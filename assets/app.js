// DSHA, phone UI for the dsh agent backend.
// Transport: inside the APK every call goes through window.Native (Java does the
// HTTP/SSE). In a plain browser (tests, desktop) it falls back to fetch with the
// URL/token from localStorage.
const $ = s => document.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const I = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'), more: svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>'),
  send: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'), stop: svg('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'), gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  chev: svg('<path d="M9 6l6 6-6 6"/>'), down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'), check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'), copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'), up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  term: svg('<path d="M5 8l4 4-4 4M12 17h7"/>'), file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'), search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'), globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'), retry: svg('<path d="M4 4v6h6"/><path d="M20 12a8 8 0 0 0-14-5.3L4 10"/><path d="M20 20v-6h-6"/><path d="M4 12a8 8 0 0 0 14 5.3l2-3.3"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'), activity: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'), chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'), fold: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  circle: svg('<circle cx="12" cy="12" r="7"/>'), half: svg('<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor"/>'),
  share: svg('<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'), trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'), link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
const MARK = '<svg class="mark" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fff" stroke="none"/><path d="M6.5 13c1.8-3.4 3.7-3.4 5.5 0s3.7 3.4 5.5 0" stroke="#000" stroke-width="2.2"/></svg>';
const TOOL_NAME = { bash: 'Shell', read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', list_dir: 'List folder', grep: 'Search', glob: 'Find files', web_fetch: 'Fetch', todo_write: 'Task list' };
const tname = n => TOOL_NAME[n] || n.replace(/_/g, ' ');
const TODO_ICON = { completed: I.check, in_progress: I.half, pending: I.circle };
const TOOL_ICON = { bash: I.term, read_file: I.file, write_file: I.pen, edit_file: I.pen, list_dir: I.folder, grep: I.search, glob: I.search, web_fetch: I.globe, todo_write: I.list };
const MODES = { ask: ['Ask', 'Asks before shell, edits and web fetches'], edits: ['Edits', 'File edits run freely; shell still asks'], auto: ['Auto', 'Everything runs without asking'] };

/* ---------- transport ---------- */
const N = window.Native;
const pend = new Map(), streams = new Map();
let rid = 0;
window.native = {
  done(id, status, text) { const p = pend.get(id); if (!p) return; pend.delete(id); let j = null; try { j = text ? JSON.parse(text) : {}; } catch { j = { error: text }; } status >= 200 && status < 300 ? p.ok(j) : p.bad(Object.assign(new Error(j?.error || 'HTTP ' + status), { status })); },
  ev(id, list) { streams.get(id)?.on(list); },
  end(id, err) { const s = streams.get(id); streams.delete(id); s?.end(err); },
  paired(ok, err) { pairDone?.(ok, err); },
  shared(t) { sharedText(t); },
  back() { if (document.body.classList.contains('sheet')) { closeSheet(); return true; } if (document.body.classList.contains('drawer')) { drawer(false); return true; } return false; },
  resume() { if (S.cur) resync(); refreshSessions(); },
};
const local = { get: k => { try { return localStorage.getItem('dsha.' + k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem('dsha.' + k, v); } catch {} } };
const settings = () => N ? JSON.parse(N.settings()) : { url: local.get('url') || 'http://127.0.0.1:8787', token: local.get('token'), version: 'web' };
const saveSettings = (url, token) => N ? N.saveSettings(url, token) : (local.set('url', url), local.set('token', token));

function api(method, path, body) {
  if (N) return new Promise((ok, bad) => { const id = 'r' + ++rid; pend.set(id, { ok, bad }); N.request(id, method, path, body ? JSON.stringify(body) : ''); });
  const c = settings();
  return fetch(c.url + path, { method, headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .catch(() => { throw new Error(`Can't reach dsh at ${c.url}`); })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status }); return j; });
}
function stream(path, on, end) {
  const id = 's' + ++rid;
  if (N) { streams.set(id, { on, end }); N.stream(id, path); return () => { streams.delete(id); N.cancel(id); }; }
  const c = settings(), ctrl = new AbortController();
  (async () => {
    const r = await fetch(c.url + path, { headers: { authorization: 'Bearer ' + c.token }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let buf = ''; const dec = new TextDecoder();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true }); const out = []; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, i).split('\n').find(x => x.startsWith('data: ')); buf = buf.slice(i + 2); if (l) out.push(JSON.parse(l.slice(6))); }
      if (out.length) on(out);
    }
  })().then(() => end(null), e => { if (e.name !== 'AbortError') end(String(e.message || e)); });
  return () => ctrl.abort();
}
const haptic = () => N?.haptic();
const visible = () => N ? N.visible() : !document.hidden;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2200); }
function copy(t) { N ? N.copy(t) : navigator.clipboard?.writeText(t); toast('Copied'); haptic(); }

/* ---------- theme: system, dark or light; the native side recolours the system bars ---------- */
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = local.get('theme') || 'system', root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme; else root.dataset.theme = pref;
  const dark = pref === 'dark' || pref === 'system' && darkMq.matches;
  try { N?.theme?.(dark); } catch {}
}
darkMq.addEventListener?.('change', applyTheme);
applyTheme();

/* ---------- markdown ---------- */
const md = window.markdownit({ linkify: true, breaks: false, highlight(code, lang) { try { if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value; } catch {} return ''; } });
function renderMd(el, text) {
  el.innerHTML = DOMPurify.sanitize(md.render(text || ''));
  for (const pre of el.querySelectorAll('pre')) { const lang = (pre.querySelector('code')?.className.match(/language-(\w+)/) || [])[1]; if (lang) pre.dataset.lang = lang; const b = h('button', 'cp', I.copy); b.ariaLabel = 'Copy code'; b.onclick = () => copy(pre.querySelector('code')?.innerText || pre.innerText); pre.append(b); }
  for (const a of el.querySelectorAll('a')) a.target = '_blank';
}

/* ---------- state ---------- */
const S = { cur: null, items: [], seq: 0, running: false, close: null, sessions: [], health: null, cfg: null, retry: 0, todos: [], todosOpen: false };
const log = $('#log'), scroller = $('#scroller');

function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90; }
let stick = true;
scroller.addEventListener('scroll', () => { stick = nearBottom(); $('#jump').hidden = stick; $('#top').classList.toggle('scrolled', scroller.scrollTop > 4); }, { passive: true });
function follow() { if (stick) scroller.scrollTop = scroller.scrollHeight; }
$('#jump').innerHTML = I.down; $('#jump').onclick = () => { stick = true; scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); };

