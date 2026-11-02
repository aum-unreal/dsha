// QA regressions for the API, storage, usage report and terminal client: request decoding, deleting a
// running session, mode switches with an approval open, plugin auth headers, argv splitting, slow plugins,
// session listing, symlinked files, the pre-ledger estimate's date, DST periods and the CLI chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'America/New_York'; // the DST test; the rest doesn't care
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-qa-'));
process.env.DSH_TEMP_ROOTS = path.join(tmp, 'no-temp');
process.env.HOME = path.join(tmp, 'user');
process.env.DSH_HOME = path.join(tmp, 'user', '.dsh');
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'); fs.mkdirSync(work, { recursive: true });
const DSH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dsh.mjs');

// The mock answers by conversation. A route may return { hang: true } to keep the stream open.
const sse = (res, chunks) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end('data: [DONE]\n\n'); };
const delta = d => ({ choices: [{ index: 0, delta: d }] });
const call = (id, name, args) => delta({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const last = b => b.messages.at(-1);
let route = () => [delta({ content: 'ok' })];
const hung = new Set();
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const r = route(JSON.parse(b));
    if (r.hang) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(delta({ content: 'w' }))}\n\n`); hung.add(res); return; }
    sse(res, r);
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const store = await import('../lib/store.mjs');
store.saveConfig({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok', mode: 'ask' });
const { createServer, splitArgs } = await import('../lib/server.mjs');
const { saveMcpConfig, loadMcpConfig } = await import('../lib/mcp.mjs');
const { usageReport } = await import('../lib/usage.mjs');
let srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port, base = `http://127.0.0.1:${port}`;
store.saveConfig({ port }); // the CLI finds this server through the config
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const wait = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 30)); } };
// The CLI talks to this process's server, so it must not be run with spawnSync (that blocks the server).
const runCli = (args, { env = process.env, input } = {}) => new Promise(ok => {
  const p = spawn(process.execPath, [DSH, ...args], { env }); let stdout = '', stderr = '';
  p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
  p.on('close', status => ok({ status, stdout, stderr })); p.stdin.end(input ?? '');
});
const sessFile = id => path.join(process.env.DSH_HOME, 'sessions', id + '.json');

