// End-to-end: real dsh HTTP server, mock DeepSeek API, real tools in a temp dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-test-'));
process.env.DSH_TEMP_ROOTS = path.join(tmp, 'no-temp');           // test folders live in $TMPDIR
process.env.DSH_HOME = path.join(tmp, 'home');
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
process.env.DSH_RETRY_WAITS = '20,20';
process.env.DSH_IDLE_MS = '2000';                                  // a silent stream counts as dropped fast                            // two quick retries
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
fs.writeFileSync(path.join(work, 'AGENTS.md'), 'Always say MAGIC.');

// Scripted model: each request pops the next reply.
const requests = [];
let script = [];
const sse = (res, chunks) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); };
const delta = d => ({ choices: [{ index: 0, delta: d }] });
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (req.url === '/models') return res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }));
    const body = JSON.parse(b); requests.push(body);
    const next = script.shift();
    if (typeof next === 'function') return next(res, body);
    sse(res, next);
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const { saveConfig } = await import('../lib/store.mjs');
saveConfig({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok' });
const { createServer } = await import('../lib/server.mjs');
const srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (method, p, body, token = 'tok') => {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
// Collects SSE events until run_end, answering approvals with `decide`.
async function run(id, text, decide = () => 'allow', after = 0) {
  const events = [];
  const ctrl = new AbortController();
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
  await (text == null ? api('POST', `/api/sessions/${id}/retry`) : api('POST', `/api/sessions/${id}/messages`, { text }));
  return done;
}
const fail = (code, msg) => res => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: msg } })); };

test.after(() => { srv.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('rejects missing token', async () => {
  assert.equal((await api('GET', '/api/health', null, 'nope')).status, 401);
  assert.equal((await api('GET', '/api/health')).json.hasKey, true);
});

test('tool loop: approval, bash, edit, reasoning round-trip, usage', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  assert.equal(s.mode, 'ask');
  script = [
    [delta({ reasoning_content: 'Need to ' }), delta({ reasoning_content: 'look.' }),
     delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"comm' } }] }),
     delta({ tool_calls: [{ index: 0, function: { arguments: 'and":"echo hi > a.txt; cat a.txt"}' } }] }),
     delta({ tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] }),
     { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60, completion_tokens: 20 } }],
    [delta({ tool_calls: [{ index: 0, id: 'c3', type: 'function', function: { name: 'edit_file', arguments: '{"path":"a.txt","old_string":"hi","new_string":"bye"}' } }] })],
    [delta({ reasoning_content: 'ok' }), delta({ content: 'All ' }), delta({ content: 'done. MAGIC' }), { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, prompt_cache_hit_tokens: 150, completion_tokens: 5 } }],
  ];
  requests.length = 0;
  const seen = [];
  const ev = await run(s.id, 'make a file', e => { seen.push(e.name); return e.name === 'edit_file' ? 'deny' : 'allow'; });
  assert.deepEqual(seen, ['bash', 'edit_file']); // read_file never asks
  assert.equal(ev.filter(e => e.type === 'reasoning').map(e => e.d).join(''), 'Need to look.ok');
  assert.equal(ev.filter(e => e.type === 'text').map(e => e.d).join(''), 'All done. MAGIC');
  const results = ev.filter(e => e.type === 'tool_result');
  assert.match(results[0].content, /hi\n\[exit 0\]/);
  assert.match(results[1].content, /1\thi/);
  assert.equal(results[2].denied, true);
  assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'hi\n');
  assert.equal(ev.at(-1).reason, 'done');
  // Request 2 must carry the first assistant turn's reasoning and both tool results.
  const m2 = requests[1].messages;
  assert.equal(m2[0].role, 'system'); assert.match(m2[0].content, /Always say MAGIC/);
  assert.equal(m2[2].reasoning_content, 'Need to look.');
  assert.equal(m2[2].tool_calls.length, 2);
  assert.deepEqual(m2.slice(3).map(m => m.tool_call_id), ['c1', 'c2']);
  assert.ok(requests[0].tools.some(t => t.function.name === 'bash'));
  assert.equal(requests[0].thinking.type, 'enabled');
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.title, 'make a file');
  assert.equal(snap.usage.hit, 190); assert.equal(snap.usage.miss, 110); assert.equal(snap.usage.out, 25);
  assert.equal(snap.live.running, false);
  assert.equal(snap.messages.length, 1 + 1 + 2 + 1 + 1 + 1);
});

