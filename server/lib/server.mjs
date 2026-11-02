// HTTP API for the DSHA app (and anything else with the token).
// All routes need `Authorization: Bearer <token>` (token lives in ~/.dsh/config.json).
// Run events stream as Server-Sent Events from /api/sessions/:id/events?after=<seq>.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { usageReport } from './usage.mjs';
import { loadConfig, saveConfig, readKey, writeKey, listSessions, createSession, deleteSession, HOME, TEMP_ROOTS, isTemp, USER_HOME } from './store.mjs';
import { runtime, dropRuntime, activeRuns, apiState } from './agent.mjs';
import { DeepSeek } from './deepseek.mjs';
import { Mcp, loadMcpConfig, saveMcpConfig } from './mcp.mjs';
import { listSkills, readSkill, setSkill, setClaudeSkills, createSkill, deleteSkill, instructionFiles, writeInstructions, listMemory, readMemory, deleteMemory } from './skills.mjs';
import { systemPrompt } from './agent.mjs';
import { listAgents, readAgent, saveAgent, setAgent, setClaudeAgents, deleteAgent } from './agents.mjs';
import { TOOLS, editInCwd } from './tools.mjs';

export const VERSION = '0.10.1';
const BOOT = crypto.randomBytes(6).toString('hex'); // tells a client the server restarted (event seqs start again)

