// Subagents: named helpers the main agent hands a task to with the `agent` tool. Each runs its own
// loop in a fresh context (its own system prompt, tools and model) and returns one report, the way
// Claude Code's subagents work. Definitions are Markdown files: front matter, then the system prompt.
//
//   ---
//   name: code-reviewer
//   description: Reviews a diff for bugs. Use after a change is made.
//   tools: read_file, grep, glob, bash      (omit for every tool except `agent`)
//   model: flash | pro | inherit            (default inherit: the session's model)
//   effort: low | high | max                (optional)
//   ---
//   You are a careful reviewer...
//
// Sources, first match of a name wins:
//   project  <cwd>/.dsh/agents/<name>.md
//   dsh      ~/.dsh/agents/<name>.md
//   builtin  server/agents/<name>.md          (general-purpose, explore, plan)
//   claude   ~/.claude/agents/<name>.md       (off until the user turns the source on; tool names mapped)
// State lives in config.json as `agents: { off: [ids], claude: bool }`; an id is `<source>:<file name>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, loadConfig, saveConfig } from './store.mjs';
import { parseSkill, isOff, toggleOff } from './skills.mjs';
import { clip } from './tools.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUILTIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');
export const MODELS = { inherit: 'inherit', flash: 'deepseek-flash', pro: 'deepseek-v4-pro', 'deepseek-flash': 'deepseek-flash', 'deepseek-v4-pro': 'deepseek-v4-pro', haiku: 'deepseek-flash', sonnet: 'inherit', opus: 'deepseek-v4-pro' };
const EFFORTS = new Set(['low', 'high', 'max']);
// Claude Code tool names, for definitions copied from ~/.claude/agents.
const CLAUDE_TOOLS = { Read: 'read_file', Write: 'write_file', Edit: 'edit_file', MultiEdit: 'edit_file', Bash: 'bash', Grep: 'grep', Glob: 'glob', LS: 'list_dir', WebFetch: 'web_fetch', TodoWrite: 'todo_write', Skill: 'skill' };
export const READ_ONLY = ['read_file', 'list_dir', 'grep', 'glob', 'web_fetch', 'skill', 'session_log'];

const sources = cwd => [
  ['project', path.join(cwd, '.dsh', 'agents')],
  ['dsh', path.join(HOME, 'agents')],
  ['builtin', BUILTIN],
  ['claude', path.join(process.env.HOME || '', '.claude', 'agents')],
];

function state(cfg = loadConfig()) { const s = cfg.agents || {}; return { off: new Set(s.off || []), claude: !!s.claude }; }

