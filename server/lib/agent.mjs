// The agent loop. One Runtime per open session: it owns the run (stream →
// tool calls → permission gate → results → repeat) and an event log that
// clients replay by sequence number, so a phone that drops the connection
// (screen off, app killed) can reattach mid-run without losing anything.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeepSeek, cost, isPeak, asApiError } from './deepseek.mjs';
import { TOOLS, schemas, summarize, clip, editInCwd } from './tools.mjs';
import { contextFiles, skillPrompt, memoryPrompt } from './skills.mjs';
import { agentPrompt, resolveAgent } from './agents.mjs';
import { saveSession, loadSession, readKey } from './store.mjs';
import { logUsage } from './usage.mjs';

const runtimes = new Map();
const MAX_EVENTS = +process.env.DSH_MAX_EVENTS || 20000;
const COMPACT_AT = 700_000; // prompt tokens; models have a 1M window
// Live tool output kept per call (events and SSE). The tool's result is clipped separately; past this the
// stream would only grow dsh's memory for a card that shows the last 12k chars anyway.
const LIVE_OUT = +process.env.DSH_LIVE_OUT || 64 * 1024;
// The reply a tool call gets when dsh died (restart, OOM, Android) before the call finished.
export const INTERRUPTED = '(no result: dsh stopped before this finished)';
const CANCELLED = 'Cancelled: the user stopped the run.';
// steerN/thinkN meta is keyed by message index.
const IDX_META = /^(steer|think)(\d+)$/;
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
// A dropped runtime (its session deleted) never writes the file again, however its run winds down.
export const dropRuntime = id => { const r = runtimes.get(id); if (r) { r.dropped = true; r.stop(); } runtimes.delete(id); };
export const activeRuns = () => [...runtimes.values()].filter(r => r.running).map(r => r.s.id);

// What the Android app sandbox offers (checked on a Galaxy Z Fold, Android 15): toybox, no package manager.
const SANDBOX = `The shell is Android's /system/bin/sh with toybox: ls, cat, grep, sed, awk, find, xargs, tar, gzip, diff, curl and the like. There is no git, python, bash or package manager; node (Node ${process.versions.node.split('.')[0]}) is on PATH for scripts and small servers. ~ is this app's private storage (projects in ~/projects); the phone's shared storage is /storage/emulated/0, readable only if the user allowed all-files access in Settings. The user can switch DSHA to Termux for a full Linux environment.`;
export function systemPrompt(s, mcp = '') {
  const files = contextFiles(s.cwd), skills = skillPrompt(s.cwd), memory = memoryPrompt(), agents = agentPrompt(s.cwd);
  const standalone = !!process.env.DSH_STANDALONE;
  return `You are dsh, a coding and operations agent running on the user's own machine (${os.platform()} ${os.arch()}${standalone ? ', inside the DSHA Standalone app on Android, no Termux' : process.env.PREFIX ? ', Termux on Android' : ''}) and talking to them through the DSHA phone app.
Working directory: ${s.cwd}
Date: ${new Date().toISOString().slice(0, 10)}

How to work:
- Use the tools to inspect before you change things. Read a file before editing it; prefer edit_file over rewriting whole files.
- Paths are relative to the working directory unless absolute. ${standalone ? SANDBOX : 'The shell is bash; Termux binaries live in $PREFIX/bin.'}
- Keep the user informed in short prose. Final answers: concise, Markdown, lead with the result. On a phone screen, avoid wide tables.
- For multi-step tasks keep a todo list with todo_write.
- Tool calls may be denied by the user; if so, don't retry the same call — adjust or ask.
- Don't run destructive commands (rm -rf, force-push, wiping data) unless the user clearly asked.
- Report outcomes faithfully: if a command failed, say so.${mcp ? '\n\nExternal tool servers (MCP) connected; their tools sit next to the built-ins and follow the same approval rules:\n' + mcp : ''}\n\nSubagents: spawn helpers with the agent tool for searches across many files, independent parts of a task (several in one reply run in parallel), or work whose output would flood this conversation. Design one for the job by giving it a role (and tools and model when it needs less), or use a saved one. Brief each fully; it sees nothing here. Do simple lookups yourself. To keep a designed subagent for later, save it as ~/.dsh/agents/<name>.md (or .dsh/agents/ in the project): front matter name, description, tools, model (flash, pro or inherit), then its system prompt.${agents ? '\nSaved subagents:\n' + agents : ''}${skills ? '\n\nSkills: load one with the skill tool before a task it covers.\n' + skills : ''}${memory ? '\n\nMemory index (~/.dsh/memory/MEMORY.md; read a memory file when its line is relevant, and keep memory current with the dsh-memory-evolve skill):\n' + memory : ''}${files ? '\n\nInstructions from the user (global DSH.md) and the working directory (DSH.md, AGENTS.md, CLAUDE.md):\n' + files : ''}`;
}

