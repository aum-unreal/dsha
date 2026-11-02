// Tools the agent can call. Each has an OpenAI function schema, a risk class
// ('read' runs without asking; 'edit' and 'exec' go through the permission gate)
// and a run(args, ctx) that returns a string for the model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { loadSkill } from './skills.mjs';
import { listSessions, loadSession, HOME as DSH_STATE } from './store.mjs';

const MAX_OUT = 30000, HEAD_MAX = MAX_OUT * 2, TAIL_MAX = MAX_OUT;
const PREFIX = process.env.PREFIX || '/usr';
// ripgrep when there is one (Termux, desktops). DSHA Standalone runs in Android's app sandbox,
// which has none: grep and glob then walk the tree in Node (DSH_NO_RG forces that for tests).
// Only absolute PATH entries outside ~ count (a ~/bin/rg is too easy to plant), resolved once at startup.
const HOME_DIR = process.env.HOME || '/';
const RG = process.env.DSH_NO_RG ? null : (() => {
  const dirs = [PREFIX + '/bin', '/usr/bin', '/bin', ...(process.env.PATH || '').split(':').filter(d => path.isAbsolute(d) && !inside(HOME_DIR, d))];
  for (const d of dirs) { try { return realpathSync(d + '/rg'); } catch {} }
  return null;
})();
const SKIP = new Set(['.git', 'node_modules', '.hg', '.svn', '.gradle', 'build', 'dist']);
async function* walk(p, signal) {
  const st = await fs.stat(p).catch(() => null); if (!st) return;
  if (st.isFile()) { yield p; return; }
  for (const e of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) {
    if (signal?.aborted) return;
    const f = path.join(p, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(f, signal); } else if (e.isFile()) yield f;
  }
}
// rg -g semantics: a pattern without a slash matches the file name anywhere, one with a slash the path from the root.
const globHit = (root, f, g) => path.matchesGlob(g.includes('/') ? path.relative(root, f) : path.basename(f), g);
async function nodeGrep(a, ctx) {
  const re = new RegExp(a.pattern, a.ignore_case ? 'i' : ''), root = resolve(ctx, a.path), out = [];
  for await (const f of walk(root, ctx.signal)) {
    if (a.glob && !globHit(root, f, a.glob)) continue;
    const st = await fs.stat(f).catch(() => null); if (!st || st.size > 2e6) continue;
    const buf = await fs.readFile(f).catch(() => null); if (!buf || buf.subarray(0, 8000).includes(0)) continue;
    let n = 0;
    for (const [i, line] of buf.toString('utf8').split('\n').entries()) if (re.test(line)) { out.push(`${f}:${i + 1}:${line.slice(0, 500)}`); if (++n >= 200) break; }
    if (out.length >= 2000) break;
  }
  return out.join('\n');
}
async function nodeGlob(a, ctx) {
  const root = resolve(ctx, a.path), out = [];
  for await (const f of walk(root, ctx.signal)) if (globHit(root, f, a.pattern) && out.push(f) >= 500) break;
  return out.join('\n');
}

const FETCH_TIMEOUT = 60000, FETCH_MAX = 4 * 1024 * 1024;
export function clip(s, max = MAX_OUT) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  const head = s.slice(0, max * 0.7), tail = s.slice(-max * 0.25);
  return `${head}\n\n… [${s.length - head.length - tail.length} chars omitted] …\n\n${tail}`;
}