export function createServer({ config = loadConfig } = {}) {
  let cfg = config();
  const getCfg = () => cfg;
  const mcp = new Mcp();
  const deps = { config: getCfg, mcp };

  // The tool picker takes plugin tools from servers that are up; a hung one (30 s initialize) must not hold
  // the Subagents page or its Save, so it gets a short wait and the list fills in on a later load.
  // Each server is waited on by itself and listed from its own tools, so one hung server leaves out only its own.
  const agentList = async cwd => {
    const reserved = new Set(Object.keys(TOOLS)); let t;
    mcp.schemas(reserved).catch(() => {}); // refreshes the agent loop's map once every server has answered
    await Promise.race([Promise.all(mcp.servers.map(s => Promise.resolve(s.ready()).catch(() => {}))), new Promise(r => { t = setTimeout(r, 1500); })]); clearTimeout(t);
    const risk = (s, x) => { const a = x.annotations || {}; return a.readOnlyHint ? 'read' : a.destructiveHint === false ? 'edit' : a.destructiveHint === true ? 'exec' : s.risk || 'exec'; };
    const plug = mcp.servers.filter(s => s.state === 'up').flatMap(s => s.tools.map(x => ({ name: mcp.exposed(s, x, reserved), risk: risk(s, x), mcp: true })));
    const tools = [...Object.entries(TOOLS).filter(([n]) => n !== 'agent').map(([name, t]) => ({ name, risk: t.risk })), ...plug];
    return { ...listAgents(cwd), tools };
  };
  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, version: VERSION, pid: process.pid, boot: BOOT, standalone: !!process.env.DSH_STANDALONE, hasKey: !!readKey(), model: cfg.model, home: HOME, running: activeRuns(), tempRoots: TEMP_ROOTS, userHome: USER_HOME, api: apiState })],
    ['GET', /^\/api\/config$/, () => pub(cfg)],
    ['PUT', /^\/api\/config$/, (_, b) => {
      const p = pick(b, ['model', 'effort', 'mode', 'thinking', 'maxSteps', 'cwd', 'base']);
      if (p.cwd) { p.cwd = path.resolve(expand(p.cwd)); if (!isDir(p.cwd)) throw httpErr(400, 'Not a directory: ' + p.cwd); if (isTemp(p.cwd)) throw httpErr(400, tempMsg(p.cwd)); }
      cfg = saveConfig(p); return pub(cfg);
    }],
    ['PUT', /^\/api\/key$/, async (_, b) => {
      const k = String(b.key || '').trim();
      if (!/^sk-[\w-]{10,}$/.test(k)) throw httpErr(400, 'That does not look like a DeepSeek key (sk-…)');
      if (b.verify !== false) await new DeepSeek({ key: k, base: cfg.base }).models().catch(e => { throw httpErr(400, 'Key rejected: ' + e.message); });
      writeKey(k); return { ok: true };
    }],
    ['GET', /^\/api\/mcp$/, async () => { await mcp.schemas(); return mcp.status(); }],
    ['POST', /^\/api\/mcp\/reload$/, async () => { mcp.reload(true); await mcp.schemas(); return mcp.status(); }], // Reconnect all: restart every server, wedged ones too
    // Plugin management: edits ~/.dsh/mcp.json, then reloads. Replies without waiting for connections.
    ['PUT', /^\/api\/mcp\/([\w-]{1,40})$/, ([name], b) => {
      if (name === 'reload') throw httpErr(400, 'That name is reserved');
      const all = loadMcpConfig(), old = all[name] || {}, c = {};
      if (b.create && all[name]) throw httpErr(409, `A plugin named ${name} already exists`);
      if (b.url) {
        if (!/^https?:\/\/\S+$/.test(String(b.url).trim())) throw httpErr(400, 'The URL must start with http:// or https://');
        c.url = String(b.url).trim(); if (old.url && old.headers && origin(old.url) === origin(c.url)) c.headers = old.headers; // auth stays with its host
      } else if (b.command) {
        const parts = splitArgs(String(b.command)); c.command = parts[0]; c.args = parts.slice(1);
        // env and cwd (often secrets) stay only with the same program
        if (old.command === c.command && old.env) c.env = old.env; if (old.command === c.command && old.cwd) c.cwd = old.cwd;
      } else throw httpErr(400, 'Give a URL or a command');
      if (['read', 'edit', 'exec'].includes(b.risk)) c.risk = b.risk;
      if (b.start) c.start = String(b.start).trim();
      if (old.disabled) c.disabled = true;
      all[name] = c; saveMcpConfig(all); mcp.reload(); return mcp.status();
    }],
    ['PATCH', /^\/api\/mcp\/([\w-]{1,40})$/, ([name], b) => {
      const all = loadMcpConfig(); if (!all[name]) throw httpErr(404, 'No such server');
      if (b.disabled) all[name].disabled = true; else delete all[name].disabled;
      saveMcpConfig(all); mcp.reload(); return mcp.status();
    }],
    ['DELETE', /^\/api\/mcp\/([\w-]{1,40})$/, ([name]) => { const all = loadMcpConfig(); delete all[name]; saveMcpConfig(all); mcp.reload(); return mcp.status(); }],
    ['GET', /^\/api\/mcp\/([\w-]{1,40})\/tools$/, async ([name]) => { await mcp.schemas(); return mcp.tools(name); }],
    // Skills and instruction files, resolved against a working directory (default: the configured one).
    // Subagents. Lists carry the tool names a definition can pick from (built-ins, then connected plugins).
    ['GET', /^\/api\/agents$/, async q => agentList(cwdOf(q.query.get('cwd')))],
    ['GET', /^\/api\/agents\/read$/, q => user(() => readAgent(cwdOf(q.query.get('cwd')), q.query.get('id')))],
    ['POST', /^\/api\/agents$/, async (_, b) => { const cwd = cwdOf(b.cwd); const id = user(() => saveAgent(cwd, b)); return { id, ...await agentList(cwd) }; }],
    ['PATCH', /^\/api\/agents$/, async (_, b) => { if ('claude' in b) setClaudeAgents(b.claude); if (b.id) setAgent(String(b.id), !!b.enabled, cwdOf(b.cwd)); return agentList(cwdOf(b.cwd)); }],
    ['POST', /^\/api\/agents\/delete$/, async (_, b) => { const cwd = cwdOf(b.cwd); user(() => deleteAgent(cwd, String(b.id))); return agentList(cwd); }],
    ['GET', /^\/api\/skills$/, q => listSkills(cwdOf(q.query.get('cwd')))],
    ['GET', /^\/api\/skills\/read$/, q => user(() => readSkill(cwdOf(q.query.get('cwd')), q.query.get('id')))],
    ['POST', /^\/api\/skills$/, (_, b) => { const cwd = cwdOf(b.cwd); const id = user(() => createSkill(cwd, b)); return { id, ...listSkills(cwd) }; }],
    ['PATCH', /^\/api\/skills$/, (_, b) => { if ('claude' in b) setClaudeSkills(b.claude); if (b.id) setSkill(String(b.id), !!b.enabled, cwdOf(b.cwd)); return listSkills(cwdOf(b.cwd)); }],
    ['POST', /^\/api\/skills\/delete$/, (_, b) => { const cwd = cwdOf(b.cwd); user(() => deleteSkill(cwd, String(b.id))); return listSkills(cwd); }],
    ['GET', /^\/api\/memory$/, () => listMemory()],
    ['GET', /^\/api\/memory\/read$/, q => user(() => readMemory(q.query.get('file')))],
    ['POST', /^\/api\/memory\/delete$/, (_, b) => { user(() => deleteMemory(String(b.file))); return listMemory(); }],
    ['GET', /^\/api\/instructions$/, q => instructionFiles(cwdOf(q.query.get('cwd')))],
    ['PUT', /^\/api\/instructions$/, (_, b) => { const cwd = cwdOf(b.cwd); user(() => writeInstructions(cwd, String(b.key), b.content)); return instructionFiles(cwd); }],
    ['GET', /^\/api\/system$/, q => { const id = q.query.get('session'); return { text: id ? systemPrompt(rt(id).s, mcp.prompt()) : systemPrompt({ cwd: cwdOf(q.query.get('cwd')) }, mcp.prompt()) }; }],
    ['GET', /^\/api\/models$/, () => api().models()],
    ['GET', /^\/api\/balance$/, () => api().balance()],
    ['GET', /^\/api\/usage$/, () => usageReport({ running: activeRuns() })],
    ['GET', /^\/api\/sessions$/, () => listSessions().map(s => ({ ...s, running: activeRuns().includes(s.id) }))],
    ['POST', /^\/api\/sessions$/, (_, b) => {
      // New sessions start somewhere that survives: never a temp folder, and the default falls back to home.
      const cwd = b.cwd ? path.resolve(expand(b.cwd)) : isTemp(cfg.cwd) || !isDir(cfg.cwd) ? USER_HOME : cfg.cwd;
      if (!isDir(cwd)) throw httpErr(400, 'Not a directory: ' + cwd);
      if (isTemp(cwd)) throw httpErr(400, tempMsg(cwd));
      return createSession(cfg, { ...pick(b, ['title', 'model', 'effort', 'mode', 'thinking']), cwd }); }],
    ['GET', /^\/api\/sessions\/(\w+)$/, q => rt(q[0]).snapshot(q.query.get('at'))],
    ['PATCH', /^\/api\/sessions\/(\w+)$/, ([id], b) => {
      const r = rt(id), p = pick(b, ['title', 'model', 'effort', 'mode', 'thinking', 'cwd']);
      if (p.cwd) { p.cwd = path.resolve(expand(p.cwd)); if (!isDir(p.cwd)) throw httpErr(400, 'Not a directory: ' + p.cwd); }
      if ('allow' in b) r.s.allow = [];
      Object.assign(r.s, p); r.save(); r.emit('session', { patch: 'allow' in b ? { ...p, allow: r.s.allow } : p });
      // A mode that now allows a tool waiting for approval lets it run (switching to Auto unblocks the run).
      // The call's own args count, as at the gate: 'edits' covers a built-in file write only inside the working directory.
      if (p.mode) for (const wid of [...r.waiting.keys()]) {
        const ev = r.events.findLast(e => e.type === 'approval' && e.id === wid), risk = ev && (TOOLS[ev.name] || mcp.lookup(ev.name))?.risk;
        if (!risk || !r.allowed(ev.name, risk, ev.args, TOOLS[ev.name] ? ev.name : mcp.lookup(ev.name)?.allowKey || ev.name)) continue;
        r.approve(wid, 'allow');
      }
      return r.snapshot();
    }],
    // Deleted first: the stopped run's last saves are then no-ops and can't bring the file back.
    // Its open event streams end too, so a client watching it (the CLI, another phone) hears that it is gone.
    ['DELETE', /^\/api\/sessions\/(\w+)$/, ([id]) => { deleteSession(id); dropRuntime(id); for (const res of streams.get(id) || []) res.end(); return { ok: true }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/messages$/, ([id], b) => { const text = String(b.text || '').trim(); if (!text) throw httpErr(400, 'Empty message'); const r = rt(id); let q; try { q = r.send(text); } catch (e) { throw httpErr(409, e.message); } return { ok: true, seq: r.seq, ...(q ? { queued: q } : {}) }; }],
    ['DELETE', /^\/api\/sessions\/(\w+)\/queue\/(\w+)$/, ([id, q]) => { if (!rt(id).unqueue(q)) throw httpErr(409, 'Already read by dsh'); return { ok: true }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/retry$/, ([id]) => { const r = rt(id); try { r.retry(); } catch (e) { throw httpErr(409, e.message); } return { ok: true, seq: r.seq }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/stop$/, ([id]) => { rt(id).stop(); return { ok: true }; }],
    ['POST', /^\/api\/sessions\/(\w+)\/approve$/, ([id], b) => ({ ok: rt(id).approve(String(b.id), ['allow', 'always', 'deny'].includes(b.decision) ? b.decision : 'deny') })],
    ['POST', /^\/api\/sessions\/(\w+)\/compact$/, async ([id]) => { const r = rt(id); if (r.running) throw httpErr(409, 'Stop the run first'); try { return { ok: await r.compact() }; } catch (e) { throw e.status ? e : httpErr(409, e.message); } }],
    ['POST', /^\/api\/sessions\/(\w+)\/rewind$/, ([id], b) => {
      // Drop everything from the n-th user message on, so it can be edited and resent.
      const r = rt(id); if (r.running) throw httpErr(409, 'Stop the run first');
      if (!Number.isInteger(b.turn) || b.turn < 0) throw httpErr(400, 'turn must be a message number');
      let n = -1, cut = r.s.messages.length;
      r.s.messages.forEach((m, i) => { if (m.role === 'user' && ++n === b.turn && cut === r.s.messages.length) cut = i; });
      const text = r.s.messages[cut]?.content; r.s.messages = r.s.messages.slice(0, cut); r.runBase = cut;
      for (const k of Object.keys(r.s.meta)) { const m = k.match(/^(?:steer|think)(\d+)$/); if (m && +m[1] >= cut) delete r.s.meta[k]; }
      r.save();
      return { ok: true, text, session: r.snapshot() };
    }],
    ['GET', /^\/api\/fs$/, (q) => {
      const d = path.resolve(expand(q.query.get('path') || (isDir(cfg.cwd) ? cfg.cwd : USER_HOME)));
      let list;
      try { list = fs.readdirSync(d, { withFileTypes: true }); }
      catch (e) { throw httpErr(e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 404 : 403, e.code === 'ENOENT' ? `${d} doesn't exist` : e.code === 'ENOTDIR' ? `${d} isn't a folder` : `Can't open ${d}`); }
      const ents = list.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name).filter(n => q.query.get('hidden') || !n.startsWith('.')).sort();
      return { path: d, parent: path.dirname(d), dirs: ents.filter(n => isDir(path.join(d, n))) };
    }],
  ];

  const cwdOf = c => { const d = c ? path.resolve(expand(String(c))) : cfg.cwd; if (!isDir(d)) throw httpErr(400, 'Not a directory: ' + d); return d; };
  const user = fn => { try { return fn(); } catch (e) { throw e.status ? e : httpErr(400, e.message); } };
  const streams = new Map(); // session id → open event-stream responses
  const rt = id => { const r = runtime(id, deps); if (!r) throw httpErr(404, 'No such session'); return r; };
  const api = () => { const k = readKey(); if (!k) throw httpErr(412, 'No API key set'); return new DeepSeek({ key: k, base: cfg.base }); };

  const srv = http.createServer(async (req, res) => {
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
  srv.on('close', () => mcp.close());
  return srv;

  function stream(req, res, id, after) {
    let r; try { r = rt(id); } catch (e) { return send(res, 404, { error: e.message }); }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...cors });
    res.write(`: dsh ${VERSION}\n\n`);
    const off = r.subscribe(ev => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`), after);
    const ping = setInterval(() => res.write(`: ping\n\n`), 15000), open = streams.get(id) || new Set();
    streams.set(id, open.add(res));
    res.on('close', () => { off(); clearInterval(ping); open.delete(res); if (!open.size && streams.get(id) === open) streams.delete(id); });
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
    // Decoded once at the end: a UTF-8 character split across two chunks must not turn into U+FFFD.
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > 4e6) { bad(httpErr(413, 'Body too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { ok(s ? JSON.parse(s) : {}); } catch { bad(httpErr(400, 'Invalid JSON')); } });
  });
}

const pub = c => { const { token, ...rest } = c; return rest; };
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const expand = p => p.startsWith('~') ? path.join(process.env.HOME || '/', p.slice(1)) : p;
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

const origin = u => { try { return new URL(u).origin; } catch { return null; } };

// Shell-style words: "node server.mjs --flag 'a b' --x=\"c d\" e\\ f" -> ['node', 'server.mjs', '--flag', 'a b', '--x=c d', 'e f'].
// Single quotes are literal, \ escapes the next character (inside double quotes only " \ $ `), pieces join.
export function splitArgs(line) {
  const out = []; let cur = null, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; }
    else if (q === '"') { if (c === '"') q = null; else if (c === '\\' && '"\\$`'.includes(line[i + 1] ?? '\n')) cur += line[++i]; else cur += c; }
    else if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null; }
    else { cur ??= ''; if (c === "'" || c === '"') q = c; else if (c === '\\' && i + 1 < line.length) cur += line[++i]; else cur += c; }
  }
  if (cur !== null) out.push(cur);
  return out;
}

const tempMsg = d => `${d} is a temporary folder that can be wiped; pick one under your home folder`;
