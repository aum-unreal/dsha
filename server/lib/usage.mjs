// Spend across sessions. Every model call is appended to ~/.dsh/usage.jsonl with what it cost at
// the hour it ran (peak or off-peak), so totals survive deleted sessions and can be split by day.
// Sessions from before the ledger (dsh < 0.9.0) only kept totals: their unlogged part is reported
// as an estimate at off-peak rates, dated on the session's last update.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, listSessions } from './store.mjs';

const FILE = () => path.join(HOME, 'usage.jsonl');

export function logUsage(rec) {
  try { fs.mkdirSync(HOME, { recursive: true }); fs.appendFileSync(FILE(), JSON.stringify(rec) + '\n'); } catch {}
}

function readLedger() {
  let text = ''; try { text = fs.readFileSync(FILE(), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}

const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const zero = () => ({ cost: 0, est: 0, peak: 0, calls: 0, hit: 0, miss: 0, out: 0, reasoning: 0 });
function addTo(a, r) {
  a.cost += r.cost || 0; a.est += r.est || 0; a.peak += r.peak ? r.cost || 0 : 0; a.calls += r.calls ?? 1;
  a.hit += r.hit || 0; a.miss += r.miss || 0; a.out += r.out || 0; a.reasoning += r.reasoning || 0;
}

export function usageReport({ now = Date.now(), days = 30, running = [] } = {}) {
  const ledger = readLedger(), sessions = listSessions();
  const per = new Map(), logged = new Map();
  for (const r of ledger) {
    if (!logged.has(r.sid)) logged.set(r.sid, { hit: 0, miss: 0, out: 0, reasoning: 0, off: 0, calls: 0 });
    const l = logged.get(r.sid); l.hit += r.hit || 0; l.miss += r.miss || 0; l.out += r.out || 0; l.reasoning += r.reasoning || 0; l.off += r.off || 0; l.calls++;
  }
  // Each session's pre-ledger remainder becomes one estimated record.
  const records = ledger.map(r => ({ ...r }));
  for (const s of sessions) {
    const U = s.usage || {}, l = logged.get(s.id) || { hit: 0, miss: 0, out: 0, reasoning: 0, off: 0 };
    const rest = { hit: Math.max(0, (U.hit || 0) - l.hit), miss: Math.max(0, (U.miss || 0) - l.miss), out: Math.max(0, (U.out || 0) - l.out), reasoning: Math.max(0, (U.reasoning || 0) - l.reasoning) };
    const est = Math.max(0, (U.costOff || 0) - l.off);
    if (est > 1e-9 || rest.hit + rest.miss + rest.out > 0) records.push({ t: s.updated, sid: s.id, model: s.model, ...rest, cost: 0, est, calls: 0 });
  }

  const total = zero(), models = new Map(), byDay = new Map(), sess = new Map();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const periods = { today: zero(), week: zero(), month: zero() };
  for (const r of records) {
    addTo(total, r);
    if (!models.has(r.model)) models.set(r.model, zero()); addTo(models.get(r.model), r);
    if (!sess.has(r.sid)) sess.set(r.sid, { ...zero(), last: 0 }); const x = sess.get(r.sid); addTo(x, r); x.last = Math.max(x.last, r.t || 0);
    const k = dayKey(r.t); if (!byDay.has(k)) byDay.set(k, zero()); addTo(byDay.get(k), r);
    if (r.t >= +startToday) addTo(periods.today, r);
    if (r.t >= +startToday - 6 * 864e5) addTo(periods.week, r);
    if (r.t >= +startToday - 29 * 864e5) addTo(periods.month, r);
  }
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(startToday); d.setDate(d.getDate() - i); const k = dayKey(d); dayList.push({ day: k, ...(byDay.get(k) || zero()) }); }
  const meta = new Map(sessions.map(s => [s.id, s]));
  return {
    now, total, periods, days: dayList,
    since: records.reduce((m, r) => Math.min(m, r.t || now), now),
    ledgerSince: ledger.length ? ledger[0].t : null,
    models: [...models].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cost + b.est - a.cost - a.est),
    sessions: [...sess].map(([id, v]) => {
      const s = meta.get(id);
      return { id, ...v, title: s ? s.title : 'Deleted session', deleted: !s, cwd: s?.cwd, model: s?.model, turns: s?.turns ?? 0, updated: s?.updated ?? v.last, running: running.includes(id) };
    }).sort((a, b) => b.updated - a.updated),
  };
}
