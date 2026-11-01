// Agent setup API: skills, instruction files and MCP plugin management, against a real dsh server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-manage-'));
process.env.HOME = path.join(tmp, 'user');                       // keeps the real ~/.claude/skills out
process.env.DSH_HOME = path.join(tmp, 'user', '.dsh');
process.env.DSH_TEMP_ROOTS = path.join(tmp, 'scratch');                 // stands in for $PREFIX/tmp
process.env.DSH_KEY_FILE = path.join(tmp, 'key');
fs.writeFileSync(process.env.DSH_KEY_FILE, 'sk-test-0123456789\n');
const work = path.join(tmp, 'work'); fs.mkdirSync(work, { recursive: true });
const claudeSkill = path.join(process.env.HOME, '.claude', 'skills', 'tidy');
fs.mkdirSync(claudeSkill, { recursive: true });
fs.writeFileSync(path.join(claudeSkill, 'SKILL.md'), '---\nname: tidy\ndescription: "Tidy a folder"\n---\nSort files by type.\n');
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.DSH_HOME, 'mcp.json'), JSON.stringify({ note: 'kept', mcpServers: {} }));

const { saveConfig } = await import('../lib/store.mjs');
saveConfig({ cwd: work, token: 'tok' });
const { createServer } = await import('../lib/server.mjs');
const { loadSkill } = await import('../lib/skills.mjs');
const { schemas } = await import('../lib/tools.mjs');
const srv = createServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const system = async () => (await api('GET', '/api/system?cwd=' + encodeURIComponent(work))).json.text;
test.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('skills: create, list in the prompt, load, toggle, shadow, delete', async () => {
  let r = await api('POST', '/api/skills', { cwd: work, scope: 'dsh', name: 'release', description: 'Ship an APK version', body: 'Bump the version, then build.' });
  assert.equal(r.status, 200); assert.equal(r.json.id, 'dsh:release');
  assert.ok(r.json.skills.find(s => s.id === 'dsh:release' && s.enabled));
  assert.match(await system(), /Skills: load one[\s\S]*- release: Ship an APK version/);
  assert.match(loadSkill(work, 'release'), /<skill name="release"[\s\S]*Bump the version, then build\./);
  assert.ok(schemas().some(t => t.function.name === 'skill'));

  assert.equal((await api('POST', '/api/skills', { cwd: work, scope: 'dsh', name: 'Bad Name', description: 'x' })).status, 400);
  assert.equal((await api('POST', '/api/skills', { cwd: work, scope: 'dsh', name: 'release', description: 'again' })).status, 400);

  // A project skill with the same name wins; the global one is marked shadowed.
  r = await api('POST', '/api/skills', { cwd: work, scope: 'project', name: 'release', description: 'Project release steps', body: 'Use make.' });
  assert.ok(r.json.skills.find(s => s.id === 'dsh:release').shadowed);
  assert.match(loadSkill(work, 'release'), /Use make\./);

  r = await api('PATCH', '/api/skills', { cwd: work, id: 'project:release', enabled: false });
  assert.equal(r.json.skills.find(s => s.id === 'project:release').enabled, false);
  assert.match(loadSkill(work, 'release'), /Bump the version/);

  // Claude Code skills are listed but stay out until the source is switched on.
  const tidy = () => r.json.skills.find(s => s.id === 'claude:tidy');
  assert.equal(tidy().enabled, false); assert.doesNotMatch(await system(), /- tidy:/);
  r = await api('PATCH', '/api/skills', { cwd: work, claude: true });
  assert.ok(tidy().enabled); assert.match(await system(), /- tidy: Tidy a folder/);
  assert.equal((await api('POST', '/api/skills/delete', { cwd: work, id: 'claude:tidy' })).status, 400);

  r = await api('GET', '/api/skills/read?cwd=' + encodeURIComponent(work) + '&id=dsh:release');
  assert.match(r.json.content, /^---\nname: release/);
  r = await api('POST', '/api/skills/delete', { cwd: work, id: 'dsh:release' });
  assert.ok(!r.json.skills.some(s => s.id === 'dsh:release'));
  assert.equal(fs.existsSync(path.join(process.env.DSH_HOME, 'skills', 'release')), false);
});

