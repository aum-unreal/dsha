// QA regressions for tools, MCP, skills and subagent definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-qa-tools-')));
process.env.DSH_HOME = path.join(tmp, 'dshhome');
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });
const { TOOLS, sh, editInCwd } = await import('../lib/tools.mjs');
const { Mcp, loadMcpConfig, saveMcpConfig, CONFIG_FILE } = await import('../lib/mcp.mjs');
const { parseAgent, listAgents, setAgent, saveAgent, deleteAgent } = await import('../lib/agents.mjs');
const { listSkills, setSkill, createSkill, deleteSkill, instructionFiles, writeInstructions } = await import('../lib/skills.mjs');
const { loadConfig } = await import('../lib/store.mjs');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const ctx = { cwd: work, signal: new AbortController().signal };

test('preview asks like web_fetch: it reaches the network', () => {
  assert.equal(TOOLS.web_fetch.risk, 'exec');
  assert.equal(TOOLS.preview.risk, 'exec');
});

test('edits mode auto-approves file writes only inside the working directory', () => {
  fs.mkdirSync(path.join(work, '.git', 'hooks'), { recursive: true });
  fs.symlinkSync(tmp, path.join(work, 'escape'));
  assert.equal(editInCwd(work, 'src/a.js'), true);
  assert.equal(editInCwd(work, path.join(work, 'new', 'b.txt')), true);
  assert.equal(editInCwd(work, '.eslintrc'), true, 'project dotfiles are project files');
  assert.equal(editInCwd(work, '../outside.txt'), false);
  assert.equal(editInCwd(work, '/etc/passwd'), false);
  assert.equal(editInCwd(work, '.git/hooks/pre-commit'), false);
  assert.equal(editInCwd(work, 'escape/x.sh'), false, 'a symlink out of the folder is outside');
  assert.equal(editInCwd(work, '~/.bashrc'), false);
  assert.equal(editInCwd(work, path.join(process.env.DSH_HOME, 'mcp.json')), false);
  if (process.env.PREFIX) assert.equal(editInCwd(work, process.env.PREFIX + '/bin/rg'), false);
  // cwd = ~: dotfiles and dot-folders there still ask.
  const home = process.env.HOME;
  if (home && home !== '/') { assert.equal(editInCwd(home, '.bashrc'), false); assert.equal(editInCwd(home, '.local/bin/dsh'), false); }
});

test('edits mode: a dangling symlink is judged by where a write through it lands', () => {
  const w = path.join(tmp, 'dangle'); fs.mkdirSync(w);
  fs.symlinkSync(path.join(tmp, 'not-yet-there'), path.join(w, 'notes.md'));
  fs.symlinkSync('inner-missing', path.join(w, 'rel.md'));
  fs.symlinkSync('loop2', path.join(w, 'loop1')); fs.symlinkSync('loop1', path.join(w, 'loop2'));
  assert.equal(editInCwd(w, 'notes.md'), false);
  assert.equal(editInCwd(w, 'rel.md'), true, 'a dangling link that stays inside is fine');
  assert.equal(editInCwd(w, 'loop1'), false);
  if (process.env.HOME && process.env.HOME !== '/') {
    fs.symlinkSync(path.join(process.env.HOME, '.zz_dsha_test_never_created'), path.join(w, 'rc'));
    assert.equal(editInCwd(w, 'rc'), false);
  }
});

test('bash keeps the real end of long output', async () => {
  const r = await TOOLS.bash.run({ command: 'seq 1 60000; echo FINAL-ERROR-LINE; exit 3' }, ctx);
  assert.match(r, /FINAL-ERROR-LINE\n\[exit 3\]$/);
  assert.match(r, /chars omitted/);
  assert.match(r, /^1\n2\n3\n/);
});

test('multi-byte characters split across pipe chunks stay whole', async () => {
  const r = await sh(`${process.execPath} -e "process.stdout.write('a'.repeat(65535)+'é'.repeat(50000))"`, { cwd: work });
  assert.ok(!r.out.includes('\uFFFD'));
});

