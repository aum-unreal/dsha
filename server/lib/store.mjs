// On-disk state under $DSH_HOME (default ~/.dsh): config.json and one JSON file
// per session. Writes go through a temp file + rename so a kill mid-write never
// leaves a truncated session.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOME = process.env.DSH_HOME || path.join(process.env.HOME || '.', '.dsh');
export const KEY_FILE = process.env.DSH_KEY_FILE || path.join(process.env.HOME || '.', '.config/deepseek/key');
const SESS = path.join(HOME, 'sessions');

const DEFAULTS = { host: '127.0.0.1', port: 8787, model: 'deepseek-flash', effort: 'high', thinking: true, mode: 'ask', maxSteps: 80, base: 'https://api.deepseek.com', cwd: process.env.HOME || '/' };

export function writeAtomic(file, data, mode) {
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

export function listSessions() {
  let names = []; try { names = fs.readdirSync(SESS).filter(n => n.endsWith('.json')); } catch {}
  return names.map(n => { try { const s = JSON.parse(fs.readFileSync(path.join(SESS, n), 'utf8')); return { id: s.id, title: s.title, cwd: s.cwd, model: s.model, updated: s.updated, created: s.created, turns: s.messages.filter(m => m.role === 'user').length, usage: s.usage }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.updated - a.updated);
}

export function loadSession(id) {
  if (!/^[a-z0-9]+$/.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(SESS, id + '.json'), 'utf8')); } catch { return null; }
}

export function saveSession(s) { s.updated = Date.now(); writeAtomic(path.join(SESS, s.id + '.json'), JSON.stringify(s)); }

export function deleteSession(id) { if (/^[a-z0-9]+$/.test(id)) fs.rmSync(path.join(SESS, id + '.json'), { force: true }); }

export function createSession(cfg, { cwd, title, model, effort, mode, thinking } = {}) {
  const now = Date.now();
  const s = { id: newId(), title: title || 'New session', cwd: cwd || cfg.cwd, model: model || cfg.model, effort: effort || cfg.effort, thinking: thinking ?? cfg.thinking, mode: mode || cfg.mode, created: now, updated: now, messages: [], meta: {}, allow: [], todos: [], usage: { hit: 0, miss: 0, out: 0, reasoning: 0, cost: 0, lastPrompt: 0 } };
  saveSession(s);
  return s;
}