const withReasoning = m => m.role === 'assistant' && m.reasoning_content == null ? { ...m, reasoning_content: '' } : m;
// DeepSeek documents this finish for a reply cut off by server load: not an answer, so the step fails as
// 'busy' (the partial reply is dropped and Retry runs the step again).
const cutShort = () => Object.assign(new Error('DeepSeek cut the reply short: not enough server capacity (insufficient_system_resource).'), { kind: 'busy' });

export class Runtime {
  constructor(s, { config, mcp }) {
    // Older or hand-edited session files may lack fields the loop relies on.
    s.messages ??= []; s.meta ??= {}; s.allow ??= []; s.todos ??= []; s.usage ??= { hit: 0, miss: 0, out: 0, reasoning: 0, cost: 0, lastPrompt: 0 };
    this.s = s; this.config = config; this.mcp = mcp;
    this.events = []; this.seq = 0; this.subs = new Set();
    this.running = false; this.abort = null; this.waiting = new Map(); this.subStats = new Map(); this.runBase = s.messages.length; this.runSeq = 0; this.stepBase = this.runBase; this.stepSeq = 0;
    this.queue = []; // live steering: messages sent during a run, read at the next step boundary
    if (this.repair()) this.save();
  }

  // A session saved between a reply's tool_calls and their results (dsh killed mid-tool) would be
  // refused by the API on the next call. Give each unanswered call a result saying so.
  repair() {
    const s = this.s, m = s.messages; let fixed = 0;
    for (let i = 0; i < m.length; i++) {
      const calls = m[i].role === 'assistant' && m[i].tool_calls; if (!calls?.length) continue;
      let j = i + 1; const have = new Set();
      while (m[j]?.role === 'tool') have.add(m[j++].tool_call_id);
      const miss = calls.filter(c => !have.has(c.id)); if (!miss.length) continue;
      m.splice(j, 0, ...miss.map(c => ({ role: 'tool', tool_call_id: c.id, content: INTERRUPTED })));
      const moved = Object.keys(s.meta).map(k => [k, k.match(IDX_META)]).filter(([, x]) => x && +x[2] >= j);
      const vals = moved.map(([k]) => s.meta[k]); for (const [k] of moved) delete s.meta[k];
      moved.forEach(([, x], n) => { s.meta[x[1] + (+x[2] + miss.length)] = vals[n]; });
      for (const c of miss) s.meta[c.id] = { ok: false, ms: s.meta[c.id]?.ms || 0, interrupted: true };
      fixed += miss.length; i = j + miss.length - 1;
    }
    return fixed;
  }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, t: Date.now(), type, ...data };
    this.events.push(ev);
    // Trim what a reconnecting client rebuilds from the snapshot: finished runs and the live run's finished
    // steps. The step in progress stays whole however long it streams (every token is an event), or an app
    // reopened mid-run would draw a reply's tail with no start. Holding a whole live run instead grows
    // without bound: a run of a thousand steps is hundreds of thousands of events in dsh's memory.
    const over = this.events.length - MAX_EVENTS;
    if (over > 0) {
      const keep = this.running ? Math.max(this.runSeq, this.stepSeq || 0) : Infinity;
      let n = 0; while (n < over && this.events[n].seq < keep) n++;
      if (n) this.events.splice(0, n);
    }
    for (const f of this.subs) f(ev);
    return ev;
  }
  subscribe(f, after = 0) {
    for (const ev of this.events) if (ev.seq > after) f(ev);
    this.subs.add(f); return () => this.subs.delete(f);
  }
  // Mid-run, a snapshot holds the messages before the run and the client replays the run's events.
  // at='step' (the app) holds every finished step instead and replays only the step in progress: a long
  // run is hundreds of thousands of token events, and replaying them all on each reopen is slow.
  // Once a run's start has been trimmed every client gets the step form: nothing else can be replayed.
  snapshot(at) {
    const s = this.s, step = this.running && this.stepSeq > this.runSeq && (at === 'step' || this.events[0]?.seq > this.runSeq);
    const base = !this.running ? s.messages.length : step ? this.stepBase : this.runBase;
    const fromSeq = !this.running ? this.seq : (step ? this.stepSeq : this.runSeq) - 1;
    return { ...s, messages: s.messages.slice(0, base), live: { running: this.running, seq: this.seq, fromSeq, waiting: [...this.waiting.keys()], queue: this.queue.map(q => ({ id: q.id, text: q.text })) } };
  }
  // Never throws: a full or read-only disk must not take the run (or dsh) down. The user hears once per cause.
  save() {
    if (this.dropped) return;
    try { saveSession(this.s); this.saveErr = null; }
    catch (e) { const m = String(e?.message || e); if (m !== this.saveErr) { this.saveErr = m; this.emit('notice', { text: `Couldn't save the session: ${m}` }); } }
  }

  // During a run a message waits in the queue (its id is returned) instead of being refused.
  send(text) { if (this.running) return this.enqueue(text); this.start(text); }
  enqueue(text) {
    const q = { id: 'q' + (++this.qn || (this.qn = 1)) + Date.now().toString(36), text };
    this.queue.push(q); this.emit('queued', q); return q.id;
  }
  unqueue(id) {
    const i = this.queue.findIndex(q => q.id === id); if (i < 0) return false;
    this.queue.splice(i, 1); this.emit('unqueued', { id }); return true;
  }
  // Hand the queue to the model as one user turn: after a step's tool results, or in place of
  // ending the run. A model call already streaming can't take it, so it lands at the boundary.
  drain() {
    if (!this.queue.length) return false;
    const qs = this.queue.splice(0), text = qs.map(q => q.text).join('\n\n');
    this.s.messages.push({ role: 'user', content: text });
    this.s.meta['steer' + (this.s.messages.length - 1)] = true;
    this.emit('steer', { ids: qs.map(q => q.id), text });
    return true;
  }

  // Run again from where a failed run stopped: the last message is the user's or a tool result.
  retry() {
    if (this.running) throw new Error('A run is already in progress');
    if (this.repair()) this.save();
    const role = this.s.messages.at(-1)?.role;
    if (role !== 'user' && role !== 'tool') throw new Error('Nothing to retry: the last reply finished');
    this.start(null);
  }

  start(text) {
    if (this.running) throw new Error('A run is already in progress');
    if (this.compacting) throw new Error('Compacting the conversation: wait for it to finish, or stop it');
    if (!readKey()) throw new Error('No DeepSeek API key. Set one in DSHA settings or write it to ~/.config/deepseek/key');
    this.repair();
    this.runBase = this.stepBase = this.s.messages.length;
    this.running = true; this.abort = new AbortController();
    this.runSeq = this.emit('run_start', { runBase: this.runBase, retry: text == null }).seq;
    try {
      // A failed run's error stays on the session (a reopened app still shows it) until the next run.
      delete this.s.meta.error;
      if (text != null) {
        this.s.messages.push({ role: 'user', content: text });
        if (this.s.title === 'New session') { this.s.title = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session'; this.emit('title', { title: this.s.title }); }
        this.emit('user', { text });
      }
      this.save();
    } catch (e) { this.running = false; this.abort = null; this.emit('run_end', { reason: 'error' }); throw e; }
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
      // Messages still queued: after a stop or failure they go back to the sender's input box;
      // one that slipped in as the run finished starts the next run.
      const left = this.queue.splice(0), next = reason === 'done' && left.length ? left.map(q => q.text).join('\n\n') : null;
      for (const q of left) this.emit('unqueued', { id: q.id, text: q.text, returned: next == null });
      this.save();
      this.emit('run_end', { reason });
      if (next != null) try { this.start(next); } catch (e) { this.emit('notice', { text: `Couldn't send your queued message: ${e.message}` }); }
    }).catch(e => console.error('dsh: run cleanup failed:', e));
  }

  stop() { if (this.abort) this.abort.abort(); this.compacting?.abort(); for (const r of this.waiting.values()) r('deny'); }

  approve(id, decision) {
    const r = this.waiting.get(id); if (!r) return false;
    r(decision); return true;
  }

  client() { return new DeepSeek({ key: readKey(), base: this.config().base }); }

  apiMessages() {
    // Thinking mode with tools wants reasoning_content on every assistant turn; older sessions stored none.
    return [{ role: 'system', content: systemPrompt(this.s, this.mcp?.prompt()) }, ...this.s.messages.map(withReasoning)];
  }

  async loop() {
    const s = this.s, ds = this.client(), signal = this.abort.signal, builtin = schemas();
    // Read every step, so changing the limit in the app reaches a run already in progress. 0 is no limit.
    for (let step = 0; !this.config().maxSteps || step < this.config().maxSteps; step++) {
      if (signal.aborted) return;
      // MCP tools are re-listed each step: a call can enable more of them.
      const tools = this.mcp ? [...builtin, ...await this.mcp.schemas(new Set(Object.keys(TOOLS)))] : builtin;
      if (s.usage.lastPrompt > COMPACT_AT) await this.compact(ds, signal);
      this.stepBase = s.messages.length; this.stepSeq = this.emit('step_start', { step }).seq;
      let r0 = 0, rMs = 0, f0 = 0;
      const thought = () => { f0 ||= Date.now(); if (r0 && !rMs) rMs = Date.now() - r0; };
      // Model and folder are read once per step: a mid-run change applies from the next step, which is
      // also when the system prompt names the new folder, and this call is priced at the model it used.
      const model = s.model, cwd = s.cwd;
      const r = await this.call(signal, () => f0 > 0, () => ds.stream(
        { model, messages: this.apiMessages(), tools, effort: s.effort, thinking: s.thinking !== false },
        { reasoning: d => { r0 ||= Date.now(); f0 ||= r0; this.emit('reasoning', { d }); }, text: d => { thought(); this.emit('text', { d }); }, toolDelta: thought },
        signal));
      if (!r) return;
      const { message, usage, finish } = r;
      const genMs = f0 ? Date.now() - f0 : 0;
      thought();
      if (finish === 'insufficient_system_resource') { this.account(usage, genMs, { model }); throw cutShort(); }
      s.messages.push(message);
      if (rMs) s.meta['think' + (s.messages.length - 1)] = rMs;
      this.account(usage, genMs, { model });
      this.save();
      if (finish === 'length' && !message.tool_calls) { this.emit('notice', { text: 'Reply hit the output token limit.' }); }
      else if (finish && finish !== 'stop' && finish !== 'tool_calls' && finish !== 'length') this.emit('notice', { text: `The reply ended early (${finish}).` });
      if (!message.tool_calls?.length) { if (this.drain()) { this.save(); continue; } return; }
      // Subagents in one reply run side by side; other tools keep their order. Results go back in call order.
      // Every card is announced first, in reply order, so the live view matches the reloaded one.
      const calls = message.tool_calls, out = [], pre = calls.map(c => this.announce(c, null));
      const one = async (c, i) => { out[i] = await this.runTool(c, signal, null, cwd, pre[i]); };
      const subs = Promise.all(calls.map((c, i) => c.function.name === 'agent' ? one(c, i) : null));
      for (const [i, c] of calls.entries()) if (c.function.name !== 'agent') await one(c, i);
      await subs;
      for (const [i, c] of calls.entries()) s.messages.push({ role: 'tool', tool_call_id: c.id, content: out[i] });
      if (!signal.aborted) this.drain();
      this.save();
    }
    this.endReason = 'max_steps';
    this.emit('notice', { text: `Stopped after ${this.config().maxSteps} steps. Send a message to continue.` });
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
  // The tool_call event (the card), sent before the call runs.
  announce(call, sub) {
    const name = call.function.name, id = sub ? `${sub.parent}/${call.id}` : call.id, parent = sub?.parent;
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = null; }
    const tool = sub && !sub.allow(name) ? null : TOOLS[name] || this.mcp?.lookup(name);
    const summary = args ? summarize(name, args) : call.function.arguments;
    this.emit('tool_call', { id, name, args, summary, risk: tool?.risk, mcp: tool?.mcp, parent });
    return { name, id, parent, args, tool, summary };
  }

  // cwd: the folder of the step that issued the call (a subagent's: the folder it started in).
  async runTool(call, signal, sub = null, cwd = sub?.cwd || this.s.cwd, pre = this.announce(call, sub)) {
    const s = this.s, { name, id, parent, args, tool, summary } = pre, t0 = Date.now();
    const finish = (ok, content, extra = {}) => {
      Object.assign(extra, this.subStats.get(id)); this.subStats.delete(id);
      s.meta[id] = { ok, ms: Date.now() - t0, ...extra, ...(sub ? { parent, name, summary: clip(summary, 300), content: clip(content, 2000) } : {}) };
      this.emit('tool_result', { id, ok, content: clip(content, 8000), ms: s.meta[id].ms, ...extra, parent });
      return content;
    };
    if (signal.aborted) return finish(false, CANCELLED);
    if (!tool) return finish(false, sub && TOOLS[name] ? `The ${name} tool is not available to this subagent.` : `Unknown tool: ${name}`);
    if (!args) return finish(false, `Invalid JSON arguments: ${call.function.arguments}`);
    // 'Always allow' is stored under the tool's own identity: an MCP tool under its server, not the exposed name.
    const key = tool.allowKey || name;
    if (!this.allowed(name, tool.risk, args, key, cwd)) {
      const decision = await new Promise(r => { this.waiting.set(id, r); this.emit('approval', { id, name, summary: summarize(name, args), args, mcp: tool.mcp, parent }); });
      this.waiting.delete(id);
      this.emit('approval_done', { id, decision });
      if (decision === 'always') { if (!s.allow.includes(key)) { s.allow.push(key); this.emit('session', { patch: { allow: [...s.allow] } }); } }
      else if (decision !== 'allow') return finish(false, signal.aborted ? CANCELLED : 'The user denied this tool call.', { denied: true });
    }
    let live = 0;
    const onOutput = d => {
      if (live > LIVE_OUT) return;
      live += d.length;
      this.emit('tool_output', { id, d: live > LIVE_OUT ? '\n… (live output stopped here; the result comes when the call ends)\n' : d });
    };
    try {
      const out = await tool.run(args, { cwd, signal, session: s, onOutput, preview: url => this.emit('preview', { url }), subagent: sub ? null : a => this.subagent(a, id, signal, cwd) });
      if (name === 'todo_write' && !sub) this.emit('todos', { todos: s.todos });
      return finish(true, out);
    } catch (e) {
      return finish(false, e?.cancelled ? e.message : `Error: ${e?.message || e}`);
    }
  }

  // A subagent: its own loop over its own messages, sharing this session's permission gate, approvals,
  // usage and event stream. Its final reply is the agent tool's result.
  async subagent(a, parent, signal, cwd = this.s.cwd) {
    const s = this.s, def = resolveAgent(cwd, a);
    const cancelled = () => Object.assign(new Error(CANCELLED), { cancelled: true });
    const model = def.model === 'inherit' ? s.model : def.model, ds = this.client();
    const allow = n => n !== 'agent' && (!def.tools || def.tools.includes(n));
    const builtin = schemas().filter(t => allow(t.function.name));
    const files = contextFiles(cwd);
    const messages = [{ role: 'system', content: `${def.prompt}

You are the dsh subagent "${def.name}", started by the main dsh agent for one task, on the user's machine (${os.platform()} ${os.arch()}${process.env.PREFIX ? ', Termux on Android' : ''}).
Working directory: ${cwd}
Date: ${new Date().toISOString().slice(0, 10)}
Work on your own: you cannot ask the user or the main agent anything, and the user may deny a tool call; adjust if so. Your final message is returned to the main agent as your whole result.${files ? '\n\nInstructions from the user and the working directory:\n' + files : ''}` }, { role: 'user', content: String(a.prompt || '') }];
    const stats = { agent: def.name, spawned: def.source === 'spawned', model, steps: 0, tools: 0, in: 0, out: 0 };
    this.subStats.set(parent, stats);
    let prompt = 0;
    for (let step = 0; !this.config().maxSteps || step < this.config().maxSteps; step++) {
      if (signal.aborted) throw cancelled();
      if (prompt > COMPACT_AT) {
        const summary = await this.digest(ds, signal, messages.slice(1), { model, sub: true });
        if (signal.aborted) throw cancelled();
        if (summary) { messages.splice(1, Infinity, { role: 'user', content: `Your task: ${a.prompt}\n\nYour earlier steps were compacted to this summary. Carry on from it:\n\n${summary}` }); prompt = 0; }
      }
      const tools = this.mcp && !def.tools ? [...builtin, ...await this.mcp.schemas(new Set(Object.keys(TOOLS)))] : this.mcp ? [...builtin, ...(await this.mcp.schemas(new Set(Object.keys(TOOLS)))).filter(t => allow(t.function.name))] : builtin;
      this.emit('sub_step', { parent, step });
      let f0 = 0;
      const r = await this.call(signal, () => f0 > 0, () => ds.stream({ model, messages, tools, effort: def.effort || s.effort, thinking: s.thinking !== false }, { reasoning: () => { f0 ||= Date.now(); }, text: () => { f0 ||= Date.now(); }, toolDelta: () => { f0 ||= Date.now(); } }, signal));
      if (!r) throw cancelled();
      const { message, usage, finish } = r;
      this.account(usage, f0 ? Date.now() - f0 : 0, { model, sub: true });
      if (finish === 'insufficient_system_resource') throw cutShort();
      messages.push(message);
      stats.steps++; stats.in += usage.hit + usage.miss; stats.out += usage.out; if (usage.hit || usage.miss) prompt = usage.hit + usage.miss;
      if (!message.tool_calls?.length) return message.content || '(The subagent finished without a reply.)';
      for (const c of message.tool_calls) {
        stats.tools++;
        const content = await this.runTool(c, signal, { parent, allow, cwd });
        messages.push({ role: 'tool', tool_call_id: c.id, content });
      }
    }
    return `The subagent stopped after ${this.config().maxSteps} steps without a final report. Its last reply: ${messages.findLast(m => m.role === 'assistant' && m.content)?.content || '(none)'}`;
  }

  // 'edits' runs a built-in file write without asking only inside the working directory (editInCwd: not .git,
  // dotfiles, $PREFIX or dsh's state, where a write would run code later); MCP edit tools follow their risk.
  allowed(name, risk, args, key = name, cwd = this.s.cwd) {
    const m = this.s.mode;
    if (risk === 'read' || m === 'auto' || this.s.allow.includes(key)) return true;
    if (m === 'edits' && risk === 'edit') return TOOLS[name] ? editInCwd(cwd, args?.path) : true;
    return false;
  }

  // genMs: first streamed token to end of the call, so tok/s is decode speed, not time to first token.
  // sub: a subagent's call, priced at its own model and kept out of the context meter.
  account(u, genMs = 0, { model = this.s.model, sub = false } = {}) {
    // A stream that ended without a usage chunk tells nothing: don't zero the meter or log a free call.
    if (!(u.hit || u.miss || u.out)) return;
    const U = this.s.usage, c = cost(model, u);
    U.hit += u.hit; U.miss += u.miss; U.out += u.out; U.reasoning = (U.reasoning || 0) + (u.reasoning || 0);
    U.costPeak = (U.costPeak || 0) + c.peak; U.costOff = (U.costOff || 0) + c.offpeak;
    // What the call actually cost, at the rate of the hour it ran in. costPeak/costOff stay as the two bounds.
    const peak = isPeak(), spent = peak ? c.peak : c.offpeak;
    U.cost = (U.cost || 0) + spent;
    logUsage({ t: Date.now(), sid: this.s.id, model, sub: sub || undefined, hit: u.hit || 0, miss: u.miss || 0, out: u.out || 0, reasoning: u.reasoning || 0, cost: spent, off: c.offpeak, peak: peak || undefined });
    if (!sub) U.lastPrompt = u.hit + u.miss;
    if (genMs > 0 && u.out > 0) { u.tps = Math.round(u.out / (genMs / 1000)); U.genOut = (U.genOut || 0) + u.out; U.genMs = (U.genMs || 0) + genMs; U.tps = u.tps; }
    this.emit('usage', { step: u, total: U });
  }

  // Replaces the conversation with a model-written summary. Used automatically
  // near the context limit and on demand from the app.
  // A manual compact (no signal) holds this.compacting: runs can't start under it and stop() cancels it.
  async compact(ds = this.client(), signal) {
    if (!signal) {
      if (this.running || this.compacting) throw new Error(this.running ? 'Stop the run first' : 'Already compacting');
      const c = this.compacting = new AbortController();
      try { return await this.compact(ds, c.signal); } finally { if (this.compacting === c) this.compacting = null; }
    }
    const s = this.s;
    if (s.messages.length < 4) return false;
    this.emit('notice', { text: 'Compacting conversation…' });
    const model = s.model, summary = await this.digest(ds, signal, s.messages, { model });
    if (summary == null || signal.aborted) return false;
    const last = [...s.messages].reverse().find(m => m.role === 'user');
    s.messages = [{ role: 'user', content: `Summary of our conversation so far (earlier turns were compacted):\n\n${summary}` }, { role: 'assistant', content: 'Understood. I have the context from the summary.' }];
    if (this.running && last) s.messages.push({ role: 'user', content: `Continue with my latest request: ${last.content}` });
    for (const k of Object.keys(s.meta)) if (IDX_META.test(k)) delete s.meta[k];
    // Mid-run, the compacted messages are the run's new base and the replay starts after this event, so a
    // client reloading on 'compacted' gets a snapshot that doesn't replay it again.
    this.runBase = s.messages.length; s.usage.lastPrompt = 0; s.compactions = (s.compactions || 0) + 1;
    this.save();
    const ev = this.emit('compacted', { summary });
    if (this.running) this.runSeq = ev.seq + 1;
    this.stepBase = this.runBase; this.stepSeq = 0;
    return true;
  }
  // A model-written summary of messages, or null if the user stopped it. Used by compact() and by subagents.
  async digest(ds, signal, messages, { model, sub = false }) {
    const transcript = messages.map(m => m.role === 'tool' ? `[tool result]\n${clip(m.content, 3000)}` : m.role === 'assistant' ? `[assistant]\n${m.content || ''}${m.tool_calls ? '\n' + m.tool_calls.map(c => `→ ${c.function.name} ${clip(c.function.arguments, 600)}`).join('\n') : ''}` : `[${m.role}]\n${m.content}`).join('\n\n');
    // Retried like a step: one transient 429/5xx shouldn't end the long run that reached this point.
    const r = await this.call(signal, () => false, () => ds.stream({ model, thinking: false, messages: [
      { role: 'system', content: 'You compress agent transcripts. Write a dense handoff summary: the user\'s goals and preferences, decisions made, files touched (paths), commands that matter, current state, and open next steps. Markdown, no preamble.' },
      { role: 'user', content: clip(transcript, 600000) }] }, {}, signal));
    if (!r || signal.aborted) return null;
    this.account(r.usage, 0, { model, sub });
    return r.message.content;
  }
}
