// Subagents: definitions, the management API, and runs through a real dsh server with a mock model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-agents-'));
process.env.DSH_TEMP_ROOTS = path.join(tmp, 'no-temp');
process.env.HOME = path.join(tmp, 'user');
process.env.DSH_HOME = path.join(tmp, 'user', '.dsh');
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'); fs.mkdirSync(path.join(work, 'src'), { recursive: true });
fs.writeFileSync(path.join(work, 'src', 'main.js'), 'export const answer = 42;\n');

// The mock answers by conversation, not by order, since parallel subagents call it in any order.
const requests = [], mockErrors = [];
const sse = (res, chunks, delay = 0) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); (async () => { for (const c of chunks) { res.write(`data: ${JSON.stringify(c)}\n\n`); if (delay) await new Promise(r => setTimeout(r, delay)); } res.end('data: [DONE]\n\n'); })(); };
const delta = d => ({ choices: [{ index: 0, delta: d }] });
const usage = n => ({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: n, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: n, completion_tokens: 10 } });
const call = (id, name, args) => delta({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
let route = () => [delta({ content: 'ok' })];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const body = JSON.parse(b); requests.push(body);
    let r; try { r = route(body); } catch (e) { mockErrors.push(e); res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'mock: ' + e.message } })); }
    if (r.delay) sse(res, r.chunks, r.delay); else sse(res, r);
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const { saveConfig } = await import('../lib/store.mjs');
saveConfig({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok', mode: 'ask' });
const { createServer } = await import('../lib/server.mjs');
const { parseAgent } = await import('../lib/agents.mjs');
const srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
async function run(id, text, decide = () => 'allow', after = 0) {
  const events = [], ctrl = new AbortController();
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
const sys = b => b.messages[0].content, last = b => b.messages.at(-1);

test.afterEach(() => { const e = mockErrors.splice(0); if (e.length) throw e[0]; });
test.after(() => { srv.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('definitions: front matter, tool lists, Claude Code names, models', () => {
  const a = parseAgent('---\nname: Rev\ndescription: Reviews\ntools:\n  - read_file\n  - agent\n  - grep\nmodel: pro\neffort: max\n---\nBe careful.\n', 'rev.md', 'dsh');
  assert.deepEqual([a.name, a.tools, a.model, a.effort, a.prompt], ['rev', ['read_file', 'grep'], 'deepseek-v4-pro', 'max', 'Be careful.']);
  const c = parseAgent('---\nname: cc\ndescription: x\ntools: Read, Grep, Bash, WebSearch, mcp__godot__run\nmodel: haiku\n---\nHi', 'cc.md', 'claude');
  assert.deepEqual([c.tools, c.model], [['read_file', 'grep', 'bash', 'mcp__godot__run'], 'deepseek-flash']);
  assert.equal(parseAgent('---\nname: all\ndescription: x\n---\nHi', 'all.md', 'dsh').tools, null);
});

test('management API: built-ins, create, edit, toggle, Claude Code source, delete', async () => {
  let l = (await api('GET', '/api/agents?cwd=' + encodeURIComponent(work))).json;
  assert.deepEqual(l.agents.filter(a => a.source === 'builtin').map(a => a.name), ['explore', 'general-purpose', 'plan']);
  assert.ok(l.tools.some(t => t.name === 'bash') && !l.tools.some(t => t.name === 'agent'));

  assert.equal((await api('POST', '/api/agents', { cwd: work, name: 'Bad Name', description: 'x', prompt: 'y' })).status, 400);
  const r = (await api('POST', '/api/agents', { cwd: work, scope: 'project', name: 'tester', description: 'Runs the tests', tools: ['bash', 'read_file', 'agent'], model: 'flash', prompt: 'Run npm test.' })).json;
  assert.equal(r.id, 'project:tester');
  const file = path.join(work, '.dsh', 'agents', 'tester.md');
  assert.match(fs.readFileSync(file, 'utf8'), /tools: bash, read_file\nmodel: flash/);
  // Edit renames the file in place.
  await api('POST', '/api/agents', { cwd: work, id: 'project:tester', name: 'test-runner', description: 'Runs the test suite', model: 'inherit', prompt: 'Run it.' });
  assert.ok(!fs.existsSync(file) && fs.existsSync(path.join(work, '.dsh', 'agents', 'test-runner.md')));
  const read = (await api('GET', `/api/agents/read?cwd=${encodeURIComponent(work)}&id=project:test-runner`)).json;
  assert.deepEqual([read.tools, read.model, read.prompt, read.editable], [null, 'inherit', 'Run it.', true]);
  assert.equal((await api('POST', '/api/agents', { cwd: work, id: 'builtin:explore', name: 'explore', description: 'x', prompt: 'y' })).status, 400);

  l = (await api('PATCH', '/api/agents', { cwd: work, id: 'builtin:plan', enabled: false })).json;
  assert.equal(l.agents.find(a => a.id === 'builtin:plan').enabled, false);
  await api('PATCH', '/api/agents', { cwd: work, id: 'builtin:plan', enabled: true });

  fs.mkdirSync(path.join(process.env.HOME, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(process.env.HOME, '.claude', 'agents', 'cc.md'), '---\nname: cc\ndescription: From Claude\ntools: Read\n---\nHi');
  l = (await api('GET', '/api/agents?cwd=' + encodeURIComponent(work))).json;
  assert.equal(l.agents.find(a => a.id === 'claude:cc').enabled, false);
  l = (await api('PATCH', '/api/agents', { cwd: work, claude: true })).json;
  assert.equal(l.agents.find(a => a.id === 'claude:cc').enabled, true);
  await api('PATCH', '/api/agents', { cwd: work, claude: false });

  assert.equal((await api('POST', '/api/agents/delete', { cwd: work, id: 'builtin:explore' })).status, 400);
  l = (await api('POST', '/api/agents/delete', { cwd: work, id: 'project:test-runner' })).json;
  assert.ok(!l.agents.some(a => a.source === 'project'));
});

test('a subagent runs in its own context with its own tools and returns its report', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  route = b => {
    if (/subagent "explore"/.test(sys(b))) {
      assert.equal(b.model, 'deepseek-flash'); assert.equal(b.reasoning_effort, 'low');
      assert.deepEqual(b.tools.map(t => t.function.name).sort(), ['glob', 'grep', 'list_dir', 'read_file', 'skill']);
      if (last(b).role === 'user') return [call('e1', 'read_file', { path: 'src/main.js' }), usage(300)];
      if (last(b).tool_call_id === 'e1') return [call('e2', 'bash', { command: 'rm -rf src' }), usage(400)];
      return [delta({ content: 'answer is defined at src/main.js:1' }), usage(500)];
    }
    assert.match(sys(b), /Saved subagents:\n[\s\S]*- explore: Fast read-only/);
    if (last(b).role === 'user') return [call('m1', 'agent', { description: 'Find the answer', subagent_type: 'explore', prompt: 'Where is answer defined?' }), usage(1000)];
    assert.equal(last(b).content, 'answer is defined at src/main.js:1');
    return [delta({ content: 'Found it.' }), usage(1100)];
  };
  const evs = await run(s.id, 'Where is answer?');
  const tc = evs.filter(e => e.type === 'tool_call');
  assert.deepEqual(tc.map(e => [e.id, e.name, e.parent ?? null]), [['m1', 'agent', null], ['m1/e1', 'read_file', 'm1'], ['m1/e2', 'bash', 'm1']]);
  const res = Object.fromEntries(evs.filter(e => e.type === 'tool_result').map(e => [e.id, e]));
  assert.match(res['m1/e1'].content, /answer = 42/);
  assert.match(res['m1/e2'].content, /not available to this subagent/);
  assert.ok(fs.existsSync(path.join(work, 'src')));
  assert.deepEqual([res.m1.agent, res.m1.steps, res.m1.tools, res.m1.model], ['explore', 3, 2, 'deepseek-flash']);
  assert.equal(evs.filter(e => e.type === 'sub_step').length, 3);

  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  // The parent conversation holds only the agent call and its report; the subagent's own turns stay out.
  assert.deepEqual(snap.messages.map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(snap.meta['m1/e1'].parent, 'm1'); assert.equal(snap.meta['m1/e1'].name, 'read_file');
  assert.equal(snap.usage.lastPrompt, 1100, 'subagent calls stay out of the context meter');
  assert.equal(snap.usage.miss, 1000 + 300 + 400 + 500 + 1100);
});

test('subagent tools ask for approval like the main agent; parallel subagents run side by side', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  const live = new Set(); let overlap = false;
  route = b => {
    const m = /subagent "general-purpose"/.test(sys(b)) && /task (\w)/.exec(b.messages[1].content);
    if (m) {
      const k = m[1];
      if (last(b).role === 'user') { live.add(k); if (live.size > 1) overlap = true; return { delay: 60, chunks: [call('g' + k, 'bash', { command: `echo from-${k}` }), usage(100)] }; }
      live.delete(k); return [delta({ content: `report ${k}` }), usage(100)];
    }
    if (last(b).role === 'user') return [delta({ tool_calls: [
      { index: 0, id: 'pa', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'A', prompt: 'task A' }) } },
      { index: 1, id: 'pb', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'B', prompt: 'task B' }) } }] }), usage(100)];
    return [delta({ content: 'both done' }), usage(100)];
  };
  const asked = [];
  const evs = await run(s.id, 'Do A and B', ev => { asked.push(ev.id); return ev.id === 'pb/gB' ? 'deny' : 'allow'; });
  assert.ok(overlap, 'the two subagents were in flight at once');
  assert.deepEqual(asked.sort(), ['pa/gA', 'pb/gB']);
  assert.ok(evs.find(e => e.type === 'approval' && e.id === 'pa/gA').parent === 'pa');
  const res = Object.fromEntries(evs.filter(e => e.type === 'tool_result').map(e => [e.id, e]));
  assert.match(res['pa/gA'].content, /from-A/); assert.equal(res['pb/gB'].denied, true);
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.deepEqual(snap.messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]), [['pa', 'report A'], ['pb', 'report B']]);
});

