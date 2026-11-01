// Tools the agent can call. Each has an OpenAI function schema, a risk class
// ('read' runs without asking; 'edit' and 'exec' go through the permission gate)
// and a run(args, ctx) that returns a string for the model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadSkill } from './skills.mjs';
import { listSessions, loadSession } from './store.mjs';

const MAX_OUT = 30000;
const PREFIX = process.env.PREFIX || '/usr';
const RG = [PREFIX + '/bin/rg', '/usr/bin/rg'].find(p => existsSync(p)) || 'rg';

export function clip(s, max = MAX_OUT) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  const head = s.slice(0, max * 0.7), tail = s.slice(-max * 0.25);
  return `${head}\n\n… [${s.length - head.length - tail.length} chars omitted] …\n\n${tail}`;
}

function resolve(ctx, p) {
  if (!p) return ctx.cwd;
  if (p.startsWith('~')) p = path.join(process.env.HOME || '/', p.slice(1));
  return path.resolve(ctx.cwd, p);
}

// Runs a command in its own process group so stop/timeout kills the whole tree.
export function sh(command, { cwd, timeout = 120, signal, onData, shell = process.env.SHELL || PREFIX + '/bin/bash' } = {}) {
  return new Promise(res => {
    let out = '', done = false, killed = '';
    const p = spawn(shell, ['-c', command], { cwd, detached: true, env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = why => { if (done) return; killed = why; try { process.kill(-p.pid, 'SIGTERM'); setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, 1500); } catch {} };
    const t = setTimeout(() => kill(`timed out after ${timeout}s`), timeout * 1000);
    const ab = () => kill('stopped by user');
    signal?.addEventListener('abort', ab, { once: true });
    const take = d => { const s = d.toString(); if (out.length < MAX_OUT * 4) out += s; onData?.(s); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    p.on('error', e => { out += String(e); });
    p.on('close', code => {
      done = true; clearTimeout(t); signal?.removeEventListener('abort', ab);
      res({ code, out, killed });
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
      const text = await fs.readFile(f, 'utf8');
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
      const r = await fetch(a.url, { signal: ctx.signal, redirect: 'follow', headers: { 'user-agent': 'dsh/0.1' } });
      let t = await r.text();
      if (/html/.test(r.headers.get('content-type') || '')) t = htmlText(t);
      return clip(`HTTP ${r.status} ${r.url}\n\n${t}`, 40000);
    },
  },
  todo_write: {
    risk: 'read',
    description: 'Replace the task list shown to the user. Use for multi-step work; keep exactly one item in_progress.',
    parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } } }, required: ['todos'] },
    async run(a, ctx) { ctx.session.todos = a.todos; return 'Todo list updated.'; },
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
  preview: {
    risk: 'read',
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
    case 'todo_write': return `${(a.todos || []).length} items`;
    case 'skill': return a.name;
    case 'session_log': return a.list ? 'recent sessions' : a.id || 'this session';
    default: return JSON.stringify(a).slice(0, 200);
  }
}