test.after(() => { for (const r of hung) r.destroy(); srv.closeAllConnections?.(); srv.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('a UTF-8 character split across two body chunks arrives whole (#9)', async () => {
  const s = (await api('POST', '/api/sessions', { cwd: work })).json;
  const body = Buffer.from(JSON.stringify({ title: 'aé b ✓' })), cut = body.indexOf(0xc3) + 1;
  await new Promise((ok, bad) => {
    const c = net.connect(port, '127.0.0.1', () => {
      c.write(`PATCH /api/sessions/${s.id} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer tok\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
      c.write(body.subarray(0, cut)); setTimeout(() => c.write(body.subarray(cut)), 100);
    });
    c.on('data', () => {}); c.on('end', ok); c.on('error', bad);
  });
  assert.equal((await api('GET', '/api/sessions/' + s.id)).json.title, 'aé b ✓');
});

test('deleting a running session (streaming or waiting for approval) keeps it deleted (#10, #29)', async () => {
  route = () => ({ hang: true });
  const a = (await api('POST', '/api/sessions', { cwd: work })).json;
  await api('POST', `/api/sessions/${a.id}/messages`, { text: 'go' });
  await wait(async () => (await api('GET', '/api/sessions/' + a.id)).json.live.running);
  assert.deepEqual((await api('DELETE', '/api/sessions/' + a.id)).json, { ok: true });
  route = b => last(b).role === 'user' ? [call('c1', 'bash', { command: 'echo hi' })] : [delta({ content: 'done' })];
  const b = (await api('POST', '/api/sessions', { cwd: work })).json;
  await api('POST', `/api/sessions/${b.id}/messages`, { text: 'tool' });
  await wait(async () => (await api('GET', '/api/sessions/' + b.id)).json.live.waiting.length);
  await api('DELETE', '/api/sessions/' + b.id);
  await new Promise(r => setTimeout(r, 400));
  for (const id of [a.id, b.id]) {
    assert.equal(fs.existsSync(sessFile(id)), false);
    assert.ok(!(await api('GET', '/api/sessions')).json.some(x => x.id === id));
    assert.equal((await api('GET', '/api/sessions/' + id)).status, 404);
  }
  assert.ok(!(await api('GET', '/api/health')).json.running.includes(b.id));
});

test('switching to Auto lets a tool waiting for approval run (#88)', async () => {
  route = b => last(b).role === 'user' ? [call('c1', 'bash', { command: 'echo unblocked' })] : [delta({ content: 'done' })];
  const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'tool' });
  await wait(async () => (await api('GET', '/api/sessions/' + s.id)).json.live.waiting.length);
  await api('PATCH', '/api/sessions/' + s.id, { mode: 'edits' }); // bash is exec: still waits
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual((await api('GET', '/api/sessions/' + s.id)).json.live.waiting, ['c1']);
  await api('PATCH', '/api/sessions/' + s.id, { mode: 'auto' });
  const snap = await wait(async () => { const j = (await api('GET', '/api/sessions/' + s.id)).json; return !j.live.running && j; });
  assert.match(snap.messages.find(m => m.role === 'tool').content, /unblocked/);
});

test('a plugin\'s saved headers follow it only within the same origin (#47)', async () => {
  saveMcpConfig({ gh: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer SECRET' }, disabled: true } });
  await api('PUT', '/api/mcp/gh', { url: 'http://127.0.0.1:9/v2/mcp' });
  assert.equal(loadMcpConfig().gh.headers.Authorization, 'Bearer SECRET');
  await api('PUT', '/api/mcp/gh', { url: 'http://127.0.0.1:10/mcp' });
  assert.equal(loadMcpConfig().gh.headers, undefined);
  saveMcpConfig({});
});

test('plugin commands split like a shell (#92)', () => {
  assert.deepEqual(splitArgs(`cmd --flag="a b"`), ['cmd', '--flag=a b']);
  assert.deepEqual(splitArgs('cmd a\\ b'), ['cmd', 'a b']);
  assert.deepEqual(splitArgs('cmd "a"b'), ['cmd', 'ab']);
  assert.deepEqual(splitArgs(`npx -y pkg 'it''s' "q\\"x" ""`), ['npx', '-y', 'pkg', 'its', 'q"x', '']);
});

test('a hung plugin does not hold the Subagents page or hide the healthy plugins\' tools (#95)', async () => {
  const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-mcp-stdio.mjs');
  await api('PUT', '/api/mcp/slow', { command: 'sleep 100' });
  await api('PUT', '/api/mcp/fake', { command: `"${process.execPath}" "${fake}"` });
  const t0 = Date.now(), r = await api('GET', '/api/agents?cwd=' + encodeURIComponent(work));
  assert.equal(r.status, 200); assert.ok(r.json.tools.some(t => t.name === 'bash' && !t.mcp));
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(r.json.tools.filter(t => t.mcp).map(t => [t.name, t.risk]).sort(), [['echo', 'read'], ['fake_bash', 'read'], ['toggle', 'exec']]);
  await api('DELETE', '/api/mcp/slow'); await api('DELETE', '/api/mcp/fake');
});

test('sessions are listed by file name, tolerate missing fields, and re-read only when changed (#86, #98, #99)', async () => {
  const dir = path.join(process.env.DSH_HOME, 'sessions');
  fs.writeFileSync(path.join(dir, 'copyid.json'), JSON.stringify({ id: 'origid', title: 'Copy', cwd: work, messages: [{ role: 'user', content: 'x' }], meta: {}, usage: {} }));
  let l = store.listSessions();
  assert.ok(l.some(s => s.id === 'copyid') && !l.some(s => s.id === 'origid'));
  assert.equal(store.loadSession('copyid').id, 'copyid');
  fs.writeFileSync(path.join(dir, 'copyid.json'), JSON.stringify({ title: 'Renamed', messages: [] }));
  assert.equal(store.listSessions().find(s => s.id === 'copyid').title, 'Renamed');
  const out = await runCli(['ls']);
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /copyid {2}\? +/);
  fs.rmSync(path.join(dir, 'copyid.json'));
  assert.ok(!store.listSessions().some(s => s.id === 'copyid'));
});

test('writing through a symlink updates its target and keeps the link (#62)', () => {
  const real = path.join(tmp, 'real.md'), link = path.join(work, 'LINK.md');
  fs.writeFileSync(real, 'orig'); fs.symlinkSync(real, link);
  store.writeAtomic(link, 'new');
  assert.ok(fs.lstatSync(link).isSymbolicLink()); assert.equal(fs.readFileSync(real, 'utf8'), 'new');
});

test('the pre-ledger estimate keeps its date when an old session is touched; periods use calendar days (#12, #31, #60)', () => {
  const H = process.env.DSH_HOME, now = new Date(2026, 10, 3, 12).getTime(), june = new Date(2026, 5, 10).getTime();
  fs.writeFileSync(path.join(H, 'usage.jsonl'), [
    { t: new Date(2026, 9, 28, 0, 30).getTime(), sid: 'x', model: 'deepseek-flash', cost: 1, off: 1 },         // Oct 28 00:30 EDT, inside the week
    { t: now - 3600e3, sid: 'oldsess', model: 'deepseek-flash', cost: 0.01, off: 0.01 },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  store.saveSession({ id: 'oldsess', title: 'Old', cwd: work, model: 'deepseek-flash', created: june, messages: [], meta: {}, usage: { costOff: 5.01 } });
  const r1 = usageReport({ now });
  const est = r => r.periods.today.est;
  assert.equal(est(r1), 0, 'months-old spend is not today');
  assert.ok(Math.abs(r1.total.est - 5) < 1e-9);
  store.saveSession(JSON.parse(fs.readFileSync(sessFile('oldsess'), 'utf8'))); // touched again (rename, mode change)
  const r2 = usageReport({ now });
  assert.equal(est(r2), 0); assert.ok(Math.abs(r2.periods.week.cost - 1.01) < 1e-9, 'Oct 28 00:30 is in the 7 days');
  assert.equal(r2.days.find(d => d.day === '2026-10-28').cost, 1);
  // A session nobody has run since the ledger began: its date is pinned the first time it is reported.
  fs.writeFileSync(path.join(H, 'usage.jsonl'), '');
  const s = { id: 'idle1', title: 'Idle', cwd: work, model: 'deepseek-flash', created: june, messages: [], meta: {}, usage: { costOff: 2 } };
  store.saveSession(s); const t1 = s.updated;
  usageReport({ now: t1 + 1000 });
  store.saveSession(s);
  const r3 = usageReport({ now: s.updated + 864e5 * 3 });
  assert.equal(r3.sessions.find(x => x.id === 'idle1').last, t1);
  store.deleteSession('oldsess'); store.deleteSession('idle1'); fs.rmSync(path.join(H, 'usage.jsonl'));
});

test('dsh key never saves an empty or malformed key (#85)', async () => {
  const kf = path.join(tmp, 'key2'); fs.writeFileSync(kf, 'sk-mockkey000000000\n');
  const env = { ...process.env, DSH_KEY_FILE: kf };
  let r = await runCli(['key'], { env, input: '\n' });
  assert.match(r.stdout, /unchanged/); assert.equal(fs.readFileSync(kf, 'utf8'), 'sk-mockkey000000000\n');
  r = await runCli(['key', 'oops'], { env });
  assert.equal(r.status, 1); assert.equal(fs.readFileSync(kf, 'utf8'), 'sk-mockkey000000000\n');
  r = await runCli(['key', 'sk-newkey0123456789'], { env });
  assert.equal(fs.readFileSync(kf, 'utf8'), 'sk-newkey0123456789\n');
});

test('dsh stop ignores a stale pid file that points at another process (#61)', async () => {
  const victim = spawn('sleep', ['30']);
  fs.writeFileSync(path.join(process.env.DSH_HOME, 'dsh.pid'), String(victim.pid));
  const r = await runCli(['stop']);
  assert.equal(victim.exitCode, null); assert.equal(victim.signalCode, null);
  let alive = true; try { process.kill(victim.pid, 0); } catch { alive = false; }
  assert.ok(alive, 'the unrelated process was signalled: ' + r.stdout);
  victim.kill(); fs.rmSync(path.join(process.env.DSH_HOME, 'dsh.pid'), { force: true });
});

// The terminal client against this server, its stdin a pipe.
function cli(args, env = process.env) {
  const p = spawn(process.execPath, [DSH, ...args], { env, cwd: work });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  return { p, out: () => out.replace(/\x1b\[[0-9;]*m/g, ''), send: t => p.stdin.write(t + '\n'), until: re => wait(() => re.test(out.replace(/\x1b\[[0-9;]*m/g, '')), 8000) };
}

test('dsh -c joins a run waiting for approval, answers it, and drops approvals decided elsewhere (#37, #38, #39)', async () => {
  // Two parallel subagents, each asking for bash.
  route = b => {
    const sys = b.messages[0].content;
    if (sys.includes('dsh subagent')) return last(b).role === 'user' ? [call('s1', 'bash', { command: `echo sub-${b.messages[1].content}` })] : [delta({ content: 'sub done' })];
    if (last(b).role === 'user' && last(b).content === 'two subs') return [delta({ tool_calls: [
      { index: 0, id: 'pa', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'A', prompt: 'A' }) } },
      { index: 1, id: 'pb', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'B', prompt: 'B' }) } }] })];
    if (last(b).role === 'user') return [delta({ content: 'reply to: ' + last(b).content })];
    return [delta({ content: 'all done' })];
  };
  const dir = path.join(work, 'cli'); fs.mkdirSync(dir);
  const s = (await api('POST', '/api/sessions', { cwd: dir, mode: 'ask' })).json;
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'two subs' });
  await wait(async () => (await api('GET', '/api/sessions/' + s.id)).json.live.waiting.length === 2);
  const c = cli(['-c', dir]);
  try {
    await c.until(/allow bash: .*sub-[AB]/);
    const first = c.out().match(/sub-([AB])/)[1], other = first === 'A' ? 'B' : 'A';
    c.send('y');
    await c.until(new RegExp(`allow bash: .*sub-${other}`));
    // The app answers the second one; the CLI withdraws its question.
    const w = (await api('GET', '/api/sessions/' + s.id)).json.live.waiting;
    assert.deepEqual((await api('POST', `/api/sessions/${s.id}/approve`, { id: w[0], decision: 'allow' })).json, { ok: true });
    await c.until(/\[done\]/);
    assert.match(c.out(), /all done/);
    c.send('what next');
    await c.until(/reply to: what next/);
  } finally { c.p.kill(); }
});

test('the terminal chat reattaches after dsh restarts (#40)', async () => {
  // A real `dsh serve` in its own home, so a restart is a new process (new boot id, event seqs from 1).
  route = b => [delta({ content: 'reply to: ' + last(b).content })];
  const home = path.join(tmp, 'home2'), dir = path.join(work, 'cli2'); fs.mkdirSync(dir);
  const free = await new Promise(r => { const x = net.createServer().listen(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => r(p)); }); });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ base: `http://127.0.0.1:${mock.address().port}`, cwd: work, token: 'tok2', port: free, mode: 'auto' }));
  const env = { ...process.env, DSH_HOME: home };
  const serve = () => { const p = spawn(process.execPath, [DSH, 'serve'], { env, stdio: 'ignore' }); return p; };
  const up = () => wait(() => fetch(`http://127.0.0.1:${free}/api/health`, { headers: { authorization: 'Bearer tok2' } }).then(r => r.ok, () => false));
  let s1 = serve(); await up();
  const c = cli([dir], env);
  let s2;
  try {
    await c.until(/session \w+/);
    c.send('before'); await c.until(/reply to: before/);
    s1.kill('SIGKILL'); await c.until(/reconnecting/);
    s2 = serve(); await up();
    await c.until(/dsh restarted/);
    c.send('after'); await c.until(/reply to: after/);
  } finally { c.p.kill(); s1.kill(); s2?.kill(); }
});

