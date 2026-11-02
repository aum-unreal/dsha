// QA regressions for the agent loop (lib/agent.mjs): real dsh HTTP server, mock DeepSeek API.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-qa-'));
process.env.DSH_TEMP_ROOTS = path.join(tmp, 'no-temp');
process.env.DSH_HOME = path.join(tmp, 'home');
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
process.env.DSH_RETRY_WAITS = '20,20';
process.env.DSH_IDLE_MS = '2000';
process.env.DSH_LIVE_OUT = '4096';
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'), other = path.join(tmp, 'other'); fs.mkdirSync(work); fs.mkdirSync(other);
const SESS = path.join(process.env.DSH_HOME, 'sessions');

const requests = [];
let script = [];
const sse = (res, chunks) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); };
const delta = d => ({ choices: [{ index: 0, delta: d }] });
const usage = (p, o = 5) => ({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: p, completion_tokens: o } });
const call = (id, name, args) => delta({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const body = JSON.parse(b); requests.push(body);
    const next = script.shift() ?? [delta({ content: 'ok' }), usage(10)];
    if (typeof next === 'function') return next(res, body);
    sse(res, next);
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const { saveConfig } = await import('../lib/store.mjs');
saveConfig({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok' });
const { createServer } = await import('../lib/server.mjs');
const { INTERRUPTED } = await import('../lib/agent.mjs');
const srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
async function run(id, text, decide = () => 'allow', { after = 0, onEvent } = {}) {
  const events = [], ctrl = new AbortController();
  const r = await fetch(`${base}/api/sessions/${id}/events?after=${after}`, { headers: { authorization: 'Bearer tok' }, signal: ctrl.signal });
  const done = (async () => {
    let buf = ''; const dec = new TextDecoder();
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(i + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(6)); events.push(ev); await onEvent?.(ev);
        if (ev.type === 'approval') { const d = await decide(ev); if (d) await api('POST', `/api/sessions/${id}/approve`, { id: ev.id, decision: d }); }
        if (ev.type === 'run_end') { ctrl.abort(); return events; }
      }
    }
  })().catch(e => { if (e.name !== 'AbortError') throw e; return events; });
  await (text == null ? api('POST', `/api/sessions/${id}/retry`) : api('POST', `/api/sessions/${id}/messages`, { text }));
  return done;
}
const held = chunks => { let release; const f = res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); release = () => { for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); }; }; return [f, () => release()]; };
const until = async f => { for (let i = 0; i < 200 && !await f(); i++) await new Promise(r => setTimeout(r, 25)); assert.ok(await f()); };
const writeSession = s => { fs.mkdirSync(SESS, { recursive: true }); fs.writeFileSync(path.join(SESS, s.id + '.json'), JSON.stringify(s)); };
const bare = (id, messages, extra = {}) => ({ id, title: 't', cwd: work, model: 'deepseek-flash', effort: 'high', thinking: true, mode: 'auto', created: 1, updated: 1, messages, meta: {}, allow: [], todos: [], usage: { hit: 0, miss: 0, out: 0, cost: 0, lastPrompt: 0 }, ...extra });

test.after(() => { srv.close(); mock.close(); try { fs.chmodSync(SESS, 0o755); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); });