test('the main agent designs a subagent on the spot: its own role, tools and model', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  route = b => {
    if (/subagent "css-auditor"/.test(sys(b))) {
      assert.match(sys(b), /^You audit CSS for contrast\./);
      assert.equal(b.model, 'deepseek-v4-pro');
      assert.deepEqual(b.tools.map(t => t.function.name).sort(), ['grep', 'read_file']);
      return [delta({ content: 'no contrast problems' }), usage(50)];
    }
    if (last(b).role === 'user') return [call('d1', 'agent', { description: 'Audit the CSS', name: 'CSS Auditor', role: 'You audit CSS for contrast.', tools: ['read_file', 'grep', 'agent'], model: 'pro', prompt: 'Check src/' }), usage(10)];
    return [delta({ content: 'done' }), usage(10)];
  };
  const evs = await run(s.id, 'audit');
  const r = evs.find(e => e.type === 'tool_result' && e.id === 'd1');
  assert.deepEqual([r.ok, r.content, r.agent, r.spawned, r.model], [true, 'no contrast problems', 'css-auditor', true, 'deepseek-v4-pro']);
  assert.equal(evs.find(e => e.type === 'tool_call' && e.id === 'd1').summary, 'CSS Auditor: Audit the CSS');
});

test('unknown saved names fail with the list; with every preset off the agent can still spawn helpers', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  route = b => last(b).role === 'user' ? [call('u1', 'agent', { description: 'x', subagent_type: 'nobody', prompt: 'hi' }), usage(10)] : [delta({ content: 'ok' }), usage(10)];
  let evs = await run(s.id, 'go');
  assert.match(evs.find(e => e.type === 'tool_result').content, /No saved subagent named "nobody". Saved: explore, general-purpose, plan. Or design one with role/);
  for (const id of ['builtin:explore', 'builtin:general-purpose', 'builtin:plan']) await api('PATCH', '/api/agents', { cwd: work, id, enabled: false });
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  route = b => {
    if (/subagent "helper"/.test(sys(b))) { assert.match(sys(b), /You are a helper agent/); return [delta({ content: 'helped' }), usage(10)]; }
    assert.ok(b.tools.some(t => t.function.name === 'agent')); assert.doesNotMatch(sys(b), /Saved subagents:/);
    return last(b).role === 'user' ? [call('h1', 'agent', { description: 'Help', prompt: 'help me' }), usage(10)] : [delta({ content: 'fine' }), usage(10)];
  };
  evs = await run(s.id, 'again', undefined, snap.live.seq);
  assert.equal(evs.find(e => e.type === 'tool_result' && e.id === 'h1').content, 'helped');
  for (const id of ['builtin:explore', 'builtin:general-purpose', 'builtin:plan']) await api('PATCH', '/api/agents', { cwd: work, id, enabled: true });
});

