// The agent loop. One Runtime per open session: it owns the run (stream →
// tool calls → permission gate → results → repeat) and an event log that
// clients replay by sequence number, so a phone that drops the connection
// (screen off, app killed) can reattach mid-run without losing anything.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeepSeek, cost } from './deepseek.mjs';
import { TOOLS, schemas, summarize, clip } from './tools.mjs';
import { saveSession, loadSession, readKey } from './store.mjs';

const runtimes = new Map();
const MAX_EVENTS = 20000;
const COMPACT_AT = 700_000; // prompt tokens; models have a 1M window

export function runtime(id, deps) {
  let rt = runtimes.get(id);
  if (!rt) { const s = loadSession(id); if (!s) return null; rt = new Runtime(s, deps); runtimes.set(id, rt); }
  return rt;
}
export const dropRuntime = id => { runtimes.get(id)?.stop(); runtimes.delete(id); };
export const activeRuns = () => [...runtimes.values()].filter(r => r.running).map(r => r.s.id);

function contextFiles(cwd) {
  const out = [];
  for (const n of ['DSH.md', 'AGENTS.md', 'CLAUDE.md']) {
    const f = path.join(cwd, n);
    try { const t = fs.readFileSync(f, 'utf8'); out.push(`<file path="${f}">\n${clip(t, 20000)}\n</file>`); } catch {}
  }
  return out.join('\n');
}

export function systemPrompt(s) {
  const files = contextFiles(s.cwd);
  return `You are dsh, a coding and operations agent running on the user's own machine (${os.platform()} ${os.arch()}${process.env.PREFIX ? ', Termux on Android' : ''}) and talking to them through the DSHA phone app.
Working directory: ${s.cwd}
Date: ${new Date().toISOString().slice(0, 10)}

How to work:
- Use the tools to inspect before you change things. Read a file before editing it; prefer edit_file over rewriting whole files.
- Paths are relative to the working directory unless absolute. The shell is bash; Termux binaries live in $PREFIX/bin.
- Keep the user informed in short prose. Final answers: concise, Markdown, lead with the result. On a phone screen, avoid wide tables.
- For multi-step tasks keep a todo list with todo_write.
- Tool calls may be denied by the user; if so, don't retry the same call — adjust or ask.
- Don't run destructive commands (rm -rf, force-push, wiping data) unless the user clearly asked.
- Report outcomes faithfully: if a command failed, say so.${files ? '\n\nProject instructions found in the working directory:\n' + files : ''}`;
}