/* ---------- items ---------- */
function add(item) { S.items.push(item); item.el = build(item); log.append(item.el); paint(item); return item; }
function last() { return S.items[S.items.length - 1]; }
function build(it) {
  switch (it.kind) {
    case 'user': { const e = h('div', 'msg user'); e.onclick = () => userMenu(it); return e; }
    case 'text': return h('div', 'md');
    case 'think': { const e = h('div', 'think'), b = h('button', null, I.chev + '<span></span>'); b.onclick = () => { e.classList.toggle('open'); haptic(); }; e.append(b, h('div', 'body')); return e; }
    case 'tool': {
      const e = h('div', 'tool');
      e.innerHTML = `<button class="head"><span class="ti">${TOOL_ICON[it.name] || I.term}</span><span class="tn"></span><span class="ts"></span><span class="st"></span></button><div class="ask"><p></p><div class="cmd"></div><div class="row"><button class="deny">Deny</button><button class="always">Always</button><button class="allow">Allow</button></div></div><div class="out"><pre class="args"></pre><pre class="res"></pre></div>`;
      e.querySelector('.head').onclick = () => { haptic(); if (layout.mode === 'wide') { S.sel = S.sel === it.id ? null : it.id; S.itab = 'activity'; for (const t of S.items) if (t.kind === 'tool') t.el.classList.toggle('sel', t.id === S.sel); ui(); } else e.classList.toggle('open'); };
      for (const d of ['allow', 'always', 'deny']) e.querySelector('.' + d).onclick = () => decide(it, d);
      return e;
    }
    case 'notice': return h('div', 'notice' + (it.err ? ' err' : ''));
    case 'foot': {
      const e = h('div', 'turnfoot');
      const c = h('button', null, I.copy + 'Copy'); c.onclick = () => copy(it.text());
      const s = h('button', null, I.share + 'Share'); s.onclick = () => N ? N.share(it.text()) : copy(it.text());
      e.append(c, s); return e;
    }
  }
}
let mdQueue = new Set(), mdTimer = 0;
function paint(it) {
  const e = it.el; ui(); strip();
  switch (it.kind) {
    case 'user': e.textContent = it.text; e.classList.toggle('pending', !!it.pending); break;
    case 'text':
      if (it.live) { mdQueue.add(it); if (!mdTimer) mdTimer = setTimeout(flushMd, 70); }
      else { renderMd(e, it.text); e.classList.remove('cursor'); }
      break;
    case 'think': {
      const secs = it.ms ? Math.max(1, Math.round(it.ms / 1000)) : 0;
      e.querySelector('span').textContent = it.live ? 'Thinking…' : secs ? `Thought for ${secs}s` : 'Thoughts';
      e.classList.toggle('live', !!it.live);
      e.querySelector('.body').textContent = it.text;
      break;
    }
    case 'tool': {
      e.className = 'tool ' + (it.status || 'run') + (e.classList.contains('open') ? ' open' : '') + (S.sel === it.id ? ' sel' : '');
      e.querySelector('.tn').textContent = tname(it.name);
      e.querySelector('.ts').textContent = it.summary || '';
      e.querySelector('.ts').classList.toggle('plain', it.name === 'todo_write');
      e.querySelector('.st').textContent = statusText(it);
      e.querySelector('.args').textContent = argsText(it);
      e.querySelector('.res').textContent = it.content ?? it.output ?? '';
      e.querySelector('.ask p').textContent = askText(it);
      e.querySelector('.ask .cmd').textContent = it.name === 'bash' ? it.args?.command : it.name === 'edit_file' ? `${it.args?.path}\n− ${it.args?.old_string}\n+ ${it.args?.new_string}` : it.name === 'write_file' ? `${it.args?.path}\n\n${String(it.args?.content || '').slice(0, 1500)}` : it.summary;
      break;
    }
    case 'notice': e.textContent = it.text; break;
  }
}
function flushMd() { mdTimer = 0; for (const it of mdQueue) { renderMd(it.el, it.text); it.el.classList.toggle('cursor', !!it.live); } mdQueue.clear(); follow(); }
const fmtMs = ms => ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms / 60000) + ' min';
const statusText = it => { const st = it.status || 'run', t = it.ms != null ? ' · ' + fmtMs(it.ms) : ''; return { run: 'Running', waiting: 'Needs you', ok: 'Done' + t, fail: 'Failed' + t, denied: 'Denied' }[st]; };
const askText = it => ({ bash: 'Run this command?', write_file: 'Write this file?', edit_file: 'Apply this edit?', web_fetch: 'Fetch this URL?' }[it.name] || `Allow ${it.name}?`);
function argsText(it) {
  const a = it.args || {};
  if (it.name === 'bash') return '$ ' + a.command;
  if (it.name === 'write_file') return `${a.path} (${String(a.content || '').split('\n').length} lines)`;
  if (it.name === 'edit_file') return `${a.path}\n− ${a.old_string}\n+ ${a.new_string}`;
  return JSON.stringify(a, null, 1);
}

function closeLive() {
  for (const it of S.items) if (it.live) { it.live = false; if (it.t0) it.ms = Date.now() - it.t0; paint(it); }
}

function fromMessages(msgs, meta = {}) {
  log.textContent = ''; S.items = [];
  const tools = {}; let turn = 0;
  msgs.forEach((m, i) => {
    if (m.role === 'user') add({ kind: 'user', text: m.content, turn: turn++ });
    else if (m.role === 'assistant') {
      if (m.reasoning_content) add({ kind: 'think', text: m.reasoning_content, ms: meta['think' + i] });
      if (m.content) add({ kind: 'text', text: m.content });
      for (const c of m.tool_calls || []) { let args = {}; try { args = JSON.parse(c.function.arguments); } catch {} tools[c.id] = add({ kind: 'tool', id: c.id, name: c.function.name, args, summary: summarize(c.function.name, args), status: 'fail', content: '(no result: the run was interrupted)' }); }
    } else if (m.role === 'tool' && tools[m.tool_call_id]) {
      const t = tools[m.tool_call_id], mm = meta[m.tool_call_id] || {};
      Object.assign(t, { content: clipText(m.content), status: mm.denied ? 'denied' : mm.ok === false ? 'fail' : 'ok', ms: mm.ms }); paint(t);
    }
  });
  addFoot();
}
function summarize(n, a) { return n === 'bash' ? a.command : a.path || a.pattern || a.url || (n === 'todo_write' ? `${(a.todos || []).length} items` : ''); }
const clipText = (s, n = 8000) => (s = String(s ?? ''), s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s);
function addFoot() {
  const lt = [...S.items].reverse(); const i = lt.findIndex(x => x.kind === 'user'); const turn = i < 0 ? lt : lt.slice(0, i);
  const texts = turn.filter(x => x.kind === 'text').reverse();
  if (!texts.length || last().kind !== 'text') return;
  add({ kind: 'foot', text: () => texts.map(t => t.text).join('\n\n') });
}