// "a, b", "[a, b]" or a YAML list (joined by the front-matter parser as "- a - b"). Never the agent tool:
// subagents don't start subagents. Only an absent key or "*" means every tool: a key that is present but
// gives no usable name falls back to read-only, never to all tools.
function parseTools(v, source) {
  if (v == null || /^\*$/.test(String(v).trim())) return null;
  const names = String(v).replace(/[[\]'"]/g, ' ').split(/[\s,]+/).filter(x => x && x !== '-');
  const out = [...new Set(names.map(n => source === 'claude' ? CLAUDE_TOOLS[n] || (n.startsWith('mcp__') ? n : null) : n).filter(n => n && n !== 'agent'))];
  return out.length ? out : READ_ONLY;
}

export function parseAgent(text, file, source) {
  const { meta, body } = parseSkill(text);
  const name = String(meta.name || path.basename(file, '.md')).trim().toLowerCase();
  return {
    name, description: meta.description || '', tools: parseTools(meta.tools, source),
    model: MODELS[String(meta.model || 'inherit').trim().toLowerCase()] || 'inherit',
    effort: EFFORTS.has(meta.effort) ? meta.effort : null, prompt: body.trim(),
  };
}

export function listAgents(cwd, cfg) {
  const st = state(cfg), seen = new Set(), out = [];
  for (const [source, dir] of sources(cwd)) {
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort(); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const a = parseAgent(text, file, source), id = `${source}:${n.slice(0, -3)}`;
      const enabled = !isOff(st.off, id, cwd) && (source !== 'claude' || st.claude);
      out.push({ id, ...a, prompt: undefined, source, file, enabled, shadowed: enabled && seen.has(a.name) });
      if (enabled) seen.add(a.name);
    }
  }
  return { agents: out, claude: st.claude };
}

export const activeAgents = cwd => listAgents(cwd).agents.filter(a => a.enabled && !a.shadowed);

// Lines for the main agent's system prompt.
export function agentPrompt(cwd) {
  return activeAgents(cwd).slice(0, 40).map(a => `- ${a.name}: ${clip(a.description.replace(/\s+/g, ' '), 300)}${a.tools ? ` (tools: ${a.tools.join(', ')})` : ''}`).join('\n');
}

// The fallback when the main agent neither names a saved subagent nor designs one.
const GENERIC = `You are a helper agent working on one task the main agent handed you. Work out what the task needs and do it with your tools; read before you change anything, and stay in scope. If something fails, say so plainly. Your final message is the only thing the main agent sees: make it a complete report with file paths, line numbers, commands and outcomes, and anything left open.`;

// What a call to the agent tool runs: a role designed in the call, a saved subagent by name, or the
// generic helper (general-purpose when it is on).
export function resolveAgent(cwd, a = {}) {
  if (a.role && String(a.role).trim()) {
    const name = String(a.name || 'custom').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom';
    const tools = Array.isArray(a.tools) && a.tools.length ? parseTools(a.tools.join(','), 'dsh') : null;
    return { name, description: String(a.description || ''), tools, model: MODELS[a.model] || 'inherit', effort: null, prompt: String(a.role).trim(), source: 'spawned' };
  }
  const active = activeAgents(cwd);
  if (!a.subagent_type) {
    const gp = active.find(x => x.name === 'general-purpose');
    return gp ? load(gp) : { name: 'helper', description: '', tools: null, model: 'inherit', effort: null, prompt: GENERIC, source: 'spawned' };
  }
  const n = String(a.subagent_type).trim().toLowerCase(), x = active.find(y => y.name === n);
  if (!x) throw new Error(`No saved subagent named "${a.subagent_type}". Saved: ${active.map(y => y.name).join(', ') || 'none'}. Or design one with role.`);
  return load(x);
}
const load = a => ({ ...a, ...parseAgent(fs.readFileSync(a.file, 'utf8'), a.file, a.source) });

export function readAgent(cwd, id) {
  const a = listAgents(cwd).agents.find(x => x.id === id);
  if (!a) throw new Error('No such subagent');
  return { ...a, ...parseAgent(fs.readFileSync(a.file, 'utf8'), a.file, a.source), editable: a.source === 'project' || a.source === 'dsh' };
}

// cwd: the project a `project:` id belongs to (without it, the bare id: every project's subagent of that name).
export function setAgent(id, enabled, cwd) {
  const st = state();
  saveConfig({ agents: { off: [...toggleOff(new Set(st.off), id, cwd, enabled)], claude: st.claude } });
}
export function setClaudeAgents(on) { const st = state(); saveConfig({ agents: { off: [...st.off], claude: !!on } }); }

const rootOf = (cwd, scope) => scope === 'project' ? path.join(cwd, '.dsh', 'agents') : path.join(HOME, 'agents');

// Create, or with `id` rewrite, a project or dsh definition. Renaming moves the file.
export function saveAgent(cwd, { id, name, description, tools, model, effort, prompt, scope }) {
  name = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error('Name: lowercase letters, digits and dashes, up to 64');
  const desc = String(description || '').replace(/\s+/g, ' ').trim();
  if (!desc) throw new Error('Add a description: it is how dsh decides when to use the subagent');
  const body = String(prompt || '').trim();
  if (!body) throw new Error('Add a system prompt: what the subagent is and how it works');
  let old = null;
  if (id) {
    old = listAgents(cwd).agents.find(x => x.id === id);
    if (!old) throw new Error('No such subagent');
    if (old.source !== 'project' && old.source !== 'dsh') throw new Error('Only your own subagents can be edited; duplicate this one instead');
    scope = old.source;
  }
  const root = rootOf(cwd, scope === 'project' ? 'project' : 'dsh'), file = path.join(root, name + '.md');
  if (fs.existsSync(file) && (!old || old.file !== file)) throw new Error(`A subagent named ${name} already exists there`);
  const list = Array.isArray(tools) ? [...new Set(tools.map(String).filter(t => /^[\w-]+$/.test(t) && t !== 'agent'))] : null;
  const m = MODELS[model] && MODELS[model] !== 'inherit' ? (MODELS[model] === 'deepseek-flash' ? 'flash' : 'pro') : 'inherit';
  const lines = ['---', `name: ${name}`, `description: ${desc}`];
  if (list?.length) lines.push(`tools: ${list.join(', ')}`);
  lines.push(`model: ${m}`);
  if (EFFORTS.has(effort)) lines.push(`effort: ${effort}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n---\n\n${body}\n`);
  const nid = `${scope === 'project' ? 'project' : 'dsh'}:${name}`;
  if (old && old.file !== file) {
    fs.rmSync(old.file, { force: true });
    // A rename keeps the on/off state with the definition, and leaves nothing behind under the old id.
    const st = state(); if (isOff(st.off, old.id, cwd)) { setAgent(old.id, true, cwd); setAgent(nid, false, cwd); }
  }
  return nid;
}

export function deleteAgent(cwd, id) {
  const a = listAgents(cwd).agents.find(x => x.id === id);
  if (!a) throw new Error('No such subagent');
  if (a.source === 'claude') throw new Error('Claude Code subagents are managed by Claude Code; turn them off here instead');
  if (a.source === 'builtin') throw new Error('Built-in subagents ship with dsh; turn them off instead');
  if (path.dirname(a.file) !== rootOf(cwd, a.source)) throw new Error('Refusing to delete outside the agents folder');
  fs.rmSync(a.file, { force: true });
  // A later subagent made under the same name starts on.
  const st = state(); if (isOff(st.off, id, cwd)) setAgent(id, true, cwd);
}