export class Runtime {
  constructor(s, { config }) {
    this.s = s; this.config = config;
    this.events = []; this.seq = 0; this.subs = new Set();
    this.running = false; this.abort = null; this.waiting = new Map(); this.runBase = s.messages.length; this.runSeq = 0;
  }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, t: Date.now(), type, ...data };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const f of this.subs) f(ev);
    return ev;
  }
  subscribe(f, after = 0) {
    for (const ev of this.events) if (ev.seq > after) f(ev);
    this.subs.add(f); return () => this.subs.delete(f);
  }
  snapshot() {
    const s = this.s;
    return { ...s, messages: this.running ? s.messages.slice(0, this.runBase) : s.messages, live: { running: this.running, seq: this.seq, fromSeq: this.running ? this.runSeq - 1 : this.seq, waiting: [...this.waiting.keys()] } };
  }
  save() { saveSession(this.s); }

  send(text) {
    if (this.running) throw new Error('A run is already in progress');
    if (!readKey()) throw new Error('No DeepSeek API key. Set one in DSHA settings or write it to ~/.config/deepseek/key');
    this.runBase = this.s.messages.length;
    this.running = true; this.abort = new AbortController();
    this.runSeq = this.emit('run_start', { runBase: this.runBase }).seq;
    this.s.messages.push({ role: 'user', content: text });
    if (this.s.title === 'New session') { this.s.title = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session'; this.emit('title', { title: this.s.title }); }
    this.emit('user', { text });
    this.save();
    this.loop().catch(e => this.emit('error', { message: String(e?.message || e) })).finally(() => {
      const reason = this.abort?.signal.aborted ? 'stopped' : this.endReason || 'done';
      this.running = false; this.abort = null; this.endReason = null;
      for (const r of this.waiting.values()) r('deny');
      this.waiting.clear();
      this.save();
      this.emit('run_end', { reason });
    });
  }

  stop() { if (this.abort) this.abort.abort(); for (const r of this.waiting.values()) r('deny'); }

  approve(id, decision) {
    const r = this.waiting.get(id); if (!r) return false;
    r(decision); return true;
  }

  client() { return new DeepSeek({ key: readKey(), base: this.config().base }); }

  apiMessages() {
    return [{ role: 'system', content: systemPrompt(this.s) }, ...this.s.messages];
  }

  async loop() {
    const s = this.s, ds = this.client(), signal = this.abort.signal, tools = schemas();
    const max = this.config().maxSteps;
    for (let step = 0; step < max; step++) {
      if (signal.aborted) return;
      if (s.usage.lastPrompt > COMPACT_AT) await this.compact(ds, signal);
      this.emit('step_start', { step });
      let r0 = 0, rMs = 0;
      const thought = () => { if (r0 && !rMs) rMs = Date.now() - r0; };
      const { message, usage, finish } = await ds.stream(
        { model: s.model, messages: this.apiMessages(), tools, effort: s.effort, thinking: s.thinking !== false },
        { reasoning: d => { r0 ||= Date.now(); this.emit('reasoning', { d }); }, text: d => { thought(); this.emit('text', { d }); }, toolDelta: thought },
        signal);
      thought();
      if (!message.reasoning_content) delete message.reasoning_content;
      s.messages.push(message);
      if (rMs) s.meta['think' + (s.messages.length - 1)] = rMs;
      this.account(usage);
      this.save();
      if (finish === 'length' && !message.tool_calls) { this.emit('notice', { text: 'Reply hit the output token limit.' }); }
      if (!message.tool_calls?.length) return;
      for (const call of message.tool_calls) {
        const content = signal.aborted ? 'Cancelled: the user stopped the run.' : await this.runTool(call, signal);
        s.messages.push({ role: 'tool', tool_call_id: call.id, content });
        this.save();
      }
    }
    this.endReason = 'max_steps';
    this.emit('notice', { text: `Stopped after ${max} steps. Send a message to continue.` });
  }

  async runTool(call, signal) {
    const s = this.s, name = call.function.name, id = call.id, t0 = Date.now();
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = null; }
    const tool = TOOLS[name];
    this.emit('tool_call', { id, name, args, summary: args ? summarize(name, args) : call.function.arguments, risk: tool?.risk });
    const finish = (ok, content, extra = {}) => {
      s.meta[id] = { ok, ms: Date.now() - t0, ...extra };
      this.emit('tool_result', { id, ok, content: clip(content, 8000), ms: s.meta[id].ms, ...extra });
      return content;
    };
    if (!tool) return finish(false, `Unknown tool: ${name}`);
    if (!args) return finish(false, `Invalid JSON arguments: ${call.function.arguments}`);
    if (!this.allowed(name, tool.risk)) {
      const decision = await new Promise(r => { this.waiting.set(id, r); this.emit('approval', { id, name, summary: summarize(name, args), args }); });
      this.waiting.delete(id);
      this.emit('approval_done', { id, decision });
      if (decision === 'always') { if (!s.allow.includes(name)) s.allow.push(name); }
      else if (decision !== 'allow') return finish(false, signal.aborted ? 'Cancelled: the user stopped the run.' : 'The user denied this tool call.', { denied: true });
    }
    try {
      const out = await tool.run(args, { cwd: s.cwd, signal, session: s, onOutput: d => this.emit('tool_output', { id, d }) });
      if (name === 'todo_write') this.emit('todos', { todos: s.todos });
      return finish(true, out);
    } catch (e) {
      return finish(false, `Error: ${e?.message || e}`);
    }
  }

  allowed(name, risk) {
    const m = this.s.mode;
    if (risk === 'read' || m === 'auto' || this.s.allow.includes(name)) return true;
    if (m === 'edits' && risk === 'edit') return true;
    return false;
  }

  account(u) {
    const U = this.s.usage, c = cost(this.s.model, u);
    U.hit += u.hit; U.miss += u.miss; U.out += u.out; U.reasoning = (U.reasoning || 0) + (u.reasoning || 0);
    U.costPeak = (U.costPeak || 0) + c.peak; U.costOff = (U.costOff || 0) + c.offpeak;
    U.lastPrompt = u.hit + u.miss;
    this.emit('usage', { step: u, total: U });
  }

  // Replaces the conversation with a model-written summary. Used automatically
  // near the context limit and on demand from the app.
  async compact(ds = this.client(), signal) {
    const s = this.s;
    if (s.messages.length < 4) return false;
    this.emit('notice', { text: 'Compacting conversation…' });
    const transcript = s.messages.map(m => m.role === 'tool' ? `[tool result]\n${clip(m.content, 3000)}` : m.role === 'assistant' ? `[assistant]\n${m.content || ''}${m.tool_calls ? '\n' + m.tool_calls.map(c => `→ ${c.function.name} ${clip(c.function.arguments, 600)}`).join('\n') : ''}` : `[${m.role}]\n${m.content}`).join('\n\n');
    const { message, usage } = await ds.stream({ model: s.model, thinking: false, messages: [
      { role: 'system', content: 'You compress agent transcripts. Write a dense handoff summary: the user\'s goals and preferences, decisions made, files touched (paths), commands that matter, current state, and open next steps. Markdown, no preamble.' },
      { role: 'user', content: clip(transcript, 600000) }] }, {}, signal);
    this.account(usage);
    const last = [...s.messages].reverse().find(m => m.role === 'user');
    s.messages = [{ role: 'user', content: `Summary of our conversation so far (earlier turns were compacted):\n\n${message.content}` }, { role: 'assistant', content: 'Understood. I have the context from the summary.' }];
    if (this.running && last) s.messages.push({ role: 'user', content: `Continue with my latest request: ${last.content}` });
    this.runBase = 0; s.usage.lastPrompt = 0; s.compactions = (s.compactions || 0) + 1;
    this.save();
    this.emit('compacted', { summary: message.content });
    return true;
  }
}
