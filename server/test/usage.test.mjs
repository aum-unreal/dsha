// Usage: peak-hour pricing, the per-call ledger, and the report the app's Usage page draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_HOME = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsh-usage-'));
const { isPeak } = await import('../lib/deepseek.mjs');
const { logUsage, usageReport } = await import('../lib/usage.mjs');
const { Runtime } = await import('../lib/agent.mjs');
const { saveSession } = await import('../lib/store.mjs');

test('peak hours: 01-04 and 06-10 UTC on weekdays only', () => {
  const at = s => isPeak(Date.parse(s));
  assert.equal(at('2026-11-02T01:00:00Z'), true);   // Monday
  assert.equal(at('2026-11-02T03:59:00Z'), true);
  assert.equal(at('2026-11-02T04:00:00Z'), false);
  assert.equal(at('2026-11-02T05:30:00Z'), false);
  assert.equal(at('2026-11-02T09:59:00Z'), true);
  assert.equal(at('2026-11-02T10:00:00Z'), false);
  assert.equal(at('2026-11-01T02:00:00Z'), false);  // Sunday
  assert.equal(at('2026-11-07T07:00:00Z'), false);  // Saturday
});

test('each call is logged at its hour\'s rate; old sessions become an off-peak estimate', () => {
  const now = Date.now();
  // A session from before the ledger: totals only.
  saveSession({ id: 'old1', title: 'Old one', cwd: '/', model: 'deepseek-flash', created: now, messages: [{ role: 'user', content: 'hi' }], meta: {}, usage: { hit: 0, miss: 1e6, out: 0, costPeak: 0.3, costOff: 0.15 } });
  // A live one: account() writes the ledger.
  const s = { id: 'new1', title: 'New one', cwd: '/', model: 'deepseek-v4-pro', created: now, updated: now, messages: [], meta: {}, usage: { hit: 0, miss: 0, out: 0 } };
  const r = new Runtime(s, { config: () => ({}), mcp: null });
  r.account({ hit: 0, miss: 1e6, out: 1e6 });
  r.account({ hit: 0, miss: 0, out: 1e6 }, 0, { model: 'deepseek-flash', sub: true });
  const peak = isPeak();
  const proCall = peak ? 1.32 + 3.96 : 0.66 + 1.98, subCall = peak ? 1.2 : 0.6;
  assert.ok(Math.abs(s.usage.cost - (proCall + subCall)) < 1e-9, 'session cost is the actual spend');
  saveSession(s);
  logUsage({ t: now - 3 * 864e5, sid: 'gone', model: 'deepseek-flash', hit: 0, miss: 0, out: 1e6, cost: 0.6, off: 0.6 }); // a deleted session

  const rep = usageReport({ running: ['new1'] });
  assert.ok(Math.abs(rep.total.cost - (proCall + subCall + 0.6)) < 1e-9);
  assert.ok(Math.abs(rep.total.est - 0.15) < 1e-9, 'pre-ledger spend is estimated at off-peak');
  assert.equal(rep.total.calls, 3);
  const byId = Object.fromEntries(rep.sessions.map(x => [x.id, x]));
  assert.equal(byId.old1.est.toFixed(2), '0.15'); assert.equal(byId.old1.calls, 0);
  assert.equal(byId.new1.calls, 2); assert.equal(byId.new1.running, true);
  assert.equal(byId.gone.deleted, true); assert.equal(byId.gone.title, 'Deleted session');
  assert.equal(rep.days.length, 30);
  assert.ok(Math.abs(rep.periods.week.cost + rep.periods.week.est - rep.total.cost - rep.total.est) < 1e-9);
  assert.ok(rep.periods.today.cost >= proCall + subCall - 1e-9);
  assert.deepEqual(rep.models.map(m => m.model).sort(), ['deepseek-flash', 'deepseek-v4-pro']);
});