function apply(ev) {
  if (ev.seq <= S.seq) return; S.seq = ev.seq;
  const L = last();
  switch (ev.type) {
    case 'run_start': setRunning(true); break;
    case 'step_start': S.gen = { t0: 0, chars: 0 }; break;
    case 'user': {
      const p = S.items.find(x => x.kind === 'user' && x.pending);
      if (p) { p.pending = false; p.text = ev.text; paint(p); } else add({ kind: 'user', text: ev.text, turn: S.items.filter(x => x.kind === 'user').length });
      break;
    }
    case 'reasoning':
      countGen(ev.d);
      if (L?.kind === 'think' && L.live) { L.text += ev.d; paint(L); } else { closeLive(); add({ kind: 'think', text: ev.d, live: true, t0: ev.t || Date.now() }); }
      break;
    case 'text':
      countGen(ev.d);
      if (L?.kind === 'text' && L.live) { L.text += ev.d; paint(L); } else { closeLive(); add({ kind: 'text', text: ev.d, live: true, t0: Date.now() }); }
      break;
    case 'tool_call': closeLive(); add({ kind: 'tool', id: ev.id, name: ev.name, args: ev.args || {}, summary: ev.summary, status: 'run', output: '', t0: Date.now() }); break;
    case 'approval': { const t = tool(ev.id); if (t) { t.status = 'waiting'; paint(t); stick = true; } haptic(); if (!visible()) N?.notify('dsh needs approval', `${ev.name}: ${String(ev.summary).slice(0, 200)}`); break; }
    case 'approval_done': { const t = tool(ev.id); if (t && t.status === 'waiting') { t.status = ev.decision === 'deny' ? 'denied' : 'run'; paint(t); } break; }
    case 'tool_output': { const t = tool(ev.id); if (t) { t.output = clipText((t.output || '') + ev.d, 12000); if (t.el.classList.contains('open')) paint(t); } break; }
    case 'tool_result': { const t = tool(ev.id); if (t) { Object.assign(t, { content: ev.content, status: ev.denied ? 'denied' : ev.ok ? 'ok' : 'fail', ms: ev.ms }); paint(t); } break; }
    case 'usage': if (S.cur) { S.cur.usage = ev.total; meter(); } S.gen = null; break;
    case 'todos': S.todos = ev.todos; todos(); break;
    case 'title': if (S.cur) { S.cur.title = ev.title; header(); } break;
    case 'notice': closeLive(); add({ kind: 'notice', text: ev.text }); break;
    case 'error': closeLive(); add({ kind: 'notice', err: true, text: ev.message }); break;
    case 'session': if (S.cur) { Object.assign(S.cur, ev.patch); header(); meter(); } break;
    case 'compacted': load(S.cur.id); break;
    case 'run_end':
      closeLive(); setRunning(false); addFoot(); refreshSessions();
      if (!visible() && ev.reason !== 'stopped') { const t = [...S.items].reverse().find(x => x.kind === 'text'); N?.notify(S.cur?.title || 'dsh', t ? t.text.slice(0, 300) : 'Finished'); }
      break;
  }
}
// Live speed estimate for the model call in flight (about 4 chars a token); the usage event replaces it with the exact figure.
function countGen(d) { if (S.gen) { S.gen.t0 ||= Date.now(); S.gen.chars += d.length; } }
const tool = id => S.items.find(x => x.kind === 'tool' && x.id === id);

async function decide(it, d) {
  haptic();
  it.status = d === 'deny' ? 'denied' : 'run'; paint(it);
  try { await api('POST', `/api/sessions/${S.cur.id}/approve`, { id: it.id, decision: d }); if (d === 'always') toast(`${tname(it.name)} allowed for this session`); }
  catch (e) { toast(e.message); }
}

/* ---------- sessions ---------- */
async function load(id) {
  S.close?.(); S.close = null;
  const s = await api('GET', '/api/sessions/' + id);
  S.cur = s; S.seq = s.live.fromSeq; S.todos = s.todos || []; S.sel = null;
  local.set('last', id);
  fromMessages(s.messages, s.meta);
  setRunning(s.live.running);
  header(); meter(); todos(); renderSessions(); emptyState();
  stick = true; requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  listen();
}
function listen() {
  const id = S.cur.id;
  S.close = stream(`/api/sessions/${id}/events?after=${S.seq}`, list => {
    if (S.cur?.id !== id) return;
    S.retry = 0; for (const ev of list) apply(ev); follow(); conn(true);
  }, err => {
    if (S.cur?.id !== id) return;
    S.close = null; conn(false);
    const wait = [500, 1000, 2000, 4000, 8000][Math.min(S.retry++, 4)];
    setTimeout(() => { if (S.cur?.id === id && !S.close) resync(); }, wait);
  });
}
async function resync() {
  if (!S.cur) return;
  try {
    const s = await api('GET', '/api/sessions/' + S.cur.id);
    conn(true);
    // Server restarted, we missed a run, or a run ended without its run_end reaching us.
    if (s.live.seq < S.seq || !S.close && s.live.fromSeq > S.seq || S.running && !s.live.running && s.live.seq > S.seq) return load(S.cur.id);
    if (!S.close) listen();
  } catch { conn(false); if (!S.close) setTimeout(resync, 4000); }
}
async function refreshSessions() { try { S.sessions = await api('GET', '/api/sessions'); renderSessions(); conn(true); } catch { conn(false); } }
function renderSessions(box = $('#sessions')) {
  if (box.id === 'sessions' && layout.mode === 'wide' && S.itab === 'sessions') renderSessions($('#ibody'));
  box.textContent = '';
  const day = 864e5, now = Date.now(), groups = [['Today', x => now - x.updated < day], ['This week', x => now - x.updated < 7 * day], ['Earlier', () => true]];
  const used = new Set();
  for (const [name, f] of groups) {
    const list = S.sessions.filter(x => !used.has(x.id) && f(x)); if (!list.length) continue;
    box.append(h('div', 'sgroup', name));
    for (const s of list) {
      used.add(s.id);
      const b = h('button', 'sitem' + (s.id === S.cur?.id ? ' cur' : ''), `<div class="sx"><div class="st1">${esc(s.title)}</div><div class="st2">${esc(short(s.cwd))} · ${s.turns} turn${s.turns === 1 ? '' : 's'}</div></div>${s.running ? '<span class="livedot" aria-label="Running"></span>' : ''}`);
      b.onclick = () => { drawer(false); if (s.id !== S.cur?.id) { S.sel = null; load(s.id).catch(e => toast(e.message)); } };
      box.append(b);
    }
  }
  if (!S.sessions.length) box.append(h('div', 'hint', 'No sessions yet. Start one and it shows up here.'));
}
const home = () => S.health?.home ? S.health.home.replace(/\/\.dsh$/, '') : '/data/data/com.termux/files/home';
const short = p => String(p || '').replace(home(), '~');