test('#1/#56 mid-run compaction: snapshot holds the compacted base and replays from after the compacted event', async () => {
  const s = bare('qamidcompact', [{ role: 'user', content: 'a0' }, { role: 'assistant', content: 'r0', reasoning_content: '' }, { role: 'user', content: 'a1' }, { role: 'assistant', content: 'r1', reasoning_content: '' }], { meta: { steer2: true, think3: 40 } });
  s.usage.lastPrompt = 800000; writeSession(s);
  // Stale index meta from before compaction must not leak onto the new messages.
  const [held2, release] = held([delta({ content: 'after' }), usage(100)]);
  let compactCalls = 0;
  script = [(res, b) => { compactCalls++; sse(res, [delta({ content: 'SUMMARY' }), usage(1000)]); }, held2];
  const n0 = requests.length, p = run(s.id, 'b');
  await until(() => requests.length >= n0 + 2);
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(compactCalls, 1);
  assert.equal(snap.live.running, true);
  assert.equal(snap.messages.length, 3, 'summary, ack, continue');
  assert.match(snap.messages[2].content, /Continue with my latest request: b/);
  const ev = await fetch(`${base}/api/sessions/${s.id}/events?after=${snap.live.fromSeq}`, { headers: { authorization: 'Bearer tok' } });
  const rd = ev.body.getReader(); const { value } = await Promise.race([rd.read(), new Promise(r => setTimeout(() => r({ value: new Uint8Array() }), 200))]);
  rd.cancel().catch(() => {});
  assert.doesNotMatch(new TextDecoder().decode(value), /"compacted"/, 'the replay never includes the compacted event again');
  release();
  const evs = await p;
  assert.equal(evs.at(-1).reason, 'done');
  const fin = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.ok(!Object.keys(fin.meta).some(k => /^(steer|think)\d+$/.test(k)));
});

test('#57 compaction retries a transient failure', async () => {
  const s = bare('qacompact', [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y', reasoning_content: '' }, { role: 'user', content: 'z' }, { role: 'assistant', content: 'w', reasoning_content: '' }]);
  s.usage.lastPrompt = 900000; writeSession(s);
  script = [res => { res.writeHead(503); res.end('{"error":{"message":"busy"}}'); }, [delta({ content: 'SUM' }), usage(10)], [delta({ content: 'fine' }), usage(10)]];
  const evs = await run(s.id, 'go');
  assert.equal(evs.at(-1).reason, 'done');
  assert.ok(evs.some(e => e.type === 'api_retry') && evs.some(e => e.type === 'compacted'));
});

test('#6/#28 orphan tool_calls left by a dead dsh are answered on load; retry and new messages work', async () => {
  const a = { role: 'assistant', content: '', reasoning_content: 'r', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"true"}' } }] };
  writeSession(bare('qaorphan', [{ role: 'user', content: 'do' }, a]));
  const snap = (await api('GET', '/api/sessions/qaorphan')).json;
  assert.deepEqual(snap.messages.map(m => m.role), ['user', 'assistant', 'tool']);
  assert.equal(snap.messages[2].content, INTERRUPTED); assert.equal(snap.messages[1].reasoning_content, 'r', 'reasoning kept');
  assert.equal(snap.meta.c1.ok, false);
  script = [[delta({ content: 'redo' }), usage(10)]];
  const evs = await run('qaorphan', null);
  assert.equal(evs.at(-1).reason, 'done');
  assert.deepEqual(requests.at(-1).messages.map(m => m.role), ['system', 'user', 'assistant', 'tool']);
  // Orphan in the middle (the user already sent another message): results go before it, index meta shifts.
  writeSession(bare('qaorphan2', [{ role: 'user', content: 'do' }, { ...a, tool_calls: [...a.tool_calls, { id: 'c2', type: 'function', function: { name: 'bash', arguments: '{}' } }] }, { role: 'user', content: 'hello?' }], { meta: { steer2: true, think1: 50 } }));
  script = [[delta({ content: 'hi' }), usage(10)]];
  await run('qaorphan2', 'again');
  assert.deepEqual(requests.at(-1).messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user', 'user']);
  const s2 = (await api('GET', '/api/sessions/qaorphan2')).json;
  assert.equal(s2.meta.steer4, true); assert.equal(s2.meta.think1, 50); assert.equal(s2.meta.steer2, undefined);
});

test('#7 deleting a running session keeps it deleted', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  const [h, release] = held([delta({ content: 'late' }), usage(10)]);
  script = [h];
  const n0 = requests.length, p = run(s.id, 'x');
  await until(() => requests.length > n0);
  assert.equal((await api('DELETE', '/api/sessions/' + s.id)).status, 200);
  release(); await p;
  await new Promise(r => setTimeout(r, 200));
  assert.equal(fs.existsSync(path.join(SESS, s.id + '.json')), false);
  assert.ok(!(await api('GET', '/api/sessions')).json.some(x => x.id === s.id));
});

test('#8 thinking turned on mid-run: every assistant turn carries reasoning_content', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto', thinking: false })).json;
  const [h, release] = held([call('l1', 'list_dir', { path: '.' }), usage(10)]);
  script = [h, [delta({ content: 'done' }), usage(10)]];
  const n0 = requests.length, p = run(s.id, 'x');
  await until(() => requests.length > n0);
  await api('PATCH', '/api/sessions/' + s.id, { thinking: true });
  release(); await p;
  const last = requests.at(-1);
  assert.equal(last.thinking.type, 'enabled');
  for (const m of last.messages.filter(m => m.role === 'assistant')) assert.equal(m.reasoning_content, '');
  // An older stored session without the field is sent with ''.
  writeSession(bare('qaoldreason', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]));
  await run('qaoldreason', 'c');
  assert.equal(requests.at(-1).messages[2].reasoning_content, '');
});

