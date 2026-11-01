// MCP client: stdio and HTTP fakes behind a real dsh server with a mock model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-mcp-'));
process.env.DSH_HOME = path.join(tmp, 'home');
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const httpPort = 20000 + (process.pid % 10000), pidfile = path.join(tmp, 'http.pid');
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.DSH_HOME, 'mcp.json'), JSON.stringify({ mcpServers: {
  fake: { command: process.execPath, args: [path.join(here, 'fake-mcp-stdio.mjs')], risk: 'edit' },
  // Nothing listens here until the `start` hook launches the fake, detached.
  web: { url: `http://127.0.0.1:${httpPort}/mcp`, start: `setsid ${process.execPath} ${path.join(here, 'fake-mcp-http.mjs')} ${httpPort} ${pidfile} >/dev/null 2>&1 &`, risk: 'read' },
  dead: { command: '/nonexistent/mcp-server' },
} }));

const requests = []; let script = [];
const sse = (res, chunks) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); };
const delta = d => ({ choices: [{ index: 0, delta: d }] });
const callOf = (id, name, args, index = 0) => delta({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const stop = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 2 } };
const mock = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { requests.push(JSON.parse(b)); sse(res, script.shift()); }); });
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const { saveConfig } = await import('../lib/store.mjs');
saveConfig({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok' });
const { createServer } = await import('../lib/server.mjs');
const srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
async function run(id, text, decide = () => 'allow', after = 0) {
  const events = []; const ctrl = new AbortController();
  const r = await fetch(`${base}/api/sessions/${id}/events?after=${after}`, { headers: { authorization: 'Bearer tok' }, signal: ctrl.signal });
  const done = (async () => {
    let buf = ''; const dec = new TextDecoder();
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(i + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(6)); events.push(ev);
        if (ev.type === 'approval') await api('POST', `/api/sessions/${id}/approve`, { id: ev.id, decision: decide(ev) });
        if (ev.type === 'run_end') { ctrl.abort(); return events; }
      }
    }
  })().catch(e => { if (e.name !== 'AbortError') throw e; return events; });
  await api('POST', `/api/sessions/${id}/messages`, { text });
  return done;
}
const toolNames = body => body.tools.map(t => t.function.name);

test.after(() => { srv.close(); mock.close(); try { process.kill(+fs.readFileSync(pidfile, 'utf8')); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); });

test('status: stdio up, http started by its hook, dead server reported', async () => {
  const { json } = await api('GET', '/api/mcp');
  const by = Object.fromEntries(json.map(s => [s.name, s]));
  assert.equal(by.fake.state, 'up'); assert.equal(by.fake.tools, 3); assert.equal(by.fake.server.name, 'fake-stdio');
  assert.equal(by.web.state, 'up'); assert.equal(by.web.tools, 1);
  assert.equal(by.dead.state, 'down'); assert.match(by.dead.error, /ENOENT|spawn/);
});

test('tools reach the model, collisions are prefixed, instructions reach the prompt', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  script = [[callOf('c1', 'echo', { text: 'hi' }), callOf('c2', 'fake_bash', {}, 1), callOf('c3', 'ping', { n: 7 }, 2), stop], [delta({ content: 'ok' }), stop]];
  const ev = await run(s.id, 'go', () => { throw new Error('read tools must not ask'); });
  const names = toolNames(requests[0]);
  assert.ok(names.includes('bash') && names.includes('echo') && names.includes('fake_bash') && names.includes('ping') && !names.includes('extra'));
  assert.match(requests[0].messages[0].content, /fake-stdio.*3 tools\nCall toggle to unlock extra/);
  const results = Object.fromEntries(ev.filter(e => e.type === 'tool_result').map(e => [e.id, e]));
  assert.equal(results.c1.content, 'echo: hi'); assert.equal(results.c1.ok, true);
  assert.equal(results.c3.content, 'pong 7');
  assert.equal(ev.find(e => e.type === 'tool_call' && e.id === 'c1').mcp, 'fake');
});

test('approval gate applies, and list_changed shows new tools on the next step', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  script = [[callOf('t1', 'toggle', {}), stop], [callOf('t2', 'extra', {}), stop], [delta({ content: 'done' }), stop]];
  const asked = [];
  const ev = await run(s.id, 'go', e => { asked.push(e.name); return e.name === 'extra' ? 'deny' : 'allow'; });
  assert.deepEqual(asked, ['toggle', 'extra']);
  assert.ok(!toolNames(requests.at(-3)).includes('extra'));
  assert.ok(toolNames(requests.at(-2)).includes('extra'));
  const t2 = ev.find(e => e.type === 'tool_result' && e.id === 't2');
  assert.equal(t2.denied, true);
});

test('mode edits runs the server default risk without asking; errors are reported', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'edits' })).json;
  script = [[callOf('e1', 'extra', {}), callOf('e2', 'ping', { n: 1 }, 1), stop], [delta({ content: 'x' }), stop]];
  const ev = await run(s.id, 'go', () => { throw new Error('must not ask'); });
  assert.equal(ev.find(e => e.id === 'e1' && e.type === 'tool_result').content, 'extra ran');
  // Stop the http fake: the next call fails cleanly and the server is marked down.
  process.kill(+fs.readFileSync(pidfile, 'utf8')); await new Promise(r => setTimeout(r, 300));
  script = [[callOf('e3', 'ping', {}), stop], [delta({ content: 'x' }), stop]];
  const ev2 = await run(s.id, 'go', () => 'allow', ev.at(-1).seq);
  const r3 = ev2.find(e => e.id === 'e3' && e.type === 'tool_result');
  assert.equal(r3.ok, false); assert.match(r3.content, /Error/);
});
