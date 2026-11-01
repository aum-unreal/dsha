// The replay log: a long run must never lose its own start, or an app reopened mid-run shows a
// reply's tail with no prompt (seen on a phone after an 18-minute run streamed past the cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_MAX_EVENTS = '50';
process.env.DSH_HOME = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-log-'));
const { Runtime } = await import('../lib/agent.mjs');

test('trimming drops finished runs but keeps the live run whole', () => {
  const r = new Runtime({ messages: [] }, { config: () => ({}), mcp: null });
  for (let i = 0; i < 80; i++) r.emit('text', { d: 'old ' }); // a finished run, over the cap
  assert.equal(r.events.length, 50, 'idle: capped as before');
  r.running = true; r.runSeq = r.emit('run_start').seq; r.emit('user', { text: 'Look online' });
  for (let i = 0; i < 300; i++) r.emit('reasoning', { d: 't' });
  const seen = []; r.subscribe(ev => seen.push(ev), r.runSeq - 1)();
  assert.equal(seen[0].type, 'run_start', 'a client reattaching mid-run replays from the run start');
  assert.equal(seen[1].text, 'Look online');
  assert.equal(seen.length, 302);
  assert.ok(r.events[0].seq >= r.runSeq, 'every older event went first');
  r.running = false; r.emit('run_end');
  r.emit('text', { d: 'next' });
  assert.equal(r.events.length, 50, 'once the run ends it trims to the cap again');
});
