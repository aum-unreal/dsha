// MCP (Model Context Protocol) client. Servers listed in ~/.dsh/mcp.json are
// exposed to the model as ordinary tools, next to the built-ins, and go through
// the same permission gate. Two transports, no npm deps:
//   stdio  — {"command": "...", "args": [], "env": {}, "cwd": "..."}; dsh spawns it
//   http   — {"url": "http://127.0.0.1:9090/mcp"}; streamable HTTP (JSON or SSE replies)
// Either may add "start": "<shell command>" which dsh runs once when the server
// is unreachable (for a shared service other clients also use), and "risk":
// "read" | "edit" | "exec" as the default for tools without annotations.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME } from './store.mjs';
import { sh, clip, TOOLS } from './tools.mjs';

const PROTOCOL = '2025-06-18';
export const CONFIG_FILE = path.join(HOME, 'mcp.json');
const RETRY_MS = 30_000;
const NAME_RE = /[^a-zA-Z0-9_-]/g;

// The file as parsed: { doc, error }. A missing file is an empty config; one that isn't valid JSON is an error.
function readDoc() {
  let text; try { text = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch { return { doc: {} }; }
  try { const doc = JSON.parse(text); return doc && typeof doc === 'object' && !Array.isArray(doc) ? { doc } : { doc: {}, error: 'mcp.json is not a JSON object' }; }
  catch (e) { return { doc: {}, error: 'mcp.json is not valid JSON: ' + e.message }; }
}
// The server map, without entries that aren't objects (a hand-written null must not crash dsh).
// Problems (a parse error, skipped entries) are kept on the result as a non-enumerable `errors` list.
export function loadMcpConfig() {
  const { doc, error } = readDoc(), errors = error ? [error] : [], raw = doc.mcpServers ?? {}, out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) errors.push('mcpServers is not an object');
  else for (const [k, c] of Object.entries(raw)) c && typeof c === 'object' && !Array.isArray(c) ? out[k] = c : errors.push(`${k}: not a server definition (${JSON.stringify(c)})`);
  return Object.defineProperty(out, 'errors', { value: errors });
}
// Rewrite mcp.json's server map, keeping any other top-level keys the user put there. Refuses when the
// file doesn't parse: rewriting it would drop every server the user wrote by hand.
export function saveMcpConfig(servers) {
  const { doc, error } = readDoc();
  // Also refused when an entry (or mcpServers itself) isn't a server definition: the map handed in was
  // read without it, so writing it back would silently drop what the user wrote.
  const bad = error || loadMcpConfig().errors.join('; ');
  if (bad) throw Object.assign(new Error(`${bad}. Fix ${CONFIG_FILE} by hand first.`), { status: 400 });
  doc.mcpServers = servers;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = CONFIG_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, CONFIG_FILE);
}

class Server {
  constructor(name, cfg) {
    this.name = name; this.cfg = cfg; this.state = 'idle'; this.error = ''; this.tools = []; this.dirty = true;
    this.info = null; this.instructions = ''; this.lastFail = 0; this.pending = new Map(); this.nextId = 1;
  }
  get risk() { return ['read', 'edit', 'exec'].includes(this.cfg.risk) ? this.cfg.risk : 'exec'; }
  log(...a) { if (process.env.DSH_MCP_DEBUG) console.error(`[mcp ${this.name}]`, ...a); }

  // Connect (if needed) and return the tool list; swallows failures so a dead
  // server never blocks a run, and retries no more often than RETRY_MS.
  // One at a time: concurrent callers (main loop, parallel subagents, the app) share the attempt in flight.
  ready() { return this.dead ? Promise.resolve(false) : this.readying ??= this.tryReady().finally(() => { this.readying = null; }); }
  async tryReady() {
    if (this.state === 'up') { if (this.dirty) await this.listTools().catch(e => e.expired || this.fail(e)); if (this.state === 'up') return true; }
    if (Date.now() - this.lastFail < RETRY_MS) return false;
    try {
      await this.connect();
    } catch (e) {
      if (this.dead) return false; // removed from mcp.json while connecting: no start command, no retries
      if (this.cfg.start && !this.started) {
        this.started = true; this.log('start:', this.cfg.start);
        await sh(this.cfg.start, { cwd: process.env.HOME, timeout: 60 });
        for (let i = 0; i < 30 && !this.dead; i++) { await new Promise(r => setTimeout(r, 500)); try { await this.connect(); break; } catch (e2) { e = e2; } }
      }
      if (this.dead) return false;
      if (this.state !== 'up') return this.fail(e), false;
    }
    return true;
  }
  fail(e) { this.state = 'down'; this.error = String(e?.message || e); this.lastFail = Date.now(); this.log('down:', this.error); this.close(); }