// True when p is c itself or below it.
function inside(c, p) { const r = path.relative(c, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); }
// realpath of p, or of its nearest existing parent with the rest appended (for files not written yet).
// A dangling symlink is followed to where a write through it would land, not taken as the link's own path.
function real(p) {
  const rest = [];
  for (let hops = 0; ; ) {
    try { return path.join(realpathSync(p), ...rest); } catch {}
    let link = false; try { link = lstatSync(p).isSymbolicLink(); } catch {}
    if (link) { if (++hops > 40) return null; p = path.resolve(path.dirname(p), readlinkSync(p)); continue; }
    const d = path.dirname(p); if (d === p) return path.join(p, ...rest); rest.unshift(path.basename(p)); p = d;
  }
}
// Whether 'edits' mode may run this file write without asking: only inside the session's working
// directory (after symlinks), never in .git (hooks run code), dsh's own state, $PREFIX or ~'s dotfiles
// and dot-folders (shell rc files, ~/.local/bin, ~/.dsh/mcp.json all run code later). Anything else asks.
export function editInCwd(cwd, p) {
  if (!cwd || typeof p !== 'string' || !p) return false;
  const f = real(resolve({ cwd }, p)), root = real(path.resolve(cwd));
  if (!f || !root || !inside(root, f) || f === root) return false;
  if (path.relative(root, f).split(path.sep).includes('.git')) return false;
  // $PREFIX holds the binaries tools run (rg, bash); only its tmp (Termux's $TMPDIR) is a place to work in.
  if (process.env.PREFIX && inside(real(process.env.PREFIX), f) && !inside(real(process.env.PREFIX + '/tmp'), f)) return false;
  for (const h of new Set([HOME_DIR, real(HOME_DIR)])) if (h !== '/' && inside(h, f) && path.relative(h, f).startsWith('.')) return false;
  if (inside(real(DSH_STATE), f)) return false;
  return true;
}

function resolve(ctx, p) {
  if (!p) return ctx.cwd;
  if (p.startsWith('~')) p = path.join(process.env.HOME || '/', p.slice(1));
  return path.resolve(ctx.cwd, p);
}

// Runs a command in its own process group so stop/timeout kills the whole tree.
// $SHELL, else bash, else Android's sh (DSHA Standalone sets SHELL, but nothing should hang on it).
const DEFAULT_SHELL = process.env.SHELL || [PREFIX + '/bin/bash', '/bin/bash', '/system/bin/sh'].find(p => existsSync(p)) || '/bin/sh';
export function sh(command, { cwd, timeout = 120, signal, onData, shell = DEFAULT_SHELL } = {}) {
  return new Promise(res => {
    let out = '', tail = '', total = 0, done = false, killed = '';
    const p = spawn(shell, ['-c', command], { cwd, detached: true, env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = why => { if (done) return; killed = why; try { process.kill(-p.pid, 'SIGTERM'); setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, 1500); } catch {} };
    const t = setTimeout(() => kill(`timed out after ${timeout}s`), timeout * 1000);
    const ab = () => kill('stopped by user');
    signal?.addEventListener('abort', ab, { once: true });
    // The head up to HEAD_MAX, then a rolling tail: a long build's last lines (the error, the summary) survive.
    const take = s => { total += s.length; if (out.length < HEAD_MAX) out += s; else tail = (tail + s).slice(-TAIL_MAX); onData?.(s); };
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); // a character split across chunks stays whole
    p.stdout.on('data', take); p.stderr.on('data', take);
    p.on('error', e => { out += String(e); });
    p.on('close', code => {
      done = true; clearTimeout(t); signal?.removeEventListener('abort', ab);
      const gap = total - out.length - tail.length;
      res({ code, out: gap > 0 ? `${out}\n\n… [${gap} chars omitted] …\n\n${tail}` : out + tail, killed });
    });
  });
}