test('edit_file refuses a file that is not UTF-8 and leaves it untouched', async () => {
  const f = path.join(work, 'latin1.txt'), bytes = Buffer.from('caf\xe9\nfoo\n', 'latin1');
  fs.writeFileSync(f, bytes);
  await assert.rejects(TOOLS.edit_file.run({ path: f, old_string: 'foo', new_string: 'bar' }, ctx), /not valid UTF-8/);
  assert.ok(fs.readFileSync(f).equals(bytes));
  fs.writeFileSync(path.join(work, 'u.txt'), 'café\nfoo\n');
  await TOOLS.edit_file.run({ path: 'u.txt', old_string: 'foo', new_string: 'bar' }, ctx);
  assert.equal(fs.readFileSync(path.join(work, 'u.txt'), 'utf8'), 'café\nbar\n');
});

test('web_fetch stops reading an endless body', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); const chunk = 'x'.repeat(65536); const t = setInterval(() => { if (!res.write(chunk)) {} }, 1); res.on('close', () => clearInterval(t)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const out = await TOOLS.web_fetch.run({ url: `http://127.0.0.1:${srv.address().port}/` }, ctx);
    assert.match(out, /^HTTP 200/); assert.match(out, /body cut at \d+ bytes/);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("a subagent's todo_write does not replace the session's plan", async () => {
  const session = { todos: [{ content: 'Main plan', status: 'in_progress' }] };
  await TOOLS.todo_write.run({ todos: [{ content: 'sub step', status: 'in_progress' }] }, { ...ctx, session, subagent: null });
  assert.deepEqual(session.todos, [{ content: 'Main plan', status: 'in_progress' }]);
  await TOOLS.todo_write.run({ todos: [{ content: 'New main', status: 'pending' }] }, { ...ctx, session, subagent: () => {} });
  assert.deepEqual(session.todos, [{ content: 'New main', status: 'pending' }]);
});

test('subagent tools: an unindented YAML list is read; a present but empty key is read-only, never all tools', () => {
  assert.deepEqual(parseAgent('---\nname: r\ntools:\n- read_file\n- grep\n---\nbody', 'r.md', 'dsh').tools, ['read_file', 'grep']);
  assert.deepEqual(parseAgent('---\nname: r\ntools:\n  - read_file\n  - grep\n---\nbody', 'r.md', 'dsh').tools, ['read_file', 'grep']);
  assert.ok(!parseAgent('---\nname: r\ntools:\n---\nbody', 'r.md', 'dsh').tools.includes('bash'));
  assert.ok(!parseAgent('---\nname: r\ntools: Frobnicate\n---\nbody', 'r.md', 'claude').tools.includes('bash'));
  assert.equal(parseAgent('---\nname: r\n---\nbody', 'r.md', 'dsh').tools, null);
  assert.equal(parseAgent('---\nname: r\ndescription:\n- not a list key\nmodel: pro\n---\nb', 'r.md', 'dsh').model, 'deepseek-v4-pro');
});

test('turning off a project subagent or skill affects only that project', () => {
  const A = path.join(tmp, 'A'), B = path.join(tmp, 'B');
  for (const d of [A, B]) { saveAgent(d, { name: 'reviewer', description: 'rev ' + path.basename(d), prompt: 'p', scope: 'project' }); createSkill(d, { name: 'lint', description: 'd', body: 'b', scope: 'project' }); }
  setAgent('project:reviewer', false, A); setSkill('project:lint', false, A);
  const ag = d => listAgents(d).agents.find(a => a.id === 'project:reviewer'), sk = d => listSkills(d).skills.find(s => s.id === 'project:lint');
  assert.equal(ag(A).enabled, false); assert.equal(ag(B).enabled, true);
  assert.equal(sk(A).enabled, false); assert.equal(sk(B).enabled, true);
  setAgent('project:reviewer', true, A); assert.equal(ag(A).enabled, true);
  // Deleting a turned-off definition clears its switch: a new one under that name starts on.
  setAgent('project:reviewer', false, B); deleteAgent(B, 'project:reviewer');
  saveAgent(B, { name: 'reviewer', description: 'again', prompt: 'p', scope: 'project' }); assert.equal(ag(B).enabled, true);
  setSkill('project:lint', false, B); deleteSkill(B, 'project:lint');
  createSkill(B, { name: 'lint', description: 'd', body: 'b', scope: 'project' }); assert.equal(sk(B).enabled, true);
  setSkill('project:lint', true, A);
  assert.deepEqual(loadConfig().agents.off, []); assert.deepEqual(loadConfig().skills.off, []);
});

test('renaming a turned-off subagent keeps it off and leaves no stale entry', () => {
  saveAgent(work, { name: 'foo', description: 'd', prompt: 'p', scope: 'dsh' });
  setAgent('dsh:foo', false, work);
  const id = saveAgent(work, { id: 'dsh:foo', name: 'bar', description: 'd', prompt: 'p' });
  assert.equal(id, 'dsh:bar');
  assert.equal(listAgents(work).agents.find(a => a.id === 'dsh:bar').enabled, false);
  assert.deepEqual(loadConfig().agents.off, ['dsh:bar']);
  deleteAgent(work, 'dsh:bar'); assert.deepEqual(loadConfig().agents.off, []);
});

test('instruction files: large files come back whole; files too large to edit refuse to save', () => {
  const f = path.join(work, 'AGENTS.md'), big = 'a'.repeat(70000) + 'MIDDLE' + 'b'.repeat(50000);
  fs.writeFileSync(f, big);
  const k = instructionFiles(work).find(x => x.key === 'AGENTS.md');
  assert.equal(k.content, big); assert.equal(k.truncated, false);
  writeInstructions(work, 'AGENTS.md', k.content); assert.equal(fs.readFileSync(f, 'utf8'), big);
  const huge = 'x'.repeat(1_200_000); fs.writeFileSync(f, huge);
  const h = instructionFiles(work).find(x => x.key === 'AGENTS.md');
  assert.equal(h.truncated, true); assert.equal(h.editable, false);
  assert.throws(() => writeInstructions(work, 'AGENTS.md', h.content), /too large/);
  assert.equal(fs.readFileSync(f, 'utf8'), huge);
  fs.rmSync(f);
});

/* ---------- MCP ---------- */
const fake = path.join(here, 'fake-mcp-stdio.mjs');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('mcp.json: null entries are skipped and reported; a broken file is never overwritten', () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ mcpServers: { x: null, y: { command: '/nonexistent' } } }));
  const cfg = loadMcpConfig();
  assert.deepEqual(Object.keys(cfg), ['y']); assert.match(cfg.errors[0], /^x:/);
  const m = new Mcp(); // must not throw
  assert.equal(m.status()[0].state, 'down'); assert.match(m.status()[0].error, /^x:/);
  assert.throws(() => saveMcpConfig({ y: { command: 'node' } }), e => e.status === 400 && /^x:/.test(e.message));
  m.close();
  const broken = '{"mcpServers": {"github": {"url": "http://x", "headers": {"a": "b"}},}}';
  fs.writeFileSync(CONFIG_FILE, broken);
  assert.match(loadMcpConfig().errors[0], /not valid JSON/);
  assert.throws(() => saveMcpConfig({ other: { command: 'node' } }), e => e.status === 400 && /not valid JSON/.test(e.message));
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), broken);
  fs.rmSync(CONFIG_FILE);
});