test('always-allow persists; auto mode skips approval', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'edits' })).json;
  const call = (id, name, args) => [delta({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })];
  script = [call('w1', 'write_file', { path: 'b.txt', content: 'x' }), call('b1', 'bash', { command: 'true' }), [delta({ content: 'ok' })]];
  let asked = [];
  await run(s.id, 'go', e => { asked.push(e.name); return 'always'; });
  assert.deepEqual(asked, ['bash']); // edits mode auto-allows write_file
  script = [call('b2', 'bash', { command: 'true' }), [delta({ content: 'ok' })]];
  asked = [];
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  await run(s.id, 'again', e => { asked.push(e.name); return 'deny'; }, snap.live.seq);
  assert.deepEqual(asked, []);
});

test('stop kills a running command and ends the run', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  script = [[delta({ tool_calls: [{ index: 0, id: 'z', type: 'function', function: { name: 'bash', arguments: '{"command":"sleep 30"}' } }] })]];
  const t0 = Date.now();
  const p = run(s.id, 'sleep');
  setTimeout(() => api('POST', `/api/sessions/${s.id}/stop`), 700);
  const ev = await p;
  assert.ok(Date.now() - t0 < 8000);
  assert.equal(ev.at(-1).reason, 'stopped');
  assert.match(ev.find(e => e.type === 'tool_result').content, /stopped by user/);
});

test('reattach mid-run replays from fromSeq without duplicating messages', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  let release;
  script = [(res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(delta({ content: 'part1 ' }))}\n\n`); release = () => { res.write(`data: ${JSON.stringify(delta({ content: 'part2' }))}\n\n`); res.end('data: [DONE]\n\n'); }; }];
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'hi' });
  await new Promise(r => setTimeout(r, 300));
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.live.running, true);
  assert.equal(snap.messages.length, 0); // the in-flight user turn comes from replay
  const evs = [];
  const r = await fetch(`${base}/api/sessions/${s.id}/events?after=${snap.live.fromSeq}`, { headers: { authorization: 'Bearer tok' } });
  release();
  let buf = '';
  for await (const c of r.body) { buf += new TextDecoder().decode(c); if (buf.includes('"run_end"')) break; }
  for (const b of buf.split('\n\n')) { const l = b.split('\n').find(x => x.startsWith('data: ')); if (l) evs.push(JSON.parse(l.slice(6))); }
  assert.equal(evs[0].type, 'run_start');
  assert.equal(evs.find(e => e.type === 'user').text, 'hi');
  assert.equal(evs.filter(e => e.type === 'text').map(e => e.d).join(''), 'part1 part2');
});

test('reattach mid-run at=step: finished steps come as messages, only the step in progress replays', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  let release;
  script = [
    [delta({ reasoning_content: 'plan' }), delta({ tool_calls: [{ index: 0, id: 'k1', type: 'function', function: { name: 'bash', arguments: '{"command":"echo one"}' } }] })],
    (res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(delta({ content: 'step2 ' }))}\n\n`); release = () => { res.write(`data: ${JSON.stringify(delta({ content: 'done' }))}\n\n`); res.end('data: [DONE]\n\n'); }; },
  ];
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'go' });
  for (let i = 0; i < 50 && !release; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 100));
  const whole = (await api('GET', '/api/sessions/' + s.id)).json, snap = (await api('GET', `/api/sessions/${s.id}?at=step`)).json;
  assert.equal(whole.messages.length, 0);                        // default (CLI): the run replays whole
  assert.deepEqual(snap.messages.map(m => m.role), ['user', 'assistant', 'tool']);
  assert.equal(snap.messages[1].reasoning_content, 'plan');
  assert.ok(snap.live.fromSeq > whole.live.fromSeq);
  assert.deepEqual(snap.live.queue, []);
  const r = await fetch(`${base}/api/sessions/${s.id}/events?after=${snap.live.fromSeq}`, { headers: { authorization: 'Bearer tok' } });
  release();
  let buf = ''; const evs = [];
  for await (const c of r.body) { buf += new TextDecoder().decode(c); if (buf.includes('"run_end"')) break; }
  for (const b of buf.split('\n\n')) { const l = b.split('\n').find(x => x.startsWith('data: ')); if (l) evs.push(JSON.parse(l.slice(6))); }
  assert.equal(evs[0].type, 'step_start');
  assert.ok(!evs.some(e => e.type === 'tool_call' || e.type === 'user' || e.type === 'reasoning'));
  assert.equal(evs.filter(e => e.type === 'text').map(e => e.d).join(''), 'step2 done');
});