function header() {
  const s = S.cur;
  $('#title').textContent = s ? s.title : 'DSHA';
  $('#cwdChip').textContent = s ? short(s.cwd) : S.health ? 'Not in a session' : 'Not connected';
  const m = s?.mode || S.cfg?.mode || 'ask';
  $('#modeChip').className = 'chip ' + m; $('#modeChip').textContent = MODES[m][0];
}
function meter() {
  const s = S.cur; if (!s) { $('#meter').textContent = ''; return; }
  const u = s.usage || {}, ctx = u.lastPrompt || 0;
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const c = u.costPeak || 0;
  $('#meter').innerHTML = `<span><b>${esc(modelName(s.model))}</b> · ${s.thinking === false ? 'no thinking' : esc(s.effort) + ' thinking'}</span><span><b>${k(ctx)}</b> context · ${u.tps ? `<b>${u.tps}</b> tok/s · ` : ''}<i class="mx">${k((u.hit || 0) + (u.miss || 0))} in · ${k(u.out || 0)} out · </i><b>$${c < 0.01 ? c.toFixed(4) : c.toFixed(3)}</b></span>`; ui();
}
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const modelName = m => ({ 'deepseek-flash': 'Flash', 'deepseek-v4-pro': 'V4 Pro' }[m] || String(m).replace('deepseek-', ''));
const taskList = t => t.map(x => `<li class="${x.status}">${TODO_ICON[x.status] || I.circle}<span>${esc(x.content)}</span></li>`).join('');
function todos() {
  ui();
  const box = $('#todos'), t = S.todos || [];
  box.hidden = !t.length || t.every(x => x.status === 'completed') && !S.running;
  if (box.hidden) return;
  const cur = t.find(x => x.status === 'in_progress') || t.find(x => x.status === 'pending') || t[t.length - 1];
  const done = t.filter(x => x.status === 'completed').length;
  box.className = S.todosOpen ? 'open' : '';
  box.innerHTML = `<button>${I.list}<b>${esc(cur.content)}</b><span>${done} of ${t.length}</span></button><ul>${taskList(t)}</ul>`;
  box.firstChild.onclick = () => { S.todosOpen = !S.todosOpen; todos(); };
}
function setRunning(r) {
  S.running = r;
  const b = $('#sendBtn'); b.classList.toggle('stop', r); b.innerHTML = r ? I.stop : I.send; b.ariaLabel = r ? 'Stop' : 'Send';
  syncSend();
  document.body.classList.toggle('running', r);
  todos(); strip();
}
function conn(on) {
  const c = $('#conn'); c.className = 'conn' + (on ? ' on' : '');
  c.innerHTML = `<i></i>${on ? 'dsh ' + esc(S.health?.version || '') + ' · ' + esc(settings().url.replace(/^https?:\/\//, '')) : 'Not connected'}`;
}
function emptyState() {
  const e = $('#empty');
  if (S.items.length) { e.hidden = true; return; }
  e.hidden = false;
  const recent = S.cur ? [] : S.sessions.slice(0, 3);
  e.innerHTML = `<h2>What should dsh do?</h2><div class="where">${S.cur ? 'Working in <code>' + esc(short(S.cur.cwd)) + '</code>' : 'A new session starts in <code>' + esc(short(S.cfg?.cwd)) + '</code>'}</div>
    <div class="group"><h3>Start with</h3><div class="rows" id="starters"></div></div>
    ${recent.length ? '<div class="group"><h3>Pick up where you left off</h3><div class="rows" id="recent"></div></div>' : ''}`;
  for (const t of ['Summarise this project and how to build it', 'What changed in git recently?', 'Find TODOs and rank them by importance', 'Check disk usage and the biggest folders here']) {
    const b = h('button', null, `<span class="rx r1">${esc(t)}</span>${I.arrow}`); b.onclick = () => { input.value = t; send(); }; $('#starters').append(b);
  }
  for (const s of recent) {
    const b = h('button', null, `<span class="rx"><span class="r1" style="display:block">${esc(s.title)}</span><span class="r2" style="display:block">${esc(short(s.cwd))}</span></span><span class="rv">${ago(s.updated)}</span>`);
    b.onclick = () => load(s.id).catch(er => toast(er.message)); $('#recent').append(b);
  }
}
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'Now' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };

/* ---------- run strip: every step of the current run, sized by its time ---------- */
const liveTps = () => { const g = S.gen, dt = g?.t0 ? (Date.now() - g.t0) / 1000 : 0; return dt > 0.5 ? Math.round(g.chars / 4 / dt) : 0; };
let stripQueued = false;
function strip() { if (!stripQueued) { stripQueued = true; requestAnimationFrame(() => { stripQueued = false; drawStrip(); }); } }
function drawStrip() {
  const bar = $('#run'), segs = $('#runSegs');
  const lt = S.items.map(x => x.kind).lastIndexOf('user');
  const steps = (lt < 0 ? [] : S.items.slice(lt + 1)).filter(x => x.kind === 'think' || x.kind === 'tool' || x.kind === 'text');
  bar.classList.toggle('on', !!steps.length && (S.running || !!S.cur));
  if (!steps.length) { segs.textContent = ''; $('#runText').textContent = ''; return; }
  const now = Date.now(), dur = x => x.ms ?? (x.t0 ? now - x.t0 : 1200);
  while (segs.children.length > steps.length) segs.lastChild.remove();
  steps.forEach((x, i) => {
    let b = segs.children[i]; if (!b) { b = h('button'); segs.append(b); }
    const st = x.kind === 'tool' ? x.status || 'run' : x.live ? 'run' : x.kind === 'think' ? 'think' : 'reply';
    b.dataset.s = st; b.style.flex = `${Math.max(400, Math.min(dur(x), 60000))} 1 0`;
    b.ariaLabel = x.kind === 'tool' ? `${tname(x.name)}, ${statusText(x)}` : x.kind === 'think' ? 'Thinking' : 'Reply';
    b.onclick = () => { haptic(); stick = false; x.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (x.kind === 'tool' && layout.mode === 'wide') { S.sel = x.id; S.itab = 'activity'; for (const t of S.items) if (t.kind === 'tool') t.el.classList.toggle('sel', t.id === S.sel); ui(); } };
  });
  const cur = steps[steps.length - 1], w = waitingTool(), tools = steps.filter(x => x.kind === 'tool').length;
  const total = steps.reduce((a, x) => a + (x.ms ?? (x.t0 ? now - x.t0 : 0)), 0);
  $('#runText').innerHTML = w ? `<b>Needs you</b> · ${esc(tname(w.name))}`
    : S.running ? (cur.kind === 'think' && cur.live ? '<b>Thinking</b>' : cur.kind === 'tool' && cur.status === 'run' ? `<b>${esc(tname(cur.name))}</b>` : cur.live ? '<b>Writing</b>' : '<b>Working</b>') + (liveTps() ? ` · ~${liveTps()} tok/s` : total ? ' · ' + fmtMs(Math.round(total / 100) * 100) : '')
    : `${tools} tool call${tools === 1 ? '' : 's'}${total ? ' · ' + fmtMs(Math.round(total / 100) * 100) : ''}`;
}
setInterval(() => { if (S.running) strip(); }, 1000);

/* ---------- composer ---------- */
const input = $('#input');
function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, innerHeight * .34) + 'px'; }
function syncSend() { $('#sendBtn').disabled = !S.running && !input.value.trim(); }
input.addEventListener('input', () => { grow(); syncSend(); slash(); local.set('draft', input.value); });
input.addEventListener('keydown', e => {
  if (!$('#slash').hidden && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); $('#slash .sel')?.click(); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !matchMedia('(pointer:coarse)').matches && !e.shiftKey)) { e.preventDefault(); send(); }
});
$('#sendBtn').onclick = () => S.running ? stop() : send();

const COMMANDS = [
  ['/new', 'New session', () => newSession()], ['/compact', 'Summarise history to free context', () => compact()],
  ['/mode', 'Permission mode', () => modeSheet()], ['/model', 'Model and thinking', () => optionsSheet()],
  ['/cwd', 'Change working directory', () => pickDir(S.cur?.cwd, d => patch({ cwd: d }))], ['/settings', 'Connection, key, defaults', () => settingsSheet()],
];
function slash() {
  const v = input.value, box = $('#slash');
  if (!/^\/\w*$/.test(v)) { box.hidden = true; return; }
  const list = COMMANDS.filter(c => c[0].startsWith(v));
  box.hidden = !list.length; box.textContent = '';
  list.forEach((c, i) => { const b = h('button', i ? '' : 'sel', `<b>${c[0]}</b><span>${c[1]}</span>`); b.onclick = () => { input.value = ''; grow(); box.hidden = true; syncSend(); c[2](); }; box.append(b); });
}

