// The agent loop. One Runtime per open session: it owns the run (stream →
// tool calls → permission gate → results → repeat) and an event log that
// clients replay by sequence number, so a phone that drops the connection
// (screen off, app killed) can reattach mid-run without losing anything.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeepSeek, cost, asApiError } from './deepseek.mjs';
import { TOOLS, schemas, summarize, clip } from './tools.mjs';
import { contextFiles, skillPrompt, memoryPrompt } from './skills.mjs';
import { agentPrompt, resolveAgent } from './agents.mjs';
import { saveSession, loadSession, readKey } from './store.mjs';

const runtimes = new Map();
const MAX_EVENTS = +process.env.DSH_MAX_EVENTS || 20000;
const COMPACT_AT = 700_000; // prompt tokens; models have a 1M window
// A model call that fails before anything streams is retried after these waits (ms) when the failure is
// transient (rate limit, 5xx, no connection). DSH_RETRY_WAITS overrides them, for tests.
const RETRY_WAITS = (process.env.DSH_RETRY_WAITS ?? '2000,5000,12000').split(',').filter(Boolean).map(Number);
const sleep = (ms, signal) => new Promise(res => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

// The last DeepSeek call across all sessions, for /api/health, so the app can say DeepSeek isn't answering
// without opening the session that hit it.
export const apiState = { ok: true, at: 0, kind: null, message: null };
const noteApi = e => Object.assign(apiState, e ? { ok: false, at: Date.now(), kind: e.kind || 'bad', message: String(e.message || e) } : { ok: true, at: Date.now(), kind: null, message: null });

export function runtime(id, deps) {
  let rt = runtimes.get(id);
  if (!rt) { const s = loadSession(id); if (!s) return null; rt = new Runtime(s, deps); runtimes.set(id, rt); }
  return rt;
}
export const dropRuntime = id => { runtimes.get(id)?.stop(); runtimes.delete(id); };
export const activeRuns = () => [...runtimes.values()].filter(r => r.running).map(r => r.s.id);

export function systemPrompt(s, mcp = '') {
  const files = contextFiles(s.cwd), skills = skillPrompt(s.cwd), memory = memoryPrompt(), agents = agentPrompt(s.cwd);
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
- Report outcomes faithfully: if a command failed, say so.${mcp ? '\n\nExternal tool servers (MCP) connected; their tools sit next to the built-ins and follow the same approval rules:\n' + mcp : ''}\n\nSubagents: spawn helpers with the agent tool for searches across many files, independent parts of a task (several in one reply run in parallel), or work whose output would flood this conversation. Design one for the job by giving it a role (and tools and model when it needs less), or use a saved one. Brief each fully; it sees nothing here. Do simple lookups yourself. To keep a designed subagent for later, save it as ~/.dsh/agents/<name>.md (or .dsh/agents/ in the project): front matter name, description, tools, model (flash, pro or inherit), then its system prompt.${agents ? '\nSaved subagents:\n' + agents : ''}${skills ? '\n\nSkills: load one with the skill tool before a task it covers.\n' + skills : ''}${memory ? '\n\nMemory index (~/.dsh/memory/MEMORY.md; read a memory file when its line is relevant, and keep memory current with the dsh-memory-evolve skill):\n' + memory : ''}${files ? '\n\nInstructions from the user (global DSH.md) and the working directory (DSH.md, AGENTS.md, CLAUDE.md):\n' + files : ''}`;
}

export class Runtime {
  constructor(s, { config, mcp }) {
    this.s = s; this.config = config; this.mcp = mcp;
    this.events = []; this.seq = 0; this.subs = new Set();
    this.running = false; this.abort = null; this.waiting = new Map(); this.subStats = new Map(); this.runBase = s.messages.length; this.runSeq = 0;
  }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, t: Date.now(), type, ...data };
    this.events.push(ev);
    // Trim only finished runs, which a reconnecting client rebuilds from the snapshot. The live run
    // stays whole however long it streams (every token is an event), or an app reopened mid-run
    // would replay only its tail: the prompt, the first steps and the start of the reply gone.
    const over = this.events.length - MAX_EVENTS;
    if (over > 0) { let n = 0; while (n < over && !(this.running && this.events[n].seq >= this.runSeq)) n++; if (n) this.events.splice(0, n); }
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

  send(text) { this.start(text); }

  // Run again from where a failed run stopped: the last message is the user's or a tool result.
  retry() {
    const role = this.s.messages.at(-1)?.role;
    if (role !== 'user' && role !== 'tool') throw new Error('Nothing to retry: the last reply finished');
    this.start(null);
  }

  start(text) {
    if (this.running) throw new Error('A run is already in progress');
    if (!readKey()) throw new Error('No DeepSeek API key. Set one in DSHA settings or write it to ~/.config/deepseek/key');
    this.runBase = this.s.messages.length;
    this.running = true; this.abort = new AbortController();
    this.runSeq = this.emit('run_start', { runBase: this.runBase, retry: text == null }).seq;
    // A failed run's error stays on the session (a reopened app still shows it) until the next run.
    delete this.s.meta.error;
    if (text != null) {
      this.s.messages.push({ role: 'user', content: text });
      if (this.s.title === 'New session') { this.s.title = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session'; this.emit('title', { title: this.s.title }); }
      this.emit('user', { text });
    }
    this.save();
    this.loop().catch(e => {
      if (this.abort?.signal.aborted) return;
      const err = { message: String(e?.message || e), kind: e?.kind || 'bad', at: Date.now() };
      this.s.meta.error = err; this.endReason = 'error';
      this.emit('error', err);
    }).finally(() => {
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
    return [{ role: 'system', content: systemPrompt(this.s, this.mcp?.prompt()) }, ...this.s.messages];
  }

  async loop() {
    const s = this.s, ds = this.client(), signal = this.abort.signal, builtin = schemas();
    const max = this.config().maxSteps;
    for (let step = 0; step < max; step++) {
      if (signal.aborted) return;
      // MCP tools are re-listed each step: a call can enable more of them.
      const tools = this.mcp ? [...builtin, ...await this.mcp.schemas(new Set(Object.keys(TOOLS)))] : builtin;
      if (s.usage.lastPrompt > COMPACT_AT) await this.compact(ds, signal);
      this.emit('step_start', { step });
      let r0 = 0, rMs = 0, f0 = 0;
      const thought = () => { f0 ||= Date.now(); if (r0 && !rMs) rMs = Date.now() - r0; };
      const r = await this.call(signal, () => f0 > 0, () => ds.stream(
        { model: s.model, messages: this.apiMessages(), tools, effort: s.effort, thinking: s.thinking !== false },
        { reasoning: d => { r0 ||= Date.now(); f0 ||= r0; this.emit('reasoning', { d }); }, text: d => { thought(); this.emit('text', { d }); }, toolDelta: thought },
        signal));
      if (!r) return;
      const { message, usage, finish } = r;
      const genMs = f0 ? Date.now() - f0 : 0;
      thought();
      if (!message.reasoning_content) delete message.reasoning_content;
      s.messages.push(message);
      if (rMs) s.meta['think' + (s.messages.length - 1)] = rMs;
      this.account(usage, genMs);
      this.save();
      if (finish === 'length' && !message.tool_calls) { this.emit('notice', { text: 'Reply hit the output token limit.' }); }
      if (!message.tool_calls?.length) return;
      // Subagents in one reply run side by side; other tools keep their order. Results go back in call order.
      const calls = message.tool_calls, out = [];
      const one = async (c, i) => { out[i] = signal.aborted ? 'Cancelled: the user stopped the run.' : await this.runTool(c, signal); };
      const subs = Promise.all(calls.map((c, i) => c.function.name === 'agent' ? one(c, i) : null));
      for (const [i, c] of calls.entries()) if (c.function.name !== 'agent') await one(c, i);
      await subs;
      for (const [i, c] of calls.entries()) s.messages.push({ role: 'tool', tool_call_id: c.id, content: out[i] });
      this.save();
    }
    this.endReason = 'max_steps';
    this.emit('notice', { text: `Stopped after ${max} steps. Send a message to continue.` });
  }

  // One model call, retried while nothing has streamed yet (a reply cut off halfway has already been shown,
  // so that failure goes to the user). Resolves to null when the user stops the run.
  async call(signal, started, fn) {
    for (let attempt = 0; ; attempt++) {
      try { const r = await fn(); noteApi(null); return r; }
      catch (e0) {
        if (signal.aborted) return null;
        const e = asApiError(e0);
        noteApi(e);
        if (!e.transient || started() || attempt >= RETRY_WAITS.length) throw e;
        const wait = RETRY_WAITS[attempt];
        this.emit('api_retry', { kind: e.kind, message: e.message, attempt: attempt + 1, of: RETRY_WAITS.length, wait });
        await sleep(wait, signal);
        if (signal.aborted) return null;
      }
    }
  }

  // sub: for a subagent's own calls, { parent: the agent call's id, allow: tool-name filter }. Their event
  // ids are prefixed with the parent's so parallel subagents can't collide, and their meta keeps enough
  // (name, summary, a clipped result) to redraw them under the agent card when the session is reopened.
  async runTool(call, signal, sub = null) {
    const s = this.s, name = call.function.name, id = sub ? `${sub.parent}/${call.id}` : call.id, t0 = Date.now();
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = null; }
    const tool = sub && !sub.allow(name) ? null : TOOLS[name] || this.mcp?.lookup(name);
    const summary = args ? summarize(name, args) : call.function.arguments, parent = sub?.parent;
    this.emit('tool_call', { id, name, args, summary, risk: tool?.risk, mcp: tool?.mcp, parent });
    const finish = (ok, content, extra = {}) => {
      Object.assign(extra, this.subStats.get(id)); this.subStats.delete(id);
      s.meta[id] = { ok, ms: Date.now() - t0, ...extra, ...(sub ? { parent, name, summary: clip(summary, 300), content: clip(content, 2000) } : {}) };
      this.emit('tool_result', { id, ok, content: clip(content, 8000), ms: s.meta[id].ms, ...extra, parent });
      return content;
    };
    if (!tool) return finish(false, sub && TOOLS[name] ? `The ${name} tool is not available to this subagent.` : `Unknown tool: ${name}`);
    if (!args) return finish(false, `Invalid JSON arguments: ${call.function.arguments}`);
    if (!this.allowed(name, tool.risk)) {
      const decision = await new Promise(r => { this.waiting.set(id, r); this.emit('approval', { id, name, summary: summarize(name, args), args, mcp: tool.mcp, parent }); });
      this.waiting.delete(id);
      this.emit('approval_done', { id, decision });
      if (decision === 'always') { if (!s.allow.includes(name)) s.allow.push(name); }
      else if (decision !== 'allow') return finish(false, signal.aborted ? 'Cancelled: the user stopped the run.' : 'The user denied this tool call.', { denied: true });
    }
    try {
      const out = await tool.run(args, { cwd: s.cwd, signal, session: s, onOutput: d => this.emit('tool_output', { id, d }), preview: url => this.emit('preview', { url }), subagent: sub ? null : a => this.subagent(a, id, signal) });
      if (name === 'todo_write') this.emit('todos', { todos: s.todos });
      return finish(true, out);
    } catch (e) {
      return finish(false, `Error: ${e?.message || e}`);
    }
  }

  // A subagent: its own loop over its own messages, sharing this session's permission gate, approvals,
  // usage and event stream. Its final reply is the agent tool's result.
  async subagent(a, parent, signal) {
    const s = this.s, def = resolveAgent(s.cwd, a);
    const model = def.model === 'inherit' ? s.model : def.model, ds = this.client();
    const allow = n => n !== 'agent' && (!def.tools || def.tools.includes(n));
    const builtin = schemas().filter(t => allow(t.function.name));
    const files = contextFiles(s.cwd);
    const messages = [{ role: 'system', content: `${def.prompt}

You are the dsh subagent "${def.name}", started by the main dsh agent for one task, on the user's machine (${os.platform()} ${os.arch()}${process.env.PREFIX ? ', Termux on Android' : ''}).
Working directory: ${s.cwd}
Date: ${new Date().toISOString().slice(0, 10)}
Work on your own: you cannot ask the user or the main agent anything, and the user may deny a tool call; adjust if so. Your final message is returned to the main agent as your whole result.${files ? '\n\nInstructions from the user and the working directory:\n' + files : ''}` }, { role: 'user', content: String(a.prompt || '') }];
    const stats = { agent: def.name, spawned: def.source === 'spawned', model, steps: 0, tools: 0, in: 0, out: 0 };
    this.subStats.set(parent, stats);
    const max = this.config().maxSteps;
    for (let step = 0; step < max; step++) {
      if (signal.aborted) return 'Cancelled: the user stopped the run.';
      const tools = this.mcp && !def.tools ? [...builtin, ...await this.mcp.schemas(new Set(Object.keys(TOOLS)))] : this.mcp ? [...builtin, ...(await this.mcp.schemas(new Set(Object.keys(TOOLS)))).filter(t => allow(t.function.name))] : builtin;
      this.emit('sub_step', { parent, step });
      let f0 = 0;
      const r = await this.call(signal, () => f0 > 0, () => ds.stream({ model, messages, tools, effort: def.effort || s.effort, thinking: s.thinking !== false }, { reasoning: () => { f0 ||= Date.now(); }, text: () => { f0 ||= Date.now(); }, toolDelta: () => { f0 ||= Date.now(); } }, signal));
      if (!r) return 'Cancelled: the user stopped the run.';
      const { message, usage } = r;
      if (!message.reasoning_content) delete message.reasoning_content;
      messages.push(message);
      this.account(usage, f0 ? Date.now() - f0 : 0, { model, sub: true });
      stats.steps++; stats.in += usage.hit + usage.miss; stats.out += usage.out;
      if (!message.tool_calls?.length) return message.content || '(The subagent finished without a reply.)';
      for (const c of message.tool_calls) {
        stats.tools++;
        const content = signal.aborted ? 'Cancelled: the user stopped the run.' : await this.runTool(c, signal, { parent, allow });
        messages.push({ role: 'tool', tool_call_id: c.id, content });
      }
    }
    return `The subagent stopped after ${max} steps without a final report. Its last reply: ${messages.at(-1)?.content || '(none)'}`;
  }

  allowed(name, risk) {
    const m = this.s.mode;
    if (risk === 'read' || m === 'auto' || this.s.allow.includes(name)) return true;
    if (m === 'edits' && risk === 'edit') return true;
    return false;
  }

  // genMs: first streamed token to end of the call, so tok/s is decode speed, not time to first token.
  // sub: a subagent's call, priced at its own model and kept out of the context meter.
  account(u, genMs = 0, { model = this.s.model, sub = false } = {}) {
    const U = this.s.usage, c = cost(model, u);
    U.hit += u.hit; U.miss += u.miss; U.out += u.out; U.reasoning = (U.reasoning || 0) + (u.reasoning || 0);
    U.costPeak = (U.costPeak || 0) + c.peak; U.costOff = (U.costOff || 0) + c.offpeak;
    if (!sub) U.lastPrompt = u.hit + u.miss;
    if (genMs > 0 && u.out > 0) { u.tps = Math.round(u.out / (genMs / 1000)); U.genOut = (U.genOut || 0) + u.out; U.genMs = (U.genMs || 0) + genMs; U.tps = u.tps; }
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
