// DSHA Standalone with its own Termux (Termux.java sets DSH_TERMUX_PREFIX): the bash tool starts bash through
// /system/bin/linker64 with termux-exec's linker preload, and the system prompt describes Termux and the setup state.
// The exec test uses this phone's real Termux prefix when there is one (the same mechanism, at com.termux).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-tx-'));
const real = !!process.env.PREFIX && fs.existsSync('/system/bin/linker64') && fs.existsSync(process.env.PREFIX + '/lib/libtermux-exec-linker-ld-preload.so');
const w = path.join(tmp, 'w'), fake = path.join(tmp, 'usr');
fs.mkdirSync(path.join(w, 'tx-bin'), { recursive: true });
if (!real) { fs.mkdirSync(path.join(fake, 'bin'), { recursive: true }); fs.mkdirSync(path.join(fake, 'lib')); fs.writeFileSync(path.join(fake, 'bin/bash'), ''); fs.writeFileSync(path.join(fake, 'lib/libtermux-exec-linker-ld-preload.so'), ''); }
const TX = real ? process.env.PREFIX : fake;
Object.assign(process.env, { DSH_STANDALONE: '1', DSH_HOME: path.join(tmp, 'home'), SHELL: '/system/bin/sh', DSH_TERMUX_PREFIX: TX, DSH_TERMUX_BIN: path.join(w, 'tx-bin') });
delete process.env.PREFIX; // the Standalone node process has no PREFIX; only its bash children get one
const { sh, termuxReady, termuxEnv, editInCwd } = await import('../lib/tools.mjs');
const { systemPrompt } = await import('../lib/agent.mjs');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const state = s => { fs.mkdirSync(process.env.DSH_HOME, { recursive: true }); fs.writeFileSync(path.join(process.env.DSH_HOME, 'termux.json'), JSON.stringify({ state: s })); };

test('the bash tool environment: Termux PATH first, termux-exec linker preload, prefix variables', () => {
  assert.equal(termuxReady(), true);
  const e = termuxEnv({ PATH: '/app/bin:/system/bin' });
  assert.equal(e.PATH, `${path.join(w, 'tx-bin')}:${TX}/bin:/app/bin:/system/bin`);
  assert.equal(e.LD_PRELOAD, TX + '/lib/libtermux-exec-linker-ld-preload.so');
  assert.equal(e.TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE, 'force');
  assert.equal(e.PREFIX, TX); assert.equal(e.TMPDIR, TX + '/tmp'); assert.equal(e.TERMUX__ROOTFS, path.dirname(TX));
});

test('bash runs through linker64 and its children through termux-exec', { skip: !real && 'no Termux prefix here' }, async () => {
  const r = await sh('echo bash=$BASH_VERSION; readlink /proc/$$/exe; x=$(echo sub | tr a-z A-Z); echo $x | cat; (sleep 0.1; echo bg) & wait; /system/bin/getprop ro.build.version.sdk >/dev/null && echo android-ok', { cwd: w });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /bash=5/); assert.match(r.out, /linker64/); assert.match(r.out, /SUB\nbg\nandroid-ok/);
});

test('Edits mode never auto-approves writes into the prefix or the shim folder', () => {
  assert.equal(editInCwd(w, 'tx-bin/proot'), false);
  assert.equal(editInCwd(w, 'a.txt'), true);
});

test('the system prompt describes the built-in Termux and the first-run setup state', () => {
  state('installing');
  let p = systemPrompt({ cwd: w });
  assert.match(p, /with its own built-in Termux/); assert.match(p, /pkg install -y/); assert.match(p, /proot-distro install alpine/);
  assert.match(p, /still installing git, gh, proot and proot-distro/);
  assert.doesNotMatch(p, /toybox/);
  state('ready'); p = systemPrompt({ cwd: w });
  assert.doesNotMatch(p, /still installing|install failed/);
  state('failed'); assert.match(systemPrompt({ cwd: w }), /package install failed/);
});