test('#18 live tool output is capped per call', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  script = [[call('b1', 'bash', { command: 'i=0; while [ $i -lt 400 ]; do echo 0123456789012345678901234567890123456789; i=$((i+1)); done' }), usage(10)]];
  const evs = await run(s.id, 'spam');
  const outs = evs.filter(e => e.type === 'tool_output');
  const bytes = outs.reduce((n, e) => n + e.d.length, 0);
  assert.ok(bytes < 4096 + 8192 && bytes > 0, `live output bounded (${bytes})`);
  assert.match(outs.at(-1).d, /live output stopped/);
  assert.equal(evs.find(e => e.type === 'tool_result').ok, true);
});

test('#42 a model change mid-stream prices the call at the model it used', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto', model: 'deepseek-v4-pro' })).json;
  const [h, release] = held([delta({ content: 'x' }), { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1000000, completion_tokens: 0 } }]);
  script = [h];
  const n0 = requests.length, p = run(s.id, 'x');
  await until(() => requests.length > n0);
  await api('PATCH', '/api/sessions/' + s.id, { model: 'deepseek-flash' });
  release(); await p;
  const led = fs.readFileSync(path.join(process.env.DSH_HOME, 'usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.sid === s.id);
  assert.equal(led.length, 1); assert.equal(led[0].model, 'deepseek-v4-pro'); assert.equal(led[0].off, 0.66);
});

test('#43 a cwd change mid-step applies from the next step', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  script = [[delta({ tool_calls: [
    { index: 0, id: 'p1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } },
    { index: 1, id: 'p2', type: 'function', function: { name: 'bash', arguments: '{"command":"pwd > where.txt"}' } }] }), usage(10)]];
  await run(s.id, 'where', async () => { await api('PATCH', '/api/sessions/' + s.id, { cwd: other }); return 'allow'; });
  assert.equal(fs.existsSync(path.join(work, 'where.txt')), true);
  assert.equal(fs.existsSync(path.join(other, 'where.txt')), false);
});