test('maxSteps ends a run, a raise reaches the run in progress, and a subagent keeps its own cap', async () => {
  assert.equal((await api('PUT', '/api/config', { maxSteps: 'many' })).status, 400);
  assert.equal((await api('PUT', '/api/config', { maxSteps: 0 })).status, 400);
  await api('PUT', '/api/config', { maxSteps: 3 });
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  let n = 0;
  route = () => [call('c' + ++n, 'bash', { command: 'true' }), usage(10)];
  let evs = await run(s.id, 'loop forever');
  assert.equal(n, 3); assert.equal(evs.at(-1).reason, 'max_steps');
  assert.ok(evs.some(e => e.type === 'notice' && /Stopped after 3 steps/.test(e.text)));

  // The first reply streams slowly, so the raise lands while the run is on its first of two allowed steps.
  await api('PUT', '/api/config', { maxSteps: 2 });
  n = 0;
  route = () => {
    const c = [call('c' + ++n, 'bash', { command: 'true' }), usage(10)];
    return n === 1 ? { delay: 150, chunks: c } : n < 6 ? c : [delta({ content: 'done' }), usage(10)];
  };
  const pending = run(s.id, 'again', undefined, (await api('GET', '/api/sessions/' + s.id)).json.live.seq);
  while (n < 1) await new Promise(r => setTimeout(r, 2));
  await api('PUT', '/api/config', { maxSteps: 50 });
  evs = await pending;
  assert.equal(evs.at(-1).reason, 'done', 'the raised limit let the run finish'); assert.equal(n, 6);

  await api('PUT', '/api/config', { maxSteps: 500 });
  let subSteps = 0;
  route = b => {
    if (/subagent "/.test(sys(b))) return [call('s' + ++subSteps, 'read_file', { path: 'src/main.js' }), usage(10)];
    return last(b).role === 'user' ? [call('a1', 'agent', { description: 'Spin', prompt: 'spin' }), usage(10)] : [delta({ content: 'over' }), usage(10)];
  };
  evs = await run(s.id, 'spawn one', undefined, (await api('GET', '/api/sessions/' + s.id)).json.live.seq);
  assert.equal(subSteps, 80);
  assert.match(evs.find(e => e.type === 'tool_result' && e.id === 'a1').content, /stopped after 80 steps/);
  await api('PUT', '/api/config', { maxSteps: 80 });
});