test('SKILL.md front matter: quoted, folded block and continued values', async () => {
  const { parseSkill } = await import('../lib/skills.mjs');
  assert.deepEqual(parseSkill('---\nname: a\ndescription: >-\n  Line one\n  line two.\nmeta: x\n---\nBody').meta, { name: 'a', description: 'Line one line two.', meta: 'x' });
  assert.equal(parseSkill('---\ndescription: |\n  one\n  two\n---\n').meta.description, 'one\ntwo');
  assert.equal(parseSkill('---\ndescription: starts here\n  and goes on\n---\n').meta.description, 'starts here and goes on');
  assert.equal(parseSkill('---\ndescription: "quoted: yes"\n---\nB').body, 'B');
});

test('instruction files: global DSH.md joins the prompt, CLAUDE.md is read-only', async () => {
  let r = await api('GET', '/api/instructions?cwd=' + encodeURIComponent(work));
  assert.deepEqual(r.json.map(f => [f.key, f.exists, f.editable]), [['global', false, true], ['DSH.md', false, true], ['AGENTS.md', false, true], ['CLAUDE.md', false, false]]);
  r = await api('PUT', '/api/instructions', { cwd: work, key: 'global', content: 'Answer in British English.' });
  assert.equal(r.json[0].exists, true);
  await api('PUT', '/api/instructions', { cwd: work, key: 'DSH.md', content: 'Run make test before committing.' });
  const sys = await system();
  assert.match(sys, /scope="every session">\nAnswer in British English\./);
  assert.ok(sys.indexOf('British') < sys.indexOf('make test'), 'global file comes first');
  assert.equal((await api('PUT', '/api/instructions', { cwd: work, key: 'CLAUDE.md', content: 'x' })).status, 400);
  assert.equal(fs.existsSync(path.join(work, 'CLAUDE.md')), false);
});

test('plugins: add, disable, edit, remove; mcp.json keeps other keys', async () => {
  assert.equal((await api('PUT', '/api/mcp/web', { url: 'ftp://nope' })).status, 400);
  assert.equal((await api('PUT', '/api/mcp/web', {})).status, 400);
  let r = await api('PUT', '/api/mcp/web', { url: 'http://127.0.0.1:1/mcp', risk: 'read' });
  assert.deepEqual(r.json.map(s => [s.name, s.transport, s.risk, s.disabled]), [['web', 'http', 'read', false]]);
  r = await api('PUT', '/api/mcp/files', { command: '/nonexistent/server --root "/sd card"', start: 'true' });
  const files = r.json.find(s => s.name === 'files');
  assert.equal(files.target, '/nonexistent/server --root /sd card'); assert.equal(files.risk, 'exec');
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'mcp.json'), 'utf8'));
  assert.equal(disk.note, 'kept'); assert.deepEqual(disk.mcpServers.files.args, ['--root', '/sd card']);

  r = await api('PATCH', '/api/mcp/web', { disabled: true });
  assert.equal(r.json.find(s => s.name === 'web').state, 'off');
  r = await api('PUT', '/api/mcp/web', { url: 'http://127.0.0.1:2/mcp' });
  assert.ok(r.json.find(s => s.name === 'web').disabled, 'editing keeps it off');
  r = await api('PATCH', '/api/mcp/web', { disabled: false });
  assert.notEqual(r.json.find(s => s.name === 'web').state, 'off');
  r = await api('DELETE', '/api/mcp/files');
  assert.deepEqual(r.json.map(s => s.name), ['web']);
  assert.deepEqual(await (await api('GET', '/api/mcp/web/tools')).json, []);
});