test('rewind drops the turn and returns its text', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  script = [[delta({ content: 'a' })]]; await run(s.id, 'first');
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  script = [[delta({ content: 'b' })]]; await run(s.id, 'second', undefined, snap.live.seq);
  const r = (await api('POST', `/api/sessions/${s.id}/rewind`, { turn: 1 })).json;
  assert.equal(r.text, 'second');
  assert.equal(r.session.messages.length, 2);
});

test('fs listing and bad cwd', async () => {
  fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
  const r = (await api('GET', '/api/fs?path=' + encodeURIComponent(work))).json;
  assert.ok(r.dirs.includes('sub'));
  assert.equal((await api('POST', '/api/sessions', { cwd: path.join(work, 'nope') })).status, 400);
});

test('API trouble: transient errors retry, others stay on the session until Retry', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  script = [fail(503, 'Server busy'), fail(429, 'Slow down'), [delta({ content: 'made it' })]];
  let evs = await run(s.id, 'hello');
  const tries = evs.filter(e => e.type === 'api_retry');
  assert.deepEqual(tries.map(e => [e.kind, e.attempt, e.of]), [['busy', 1, 2], ['rate', 2, 2]]);
  assert.equal(evs.find(e => e.type === 'error'), undefined);
  assert.equal(evs.filter(e => e.type === 'text').map(e => e.d).join(''), 'made it');
  assert.equal((await api('GET', '/api/health')).json.api.ok, true);

  // A rejected key is not retried; the error is kept on the session and in health.
  let snap = (await api('GET', '/api/sessions/' + s.id)).json;
  script = [fail(401, 'Authentication Fails')];
  evs = await run(s.id, 'again', undefined, snap.live.seq);
  const err = evs.find(e => e.type === 'error');
  assert.equal(err.kind, 'auth'); assert.match(err.message, /401: Authentication Fails/);
  assert.equal(evs.at(-1).reason, 'error');
  snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.meta.error.kind, 'auth');
  assert.equal((await api('GET', '/api/health')).json.api.kind, 'auth');

  // Retry runs from the unanswered message without adding a new one.
  script = [[delta({ content: 'second try' })]];
  evs = await run(s.id, null, undefined, snap.live.seq);
  assert.equal(evs.find(e => e.type === 'user'), undefined);
  snap = (await api('GET', '/api/sessions/' + s.id)).json;
  assert.equal(snap.meta.error, undefined);
  assert.deepEqual(snap.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(snap.messages.at(-1).content, 'second try');
  assert.equal((await api('POST', `/api/sessions/${s.id}/retry`)).status, 409);
});

test('no connection to DeepSeek reads as a network error', async () => {
  const { DeepSeek } = await import('../lib/deepseek.mjs');
  const closed = http.createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port; await new Promise(r => closed.close(r));
  const ds = new DeepSeek({ key: 'k', base: `http://127.0.0.1:${port}` });
  await assert.rejects(ds.stream({ model: 'm', messages: [] }), e => e.kind === 'network' && e.transient && /Can't reach DeepSeek: ECONNREFUSED/.test(e.message));
});

test('a stream that goes silent is cut and retried', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  script = [res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': keep\n\n'); }, [delta({ content: 'after the stall' })]];
  const evs = await run(s.id, 'stall');
  const r = evs.find(e => e.type === 'api_retry');
  assert.equal(r.kind, 'network'); assert.match(r.message, /no answer for 2 s/);
  assert.equal(evs.filter(e => e.type === 'text').map(e => e.d).join(''), 'after the stall');
});

test('preview tool hands the page to the app', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  await api('PATCH', '/api/sessions/' + s.id, { mode: 'auto' });
  script = [[delta({ tool_calls: [{ index: 0, id: 'p1', type: 'function', function: { name: 'preview', arguments: '{"url":"http://127.0.0.1:5173"}' } }] })],
            [delta({ tool_calls: [{ index: 0, id: 'p2', type: 'function', function: { name: 'preview', arguments: '{"url":"file:///etc/passwd"}' } }] })],
            [delta({ content: 'There it is.' })]];
  const evs = await run(s.id, 'show me');
  assert.deepEqual(evs.filter(e => e.type === 'preview').map(e => e.url), ['http://127.0.0.1:5173/']);
  const results = evs.filter(e => e.type === 'tool_result');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false); assert.match(results[1].content, /Only http and https/);
});