async function send() {
  const text = input.value.trim(); if (!text || S.running) return;
  const cmd = COMMANDS.find(c => c[0] === text); if (cmd) { input.value = ''; grow(); $('#slash').hidden = true; return cmd[2](); }
  haptic();
  try {
    if (!S.cur) { const s = await api('POST', '/api/sessions', {}); await load(s.id); }
    input.value = ''; grow(); local.set('draft', ''); syncSend(); $('#slash').hidden = true;
    add({ kind: 'user', text, pending: true }); emptyState(); stick = true; follow();
    await api('POST', `/api/sessions/${S.cur.id}/messages`, { text });
  } catch (e) {
    const p = S.items.find(x => x.pending); if (p) { p.el.remove(); S.items.splice(S.items.indexOf(p), 1); input.value = text; grow(); syncSend(); }
    toast(e.message); emptyState();
  }
}
async function stop() { haptic(); try { await api('POST', `/api/sessions/${S.cur.id}/stop`); } catch (e) { toast(e.message); } }
async function compact() {
  if (!S.cur) return; if (S.running) return toast('Stop the run first');
  toast('Compacting…');
  try { const r = await api('POST', `/api/sessions/${S.cur.id}/compact`); await load(S.cur.id); toast(r.ok ? 'Compacted' : 'Nothing to compact'); } catch (e) { toast(e.message); }
}
async function patch(p) {
  try { const s = await api('PATCH', '/api/sessions/' + S.cur.id, p); Object.assign(S.cur, { ...s, messages: S.cur.messages }); header(); meter(); emptyState(); } catch (e) { toast(e.message); }
}
function userMenu(it) {
  if (it.pending) return;
  sheet(`<h3>Message</h3><div class="rows"><button data-a="copy">${I.copy}<span>Copy text</span></button><button data-a="edit">${I.pen}<span>Edit and resend from here</span></button></div><p class="hint">Editing drops this message and everything after it.</p>`, {
    copy: () => { closeSheet(); copy(it.text); },
    edit: async () => {
      closeSheet(); if (S.running) return toast('Stop the run first');
      try { const r = await api('POST', `/api/sessions/${S.cur.id}/rewind`, { turn: it.turn }); await load(S.cur.id); input.value = r.text || it.text; grow(); syncSend(); input.focus(); } catch (e) { toast(e.message); }
    },
  });
}
function sharedText(t) {
  input.value = (input.value ? input.value + '\n\n' : '') + t; grow(); syncSend(); input.focus(); toast('Shared text added to the message');
}

/* ---------- drawer & sheets ---------- */
function drawer(on) { document.body.classList.toggle('drawer', on); $('#drawer').ariaHidden = !on; if (on) refreshSessions(); }
document.querySelector('.brand').innerHTML = MARK + '<span>DSHA</span>';
$('#menuBtn').innerHTML = I.menu; $('#menuBtn').onclick = () => { haptic(); drawer(true); };
$('#moreBtn').innerHTML = I.more; $('#moreBtn').onclick = () => { haptic(); optionsSheet(); };
$('#settingsBtn').innerHTML = I.gear; $('#settingsBtn').onclick = () => { drawer(false); settingsSheet(); };
$('#newBtn').innerHTML = I.plus + 'New session'; $('#newBtn').onclick = () => { drawer(false); newSession(); };
$('#scrim').onclick = () => { drawer(false); closeSheet(); };
$('#modeChip').onclick = () => { haptic(); modeSheet(); };
$('#cwdChip').onclick = () => S.cur && pickDir(S.cur.cwd, d => patch({ cwd: d }));

