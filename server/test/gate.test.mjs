// The permission gate: 'edits' auto-approves built-in file writes only inside the working directory,
// and 'always allow' for an MCP tool is keyed to its server, not to the name the model sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_HOME = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-gate-'));
const { Runtime } = await import('../lib/agent.mjs');

test('edits mode: writes inside cwd run, outside or into .git ask; MCP edit tools follow their risk', () => {
  const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-gate-cwd-'));
  fs.mkdirSync(path.join(cwd, '.git'));
  const r = new Runtime({ id: 'g1', cwd, mode: 'edits', messages: [], meta: {}, allow: [], todos: [], usage: {} }, { config: () => ({}), mcp: null });
  assert.equal(r.allowed('write_file', 'edit', { path: 'src/a.txt' }), true);
  assert.equal(r.allowed('edit_file', 'edit', { path: path.join(cwd, 'b.md') }), true);
  assert.equal(r.allowed('write_file', 'edit', { path: '../outside.txt' }), false);
  assert.equal(r.allowed('write_file', 'edit', { path: '.git/hooks/pre-commit' }), false);
  assert.equal(r.allowed('write_file', 'edit', { path: '~/.bashrc' }), false);
  assert.equal(r.allowed('bash', 'exec', { command: 'ls' }), false);
  assert.equal(r.allowed('mcp_files_write', 'edit', {}, 'mcp:files:write'), true);
  r.s.mode = 'auto'; assert.equal(r.allowed('write_file', 'edit', { path: '../outside.txt' }), true);
});

test('always allow for an MCP tool is stored and matched under its server identity', () => {
  const r = new Runtime({ id: 'g2', cwd: '/', mode: 'ask', messages: [], meta: {}, allow: ['mcp:a:run'], todos: [], usage: {} }, { config: () => ({}), mcp: null });
  assert.equal(r.allowed('run', 'exec', {}, 'mcp:a:run'), true);
  assert.equal(r.allowed('run', 'exec', {}, 'mcp:b:run'), false, 'the same exposed name from another server still asks');
});