  async connect() {
    if (this.dead) throw new Error('MCP server removed');
    this.state = 'connecting';
    await this.open();
    const r = await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dsh', version: '0.3.0' } }, 30);
    this.protocol = r.protocolVersion || PROTOCOL; this.info = r.serverInfo || null; this.instructions = r.instructions || '';
    await this.notify('notifications/initialized');
    this.state = 'up'; this.error = '';
    await this.listTools();
  }
  async listTools() {
    const out = []; let cursor;
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, 30);
      out.push(...(r.tools || [])); cursor = r.nextCursor;
    } while (cursor);
    this.tools = out; this.dirty = false;
    return out;
  }
  async call(tool, args, signal) {
    const req = () => this.request('tools/call', { name: tool, arguments: args || {} }, 600, signal);
    // The server forgot our session (HTTP 404): it didn't run the call, so start a new session and retry once.
    const r = await req().catch(async e => { if (!e.expired || !await this.ready()) throw e; return req(); });
    this.dirty = true; // a call may enable or add tools (toolset gating); relist before the next step
    const parts = (r.content || []).map(c => c.type === 'text' ? c.text : c.type === 'image' ? `[image ${c.mimeType || ''} ${Math.round((c.data || '').length * 0.75)} bytes]` : c.type === 'resource' ? (c.resource?.text ?? `[resource ${c.resource?.uri || ''}]`) : `[${c.type}]`);
    let text = parts.join('\n');
    if (!text && r.structuredContent) text = JSON.stringify(r.structuredContent, null, 1);
    if (r.isError) throw new Error(text || 'tool error');
    return text || '(no output)';
  }

  // JSON-RPC plumbing shared by both transports.
  handle(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${msg.error.message || 'error'}${msg.error.data ? ' ' + clip(JSON.stringify(msg.error.data), 500) : ''}`)) : p.resolve(msg.result ?? {});
    } else if (msg.method && msg.id !== undefined) {
      // Server → client request: we support none, answer method-not-found.
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not supported by dsh: ' + msg.method } }).catch(() => {});
    } else if (msg.method === 'notifications/tools/list_changed') {
      this.dirty = true;
    }
  }
  request(method, params, timeoutS = 120, signal) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => done(new Error(`${method} timed out after ${timeoutS}s`)), timeoutS * 1000);
      const onAbort = () => { this.notify('notifications/cancelled', { requestId: id, reason: 'stopped by user' }).catch(() => {}); done(new Error('Cancelled: the user stopped the run.')); };
      const done = (err, val) => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); this.pending.delete(id); err ? reject(err) : resolve(val); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve: v => done(null, v), reject: done });
      this.send(msg).catch(done);
    });
  }
  notify(method, params) { return this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); }
  close() { for (const p of this.pending.values()) p.reject(new Error('MCP server closed')); this.pending.clear(); }
  // For good (removed or changed in mcp.json): no reconnects after this.
  dispose() { this.dead = true; this.state = 'idle'; this.close(); }
}

class Stdio extends Server {
  async open() {
    const { command, args = [], env = {}, cwd } = this.cfg;
    if (!command) throw new Error('no command');
    if (this.dead) throw new Error('MCP server removed');
    if (this.proc) { const old = this.proc; this.proc = null; try { old.kill('SIGTERM'); } catch {} } // a failed earlier attempt
    const p = spawn(command, args, { cwd: cwd || process.env.HOME, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    let buf = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); // a character split across chunks stays whole
    p.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        try { this.handle(JSON.parse(line)); } catch { this.log('bad line', line.slice(0, 200)); }
      }
    });
    p.stderr.on('data', d => this.log(String(d).trimEnd()));
    p.on('exit', (code, sig) => { if (this.proc === p) { this.proc = null; if (this.state !== 'idle') this.fail(new Error(`exited (${sig || code})`)); } });
    await new Promise((ok, bad) => { p.once('spawn', ok); p.once('error', bad); });
  }
  send(msg) {
    return new Promise((ok, bad) => { if (!this.proc?.stdin.writable) return bad(new Error('MCP server not running')); this.proc.stdin.write(JSON.stringify(msg) + '\n', e => e ? bad(e) : ok()); });
  }
  close() { super.close(); const p = this.proc; this.proc = null; if (p) { try { p.kill('SIGTERM'); } catch {} } }
}

class Http extends Server {
  async open() {
    if (!this.cfg.url) throw new Error('no url');
    this.session = null;
  }
  headers(extra = {}) {
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(this.cfg.headers || {}), ...extra };
    if (this.session) h['mcp-session-id'] = this.session;
    if (this.state === 'up') h['mcp-protocol-version'] = this.protocol;
    return h;
  }
  // Each POST carries one message; the reply is either a JSON body or an SSE
  // stream that we drain, routing every message through handle().
  async send(msg) {
    const headers = this.headers();
    const r = await fetch(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(msg) });
    const sid = r.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (r.status === 202 || r.status === 204) return;
    // MCP spec: 404 on a request carrying a session id means the session is gone; the client must start a new one.
    if (r.status === 404 && headers['mcp-session-id']) {
      await r.text().catch(() => {});
      // Only if it's still our session: a late 404 for an old one must not drop a newer session (parallel calls).
      if (this.session === headers['mcp-session-id']) { this.session = null; if (this.state === 'up') this.state = 'idle'; this.lastFail = 0; }
      throw Object.assign(new Error('HTTP 404: the MCP session expired'), { expired: true });
    }
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status}${t ? ': ' + clip(t, 300) : ''}`); }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) { this.drain(r.body).catch(e => this.log('stream', e.message)); return; }
    const body = await r.text(); if (!body.trim()) return;
    const j = JSON.parse(body);
    for (const m of Array.isArray(j) ? j : [j]) this.handle(m);
  }
  async drain(body) {
    let buf = '', data = ''; const dec = new TextDecoder();
    const flush = () => { if (data) { try { this.handle(JSON.parse(data)); } catch {} } data = ''; };
    for await (const c of body) {
      buf += dec.decode(c, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (line === '') flush();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
      }
    }
    flush();
  }
  close() { super.close(); if (this.session) { fetch(this.cfg.url, { method: 'DELETE', headers: this.headers() }).catch(() => {}); this.session = null; } }
}