function sheet(html, actions = {}) {
  const b = $('#sheetBody'); b.innerHTML = html; $('#sheet').hidden = false; document.body.classList.add('sheet');
  b.querySelectorAll('[data-a]').forEach(el => el.addEventListener('click', e => { haptic(); actions[el.dataset.a]?.(el, e); }));
  return b;
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet'); }
const seg = (name, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="${name}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

function modeSheet() {
  const cur = S.cur?.mode || S.cfg?.mode;
  sheet(`<h3>Permission mode</h3>${seg('m', Object.entries(MODES).map(([k, v]) => [k, v[0]]), cur)}<p class="hint">${Object.values(MODES).map(v => `<b>${v[0]}</b>: ${v[1]}.`).join('<br>')}</p>${S.cur?.allow?.length ? `<h4>Always allowed here</h4><div class="rows"><button data-a="reset">${I.x}<span>${esc(S.cur.allow.map(tname).join(', '))}</span></button></div><p class="hint">Tap to reset.</p>` : ''}`, {
    m: el => { closeSheet(); if (S.cur) patch({ mode: el.dataset.v }); else api('PUT', '/api/config', { mode: el.dataset.v }).then(c => { S.cfg = c; header(); }); },
    reset: () => { closeSheet(); patch({ allow: [] }); },
  });
}

async function optionsSheet() {
  const s = S.cur; const tgt = s || S.cfg; if (!tgt) return settingsSheet();
  const models = S.models || [{ id: tgt.model }];
  const b = sheet(`<h3>${s ? 'Session' : 'Defaults'}</h3>
    <h4>Model</h4>${seg('model', models.map(m => [m.id, modelName(m.id)]), tgt.model)}
    <h4>Thinking</h4>${seg('effort', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['max', 'Max']], tgt.thinking === false ? 'off' : tgt.effort)}
    <p class="hint">Flash is fast and cheap; Pro is stronger on hard problems. Higher thinking spends more tokens before acting.</p>
    ${s ? `<h4>Session</h4><div class="rows">
      <button data-a="rename">${I.pen}<span>Rename</span></button>
      <button data-a="cwd">${I.folder}<span>${esc(short(s.cwd))}</span></button>
      <button data-a="compact">${I.retry}<span>Compact history</span></button>
      <button data-a="export">${I.share}<span>Share transcript</span></button>
      <button data-a="del" class="danger">${I.trash}<span>Delete session</span></button></div>` : ''}`, {
    model: el => set({ model: el.dataset.v }),
    effort: el => set(el.dataset.v === 'off' ? { thinking: false } : { thinking: true, effort: el.dataset.v }),
    rename: () => { const t = prompt('Session name', s.title); if (t) { closeSheet(); patch({ title: t }); } },
    cwd: () => pickDir(s.cwd, d => patch({ cwd: d })),
    compact: () => { closeSheet(); compact(); },
    export: () => { closeSheet(); const t = transcript(); N ? N.share(t) : copy(t); },
    del: async () => { if (!confirm('Delete this session?')) return; closeSheet(); try { await api('DELETE', '/api/sessions/' + s.id); S.close?.(); S.cur = null; fromMessages([]); header(); meter(); setRunning(false); emptyState(); refreshSessions(); } catch (e) { toast(e.message); } },
  });
  async function set(p) {
    if (s) await patch(p); else { S.cfg = await api('PUT', '/api/config', p); }
    optionsSheet();
  }
}
function transcript() {
  return `# ${S.cur.title}\n\n` + S.items.map(it => it.kind === 'user' ? `**You:** ${it.text}` : it.kind === 'text' ? it.text : it.kind === 'tool' ? `> ${it.name}: \`${String(it.summary).slice(0, 200)}\`` : '').filter(Boolean).join('\n\n');
}

async function newSession() {
  const recents = [...new Set(S.sessions.map(x => x.cwd))].slice(0, 5);
  const start = S.cur?.cwd || S.cfg?.cwd;
  sheet(`<h3>New session</h3><div class="path">${esc(short(start))}</div><div class="rowbtns"><button class="secondary" data-a="pick">${I.folder}Choose folder</button><button class="primary" data-a="go">Start</button></div>${recents.length ? `<h4>Recent folders</h4><div class="rows">${recents.map((r, i) => `<button data-a="r" data-i="${i}">${I.folder}<span>${esc(short(r))}</span></button>`).join('')}</div>` : ''}`, {
    go: () => create(start), r: el => create(recents[+el.dataset.i]), pick: () => pickDir(start, create),
  });
  async function create(cwd) {
    closeSheet();
    try { const s = await api('POST', '/api/sessions', { cwd }); await load(s.id); refreshSessions(); input.focus(); } catch (e) { toast(e.message); }
  }
}

async function pickDir(start, done) {
  let cur = start || home(), hidden = false;
  const go = async p => {
    let r; try { r = await api('GET', `/api/fs?path=${encodeURIComponent(p)}${hidden ? '&hidden=1' : ''}`); } catch (e) { return toast(e.message); }
    cur = r.path;
    sheet(`<h3>Choose folder</h3><div class="path">${esc(short(r.path))}</div><div class="rowbtns"><button class="secondary" data-a="hid">${hidden ? 'Hide' : 'Show'} hidden</button><button class="primary" data-a="use">Use this folder</button></div><h4>Folders</h4><div class="rows">${r.path !== '/' ? `<button data-a="up">${I.up}<span>..</span></button>` : ''}${r.dirs.map((d, i) => `<button data-a="d" data-i="${i}">${I.folder}<span>${esc(d)}</span></button>`).join('') || '<div class="hint" style="padding:14px 16px;margin:0">No subfolders</div>'}</div>`, {
      up: () => go(r.parent), d: el => go(r.path.replace(/\/$/, '') + '/' + r.dirs[+el.dataset.i]),
      hid: () => { hidden = !hidden; go(cur); }, use: () => { closeSheet(); done(cur); },
    });
  };
  go(cur);
}

let pairDone = null;
function pairTermux(cb) {
  if (!N) return cb(null, 'Pairing needs the Android app. Paste the token from `dsh token` instead.');
  pairDone = (ok, err) => { pairDone = null; cb(ok, err); };
  N.pairTermux();
}

async function settingsSheet() {
  const c = settings();
  let bal = '', key = S.health?.hasKey;
  const b = sheet(`<h3>Settings</h3>
    <h4>Backend</h4>
    <button class="primary wide" data-a="pair">${I.link}Pair with dsh in Termux</button>
    <p class="hint">Starts <code>dsh</code> in Termux and fetches its token. First time, Android asks to let DSHA run Termux commands.</p>
    <label class="field"><span>URL</span><input id="fUrl" value="${esc(c.url)}" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Token (<code>dsh token</code>)</span><input id="fTok" type="password" value="${esc(c.token)}" autocapitalize="off" spellcheck="false"></label>
    <button class="secondary wide" data-a="save">Save and reconnect</button>
    <div class="err-text" id="pairErr"></div>
    <h4>Appearance</h4>${seg('theme', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], local.get('theme') || 'system')}
    <h4>DeepSeek API key</h4>
    <div class="kvs"><div class="kv"><span>Status</span><b>${key ? 'Set on backend' : 'Not set'}</b></div><div class="kv"><span>Balance</span><b id="bal">…</b></div></div>
    <label class="field" style="margin-top:14px"><span>Replace key</span><input id="fKey" type="password" placeholder="sk-…" autocapitalize="off" spellcheck="false"></label>
    <button class="secondary wide" data-a="key">Verify and save key</button><p class="hint">Stored only on the backend, in <code>~/.config/deepseek/key</code>.</p>
    <h4>Defaults for new sessions</h4>
    <div class="rows"><button data-a="defs">${I.gear}<span>${esc(S.cfg ? `${modelName(S.cfg.model)} · ${S.cfg.thinking === false ? 'no thinking' : S.cfg.effort + ' thinking'} · ${MODES[S.cfg.mode]?.[0] || S.cfg.mode}` : 'Unknown')}</span></button><button data-a="dcwd">${I.folder}<span>${esc(short(S.cfg?.cwd || ''))}</span></button></div>
    ${N ? `<h4>Notifications</h4><button class="secondary wide" data-a="notif">Allow notifications</button><p class="hint">Get notified when a run finishes or needs approval while DSHA is in the background.</p>` : ''}
    <h4>About</h4><div class="kvs"><div class="kv"><span>DSHA</span><b>${esc(c.version)}</b></div><div class="kv"><span>dsh</span><b>${esc(S.health?.version || 'Not connected')}</b></div></div><div class="rows" style="margin-top:10px"><button data-a="lic">${I.file}<span>Third-party licences</span></button></div>`, {
    theme: el => { local.set('theme', el.dataset.v); applyTheme(); b.querySelectorAll('[data-a=theme]').forEach(x => x.classList.toggle('on', x === el)); },
    pair: el => { el.disabled = true; $('#pairErr').textContent = ''; pairTermux((ok, err) => { el.disabled = false; if (ok) { toast('Paired'); closeSheet(); boot(); } else $('#pairErr').textContent = err; }); },
    save: () => { saveSettings($('#fUrl').value.trim().replace(/\/+$/, ''), $('#fTok').value.trim()); closeSheet(); boot(); },
    key: async el => { const k = $('#fKey').value.trim(); if (!k) return; el.disabled = true; try { await api('PUT', '/api/key', { key: k }); toast('Key saved'); S.health = await api('GET', '/api/health'); settingsSheet(); } catch (e) { toast(e.message); el.disabled = false; } },
    defs: () => { const s = S.cur; S.cur = null; optionsSheet().finally(() => { S.cur = s; }); },
    dcwd: () => pickDir(S.cfg?.cwd, async d => { S.cfg = await api('PUT', '/api/config', { cwd: d }); toast('Default folder set'); }),
    notif: () => N.askNotifications(),
    lic: async () => { const t = await fetch('vendor/LICENSES.txt').then(r => r.text()); sheet(`<h3>Licences</h3><pre style="white-space:pre-wrap;font-size:11px;color:var(--muted)">${esc(t)}</pre>`); },
  });
  try { const r = await api('GET', '/api/balance'); bal = (r.balance_infos || []).map(x => `${x.total_balance} ${x.currency}`).join(', ') || 'Unknown'; } catch (e) { bal = 'Unavailable'; }
  const be = b.querySelector('#bal'); if (be) be.textContent = bal;
}

function onboarding(err) {
  log.textContent = ''; S.items = [];
  const e = $('#empty'); e.hidden = false;
  e.innerHTML = `<div class="onboard">${MARK.replace('class="mark"', 'class="mark big"')}<h2>Connect to dsh</h2><p>DSHA is the interface. The agent, dsh, runs in Termux on this phone, with your files and shell.</p>
  <button class="primary wide" id="obPair">${I.link}Pair with Termux</button>
  <div class="err-text" id="obErr">${esc(err || '')}</div>
  <ol><li>dsh lives in <code>~/dev/dsha/server</code>; the <code>dsh</code> command starts it.</li><li>Pairing runs <code>dsh start</code> in Termux and reads the token. Termux needs <code>allow-external-apps = true</code> in <code>~/.termux/termux.properties</code>.</li><li>Or open settings and paste the URL and the output of <code>dsh token</code>.</li></ol>
  <button class="secondary wide" id="obSet">${I.gear}Settings</button></div>`;
  $('#obPair').onclick = () => { $('#obPair').disabled = true; pairTermux((ok, er) => { $('#obPair').disabled = false; if (ok) boot(); else $('#obErr').textContent = er; }); };
  $('#obSet').onclick = settingsSheet;
  header(); conn(false);
}

async function boot() {
  try {
    S.health = await api('GET', '/api/health');
    S.cfg = await api('GET', '/api/config');
  } catch (e) {
    return onboarding(settings().token ? e.message : '');
  }
  conn(true); header();
  api('GET', '/api/models').then(r => { S.models = r.data; }).catch(() => {});
  await refreshSessions();
  const lastId = local.get('last');
  const pick = S.sessions.find(x => x.id === lastId) || S.sessions[0];
  if (pick && Date.now() - pick.updated < 6 * 3600e3) await load(pick.id).catch(() => { S.cur = null; });
  else { S.cur = null; fromMessages([]); header(); meter(); }
  emptyState();
  if (!S.health.hasKey) { add({ kind: 'notice', err: true, text: 'No DeepSeek API key on the backend yet. Add one in Settings.' }); emptyState(); }
}

/* ---------- foldable layout ---------- */
// Three modes. cover/phone: single column. wide (unfolded, or half-open like a
// book): chat in the pane left of the hinge, inspector on the right. tabletop
// (half-folded with the hinge horizontal, "Flex mode"): chat above the hinge,
// a control deck below it. The hinge comes from the native TYPE_HINGE_ANGLE
// sensor plus the screen centre (window.native.posture), or from the browser's
// Viewport Segments API when the WebView has it.
const layout = { mode: 'phone', angle: -1, cx: null, cy: null };
window.native.posture = (angle, cx, cy) => { Object.assign(layout, { angle, cx, cy }); relayout(); };
function relayout() {
  const w = innerWidth, hgt = innerHeight, root = document.documentElement.style;
  const segs = window.viewport?.segments, q = new URLSearchParams(location.search).get('posture');
  const half = layout.angle > 20 && layout.angle < 160;
  let mode = 'phone', split = null, gap = 0;
  if (segs?.length === 2) {
    const [a, b] = segs;
    if (a.y === b.y) { mode = 'wide'; split = a.width; gap = b.x - a.right; } else { mode = 'tabletop'; split = a.height; gap = b.y - a.bottom; }
  } else if (q === 'tabletop' || half && w > hgt && w >= 560) { mode = 'tabletop'; split = layout.cy; }
  else if (q === 'wide' || w >= 680) { mode = 'wide'; split = layout.cx; }
  if (mode === 'wide') { const x = split > 260 && split < w - 260 ? split : w / 2; root.setProperty('--paneL', x - gap / 2 + 'px'); root.setProperty('--hingeW', gap + 'px'); }
  if (mode === 'tabletop') { const y = split > 160 && split < hgt - 140 ? split : hgt / 2; root.setProperty('--hy', y + 'px'); root.setProperty('--hingeW', gap + 'px'); }
  const changed = mode !== layout.mode;
  layout.mode = mode;
  for (const m of ['wide', 'tabletop']) document.body.classList.toggle(m, mode === m);
  if (changed) { if (mode === 'wide') { drawer(false); for (const t of S.items) t.el?.classList.remove('open'); } if (mode !== 'wide') S.sel = null; for (const t of S.items) if (t.kind === 'tool') paint(t); ui(true); requestAnimationFrame(follow); }
}
addEventListener('resize', relayout);
window.viewport?.addEventListener?.('segmentschange', relayout);

let uiQueued = false;
function ui(now) {
  if (layout.mode === 'phone') return;
  if (now) return renderUI();
  if (!uiQueued) { uiQueued = true; requestAnimationFrame(() => { uiQueued = false; renderUI(); }); }
}
function renderUI() { if (layout.mode === 'wide') inspector(); else if (layout.mode === 'tabletop') deckLive(); }

const waitingTool = () => S.items.find(x => x.kind === 'tool' && x.status === 'waiting');
const focusTool = () => S.items.find(x => x.id === S.sel) || [...S.items].reverse().find(x => x.kind === 'tool');
const liveThink = () => { const l = [...S.items].reverse().find(x => x.kind !== 'notice'); return l?.kind === 'think' && l.live ? l : null; };
const tail = (t, n = 6000) => (t = String(t || ''), t.length > n ? '…' + t.slice(-n) : t);

S.itab = 'activity';
function inspector() {
  const tabs = [['activity', I.activity, 'Activity'], ['tasks', I.list, 'Tasks'], ['stats', I.chart, 'Session'], ['sessions', I.folder, 'Sessions']];
  const nt = (S.todos || []).filter(x => x.status !== 'completed').length;
  const nav = $('#itabs');
  const sig = S.itab + nt + !!waitingTool();
  if (nav.dataset.sig !== sig) {
    nav.dataset.sig = sig;
    nav.innerHTML = tabs.map(([k, ic, l]) => `<button role="tab" data-t="${k}" class="${S.itab === k ? 'on' : ''}">${l}${k === 'tasks' && nt ? `<span class="count">${nt}</span>` : ''}${k === 'activity' && waitingTool() ? '<span class="count need">Needs you</span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { haptic(); S.itab = b.dataset.t; nav.dataset.sig = ''; inspector(); });
  }
  const box = $('#ibody'), keepScroll = box.scrollTop, atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  if (S.itab === 'sessions') { if (box.dataset.tab !== 'sessions') { box.dataset.tab = 'sessions'; renderSessions(box); } return; }
  box.dataset.tab = S.itab;
  if (S.itab === 'activity') {
    const th = liveThink(), t = focusTool(), live = S.running && !S.sel;
    if (!t && !th) { box.innerHTML = `<div class="iempty">Tool calls and their output appear here.<br>Tap a tool card to pin it.</div>`; return; }
    box.innerHTML = `<div class="ihead"><h2>${th ? 'Thinking' : esc(tname(t.name || ''))}</h2>${S.sel ? '<button class="pill" id="follow">Follow live</button>' : live ? '<span class="pill"><span class="livedot"></span>Live</span>' : ''}</div>`
      + (th ? `<div class="panel"><h3>Reasoning</h3><div class="ithink">${esc(tail(th.text, 8000))}</div></div>` : '')
      + (t ? `<div class="panel"><div class="cmdline">${esc(t.name === 'bash' ? '$ ' + t.args?.command : t.summary)}</div><pre class="ipre">${esc(t.content ?? t.output ?? '') || (t.status === 'waiting' ? 'Waiting for your approval…' : 'Running…')}</pre></div>`
        + (t.status === 'waiting' ? `<div class="rowbtns"><button class="secondary" data-d="deny">Deny</button><button class="secondary" data-d="always">Always</button><button class="primary" data-d="allow">Allow</button></div>` : '')
        + `<p class="hint">${esc(statusText(t))}</p>` : '');
    box.querySelector('#follow')?.addEventListener('click', () => { S.sel = null; for (const x of S.items) if (x.kind === 'tool') x.el.classList.remove('sel'); inspector(); });
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => decide(t, b.dataset.d));
    box.scrollTop = live || atEnd ? box.scrollHeight : keepScroll;
    return;
  }
  if (S.itab === 'tasks') {
    const t = S.todos || [], done = t.filter(x => x.status === 'completed').length;
    box.innerHTML = t.length ? `<div class="ihead"><h2>Tasks</h2><span class="pill">${done} of ${t.length} done</span></div><div class="panel"><div class="plan" style="margin-top:0"><i style="width:${100 * done / t.length}%"></i></div><ul class="tasks" style="padding:6px 0 0">${taskList(t)}</ul></div>` : `<div class="iempty">No task list yet.<br>dsh writes one for multi-step work.</div>`;
    return;
  }
  if (S.itab === 'stats') {
    const s = S.cur; if (!s) { box.innerHTML = '<div class="iempty">No session open.</div>'; return; }
    const u = s.usage || {}, inTok = (u.hit || 0) + (u.miss || 0), hitPct = inTok ? Math.round(100 * (u.hit || 0) / inTok) : 0;
    const k = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
    const tools = S.items.filter(x => x.kind === 'tool'), files = new Map();
    for (const t of tools) if (t.args?.path && /file|list_dir/.test(t.name)) files.set(t.args.path, t.name === 'read_file' || t.name === 'list_dir' ? (files.get(t.args.path) || 'read') : t.name === 'write_file' ? 'write' : 'edit');
    const ctx = u.lastPrompt || 0;
    box.innerHTML = `<div class="ihead"><h2>${esc(s.title)}</h2></div>
      <div class="panel"><h3>Context window</h3><div class="kpi" style="padding:0"><b style="margin:0">${k(ctx)}</b></div><div class="plan"><i style="width:${Math.min(100, 100 * ctx / 1048576)}%"></i></div><div class="planends"><span>${k(ctx)} used</span><span>1M</span></div></div>
      <div class="kpis"><div class="kpi"><span>Spent</span><b>$${(u.costPeak || 0).toFixed(4)}</b><small>$${(u.costOff || 0).toFixed(4)} off-peak</small></div>
      <div class="kpi"><span>Cache hits</span><b>${hitPct}%</b><small>${k(u.hit || 0)} of ${k(inTok)} in</small></div>
      <div class="kpi"><span>Tool calls</span><b>${tools.length}</b><small>${tools.filter(t => t.status === 'fail').length} failed · ${tools.filter(t => t.status === 'denied').length} denied</small></div>
      <div class="kpi"><span>Speed</span><b>${u.tps ? u.tps + ' tok/s' : 'None yet'}</b><small>${u.genMs ? `${Math.round(u.genOut / (u.genMs / 1000))} tok/s average · ` : ''}${k(u.out || 0)} out</small></div></div>
      <div class="panel"><h3>Session</h3><div class="kv"><span>Model</span><b>${esc(modelName(s.model))}</b></div><div class="kv"><span>Thinking</span><b>${s.thinking === false ? 'Off' : esc(cap(s.effort))}</b></div><div class="kv"><span>Mode</span><b>${esc(MODES[s.mode]?.[0] || s.mode)}</b></div><div class="kv"><span>Folder</span><b>${esc(short(s.cwd))}</b></div></div>
      ${files.size ? `<div class="panel"><h3>Files touched</h3><ul class="files">${[...files].map(([p, m]) => `<li><span>${esc(p)}</span><em>${m === 'read' ? 'Read' : m === 'write' ? 'Written' : 'Edited'}</em></li>`).join('')}</ul></div>` : ''}`;
  }
}

function deckLive() {
  const box = $('#deckLive'), w = waitingTool(), th = liveThink(), t = [...S.items].reverse().find(x => x.kind === 'tool');
  if (w) {
    const cmd = w.name === 'bash' ? w.args?.command : w.name === 'edit_file' ? `${w.args?.path}\n− ${w.args?.old_string}\n+ ${w.args?.new_string}` : w.summary;
    if (box.dataset.k !== 'ask' + w.id) {
      box.dataset.k = 'ask' + w.id;
      box.innerHTML = `<div class="dl-head"><h3>${esc(askText(w))}</h3><span class="pill">${esc(tname(w.name))}</span></div><div class="dl-ask"><div class="cmd">${esc(cmd)}</div><div class="row"><button class="deny">Deny</button><button class="always">Always</button><button class="allow">Allow</button></div></div>`;
      for (const d of ['allow', 'always', 'deny']) box.querySelector('.' + d).onclick = () => decide(w, d);
    }
    return;
  }
  if (S.running) {
    const what = th ? ['Thinking', th.text] : t && t.status === 'run' ? [tname(t.name), t.output || t.summary || ''] : t ? [tname(t.name) + ' · ' + statusText(t), t.content || ''] : ['Starting', ''];
    if (box.dataset.k !== 'live') { box.dataset.k = 'live'; box.innerHTML = `<div class="dl-head"><span class="livedot"></span><h3></h3><button class="secondary" style="height:36px;padding:0 16px" id="dlStop">Stop</button></div><div class="dl-body"><pre></pre></div>`; box.querySelector('#dlStop').onclick = stop; }
    box.querySelector('h3').textContent = what[0];
    box.querySelector('pre').textContent = tail(what[1], 4000);
    const b = box.querySelector('.dl-body'); b.scrollTop = b.scrollHeight;
    return;
  }
  const idle = 'idle' + (S.cur?.id || '') + (S.cur?.mode || S.cfg?.mode);
  if (box.dataset.k === idle) return;
  box.dataset.k = idle;
  const acts = [['cont', I.retry, 'Continue', 'Ask dsh to keep going'], ['mode', I.fold, 'Permission mode', MODES[S.cur?.mode || S.cfg?.mode || 'ask'][0]], ['compact', I.chart, 'Compact history', 'Free up context'], ['new', I.plus, 'New session', 'Pick a folder']];
  box.innerHTML = `<div class="dl-head"><h3>Quick actions</h3></div><div class="dl-body" style="padding:0"><div class="rows">${acts.map(([k, ic, l, sub]) => `<button data-q="${k}">${ic}<span class="rx"><span class="r1" style="display:block">${l}</span><span class="r2" style="display:block">${esc(sub)}</span></span></button>`).join('')}</div></div>`;
  box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { haptic(); ({ cont: () => { input.value = 'Continue.'; send(); }, mode: modeSheet, compact, new: newSession })[b.dataset.q](); });
}

// Watchdog: while a run looks active, confirm with the server now and then, so a
// lost event can never leave the UI spinning.
setInterval(() => { if (S.running && S.cur && visible()) resync(); }, 10000);

$('#sendBtn').innerHTML = I.send;
input.value = local.get('draft'); grow(); syncSend(); header();
relayout();
boot();
N?.ready();