test('switching to Edits approves a waiting file write only inside the working directory (#88)', async () => {
  const outside = path.join(tmp, 'outside.txt');
  route = b => last(b).role === 'user' ? [call('w1', 'write_file', { path: last(b).content, content: 'x' })] : [delta({ content: 'done' })];
  for (const [target, expect] of [[outside, false], ['inside.txt', true]]) {
    const s = (await api('POST', '/api/sessions', { cwd: work, mode: 'ask' })).json;
    await api('POST', `/api/sessions/${s.id}/messages`, { text: target });
    await wait(async () => (await api('GET', '/api/sessions/' + s.id)).json.live.waiting.length);
    await api('PATCH', '/api/sessions/' + s.id, { mode: 'edits' });
    if (expect) await wait(async () => !(await api('GET', '/api/sessions/' + s.id)).json.live.running);
    else { await new Promise(r => setTimeout(r, 200)); assert.deepEqual((await api('GET', '/api/sessions/' + s.id)).json.live.waiting, ['w1']); await api('POST', `/api/sessions/${s.id}/stop`); }
    assert.equal(fs.existsSync(path.resolve(work, target)), expect, target);
  }
});

test('dsh -c with its input used up denies an approval instead of hanging, and exits (#36)', async () => {
  route = b => last(b).role === 'user' ? [call('b1', 'bash', { command: 'echo never' })] : [delta({ content: 'gave up' })];
  const dir = path.join(work, 'cli3'); fs.mkdirSync(dir);
  const r = await runCli([dir], { input: 'run it\n' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no input left: denied bash/); assert.match(r.stdout, /gave up/);
});

test('joining a run replays only the approvals still open; a deleted session ends the chat (#39, #40)', async () => {
  // Two bash calls one after the other: the first is answered before the CLI joins.
  route = b => { const n = b.messages.filter(m => m.role === 'tool').length; return n < 2 ? [call('q' + n, 'bash', { command: 'echo step' + n })] : [delta({ content: 'end' })]; };
  const dir = path.join(work, 'cli4'); fs.mkdirSync(dir);
  const s = (await api('POST', '/api/sessions', { cwd: dir, mode: 'ask' })).json;
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'go' });
  await wait(async () => (await api('GET', '/api/sessions/' + s.id)).json.live.waiting[0] === 'q0');
  await api('POST', `/api/sessions/${s.id}/approve`, { id: 'q0', decision: 'allow' });
  await wait(async () => (await api('GET', '/api/sessions/' + s.id)).json.live.waiting[0] === 'q1');
  const c = cli(['-c', dir]);
  try {
    await c.until(/allow bash: .*step1/);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(c.out().match(/allow bash/g).length, 1, c.out());
    await api('DELETE', '/api/sessions/' + s.id);
    await c.until(/session was deleted/);
    await wait(() => c.p.exitCode !== null);
    assert.equal(c.p.exitCode, 1);
  } finally { c.p.kill(); }
});

test('dsh stop escalates to SIGKILL when SIGTERM is ignored (#61)', async () => {
  const home = path.join(tmp, 'home3'), fakeDir = path.join(tmp, 'fakedsh'); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(fakeDir);
  fs.writeFileSync(path.join(fakeDir, 'dsh.mjs'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
  const free = await new Promise(r => { const x = net.createServer().listen(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => r(p)); }); });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ token: 't', port: free }));
  const stubborn = spawn(process.execPath, [path.join(fakeDir, 'dsh.mjs'), 'serve']);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(home, 'dsh.pid'), String(stubborn.pid));
  const r = await runCli(['stop'], { env: { ...process.env, DSH_HOME: home } });
  assert.match(r.stdout, new RegExp('stopped ' + stubborn.pid), r.stdout + r.stderr);
  assert.match(r.stderr, /did not exit on SIGTERM/);
  assert.equal(stubborn.signalCode ?? (await new Promise(ok => stubborn.on('exit', (c, sig) => ok(sig)))), 'SIGKILL');
});