test('#53/#54 a failing save neither kills dsh nor leaves the session stuck running', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  fs.chmodSync(SESS, 0o555);
  try {
    script = [[delta({ content: 'ok' }), usage(10)]];
    const evs = await run(s.id, 'x');
    assert.equal(evs.at(-1).type, 'run_end');
    assert.ok(evs.some(e => e.type === 'notice' && /Couldn't save the session/.test(e.text)));
  } finally { fs.chmodSync(SESS, 0o755); }
  const h = (await api('GET', '/api/health')).json;
  assert.ok(!(h.running || []).includes(s.id));
  // A session file without meta (older or hand-written) runs.
  const b = bare('qanometa', []); delete b.meta; delete b.allow; writeSession(b);
  const evs = await run('qanometa', 'hi');
  assert.equal(evs.at(-1).reason, 'done');
});

test('#59 insufficient_system_resource fails the step as busy and Retry runs it again', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  script = [[delta({ content: 'half a rep' }), { choices: [{ index: 0, delta: {}, finish_reason: 'insufficient_system_resource' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }]];
  const evs = await run(s.id, 'x');
  assert.equal(evs.at(-1).reason, 'error');
  assert.equal(evs.find(e => e.type === 'error').kind, 'busy');
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.messages.at(-1).role, 'user', 'partial reply dropped');
  script = [[delta({ content: 'full reply' }), usage(10)]];
  const ev2 = await run(s.id, null, undefined, { after: snap.live.seq });
  assert.equal(ev2.at(-1).reason, 'done', JSON.stringify(ev2.filter(e => e.type === 'error')));
});

test('#80 a call with no usage chunk keeps the context meter and the ledger', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  script = [[delta({ content: 'a' }), usage(5000)]];
  await run(s.id, 'x');
  script = [[delta({ content: 'b' })]];
  await run(s.id, 'y');
  assert.equal((await api('GET', '/api/sessions/' + s.id)).json.usage.lastPrompt, 5000);
  const led = fs.readFileSync(path.join(process.env.DSH_HOME, 'usage.jsonl'), 'utf8').trim().split('\n').filter(l => l.includes(s.id));
  assert.equal(led.length, 1);
});

test('#87 Always allow is announced as a session patch', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  script = [[call('a1', 'bash', { command: 'true' }), usage(10)]];
  const evs = await run(s.id, 'x', () => 'always');
  assert.deepEqual(evs.find(e => e.type === 'session')?.patch, { allow: ['bash'] });
});

test('#89/#91 tool cards announced in reply order; a stopped subagent is not Done', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  const sub = { index: 0, id: 'z1', type: 'function', function: { name: 'bash', arguments: '{"command":"true"}' } };
  script = [
    [delta({ tool_calls: [
      { index: 0, id: 'm1', type: 'function', function: { name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'a', status: 'pending' }] }) } },
      { index: 1, id: 'g1', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'A', prompt: 'task' }) } }] }), usage(10)],
    [delta({ tool_calls: [sub] }), usage(10)]];
  const evs = await run(s.id, 'x', async () => { await api('POST', `/api/sessions/${s.id}/stop`); return null; });
  assert.deepEqual(evs.filter(e => e.type === 'tool_call' && !e.parent).map(e => e.id), ['m1', 'g1']);
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.meta.g1.ok, false);
  assert.match(snap.messages.find(m => m.tool_call_id === 'g1').content, /^Cancelled/);
});

test('review: a manual compact blocks new runs and Stop cancels it', async () => {
  const msgs = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y', reasoning_content: '' }, { role: 'user', content: 'z' }, { role: 'assistant', content: 'w', reasoning_content: '' }];
  writeSession(bare('qamanualcompact', msgs));
  const [f, release] = held([delta({ content: 'SUM' }), usage(10)]);
  const n = requests.length; script = [f];
  const pending = api('POST', '/api/sessions/qamanualcompact/compact');
  await until(() => requests.length > n);
  assert.equal((await api('POST', '/api/sessions/qamanualcompact/messages', { text: 'hi' })).status, 409, 'no run starts under a compaction');
  assert.equal((await api('POST', '/api/sessions/qamanualcompact/retry')).status, 409);
  await api('POST', '/api/sessions/qamanualcompact/stop');
  release();
  assert.deepEqual((await pending).json, { ok: false }, 'a stopped compaction changes nothing');
  assert.deepEqual((await api('GET', '/api/sessions/qamanualcompact')).json.messages.map(m => m.content), ['x', 'y', 'z', 'w']);
  const evs = await run('qamanualcompact', 'next');
  assert.equal(evs.at(-1).reason, 'done', 'runs start again once the compaction is over');
});
