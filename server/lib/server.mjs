// HTTP API for the DSHA app (and anything else with the token).
// All routes need `Authorization: Bearer <token>` (token lives in ~/.dsh/config.json).
// Run events stream as Server-Sent Events from /api/sessions/:id/events?after=<seq>.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, saveConfig, readKey, writeKey, listSessions, createSession, deleteSession, HOME } from './store.mjs';
import { runtime, dropRuntime, activeRuns } from './agent.mjs';
import { DeepSeek } from './deepseek.mjs';

export const VERSION = '0.2.0';

export function createServer({ config = loadConfig } = {}) {
  let cfg = config();
  const getCfg = () => cfg;
  const deps = { config: getCfg };

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, version: VERSION, hasKey: !!readKey(), model: cfg.model, home: HOME, running: activeRuns() })],
    ['GET', /^\/api\/config$/, () => pub(cfg)],
    ['PUT', /^\/api\/config$/, (_, b) => { const p = pick(b, ['model', 'effort', 'mode', 'thinking', 'maxSteps', 'cwd', 'base']); cfg = saveConfig(p); return pub(cfg); }],
    ['PUT', /^\/api\/key$/, async (_, b) => {
      const k = String(b.key || '').trim();
      if (!/^sk-[\w-]{10,}$/.test(k)) throw httpErr(400, 'That does not look like a DeepSeek key (sk-…)');
      if (b.verify !== false) await new DeepSeek({ key: k, base: cfg.base }).models().catch(e => { throw httpErr(400, 'Key rejected: ' + e.message); });
      writeKey(k); return { ok: true };
    }],
    ['GET', /^\/api\/models$/, () => api().models()],
    ['GET', /^\/api\/balance$/, () => api().balance()],
    ['GET', /^\/api\/sessions$/, () => listSessions().map(s => ({ ...s, running: activeRuns().includes(s.id) }))],
    ['POST', /^\/api\/sessions$/, (_, b) => { const cwd = b.cwd ? path.resolve(expand(b.cwd)) : cfg.cwd; if (!isDir(cwd)) throw httpErr(400, 'Not a directory: ' + cwd); return createSession(cfg, { ...pick(b, ['title', 'model', 'effort', 'mode', 'thinking']), cwd }); }],
    ['GET', /^\/api\/sessions\/(\w+)$/, ([id]) => rt(id).snapshot()],
    ['PATCH', /^\/api\/sessions\/(\w+)$/, ([id], b) => {
      const r = rt(id), p = pick(b, ['title', 'model', 'effort', 'mode', 'thinking', 'cwd']);
      if (p.cwd) { p.cwd = path.resolve(expand(p.cwd)); if (!isDir(p.cwd)) throw httpErr(400, 'Not a directory: ' + p.cwd); }
      if ('allow' in b) r.s.allow = [];
      Object.assign(r.s, p); r.save(); r.emit('session', { patch: p }); return r.snapshot();
    }],
    ['DELETE', /^\/api\/sessions\/(\w+)$/, ([id]) => { dropRuntime(id); deleteSession(id); return { ok: true }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/messages$/, ([id], b) => { const text = String(b.text || '').trim(); if (!text) throw httpErr(400, 'Empty message'); const r = rt(id); try { r.send(text); } catch (e) { throw httpErr(409, e.message); } return { ok: true, seq: r.seq }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/stop$/, ([id]) => { rt(id).stop(); return { ok: true }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/approve$/, ([id], b) => ({ ok: rt(id).approve(String(b.id), ['allow', 'always', 'deny'].includes(b.decision) ? b.decision : 'deny') })],
    ['POST', /^\/api\/sessions\/(\w+)\/compact$/, async ([id]) => { const r = rt(id); if (r.running) throw httpErr(409, 'Stop the run first'); return { ok: await r.compact() }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/rewind$/, ([id], b) => {
      // Drop everything from the n-th user message on, so it can be edited and resent.
      const r = rt(id); if (r.running) throw httpErr(409, 'Stop the run first');
      let n = -1, cut = r.s.messages.length;
      r.s.messages.forEach((m, i) => { if (m.role === 'user' && ++n === b.turn && cut === r.s.messages.length) cut = i; });
      const text = r.s.messages[cut]?.content; r.s.messages = r.s.messages.slice(0, cut); r.runBase = cut; r.save();
      return { ok: true, text, session: r.snapshot() };
    }],
    ['GET', /^\/api\/fs$/, (q) => {
      const d = path.resolve(expand(q.query.get('path') || cfg.cwd));
      const ents = fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name).filter(n => q.query.get('hidden') || !n.startsWith('.')).sort();
      return { path: d, parent: path.dirname(d), dirs: ents.filter(n => isDir(path.join(d, n))) };
    }],
  ];

  const rt = id => { const r = runtime(id, deps); if (!r) throw httpErr(404, 'No such session'); return r; };
  const api = () => { const k = readKey(); if (!k) throw httpErr(412, 'No API key set'); return new DeepSeek({ key: k, base: cfg.base }); };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, null);
    if (!authed(req, cfg.token)) return send(res, 401, { error: 'Bad or missing token' });
    const ev = url.pathname.match(/^\/api\/sessions\/(\w+)\/events$/);
    if (ev && req.method === 'GET') return stream(req, res, ev[1], +url.searchParams.get('after') || 0);
    for (const [m, re, fn] of routes) {
      const hit = req.method === m && url.pathname.match(re);
      if (!hit) continue;
      try {
        const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await readBody(req) : {};
        const args = hit.slice(1); args.query = url.searchParams;
        return send(res, 200, await fn(args, body));
      } catch (e) {
        return send(res, e.status || 500, { error: String(e.message || e) });
      }
    }
    send(res, 404, { error: 'Not found' });
  });

  function stream(req, res, id, after) {
    let r; try { r = rt(id); } catch (e) { return send(res, 404, { error: e.message }); }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...cors });
    res.write(`: dsh ${VERSION}\n\n`);
    const off = r.subscribe(ev => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`), after);
    const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
    req.on('close', () => { off(); clearInterval(ping); });
  }
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };

function authed(req, token) {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', ...cors });
  res.end(obj == null ? '' : JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((ok, bad) => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 4e6) { bad(httpErr(413, 'Body too large')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(httpErr(400, 'Invalid JSON')); } });
  });
}

const pub = c => { const { token, ...rest } = c; return rest; };
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const expand = p => p.startsWith('~') ? path.join(process.env.HOME || '/', p.slice(1)) : p;
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