// Live steering: a message sent mid-run is queued and read at the next step boundary.
const held = chunks => { let release; const f = res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); release = () => { for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); }; }; return [f, () => release()]; };
const until = async f => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 30)); assert.ok(f()); };

test('steering: a queued message is read after the step\'s tool results', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  const [step1, release] = held([delta({ reasoning_content: 'look first' }), delta({ tool_calls: [{ index: 0, id: 'l1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] })]);
  script = [step1, [delta({ content: 'Checked src too.' })]];
  const n0 = requests.length, p = run(s.id, 'list it');
  await until(() => requests.length > n0);
  const q = await api('POST', `/api/sessions/${s.id}/messages`, { text: 'also check src' });
  assert.equal(q.status, 200); assert.match(q.json.queued, /^q/);
  release();
  const ev = await p;
  assert.equal(ev.at(-1).reason, 'done');
  assert.deepEqual(ev.find(e => e.type === 'queued'), { ...ev.find(e => e.type === 'queued'), id: q.json.queued, text: 'also check src' });
  const st = ev.find(e => e.type === 'steer');
  assert.deepEqual(st.ids, [q.json.queued]);
  assert.ok(ev.indexOf(st) > ev.findIndex(e => e.type === 'tool_result'), 'read after the tool result');
  const sent = requests.at(-1).messages;
  assert.deepEqual(sent.slice(-3).map(m => m.role), ['assistant', 'tool', 'user']);
  assert.equal(sent.at(-1).content, 'also check src');
  assert.equal(sent.at(-3).reasoning_content, 'look first', 'reasoning still passed back');
  const snap = (await api('GET', '/api/sessions/' + s.id)).json;
  const i = snap.messages.findIndex(m => m.content === 'also check src');
  assert.equal(snap.meta['steer' + i], true);
  assert.equal(snap.messages.at(-1).content, 'Checked src too.');
});

test('steering: a message queued during the final reply keeps the run going', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  const [step1, release] = held([delta({ content: 'All done.' })]);
  script = [step1, [delta({ content: 'Shorter: done.' })]];
  const n0 = requests.length, p = run(s.id, 'do it');
  await until(() => requests.length > n0);
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'make it shorter' });
  release();
  const ev = await p;
  assert.equal(ev.filter(e => e.type === 'run_end').length, 1);
  assert.equal(requests.length - n0, 2);
  assert.equal(requests.at(-1).messages.at(-1).content, 'make it shorter');
  assert.equal(ev.filter(e => e.type === 'text').map(e => e.d).join(''), 'All done.Shorter: done.');
});

test('steering: cancel a queued message; a stop hands queued text back', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'auto' })).json;
  const [step1] = held([delta({ content: 'never' })]);
  script = [step1];
  const n0 = requests.length, p = run(s.id, 'wait');
  await until(() => requests.length > n0);
  const a = (await api('POST', `/api/sessions/${s.id}/messages`, { text: 'drop me' })).json.queued;
  const b = (await api('POST', `/api/sessions/${s.id}/messages`, { text: 'keep me' })).json.queued;
  assert.equal((await api('DELETE', `/api/sessions/${s.id}/queue/${a}`)).status, 200);
  assert.equal((await api('DELETE', `/api/sessions/${s.id}/queue/${a}`)).status, 409);
  await api('POST', `/api/sessions/${s.id}/stop`);
  const ev = await p;
  assert.equal(ev.at(-1).reason, 'stopped');
  assert.deepEqual(ev.filter(e => e.type === 'unqueued').map(e => [e.id, e.returned, e.text]), [[a, undefined, undefined], [b, true, 'keep me']]);
  assert.ok(!(await api('GET', '/api/sessions/' + s.id)).json.messages.some(m => m.content === 'keep me'));
});

test('running out of credit ends a run at once, with the reason', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  const before = requests.length;
  script = [(res) => { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Insufficient Balance' } })); }];
  const evs = await run(s.id, 'build it', undefined, (await api('GET', '/api/sessions/' + s.id)).json.live.seq);
  assert.equal(requests.length, before + 1, 'not retried');
  assert.equal(evs.find(e => e.type === 'error').kind, 'balance');
  assert.equal(evs.at(-1).reason, 'error');
});
