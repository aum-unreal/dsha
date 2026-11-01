// DSHA Standalone: dsh inside Android's app sandbox has no ripgrep and no bash. grep and glob walk
// the tree in Node, and the system prompt describes the sandbox instead of Termux.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-sa-'));
process.env.DSH_NO_RG = '1'; process.env.DSH_STANDALONE = '1'; process.env.DSH_HOME = path.join(tmp, 'home');
const { TOOLS } = await import('../lib/tools.mjs');
const { systemPrompt } = await import('../lib/agent.mjs');
const w = path.join(tmp, 'w');
for (const [f, t] of Object.entries({ 'a.js': 'const x = 1;\n// TODO first\n', 'src/b.js': 'todo: lower\nnone', 'src/c.kt': 'fun main() {} // TODO kt', 'node_modules/m/i.js': '// TODO hidden', '.git/HEAD': 'TODO git', 'bin.dat': 'TODO\0binary' })) {
  fs.mkdirSync(path.dirname(path.join(w, f)), { recursive: true }); fs.writeFileSync(path.join(w, f), t);
}
const ctx = { cwd: w };
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('grep without ripgrep: regex, line numbers, skips vendored, VCS and binary files', async () => {
  const out = await TOOLS.grep.run({ pattern: 'TODO' }, ctx);
  assert.deepEqual(out.split('\n').map(l => path.relative(w, l.split(':')[0]) + ':' + l.split(':')[1]).sort(), ['a.js:2', 'src/c.kt:1']);
  assert.match(await TOOLS.grep.run({ pattern: 'todo', ignore_case: true, glob: '*.js' }, ctx), /src\/b\.js:1:todo: lower/);
  assert.doesNotMatch(await TOOLS.grep.run({ pattern: 'todo', ignore_case: true, glob: '*.js' }, ctx), /c\.kt/);
  assert.equal(await TOOLS.grep.run({ pattern: 'nothing-here' }, ctx), 'No matches.');
  assert.match(await TOOLS.grep.run({ pattern: 'main', path: 'src/c.kt' }, ctx), /c\.kt:1:/);
});

test('glob without ripgrep: name patterns match anywhere, path patterns from the root', async () => {
  const rel = s => s.split('\n').map(l => path.relative(w, l)).sort();
  assert.deepEqual(rel(await TOOLS.glob.run({ pattern: '*.js' }, ctx)), ['a.js', 'src/b.js']);
  assert.deepEqual(rel(await TOOLS.glob.run({ pattern: 'src/*' }, ctx)), ['src/b.js', 'src/c.kt']);
  assert.deepEqual(rel(await TOOLS.glob.run({ pattern: '**/*.kt' }, ctx)), ['src/c.kt']);
});

test('the system prompt describes the sandbox, not Termux', () => {
  const p = systemPrompt({ cwd: w });
  assert.match(p, /DSHA Standalone app on Android, no Termux/);
  assert.match(p, /toybox/); assert.match(p, /no git, python, bash/);
  assert.doesNotMatch(p, /The shell is bash/);
});