export class Mcp {
  constructor(cfg) { this.names = new Map(); this.map = new Map(); this.load(cfg); }
  // Only what changed is replaced: a server whose entry is the same keeps its connection, its pending
  // calls and its state (tools unlocked by toolset gating). all: restart every server.
  load(cfg = loadMcpConfig(), all = false) {
    const errors = cfg.errors || [];
    cfg = Object.fromEntries(Object.entries(cfg || {}).filter(([, c]) => c && typeof c === 'object'));
    const old = new Map((this.servers || []).map(s => [s.name, s]));
    this.cfg = cfg; this.errors = errors;
    this.servers = Object.entries(cfg).filter(([, c]) => !c.disabled).map(([name, c]) => {
      const o = old.get(name);
      if (o && !all && JSON.stringify(o.cfg) === JSON.stringify(c)) { old.delete(name); if (o.state === 'down') o.lastFail = 0; return o; }
      return c.url ? new Http(name, c) : new Stdio(name, c);
    });
    for (const s of old.values()) s.dispose();
    this.map = new Map([...this.map].filter(([, t]) => this.servers.includes(t.server)));
  }
  reload(all = false) { this.load(undefined, all); }

  // The name a server's tool is exposed as (DeepSeek: [A-Za-z0-9_-]{1,64}). Sticky for the life of the
  // process: once given, a name always means that server's tool, even while another server that has a
  // tool of the same name comes and goes, so the model never calls a different tool under a name it saw.
  exposed(s, t, reserved) {
    const key = s.name + '\0' + t.name;
    let name = this.names.get(key); if (name && !reserved.has(name)) return name;
    const taken = new Set([...reserved, ...[...this.names].filter(([k]) => k !== key).map(([, v]) => v)]);
    name = t.name.replace(NAME_RE, '_');
    if (taken.has(name) || this.servers.some(o => o !== s && o.tools.some(x => x.name === t.name))) name = `${s.name.replace(NAME_RE, '_')}_${name}`;
    name = name.slice(0, 64);
    for (let i = 2; taken.has(name); i++) name = name.slice(0, 62) + '_' + i;
    this.names.set(key, name);
    return name;
  }
  // Function schemas for every reachable server, named so they can't collide with built-ins or each other.
  // Built-in tool names are always reserved, whoever asks (the app's status calls too).
  async schemas(reserved = new Set(Object.keys(TOOLS))) {
    await Promise.all(this.servers.map(s => s.ready()));
    const map = new Map(), out = [];
    for (const s of this.servers) {
      if (s.state !== 'up') continue;
      for (const t of s.tools) {
        const name = this.exposed(s, t, reserved);
        const a = t.annotations || {};
        const risk = a.readOnlyHint ? 'read' : a.destructiveHint === false ? 'edit' : a.destructiveHint === true ? 'exec' : s.risk;
        map.set(name, { server: s, name: t.name, risk, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } });
        out.push({ type: 'function', function: { name, description: clip(t.description || '', 4000), parameters: t.inputSchema || { type: 'object', properties: {} } } });
      }
    }
    this.map = map;
    return out;
  }
  // A TOOLS-shaped entry for the agent loop, or undefined.
  lookup(name) {
    const t = this.map.get(name); if (!t) return;
    // allowKey: what an 'always allow' should be stored under: the server and its own tool name, not the exposed name.
    return { risk: t.risk, description: t.description, parameters: t.parameters, mcp: t.server.name, allowKey: `mcp:${t.server.name}:${t.name}`, run: (args, ctx) => t.server.call(t.name, args, ctx.signal) };
  }
  // System-prompt section: which servers are up and what they say about themselves.
  prompt() {
    const up = this.servers.filter(s => s.state === 'up');
    if (!up.length) return '';
    return up.map(s => `- ${s.name}${s.info?.name ? ` (${s.info.name} ${s.info.version || ''})` : ''}: ${s.tools.length} tools${s.instructions ? '\n' + clip(s.instructions, 6000) : ''}`).join('\n');
  }
  // One row per configured server, disabled ones included. Env values and headers stay on the box.
  // A broken mcp.json shows up as a first row in error, so the user sees why servers are missing.
  status() {
    const bad = this.errors?.length ? [{ name: 'mcp.json', transport: 'config', target: CONFIG_FILE, risk: 'exec', env: [], disabled: false, state: 'down', error: this.errors.join('; '), tools: 0, invalid: true }] : [];
    return [...bad, ...Object.entries(this.cfg || {}).map(([name, c]) => {
      const s = this.servers.find(x => x.name === name);
      return { name, transport: c.url ? 'http' : 'stdio', target: c.url || [c.command, ...(c.args || [])].join(' '), risk: ['read', 'edit', 'exec'].includes(c.risk) ? c.risk : 'exec', start: c.start || undefined, env: Object.keys(c.env || {}), headers: Object.keys(c.headers || {}), command: c.url ? undefined : c.command, args: c.url ? undefined : c.args || [], disabled: !!c.disabled,
        state: c.disabled ? 'off' : s?.state || 'idle', error: s?.error || undefined, tools: s?.tools.length || 0, server: s?.info || undefined };
    })];
  }
  tools(name) {
    const s = this.servers.find(x => x.name === name);
    return (s?.tools || []).map(t => ({ name: t.name, description: t.description || '', readOnly: !!t.annotations?.readOnlyHint }));
  }
  close() { for (const s of this.servers) s.dispose(); }
}