export const TOOLS = {
  bash: {
    risk: 'exec',
    description: 'Run a shell command (bash) in the session working directory on the host (Termux on Android). Use for git, builds, tests, package managers and anything else the dedicated tools do not cover. Output is truncated to ~30k chars. Do not start long-running servers in the foreground; background them with nohup/setsid and redirect output.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'integer', description: 'seconds, default 120, max 1800' } }, required: ['command'] },
    async run(a, ctx) {
      const r = await sh(a.command, { cwd: ctx.cwd, timeout: Math.min(a.timeout || 120, 1800), signal: ctx.signal, onData: ctx.onOutput });
      return clip(r.out.replace(/\n$/, '') || '(no output)') + `\n[exit ${r.code ?? 'killed'}${r.killed ? ', ' + r.killed : ''}]`;
    },
  },
  read_file: {
    risk: 'read',
    description: 'Read a text file. Returns numbered lines. Use offset/limit (1-based line numbers) for big files.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['path'] },
    async run(a, ctx) {
      const f = resolve(ctx, a.path);
      const st = await fs.stat(f);
      if (st.isDirectory()) return TOOLS.list_dir.run({ path: a.path }, ctx);
      if (st.size > 20 * 1024 * 1024) return `File is ${st.size} bytes; use bash (head/sed) to read part of it.`;
      const text = await fs.readFile(f, 'utf8');
      if (text.includes('\u0000')) return `Binary file (${st.size} bytes).`;
      const lines = text.split('\n'), from = Math.max(1, a.offset || 1), to = Math.min(lines.length, from - 1 + (a.limit || 2000));
      const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}\t${l}`).join('\n');
      return clip(body) + (to < lines.length ? `\n[lines ${from}-${to} of ${lines.length}]` : '');
    },
  },
  write_file: {
    risk: 'edit',
    description: 'Create or overwrite a file with the given content. Creates parent directories.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async run(a, ctx) {
      const f = resolve(ctx, a.path);
      await fs.mkdir(path.dirname(f), { recursive: true });
      const existed = existsSync(f);
      await fs.writeFile(f, a.content);
      return `${existed ? 'Overwrote' : 'Created'} ${f} (${a.content.split('\n').length} lines)`;
    },
  },
  edit_file: {
    risk: 'edit',
    description: 'Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true. Read the file first.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] },
    async run(a, ctx) {
      const f = resolve(ctx, a.path);
      const buf = await fs.readFile(f), text = buf.toString('utf8');
      // Writing back text decoded with U+FFFD would destroy every byte that isn't UTF-8, not just the edited ones.
      if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error(`${f} is not valid UTF-8 text; edit it with bash (sed, iconv) instead`);
      const n = a.old_string ? text.split(a.old_string).length - 1 : 0;
      if (!n) throw new Error('old_string not found in ' + f);
      if (n > 1 && !a.replace_all) throw new Error(`old_string occurs ${n} times; add context or set replace_all`);
      const out = a.replace_all ? text.split(a.old_string).join(a.new_string) : text.replace(a.old_string, () => a.new_string);
      await fs.writeFile(f, out);
      return `Edited ${f} (${a.replace_all ? n : 1} replacement${n > 1 && a.replace_all ? 's' : ''})`;
    },
  },
  list_dir: {
    risk: 'read',
    description: 'List a directory (dirs end with /).',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async run(a, ctx) {
      const d = resolve(ctx, a.path);
      const ents = await fs.readdir(d, { withFileTypes: true });
      ents.sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name));
      return clip(`${d}\n` + ents.map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)');
    },
  },
  grep: {
    risk: 'read',
    description: 'Search file contents with ripgrep (regex). Respects .gitignore.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string', description: 'e.g. *.js' }, ignore_case: { type: 'boolean' } }, required: ['pattern'] },
    async run(a, ctx) {
      if (!RG) return clip(await nodeGrep(a, ctx) || 'No matches.');
      const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const cmd = `${RG} -n --no-heading --color never -m 200 ${a.ignore_case ? '-i ' : ''}${a.glob ? '-g ' + q(a.glob) + ' ' : ''}-e ${q(a.pattern)} ${q(resolve(ctx, a.path))}`;
      const r = await sh(cmd, { cwd: ctx.cwd, timeout: 60, signal: ctx.signal });
      return clip(r.out || 'No matches.');
    },
  },
  glob: {
    risk: 'read',
    description: 'Find files by glob pattern (e.g. **/*.kt) under a path. Respects .gitignore.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
    async run(a, ctx) {
      if (!RG) return clip(await nodeGlob(a, ctx) || 'No files.');
      const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const r = await sh(`${RG} --files -g ${q(a.pattern)} ${q(resolve(ctx, a.path))} | head -500`, { cwd: ctx.cwd, timeout: 60, signal: ctx.signal });
      return clip(r.out || 'No files.');
    },
  },
  web_fetch: {
    risk: 'exec',
    description: 'Fetch a URL over HTTP(S) and return its text (HTML is reduced to readable text).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run(a, ctx) {
      const signal = AbortSignal.any([ctx.signal || new AbortController().signal, AbortSignal.timeout(FETCH_TIMEOUT)]);
      const r = await fetch(a.url, { signal, redirect: 'follow', headers: { 'user-agent': 'dsh/0.1' } });
      // Read at most FETCH_MAX bytes; an endless or huge body is cut there instead of filling memory.
      const parts = []; let size = 0, cut = false;
      for await (const c of r.body || []) { parts.push(c); size += c.length; if (size >= FETCH_MAX) { cut = true; break; } }
      let t = new TextDecoder().decode(Buffer.concat(parts).subarray(0, FETCH_MAX));
      if (cut) { r.body.cancel().catch(() => {}); t += `\n[body cut at ${FETCH_MAX} bytes]`; }
      if (/html/.test(r.headers.get('content-type') || '')) t = htmlText(t);
      return clip(`HTTP ${r.status} ${r.url}\n\n${t}`, 40000);
    },
  },
  todo_write: {
    risk: 'read',
    description: 'Replace the task list shown to the user. Use for multi-step work; keep exactly one item in_progress.',
    parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } } }, required: ['todos'] },
    // A subagent's calls run with ctx.subagent === null (it can't spawn more): its list is its own and must
    // not replace the main session's plan, which the user sees and which is saved.
    async run(a, ctx) {
      if (ctx.subagent === null) { ctx.todos = a.todos; return 'Todo list noted (private to this subagent; the user sees the main plan).'; }
      ctx.session.todos = a.todos; return 'Todo list updated.';
    },
  },
  session_log: {
    risk: 'read',
    description: 'Read past dsh sessions in compact form (user messages, replies, tool calls, failures, denials), for learning from them. list: true lists recent sessions; otherwise reads the session with this id, or the current one.',
    parameters: { type: 'object', properties: { list: { type: 'boolean' }, id: { type: 'string', description: 'Session id from the list; omit for the current session' } } },
    async run(a, ctx) {
      if (a.list) return listSessions().slice(0, 20).map(s => `${s.id} | ${new Date(s.updated).toISOString().slice(0, 16).replace('T', ' ')} | ${s.turns} turns | ${s.cwd} | ${s.title}`).join('\n') || 'No sessions.';
      const s = a.id ? loadSession(String(a.id)) : ctx.session;
      if (!s) throw new Error('No such session');
      return clip(sessionDigest(s), 30000);
    },
  },
  agent: {
    // Its own steps go through the permission gate one by one, so starting it needs no approval.
    risk: 'read',
    description: 'Spawn a subagent: a helper with its own fresh context and tools that does one task and returns one report; the user sees its steps. Use it for broad searches, independent pieces of work, or to keep long output out of this conversation. Several agent calls in one reply run in parallel. Either name a saved subagent (subagent_type, listed under "Subagents" in the system prompt) or design one on the spot by giving `role` (its system prompt: who it is and how it works), plus `tools` and `model` if it needs fewer tools or another model. The subagent sees nothing of this conversation, so the prompt must be a complete brief: the goal, what you already know, where to look, and what to report back.',
    parameters: { type: 'object', properties: {
      description: { type: 'string', description: 'A 3-6 word label shown to the user' },
      prompt: { type: 'string', description: 'The full task brief' },
      subagent_type: { type: 'string', description: 'A saved subagent by name. Omit it when you give a role.' },
      role: { type: 'string', description: 'For a subagent you design now: its system prompt (expertise, method, what its report must contain)' },
      name: { type: 'string', description: 'For a designed subagent: a short lowercase name shown to the user, e.g. "css-auditor"' },
      tools: { type: 'array', items: { type: 'string' }, description: 'For a designed subagent: the tool names it may use; omit for all tools. Read-only work: read_file, list_dir, grep, glob, web_fetch' },
      model: { type: 'string', enum: ['inherit', 'flash', 'pro'], description: 'For a designed subagent: flash is fast and cheap, pro is strongest, inherit uses the session model (default)' },
    }, required: ['description', 'prompt'] },
    async run(a, ctx) {
      if (!ctx.subagent) throw new Error('Subagents cannot start subagents');
      return ctx.subagent(a);
    },
  },
  preview: {
    // Loading a page is a network request to any host (a URL can carry data out), so it asks like web_fetch.
    risk: 'exec',
    description: "Show a web page in the app's preview pane, the browser beside the chat on the unfolded phone: a dev server you started (http://127.0.0.1:<port>) or any http(s) page. Start the server in the background first (nohup ... &) and check it answers. Use after building or changing a page so the user sees it.",
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'http or https URL' } }, required: ['url'] },
    async run(a, ctx) {
      let u; try { u = new URL(String(a.url || '').trim()); } catch { throw new Error('Not a URL: ' + a.url); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages can be previewed');
      ctx.preview?.(u.href);
      return `Opened ${u.href} in the preview pane. On the unfolded screen it shows beside the chat; folded, the user gets a link to it.`;
    },
  },
  skill: {
    risk: 'read',
    description: 'Load a skill: the full instructions for a kind of task, listed under "Skills" in the system prompt. Load the matching skill before starting such a task, then follow it.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill name as listed' } }, required: ['name'] },
    async run(a, ctx) { return loadSkill(ctx.cwd, String(a.name || '')); },
  },
};

export function htmlText(h) {
  return h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr|br|section|article|pre)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

// One line per event of a session, for the model to learn from without the full transcript.
export function sessionDigest(s) {
  const out = [`Session ${s.id}: ${s.title} (${s.cwd})`], meta = s.meta || {};
  for (const m of s.messages) {
    if (m.role === 'user') out.push('USER: ' + clip(String(m.content), 800));
    else if (m.role === 'assistant') {
      if (m.content) out.push('DSH: ' + clip(m.content, 600));
      for (const c of m.tool_calls || []) { let args = {}; try { args = JSON.parse(c.function.arguments); } catch {} out.push(`TOOL ${c.function.name}: ${clip(summarize(c.function.name, args) || '', 300)}`); }
    } else if (m.role === 'tool') {
      const mm = meta[m.tool_call_id] || {};
      if (mm.denied) out.push('  DENIED by the user');
      else if (mm.ok === false) out.push('  FAILED: ' + clip(String(m.content), 400));
    }
  }
  return out.join('\n');
}

export function schemas() {
  return Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: { name, description: t.description, parameters: t.parameters } }));
}

// One-line summary for UI cards and approval prompts.
export function summarize(name, a = {}) {
  switch (name) {
    case 'bash': return a.command;
    case 'read_file': case 'write_file': case 'edit_file': case 'list_dir': return a.path || '.';
    case 'grep': return `${a.pattern}${a.path ? ' in ' + a.path : ''}`;
    case 'glob': return a.pattern;
    case 'web_fetch': case 'preview': return a.url;
    case 'agent': return `${a.role ? a.name || 'custom' : a.subagent_type || 'general-purpose'}: ${a.description || ''}`;
    case 'todo_write': return `${(a.todos || []).length} items`;
    case 'skill': return a.name;
    case 'session_log': return a.list ? 'recent sessions' : a.id || 'this session';
    default: return JSON.stringify(a).slice(0, 200);
  }
}