test('built-in skills: dsh-evolve and dsh-memory-evolve ship, load, toggle, cannot be deleted', async () => {
  let r = await api('GET', '/api/skills?cwd=' + encodeURIComponent(work));
  const ids = r.json.skills.filter(s => s.source === 'builtin').map(s => s.id);
  assert.deepEqual(ids, ['builtin:dsh-evolve', 'builtin:dsh-memory-evolve']);
  assert.match(await system(), /- dsh-evolve: Improve how dsh works from experience/);
  assert.match(loadSkill(work, 'dsh-memory-evolve'), /# Memory for dsh[\s\S]*MEMORY\.md/);
  assert.equal((await api('POST', '/api/skills/delete', { cwd: work, id: 'builtin:dsh-evolve' })).status, 400);
  await api('PATCH', '/api/skills', { cwd: work, id: 'builtin:dsh-evolve', enabled: false });
  assert.doesNotMatch(await system(), /- dsh-evolve:/);
  await api('PATCH', '/api/skills', { cwd: work, id: 'builtin:dsh-evolve', enabled: true });
});

test('memory: index joins the prompt, files list and delete with their index line', async () => {
  const dir = path.join(process.env.DSH_HOME, 'memory'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fold-phone.md'), '---\nname: fold-phone\ndescription: User is on a Galaxy Z Fold\ntype: user\nupdated: 2026-11-01\n---\nInner screen about 750 CSS px wide.\n');
  fs.writeFileSync(path.join(dir, 'no-gradients.md'), '---\nname: no-gradients\ndescription: User dislikes gradient UI\ntype: feedback\n---\nKeep surfaces flat.\n');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [Fold phone](fold-phone.md) — judge layouts at 750px\n- [No gradients](no-gradients.md) — flat UI only\n');
  assert.match(await system(), /Memory index[\s\S]*\[Fold phone\]\(fold-phone\.md\)/);
  let r = await api('GET', '/api/memory');
  assert.deepEqual(r.json.items.map(m => [m.file, m.type]), [['fold-phone.md', 'user'], ['no-gradients.md', 'feedback']]);
  assert.match((await api('GET', '/api/memory/read?file=fold-phone.md')).json.content, /750 CSS px/);
  assert.equal((await api('GET', '/api/memory/read?file=../config.json')).status, 400);
  r = await api('POST', '/api/memory/delete', { file: 'no-gradients.md' });
  assert.deepEqual(r.json.items.map(m => m.file), ['fold-phone.md']);
  assert.doesNotMatch(r.json.index, /no-gradients/);
  assert.doesNotMatch(await system(), /No gradients/);
});

test('session_log: compact digest marks failures and denials', async () => {
  const { sessionDigest, TOOLS } = await import('../lib/tools.mjs');
  const s = { id: 'x1', title: 'Fix build', cwd: work, meta: { a: { ok: false }, b: { ok: true, denied: true } }, messages: [
    { role: 'user', content: 'Build it' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'bash', arguments: '{"command":"make"}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'make: *** No rule\n[exit 2]' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'b', function: { name: 'bash', arguments: '{"command":"rm -rf build"}' } }] },
    { role: 'tool', tool_call_id: 'b', content: 'The user denied this tool call.' },
    { role: 'assistant', content: 'Use ./build.sh instead.' }] };
  assert.equal(sessionDigest(s), `Session x1: Fix build (${work})\nUSER: Build it\nTOOL bash: make\n  FAILED: make: *** No rule\n[exit 2]\nTOOL bash: rm -rf build\n  DENIED by the user\nDSH: Use ./build.sh instead.`);
  assert.match(await TOOLS.session_log.run({ list: true }, {}), /No sessions\.|\|/);
});

test('sessions start in persistent storage: temp folders refused, default falls back to home', async () => {
  const scratch = path.join(tmp, 'scratch', 'live'); fs.mkdirSync(scratch, { recursive: true });
  let r = await api('POST', '/api/sessions', { cwd: scratch });
  assert.equal(r.status, 400); assert.match(r.json.error, /temporary folder/);
  assert.equal((await api('PUT', '/api/config', { cwd: scratch })).status, 400);
  assert.ok((await api('GET', '/api/health')).json.tempRoots.includes(fs.realpathSync(path.join(tmp, 'scratch'))));
  // A default folder that is (or became) temporary: new sessions start in home instead.
  const { saveConfig } = await import('../lib/store.mjs');
  const cfgFile = path.join(process.env.DSH_HOME, 'config.json'), before = fs.readFileSync(cfgFile, 'utf8');
  saveConfig({ cwd: scratch });
  const srv2 = (await import('../lib/server.mjs')).createServer(); await new Promise(res => srv2.listen(0, '127.0.0.1', res));
  const s = await (await fetch(`http://127.0.0.1:${srv2.address().port}/api/sessions`, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: '{}' })).json();
  srv2.close(); fs.writeFileSync(cfgFile, before);
  assert.equal(s.cwd, process.env.HOME);
  // An existing session can still be pointed anywhere; the app warns instead.
  r = await api('PATCH', '/api/sessions/' + s.id, { cwd: scratch });
  assert.equal(r.status, 200);
});