test('concurrent schemas() spawn one stdio server, and close() leaves none', async () => {
  const log = path.join(tmp, 'spawns.log'), wrap = path.join(tmp, 'wrap.sh');
  fs.writeFileSync(wrap, `#!/bin/sh\necho $$ >> ${log}\nexec ${process.execPath} ${fake}\n`, { mode: 0o755 });
  const m = new Mcp({ fake: { command: wrap } });
  await Promise.all([m.schemas(), m.schemas(), m.schemas()]);
  const pids = fs.readFileSync(log, 'utf8').trim().split('\n').map(Number);
  assert.equal(pids.length, 1);
  m.close();
  for (let i = 0; i < 50 && pids.some(alive); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(!pids.some(alive));
});

test('MCP tool names stay with their server; always-allow keys name the server', async () => {
  const m = new Mcp({ a: { command: process.execPath, args: [fake] }, b: { command: process.execPath, args: [fake] } });
  let names = (await m.schemas()).map(t => t.function.name);
  assert.ok(names.includes('a_echo') && names.includes('b_echo') && !names.includes('echo'));
  assert.equal(m.lookup('b_echo').allowKey, 'mcp:b:echo');
  m.servers[0].fail(new Error('crashed')); // a is down for a while
  names = (await m.schemas()).map(t => t.function.name);
  assert.ok(names.includes('b_echo') && !names.includes('echo'), 'b does not take over the bare name');
  m.close();
});

test("reload replaces only the server whose entry changed; the others keep their calls and state", async () => {
  const cfg = { a: { command: process.execPath, args: [fake] }, b: { command: process.execPath, args: [fake] } };
  const m = new Mcp(cfg);
  await m.schemas();
  const [a, b] = m.servers;
  await b.call('toggle', {}); await m.schemas(); // b's extra tool is unlocked
  assert.ok(b.tools.some(t => t.name === 'extra'));
  m.load({ a: { ...cfg.a, disabled: true }, b: cfg.b });
  assert.equal(m.servers.length, 1); assert.equal(m.servers[0], b); assert.equal(b.state, 'up');
  assert.equal(a.proc, null);
  assert.equal(await b.call('extra', {}), 'extra ran');
  m.close();
});

test('HTTP MCP starts a new session after a 404 and retries the call', async () => {
  let sid = 'one', inits = 0;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
      const m = JSON.parse(body), json = r => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...r })); };
      if (m.method === 'initialize') { inits++; res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': sid }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })); }
      if (req.headers['mcp-session-id'] !== sid) { res.writeHead(404); return res.end('no session'); }
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      if (m.method === 'tools/list') return json({ result: { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } });
      json({ result: { content: [{ type: 'text', text: 'pong' }] } });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const m = new Mcp({ h: { url: `http://127.0.0.1:${srv.address().port}/mcp` } });
  try {
    await m.schemas();
    assert.equal(await m.lookup('ping').run({}, ctx), 'pong');
    sid = 'two'; // the server restarted and forgot session 'one'
    assert.equal(await m.lookup('ping').run({}, ctx), 'pong');
    assert.equal(inits, 2); assert.equal(m.servers[0].state, 'up');
  } finally { m.close(); srv.closeAllConnections(); srv.close(); }
});

test('a late 404 for an old HTTP session does not drop the new one', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(404); res.end(); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const m = new Mcp({ h: { url: `http://127.0.0.1:${srv.address().port}/mcp` } }), s = m.servers[0];
  try {
    s.session = 'one'; const h = s.headers();
    s.session = 'two'; s.state = 'up'; s.protocol = '2025-06-18';
    // Simulate a request that was sent with session 'one' and answered after 'two' was set up.
    const send = s.headers; s.headers = () => h;
    await assert.rejects(s.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), e => e.expired);
    s.headers = send;
    assert.equal(s.session, 'two'); assert.equal(s.state, 'up');
    await assert.rejects(s.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), e => e.expired);
    assert.equal(s.session, null);
  } finally { s.session = null; m.close(); srv.closeAllConnections(); srv.close(); }
});

test('a server removed while connecting does not run its start command or retry', async () => {
  const mark = path.join(tmp, 'started');
  const m = new Mcp({ s: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], start: `touch ${mark}` } }), s = m.servers[0];
  const r = s.ready();
  await new Promise(r => setTimeout(r, 300)); // initialize is pending (the process never answers)
  m.load({});
  assert.equal(await r, false);
  assert.equal(fs.existsSync(mark), false);
  assert.equal(s.proc, null);
});
