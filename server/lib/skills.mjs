// Skills and instruction files: what dsh is told beyond its built-in prompt.
//
// Skills are folders holding a SKILL.md (front matter with `name` and `description`, then the
// instructions), the same shape Claude Code and other agents use. dsh lists the enabled ones in its
// system prompt and the model loads one with the `skill` tool when a task matches, so only the short
// descriptions cost context. Sources, first match of a name wins:
//   project  <cwd>/.dsh/skills/<name>/SKILL.md
//   dsh      ~/.dsh/skills/<name>/SKILL.md
//   claude   ~/.claude/skills/<name>/SKILL.md   (off until the user turns the source on)
// State lives in config.json as `skills: { off: [ids], claude: bool }`; an id is `<source>:<name>`.
//
// Instruction files: DeepSeek has no standard file of its own, so dsh reads its own DSH.md (global in
// ~/.dsh, and per project) plus the cross-agent AGENTS.md and CLAUDE.md from the working directory.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, loadConfig, saveConfig, writeAtomic } from './store.mjs';
import { clip } from './tools.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROMPT_MAX = 60;

const sources = cwd => [
  ['project', path.join(cwd, '.dsh', 'skills')],
  ['dsh', path.join(HOME, 'skills')],
  ['claude', path.join(process.env.HOME || '', '.claude', 'skills')],
];

export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {}, lines = m ? m[1].split(/\r?\n/) : [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    // YAML block scalars (`>-`, `|`) and plain values continued on indented lines.
    const block = /^[>|][+-]?$/.test(v), more = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
    if (block) v = more.join(v[0] === '|' ? '\n' : ' ');
    else if (more.length) v = [v, ...more].join(' ');
    meta[kv[1]] = v.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

function state(cfg = loadConfig()) { const s = cfg.skills || {}; return { off: new Set(s.off || []), claude: !!s.claude }; }

export function listSkills(cwd, cfg) {
  const st = state(cfg), seen = new Set(), out = [];
  for (const [source, dir] of sources(cwd)) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, e.name, 'SKILL.md');
      let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const { meta } = parseSkill(text), name = (meta.name || e.name).trim(), id = `${source}:${e.name}`;
      const enabled = !st.off.has(id) && (source !== 'claude' || st.claude);
      out.push({ id, name, description: meta.description || '', source, dir: path.join(dir, e.name), file, enabled, shadowed: enabled && seen.has(name) });
      if (enabled) seen.add(name);
    }
  }
  return { skills: out, claude: st.claude };
}

const active = cwd => listSkills(cwd).skills.filter(s => s.enabled && !s.shadowed);

export function skillPrompt(cwd) {
  const list = active(cwd).slice(0, PROMPT_MAX);
  return list.map(s => `- ${s.name}: ${clip(s.description.replace(/\s+/g, ' '), 300)}`).join('\n');
}

export function loadSkill(cwd, name) {
  const s = active(cwd).find(x => x.name === name || x.id.endsWith(':' + name));
  if (!s) throw new Error(`No enabled skill named "${name}". Available: ${active(cwd).map(x => x.name).join(', ') || 'none'}`);
  const { body } = parseSkill(fs.readFileSync(s.file, 'utf8'));
  return `<skill name="${s.name}" dir="${s.dir}">\nPaths in these instructions are relative to ${s.dir}.\n\n${clip(body, 60000)}\n</skill>`;
}

export function readSkill(cwd, id) {
  const s = listSkills(cwd).skills.find(x => x.id === id);
  if (!s) throw new Error('No such skill');
  return { ...s, content: clip(fs.readFileSync(s.file, 'utf8'), 200000) };
}

export function setSkill(id, enabled) {
  const st = state(), off = new Set(st.off);
  enabled ? off.delete(id) : off.add(id);
  saveConfig({ skills: { off: [...off], claude: st.claude } });
}
export function setClaudeSkills(on) { const st = state(); saveConfig({ skills: { off: [...st.off], claude: !!on } }); }

export function createSkill(cwd, { name, description, body, scope }) {
  name = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error('Name: lowercase letters, digits and dashes, up to 64');
  const root = scope === 'project' ? path.join(cwd, '.dsh', 'skills') : path.join(HOME, 'skills'), dir = path.join(root, name);
  if (fs.existsSync(dir)) throw new Error(`A skill named ${name} already exists there`);
  const desc = String(description || '').replace(/\s+/g, ' ').trim();
  if (!desc) throw new Error('Add a description: it is how dsh decides when to use the skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n${String(body || '').trim()}\n`);
  return `${scope === 'project' ? 'project' : 'dsh'}:${name}`;
}

export function deleteSkill(cwd, id) {
  const s = listSkills(cwd).skills.find(x => x.id === id);
  if (!s) throw new Error('No such skill');
  if (s.source === 'claude') throw new Error('Claude Code skills are managed by Claude Code; turn them off here instead');
  const root = s.source === 'project' ? path.join(cwd, '.dsh', 'skills') : path.join(HOME, 'skills');
  if (path.dirname(s.dir) !== root) throw new Error('Refusing to delete outside the skills folder');
  fs.rmSync(s.dir, { recursive: true, force: true });
}

/* ---------- instruction files ---------- */
export const GLOBAL_MD = path.join(HOME, 'DSH.md');
const EDITABLE = new Set(['global', 'DSH.md', 'AGENTS.md']);

export function instructionFiles(cwd) {
  const list = [['global', GLOBAL_MD], ['DSH.md', path.join(cwd, 'DSH.md')], ['AGENTS.md', path.join(cwd, 'AGENTS.md')], ['CLAUDE.md', path.join(cwd, 'CLAUDE.md')]];
  return list.map(([key, file]) => {
    let content = null; try { content = fs.readFileSync(file, 'utf8'); } catch {}
    return { key, name: path.basename(file), scope: key === 'global' ? 'global' : 'project', path: file, exists: content != null, size: content?.length || 0, content: content == null ? '' : clip(content, 100000), editable: EDITABLE.has(key) };
  });
}

export function writeInstructions(cwd, key, content) {
  const f = instructionFiles(cwd).find(x => x.key === key);
  if (!f) throw new Error('Unknown instruction file');
  if (!f.editable) throw new Error(`${f.name} belongs to another agent; edit it there`);
  if (f.scope === 'project' && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Not a directory: ' + cwd);
  writeAtomic(f.path, String(content ?? ''));
}

// The system-prompt block: the global file first, then the project's.
export function contextFiles(cwd) {
  return instructionFiles(cwd).filter(f => f.exists && f.content.trim()).map(f =>
    `<file path="${f.path}"${f.scope === 'global' ? ' scope="every session"' : ''}>\n${clip(f.content, 20000)}\n</file>`).join('\n');
}
