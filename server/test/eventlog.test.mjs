// The replay log: a client must never get a reply's tail with no start (seen on a phone after an
// 18-minute run streamed past the cap), and a long run must not grow it without bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_MAX_EVENTS = '50';
process.env.DSH_HOME = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-log-'));
const { Runtime } = await import('../lib/agent.mjs');

test('trimming drops finished runs but keeps the live step whole', () => {
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

test('a long run trims its finished steps and every client then joins at the live step', () => {
  const s = { messages: [{ role: 'user', content: 'go' }], usage: {}, meta: {} };
  const r = new Runtime(s, { config: () => ({}), mcp: null });
  r.running = true; r.runBase = 0; r.runSeq = r.emit('run_start').seq; r.emit('user', { text: 'go' });
  const step = n => { r.stepBase = s.messages.length; r.stepSeq = r.emit('step_start', { step: n }).seq; for (let i = 0; i < 30; i++) r.emit('text', { d: 'x' }); s.messages.push({ role: 'assistant', content: 'step ' + n }); };
  step(0);
  assert.equal(r.snapshot().live.fromSeq, r.runSeq - 1, 'while the start is held, a plain snapshot replays the whole run');
  for (let n = 1; n < 40; n++) step(n);
  assert.ok(r.events.length <= 50 + 31, 'the log stays near the cap: ' + r.events.length);
  assert.ok(r.events[0].seq > r.runSeq, 'the run start went');
  r.stepBase = s.messages.length; r.stepSeq = r.emit('step_start', { step: 40 }).seq;
  for (let i = 0; i < 300; i++) r.emit('reasoning', { d: 't' });
  assert.ok(r.events[0].seq <= r.stepSeq, 'the step in progress stays whole, however long');
  for (const at of [null, 'step']) {
    const snap = r.snapshot(at), seen = [];
    assert.equal(snap.live.fromSeq, r.stepSeq - 1);
    assert.equal(snap.messages.length, s.messages.length, 'every finished step is in the messages');
    r.subscribe(ev => seen.push(ev), snap.live.fromSeq)();
    assert.equal(seen[0].type, 'step_start'); assert.equal(seen.length, 301);
  }
});
