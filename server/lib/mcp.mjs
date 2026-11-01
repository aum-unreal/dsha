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
import { sh, clip } from './tools.mjs';

const PROTOCOL = '2025-06-18';
export const CONFIG_FILE = path.join(HOME, 'mcp.json');
const RETRY_MS = 30_000;
const NAME_RE = /[^a-zA-Z0-9_-]/g;

export function loadMcpConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).mcpServers || {}; } catch { return {}; }
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
  async ready() {
    if (this.state === 'up') { if (this.dirty) await this.listTools().catch(e => this.fail(e)); return this.state === 'up'; }
    if (Date.now() - this.lastFail < RETRY_MS) return false;
    try {
      await this.connect();
    } catch (e) {
      if (this.cfg.start && !this.started) {
        this.started = true; this.log('start:', this.cfg.start);
        await sh(this.cfg.start, { cwd: process.env.HOME, timeout: 60 });
        for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 500)); try { await this.connect(); break; } catch (e2) { e = e2; } }
      }
      if (this.state !== 'up') return this.fail(e), false;
    }
    return true;
  }
  fail(e) { this.state = 'down'; this.error = String(e?.message || e); this.lastFail = Date.now(); this.log('down:', this.error); this.close(); }

  async connect() {
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
    const r = await this.request('tools/call', { name: tool, arguments: args || {} }, 600, signal);
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
}

class Stdio extends Server {
  async open() {
    const { command, args = [], env = {}, cwd } = this.cfg;
    if (!command) throw new Error('no command');
    const p = spawn(command, args, { cwd: cwd || process.env.HOME, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    let buf = '';
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
    const r = await fetch(this.cfg.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(msg) });
    const sid = r.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (r.status === 202 || r.status === 204) return;
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
  constructor(cfg) { this.load(cfg); }
  load(cfg = loadMcpConfig()) {
    for (const s of this.servers || []) s.close();
    this.servers = Object.entries(cfg).map(([name, c]) => c.url ? new Http(name, c) : new Stdio(name, c));
    this.map = new Map();
  }
  reload() { this.load(); }

  // Function schemas for every reachable server, named so they can't collide
  // with built-ins or each other (DeepSeek: [A-Za-z0-9_-]{1,64}).
  async schemas(reserved = new Set()) {
    await Promise.all(this.servers.map(s => s.ready()));
    const map = new Map(), out = [];
    for (const s of this.servers) {
      if (s.state !== 'up') continue;
      for (const t of s.tools) {
        let name = t.name.replace(NAME_RE, '_');
        if (reserved.has(name) || map.has(name)) name = `${s.name.replace(NAME_RE, '_')}_${name}`;
        name = name.slice(0, 64);
        for (let i = 2; map.has(name) || reserved.has(name); i++) name = name.slice(0, 62) + '_' + i;
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
    return { risk: t.risk, description: t.description, parameters: t.parameters, mcp: t.server.name, run: (args, ctx) => t.server.call(t.name, args, ctx.signal) };
  }
  // System-prompt section: which servers are up and what they say about themselves.
  prompt() {
    const up = this.servers.filter(s => s.state === 'up');
    if (!up.length) return '';
    return up.map(s => `- ${s.name}${s.info?.name ? ` (${s.info.name} ${s.info.version || ''})` : ''}: ${s.tools.length} tools${s.instructions ? '\n' + clip(s.instructions, 6000) : ''}`).join('\n');
  }
  status() {
    return this.servers.map(s => ({ name: s.name, transport: s.cfg.url ? 'http' : 'stdio', state: s.state, error: s.error || undefined, tools: s.tools.length, server: s.info || undefined }));
  }
  close() { for (const s of this.servers) s.close(); }
}
