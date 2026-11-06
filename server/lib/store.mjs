// On-disk state under $DSH_HOME (default ~/.dsh): config.json and one JSON file
// per session. Writes go through a temp file + rename so a kill mid-write never
// leaves a truncated session.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOME = process.env.DSH_HOME || path.join(process.env.HOME || '.', '.dsh');
export const KEY_FILE = process.env.DSH_KEY_FILE || path.join(process.env.HOME || '.', '.config/deepseek/key');
const SESS = path.join(HOME, 'sessions');

// Folders Android or Termux may wipe (scratchpads, caches). Sessions never start in one; the app
// warns about older sessions that live there. DSH_TEMP_ROOTS (colon-separated) overrides, for tests.
export const TEMP_ROOTS = (process.env.DSH_TEMP_ROOTS ?? [process.env.PREFIX && path.join(process.env.PREFIX, 'tmp'), process.env.TMPDIR, '/tmp', '/data/local/tmp'].filter(Boolean).join(':'))
  .split(':').filter(Boolean).map(p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }).filter((p, i, a) => a.indexOf(p) === i);
export function isTemp(p) {
  let r; try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
  return TEMP_ROOTS.some(t => r === t || r.startsWith(t + '/'));
}
export const USER_HOME = process.env.HOME || '/';

// maxSteps 0: no limit, a run goes on until it finishes, is stopped or the DeepSeek balance runs out.
const DEFAULTS = { host: '127.0.0.1', port: 8787, model: 'deepseek-flash', effort: 'high', thinking: true, mode: 'ask', maxSteps: 0, base: 'https://api.deepseek.com', cwd: process.env.HOME || '/' };

// A symlinked file (AGENTS.md -> CLAUDE.md, a linked config) is written through to its target, not replaced.
export function writeAtomic(file, data, mode) {
  try { if (fs.lstatSync(file).isSymbolicLink()) file = fs.realpathSync(file); } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  const f = path.join(HOME, 'config.json');
  let c = {};
  try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (!c.token) { c.token = crypto.randomBytes(24).toString('base64url'); writeAtomic(f, JSON.stringify(c, null, 2), 0o600); }
  return { ...DEFAULTS, ...c };
}

export function saveConfig(patch) {
  const f = path.join(HOME, 'config.json');
  let c = {}; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  Object.assign(c, patch);
  writeAtomic(f, JSON.stringify(c, null, 2), 0o600);
  return { ...DEFAULTS, ...c };
}

export function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

export function writeKey(k) { writeAtomic(KEY_FILE, k.trim() + '\n', 0o600); }

export const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

// The file name is the session's id. Summaries are cached by mtime and size, so listing (drawer, Usage page)
// re-parses only changed transcripts instead of blocking the event loop on every byte of every session.
const summaries = new Map();
const summary = (id, s) => ({ id, title: s.title ?? '', cwd: s.cwd, model: s.model, updated: s.updated, created: s.created, turns: (s.messages || []).filter(m => m.role === 'user').length, usage: s.usage });
export function listSessions() {
  let names = []; try { names = fs.readdirSync(SESS).filter(n => /^[a-z0-9]+\.json$/.test(n)); } catch {}
  const seen = new Set();
  const out = names.map(n => {
    const f = path.join(SESS, n); seen.add(f);
    try {
      const st = fs.statSync(f), c = summaries.get(f);
      if (c && c.mtime === st.mtimeMs && c.size === st.size && c.ino === st.ino) return c.sum;
      const sum = summary(n.slice(0, -5), JSON.parse(fs.readFileSync(f, 'utf8')));
      summaries.set(f, { mtime: st.mtimeMs, size: st.size, ino: st.ino, sum }); return sum;
    } catch { summaries.delete(f); return null; }
  }).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const f of summaries.keys()) if (!seen.has(f)) summaries.delete(f);
  return out;
}

// A deleted session stays deleted: a run still unwinding (aborted by the delete) must not write it back.
const gone = new Set();
export function loadSession(id) {
  if (!/^[a-z0-9]+$/.test(id) || gone.has(id)) return null;
  try { const s = JSON.parse(fs.readFileSync(path.join(SESS, id + '.json'), 'utf8')); s.id = id; return s; } catch { return null; }
}

export function saveSession(s) { if (gone.has(s.id)) return; s.updated = Date.now(); writeAtomic(path.join(SESS, s.id + '.json'), JSON.stringify(s)); }

export function deleteSession(id) { if (/^[a-z0-9]+$/.test(id)) { gone.add(id); fs.rmSync(path.join(SESS, id + '.json'), { force: true }); } }

export function createSession(cfg, { cwd, title, model, effort, mode, thinking } = {}) {
  const now = Date.now();
  const s = { id: newId(), title: title || 'New session', cwd: cwd || cfg.cwd, model: model || cfg.model, effort: effort || cfg.effort, thinking: thinking ?? cfg.thinking, mode: mode || cfg.mode, created: now, updated: now, messages: [], meta: {}, allow: [], todos: [], usage: { hit: 0, miss: 0, out: 0, reasoning: 0, cost: 0, lastPrompt: 0 } };
  saveSession(s);
  return s;
}
