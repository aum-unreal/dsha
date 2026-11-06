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
  expand: svg('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'), shrink: svg('<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>'),
  agents: svg('<circle cx="5" cy="12" r="2"/><path d="M7 12h4c2.6 0 3.4-5.5 8-5.5M11 12c2.6 0 3.4 5.5 8 5.5"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>'), back: svg('<path d="M15 6l-6 6 6 6"/>'),
  share: svg('<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'), trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'), link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
// The mark: dsh's root node, in the one hue, forking into two lines, its subagents. The agents icon,
// the sidebar's tree and the launcher icon are drawn from the same fork.
const MARK = '<svg class="mark" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6.5"/><path d="M6.4 12h4.4c2.7 0 3.6-5.3 7.6-5.3M10.8 12c2.7 0 3.6 5.3 7.6 5.3"/><circle cx="6.2" cy="12" r="2.3"/></svg>';
const TOOL_NAME = { bash: 'Shell', read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', list_dir: 'List folder', grep: 'Search', glob: 'Find files', web_fetch: 'Fetch', todo_write: 'Task list', skill: 'Skill', session_log: 'Session log', preview: 'Preview', agent: 'Agent' };
const tname = n => TOOL_NAME[n] || n.replace(/_/g, ' ');
const TODO_ICON = { completed: I.check, in_progress: I.half, pending: I.circle };
const TOOL_ICON = { bash: I.term, read_file: I.file, write_file: I.pen, edit_file: I.pen, list_dir: I.folder, grep: I.search, glob: I.search, web_fetch: I.globe, todo_write: I.list, skill: I.book, session_log: I.activity, preview: I.globe, agent: I.agents };
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
  back() { if (previewShown() && !overlaysOpen() && previewUrl && window.Native?.previewBack?.()) return true; if (document.body.classList.contains('sheet')) { closeSheet(); return true; } if (document.body.classList.contains('agside')) { if (agView.sel) { agView.sel = null; renderAgents($('#agsideBody'), true); } else agSide(false); return true; } if (document.body.classList.contains('paged')) { closePage(); return true; } if (document.body.classList.contains('drawer')) { drawer(false); return true; } return false; },
  // After time in the background, rebuild the open session from dsh's snapshot instead of patching
  // the stream back together: whatever happened while the phone was locked, the transcript comes back whole.
  resume(away = 0) { if (S.cur) away > 15000 ? load(S.cur.id).catch(() => {}) : resync(); refreshSessions();
    // Back from Android's all-files screen: the open Settings sheet still shows the old access.
    const sh = $('#sheet'); if (!sh.hidden && sh.dataset.k === 'settings' && sh.dataset.af !== String(!!settings().allFiles)) settingsSheet(); },
};
const local = { get: k => { try { return localStorage.getItem('dsha.' + k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem('dsha.' + k, v); } catch {} } };
// In a browser, ?standalone=1 stands in for the Standalone build (tests): the built-in backend, no native side.
const settings = () => N ? JSON.parse(N.settings()) : { url: local.get('url') || 'http://127.0.0.1:8787', token: local.get('token'), version: 'web', ...(/[?&]standalone=1/.test(location.search) ? { standalone: true, backend: 'builtin', allFiles: false } : {}) };
// DSHA Standalone carries dsh inside the app (Backend.java); "builtin" means the UI talks to that one.
const builtin = () => { const c = settings(); return !!c.standalone && c.backend === 'builtin'; };
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
  for (const a of el.querySelectorAll('a')) {
    // A relative link ([README](README.md)) resolves against the app's own origin and would navigate the UI away:
    // keep only links that leave the app (http(s) elsewhere, mail, phone); the rest stay as plain text.
    let u = null; try { u = new URL(a.getAttribute('href') || '', location.href); } catch {}
    if (!u || u.origin === location.origin || !/^(https?|mailto|tel):$/.test(u.protocol)) { a.title = a.getAttribute('href') || ''; a.removeAttribute('href'); a.classList.add('nolink'); continue; }
    a.target = '_blank'; if (isLocalUrl(a.href)) a.onclick = e => { if (layout.mode === 'wide') { e.preventDefault(); haptic(); showPreview(a.href); } };
  }
}

/* ---------- state ---------- */
const S = { cur: null, items: [], seq: 0, loadSeq: 0, running: false, close: null, sessions: [], health: null, cfg: null, retry: 0, todos: [], todosOpen: false, readQ: new Set() };
const log = $('#log'), scroller = $('#scroller');

function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90; }
let stick = true;
scroller.addEventListener('scroll', () => { stick = nearBottom(); $('#jump').hidden = stick; $('#top').classList.toggle('scrolled', scroller.scrollTop > 4); }, { passive: true });
function follow() { if (stick) scroller.scrollTop = scroller.scrollHeight; }
$('#jump').innerHTML = I.down; $('#jump').onclick = () => { stick = true; scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); };

/* ---------- items ---------- */
function add(item, box = log) { S.items.push(item); item.el = build(item); box.append(item.el); paint(item); if (S.items.length === 1) emptyState(); return item; }
function last() { return S.items[S.items.length - 1]; }
function build(it) {
  switch (it.kind) {
    case 'user': { const e = h('div', 'msg user'); e.onclick = () => userMenu(it); return e; }
    case 'text': return h('div', 'md');
    case 'think': { const e = h('div', 'think'), b = h('button', null, I.chev + '<span></span>'); b.onclick = () => { e.classList.toggle('open'); haptic(); }; e.append(b, h('div', 'body')); return e; }
    case 'tool': {
      const e = h('div', 'tool');
      e.innerHTML = `<button class="head"><span class="ti">${TOOL_ICON[it.name] || I.term}</span><span class="tn"></span><span class="ts"></span><span class="st"></span></button><div class="ask"><p></p><div class="cmd"></div><div class="row"><button class="deny">Deny</button><button class="always">Always</button><button class="allow">Allow</button></div></div><div class="out"><pre class="args"></pre><pre class="res"></pre></div>`;
      e.querySelector('.head').onclick = () => { haptic(); if (layout.mode === 'wide') { if (chatFull) setChatFull(false); S.sel = S.sel === it.id ? null : it.id; S.itab = 'activity'; for (const t of S.items) if (t.kind === 'tool') t.el.classList.toggle('sel', t.id === S.sel); ui(); } else e.classList.toggle('open'); };
      for (const d of ['allow', 'always', 'deny']) e.querySelector('.' + d).onclick = () => decide(it, d);
      // A subagent's card holds its own steps, always in view so a long delegation shows its progress.
      if (it.name === 'agent') { e.classList.add('agentcard'); it.subsEl = h('div', 'subs'); e.querySelector('.ask').before(it.subsEl); it.nTools ??= 0; e.querySelector('.head').onclick = () => openAgents(it.id); }
      if (it.parent) e.classList.add('sub');
      return e;
    }
    case 'notice': {
      const e = h('div', 'notice' + (it.err ? ' err' : ''));
      if (it.url) { e.classList.add('pvlink'); e.onclick = () => { haptic(); layout.mode === 'wide' ? showPreview(it.url) : window.Native?.previewExternal ? window.Native.previewExternal(it.url) : window.open(it.url, '_blank', 'noopener'); }; }
      return e;
    }
    case 'apierr': {
      const e = h('div', 'apierr', '<b></b><p></p><div class="row"></div>'), row = e.querySelector('.row');
      if (it.kind2 === 'auth') { const b = h('button', 'primary', 'Open settings'); b.onclick = () => { haptic(); settingsSheet(); }; row.append(b); }
      else {
        if (it.kind2 === 'balance') { const b = h('button', null, 'Check balance'); b.onclick = () => { haptic(); usageSheet(); }; row.append(b); }
        const r = h('button', 'primary', I.retry + 'Retry'); r.onclick = () => retryRun(it); row.append(r);
      }
      return e;
    }
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
    case 'user': e.textContent = it.text; e.classList.toggle('pending', !!it.pending); e.classList.toggle('steer', !!it.steer); break;
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
      e.className = 'tool ' + (it.subsEl ? 'agentcard ' : '') + (it.parent ? 'sub ' : '') + (it.status || 'run') + (e.classList.contains('open') ? ' open' : '') + (S.sel === it.id ? ' sel' : '');
      e.querySelector('.tn').textContent = it.name === 'agent' ? agentLabel(it) : tname(it.name);
      if (it.subsEl) { const m = agMono(it); if (e.dataset.mono !== m) { e.dataset.mono = m; e.querySelector('.ti').innerHTML = m; } }
      e.querySelector('.ts').textContent = it.name === 'agent' ? it.args?.description || '' : it.summary || '';
      e.querySelector('.ts').classList.toggle('plain', it.name === 'todo_write');
      e.querySelector('.st').textContent = statusText(it);
      e.querySelector('.args').textContent = argsText(it);
      e.querySelector('.res').textContent = it.content ?? it.output ?? '';
      e.querySelector('.ask p').textContent = askText(it);
      e.querySelector('.ask .cmd').textContent = it.name === 'bash' ? it.args?.command : it.name === 'edit_file' ? `${it.args?.path}\n− ${it.args?.old_string}\n+ ${it.args?.new_string}` : it.name === 'write_file' ? `${it.args?.path}\n\n${String(it.args?.content || '').slice(0, 1500)}` : it.summary;
      break;
    }
    case 'notice': e.textContent = it.text; if (it.url) e.append(h('code', null, esc(it.url))); break;
    case 'apierr': e.querySelector('b').textContent = API_ERR[it.kind2] || API_ERR.bad; e.querySelector('p').textContent = it.text; break;
  }
}
function flushMd() { mdTimer = 0; for (const it of mdQueue) { renderMd(it.el, it.text); it.el.classList.toggle('cursor', !!it.live); } mdQueue.clear(); follow(); }
const fmtMs = ms => ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms / 60000) + ' min';
// "Explore", or the name the main agent gave a subagent it designed.
const agentLabel = it => cap(it.agent || (it.args?.role ? it.args?.name || 'custom' : it.args?.subagent_type || 'general-purpose'));
const subCount = it => it.nTools ? ` · ${it.nTools} tool${it.nTools === 1 ? '' : 's'}` : '';
const statusText = it => { const st = it.status || 'run', t = it.ms != null ? ' · ' + fmtMs(it.ms) : '';
  if (it.name === 'agent') return { run: (it.nTools ? 'Working' : 'Starting') + subCount(it), waiting: 'Needs you', ok: 'Done' + t + subCount(it), fail: 'Failed' + t, denied: 'Denied' }[st]; return { run: 'Running', waiting: 'Needs you', ok: 'Done' + t, fail: 'Failed' + t, denied: 'Denied' }[st]; };
const askText = it => ({ bash: 'Run this command?', write_file: 'Write this file?', edit_file: 'Apply this edit?', web_fetch: 'Fetch this URL?' }[it.name] || `Allow ${it.name}?`);
function argsText(it) {
  const a = it.args || {};
  if (it.noArgs) return it.summary || '';
  if (it.name === 'agent') return `${a.role ? 'Role: ' + a.role + '\n' + (a.tools ? 'Tools: ' + a.tools.join(', ') + '\n' : '') + (a.model ? 'Model: ' + a.model + '\n' : '') + '\n' : ''}${a.prompt || ''}`;
  if (it.name === 'bash') return '$ ' + a.command;
  if (it.name === 'write_file') return `${a.path} (${String(a.content || '').split('\n').length} lines)`;
  if (it.name === 'edit_file') return `${a.path}\n− ${a.old_string}\n+ ${a.new_string}`;
  return JSON.stringify(a, null, 1);
}

// Durations end at the event that closed them (dsh's clock), not now: a reopened app replays the step
// in progress in one burst, and timing that against now made a 3 s thought read as 15 minutes.
function closeLive() {
  const end = S.evT || Date.now();
  for (const it of S.items) if (it.live) { it.live = false; if (it.t0) it.ms = Math.max(0, end - it.t0); paint(it); }
}

function fromMessages(msgs, meta = {}) {
  log.textContent = ''; S.items = []; for (const q of [...S.queue]) queuedDrop(q); agHue.clear(); agView.sel = null; agView.open.clear();
  const tools = {}; let turn = 0;
  msgs.forEach((m, i) => {
    if (m.role === 'user') add({ kind: 'user', text: m.content, turn: turn++, steer: !!meta['steer' + i] });
    else if (m.role === 'assistant') {
      if (m.reasoning_content) add({ kind: 'think', text: m.reasoning_content, ms: meta['think' + i] });
      if (m.content) add({ kind: 'text', text: m.content });
      for (const c of m.tool_calls || []) {
        let args = {}; try { args = JSON.parse(c.function.arguments); } catch {}
        const t = tools[c.id] = add({ kind: 'tool', id: c.id, name: c.function.name, args, summary: summarize(c.function.name, args), status: 'fail', content: '(no result: the run was interrupted)' });
        // A subagent's own steps live in meta (they never enter the conversation), keyed "<agent call>/<call>".
        if (t.subsEl) for (const [k, v] of Object.entries(meta)) if (v?.parent === c.id) { t.nTools++; add({ kind: 'tool', id: k, parent: c.id, name: v.name, noArgs: true, summary: v.summary, status: v.denied ? 'denied' : v.ok ? 'ok' : 'fail', content: v.content, ms: v.ms }, t.subsEl); }
      }
    } else if (m.role === 'tool' && tools[m.tool_call_id]) {
      const t = tools[m.tool_call_id], mm = meta[m.tool_call_id] || {};
      // No meta for a call skipped by a stop (it never ran): not a success.
      Object.assign(t, { content: clipText(m.content), status: mm.denied ? 'denied' : mm.ok === false || !meta[m.tool_call_id] && /^Cancelled: /.test(m.content) ? 'fail' : 'ok', ms: mm.ms }, mm.agent ? { agent: mm.agent, stats: { model: mm.model, steps: mm.steps, in: mm.in, out: mm.out } } : {}); paint(t);
    }
  });
  addFoot();
}
function summarize(n, a) { return n === 'bash' ? a.command : a.path || a.pattern || a.url || (n === 'todo_write' ? `${(a.todos || []).length} items` : Object.keys(a).length ? JSON.stringify(a).slice(0, 200) : ''); }
const clipText = (s, n = 8000) => (s = String(s ?? ''), s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s);
function addFoot() {
  const lt = [...S.items].reverse(); const i = lt.findIndex(x => x.kind === 'user'); const turn = i < 0 ? lt : lt.slice(0, i);
  const texts = turn.filter(x => x.kind === 'text').reverse();
  if (!texts.length || last().kind !== 'text') return;
  add({ kind: 'foot', text: () => texts.map(t => t.text).join('\n\n') });
}

function apply(ev) {
  if (ev.seq <= S.seq) return; S.seq = ev.seq; S.lastEv = Date.now(); S.evT = ev.t || Date.now();
  const L = last();
  switch (ev.type) {
    case 'run_start': setRunning(true); clearApiErr(); break;
    case 'step_start': S.gen = { t0: 0, chars: 0 }; break;
    case 'user': {
      const p = S.items.find(x => x.kind === 'user' && x.pending);
      if (p) { p.pending = false; p.text = ev.text; p.turn ??= S.items.filter(x => x.kind === 'user').indexOf(p); paint(p); } else add({ kind: 'user', text: ev.text, turn: userTurns() });
      break;
    }
    case 'reasoning':
      countGen(ev.d);
      if (L?.kind === 'think' && L.live) { L.text += ev.d; paint(L); } else { closeLive(); add({ kind: 'think', text: ev.d, live: true, t0: S.evT }); }
      break;
    case 'text':
      countGen(ev.d);
      if (L?.kind === 'text' && L.live) { L.text += ev.d; paint(L); } else { closeLive(); add({ kind: 'text', text: ev.d, live: true, t0: S.evT }); }
      break;
    case 'tool_call': {
      const p = ev.parent && tool(ev.parent);
      if (p) { p.nTools++; paint(p); add({ kind: 'tool', id: ev.id, parent: ev.parent, name: ev.name, args: ev.args || {}, summary: ev.summary, status: 'run', output: '', t0: S.evT }, p.subsEl); break; }
      closeLive(); add({ kind: 'tool', id: ev.id, name: ev.name, args: ev.args || {}, summary: ev.summary, status: 'run', output: '', t0: S.evT }); break;
    }
    case 'sub_step': { const p = tool(ev.parent); if (p) { p.step = ev.step; paint(p); } break; }
    case 'approval': { const t = tool(ev.id); if (t) { t.status = 'waiting'; paint(t); stick = true; } haptic(); if (!visible()) N?.notify('dsh needs approval', `${ev.name}: ${String(ev.summary).slice(0, 200)}`); break; }
    case 'approval_done': { const t = tool(ev.id); if (t && t.status === 'waiting') { t.status = ev.decision === 'deny' ? 'denied' : 'run'; paint(t); } break; }
    case 'tool_output': { const t = tool(ev.id); if (t) { t.output = clipText((t.output || '') + ev.d, 12000); if (t.el.classList.contains('open')) paint(t); } break; }
    case 'tool_result': { const t = tool(ev.id); if (t) { Object.assign(t, { content: ev.content, status: ev.denied ? 'denied' : ev.ok ? 'ok' : 'fail', ms: ev.ms }, ev.agent ? { agent: ev.agent, nTools: ev.tools, stats: { model: ev.model, steps: ev.steps, in: ev.in, out: ev.out } } : {}); paint(t); } break; }
    case 'queued': {
      if (S.queue.some(x => x.qid === ev.id)) break;
      const mine = S.queue.find(x => !x.qid && x.text === ev.text); // our own POST, its reply still in flight
      if (mine) { mine.qid = ev.id; paintQueued(mine); } else queuedAdd({ qid: ev.id, text: ev.text });
      break;
    }
    case 'unqueued': {
      S.readQ.add(ev.id); const q = S.queue.find(x => x.qid === ev.id); if (q) queuedDrop(q);
      // A stop or failure hands unread messages back to the input box.
      if (ev.returned && ev.text) { input.value = ev.text + (input.value ? '\n\n' + input.value : ''); grow(); syncSend(); local.set('draft', input.value); toast('Not sent: the run ended first'); }
      break;
    }
    case 'steer':
      for (const id of ev.ids) S.readQ.add(id);
      for (const q of S.queue.filter(x => ev.ids.includes(x.qid))) queuedDrop(q);
      closeLive(); add({ kind: 'user', text: ev.text, steer: true, turn: userTurns() }); stick = true;
      break;
    case 'usage': if (S.cur) { S.cur.usage = ev.total; meter(); } S.gen = null; break;
    case 'todos': S.todos = ev.todos; todos(); break;
    case 'title': if (S.cur) { S.cur.title = ev.title; header(); } break;
    case 'notice': closeLive(); add({ kind: 'notice', text: ev.text }); break;
    case 'error':
      closeLive(); apiErr(ev); haptic();
      if (!visible()) N?.notify(API_ERR[ev.kind] || API_ERR.bad, String(ev.message).slice(0, 200));
      break;
    case 'preview':
      // dsh opened a page: unfolded, straight into the Preview tab; folded, a line that opens it in the browser.
      closeLive();
      if (layout.mode === 'wide') showPreview(ev.url);
      else add({ kind: 'notice', url: ev.url, text: 'Preview ready. Unfold to see it beside the chat, or tap to open: ' });
      break;
    case 'api_retry': {
      // One line per run, rewritten on each attempt.
      const text = `${API_ERR[ev.kind] || API_ERR.bad}. Trying again in ${Math.round(ev.wait / 1000)} s (${ev.attempt} of ${ev.of}).`;
      const n = S.items.findLast(x => x.kind === 'notice' && x.retry);
      if (n && n === last()) { n.text = text; paint(n); } else { closeLive(); add({ kind: 'notice', retry: true, text }); }
      break;
    }
    case 'session': if (S.cur) { Object.assign(S.cur, ev.patch); header(); meter(); } break;
    // Only a compaction this load has not seen: the snapshot already holds it, and the replay from
    // fromSeq repeats the event, which would otherwise reload in a loop for the rest of the run.
    case 'compacted': S.compacted = S.running; if (ev.seq > S.loadSeq) load(S.cur.id).catch(() => {}); break;
    case 'run_end':
      closeLive(); setRunning(false); addFoot(); refreshSessions(); refreshBalance(true); reloadPreviewAfterRun();
      // A run that compacted mid-way was drawn from its events; redraw from the stored messages so turns match dsh's.
      if (S.cur && S.compacted) load(S.cur.id).catch(() => {});
      if (!visible() && ev.reason !== 'stopped') { const t = [...S.items].reverse().find(x => x.kind === 'text'); N?.notify(S.cur?.title || 'dsh', ev.reason === 'max_steps' ? 'Stopped at the step limit. Send a message to continue.' : ev.reason === 'error' ? 'Stopped: ' + (API_ERR[S.items.findLast(x => x.kind === 'apierr')?.kind2] || API_ERR.bad) : t ? t.text.slice(0, 300) : 'Finished'); }
      break;
  }
}
// Live speed estimate for the model call in flight (about 4 chars a token); the usage event replaces it with the exact figure.
function countGen(d) { if (S.gen) { S.gen.t0 ||= S.evT || Date.now(); S.gen.chars += d.length; } }
const tool = id => S.items.find(x => x.kind === 'tool' && x.id === id);
// Index of the next user message as dsh's rewind counts it: every user message, steering ones included.
// Turn index for the next user message, as dsh's rewind counts them. A pending bubble isn't a message yet: its POST may
// still come back queued, so a steer read meanwhile must not count it.
const userTurns = () => S.items.filter(x => x.kind === 'user' && !x.pending).length;

// DeepSeek failures, by the kind dsh gives them. The card stays at the end of the session until the next run.
const API_ERR = { network: "Can't reach DeepSeek", busy: 'DeepSeek is overloaded', rate: 'DeepSeek is rate limiting', auth: 'DeepSeek rejected the API key', balance: 'DeepSeek balance is used up', bad: 'DeepSeek refused the request' };
const dropItem = it => { const i = S.items.indexOf(it); if (i < 0) return; it.el.remove(); S.items.splice(i, 1); };
function clearApiErr() { for (const x of S.items.filter(x => x.kind === 'apierr')) dropItem(x); strip(); }
function apiErr(e) { clearApiErr(); return add({ kind: 'apierr', kind2: e.kind || 'bad', text: e.message }); }
async function retryRun(it) {
  haptic(); if (S.running) return;
  try { await api('POST', `/api/sessions/${S.cur.id}/retry`); dropItem(it); strip(); }
  catch (e) { toast(e.message); }
}

async function decide(it, d) {
  haptic();
  const was = it.status; it.status = d === 'deny' ? 'denied' : 'run'; paint(it);
  // Until dsh has the answer the call is still waiting: on failure, give the buttons back.
  const undo = () => { if (it.status === (d === 'deny' ? 'denied' : 'run')) { it.status = was; paint(it); } };
  try { const r = await api('POST', `/api/sessions/${S.cur.id}/approve`, { id: it.id, decision: d }); if (r.ok === false) { undo(); return toast('dsh is no longer waiting on this'); } if (d === 'always') toast(`${tname(it.name)} allowed for this session`); }
  catch (e) { undo(); toast(e.message); }
}

/* ---------- sessions ---------- */
let loadGen = 0;
async function load(id) {
  S.close?.(); S.close = null;
  // One load at a time: an older one finishing late would draw a stale snapshot and leave a second stream open.
  const my = ++loadGen; S.loading = true;
  let s;
  try { s = await api('GET', `/api/sessions/${id}?at=step`); }
  catch (e) { if (my === loadGen && S.cur?.id === id) setTimeout(() => { if (S.cur?.id === id && !S.close) resync(); }, 2000); throw e; } // never left with no stream
  finally { if (my === loadGen) S.loading = false; }
  if (my !== loadGen) return;
  S.cur = s; S.seq = s.live.fromSeq; S.loadSeq = s.live.seq; S.compacted = false; S.todos = s.todos || []; S.sel = null;
  local.set('last', id);
  S.evT = 0; fromMessages(s.messages, s.meta);
  // Messages sent during the run and not yet read: their 'queued' events may predate the replay.
  for (const q of s.live.queue || []) if (!S.readQ.has(q.id) && !S.queue.some(x => x.qid === q.id)) queuedAdd({ qid: q.id, text: q.text });
  if (s.meta?.error && !s.live.running) apiErr(s.meta.error);
  setRunning(s.live.running);
  header(); meter(); todos(); renderSessions(); emptyState();
  stick = true; requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  listen();
}
function listen() {
  const id = S.cur.id;
  S.close = stream(`/api/sessions/${id}/events?after=${S.seq}`, list => {
    if (S.cur?.id !== id) return;
    // A hole in the sequence means dsh no longer holds events we never saw: rebuild from the
    // snapshot rather than draw a reply's tail with no prompt. Once per hole, so a dsh that
    // still trims can't loop us.
    if (list[0]?.seq > S.seq + 1 && S.hole !== S.seq) { S.hole = S.seq; S.close?.(); S.close = null; load(id).catch(() => {}); return; }
    S.retry = 0; for (const ev of list) apply(ev); follow(); conn(true);
  }, err => {
    if (S.cur?.id !== id) return;
    S.close = null; conn(false);
    const wait = [500, 1000, 2000, 4000, 8000][Math.min(S.retry++, 4)];
    setTimeout(() => { if (S.cur?.id === id && !S.close) resync(); }, wait);
  });
}
async function resync() {
  if (!S.cur || S.loading) return;
  let s;
  try { s = await api('GET', '/api/sessions/' + S.cur.id); conn(true); }
  catch { conn(false); if (!S.close) setTimeout(resync, 4000); return; }
  // Server restarted, we missed a run, or a run ended without its run_end reaching us.
  // A failed load schedules its own retry, so it isn't retried here too (that would fork a second poll chain).
  if (s.live.seq < S.seq || !S.close && s.live.fromSeq > S.seq || S.running && !s.live.running && s.live.seq > S.seq) return load(S.cur.id).catch(() => {});
  if (!S.close) listen();
}
async function refreshSessions() { try { S.sessions = await api('GET', '/api/sessions'); if (S.sessions.some(x => x.running)) N?.keepAwake?.(); renderSessions(); conn(true); } catch { conn(false); } }
function renderSessions(box = $('#sessions')) {
  if (box.id === 'sessions' && layout.mode === 'wide' && S.itab === 'sessions') renderSessions($('#ibody'));
  box.textContent = '';
  if (box.id === 'ibody') { // the Inspector's list needs its own way in; the drawer is not reachable here
    const nb = h('button', 'primary wide newSess', `${I.plus}New session`);
    nb.onclick = () => { haptic(); newSession(); };
    box.append(nb);
  }
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
const home = () => S.health?.userHome || (S.health?.home ? S.health.home.replace(/\/\.dsh$/, '') : '/data/data/com.termux/files/home');
const short = p => String(p || '').replace(home(), '~');
// Temp folders (from dsh's health) can be wiped, so new sessions never start in one.
const isTempDir = p => !!p && (S.health?.tempRoots || []).some(t => p === t || p.startsWith(t + '/'));
const newStart = () => [S.cur?.cwd, S.cfg?.cwd].find(d => d && !isTempDir(d)) || home();
function tempBar() {
  const bar = $('#tempBar'), on = !!S.cur && isTempDir(S.cur.cwd);
  bar.hidden = !on; if (!on) return;
  bar.innerHTML = `<p><b>Temporary folder:</b> files here can be wiped.</p><button data-t="pick">Choose folder</button><button class="primary" data-t="home">Use home folder</button>`;
  bar.querySelector('[data-t=home]').onclick = () => { haptic(); patch({ cwd: home() }); };
  bar.querySelector('[data-t=pick]').onclick = () => pickDir(home(), d => patch({ cwd: d }));
}

function header() {
  const s = S.cur;
  $('#title').textContent = s ? s.title : 'DSHA';
  $('#cwdChip').textContent = s ? short(s.cwd) : S.health ? 'Not in a session' : 'Not connected';
  tempBar();
  const m = s?.mode || S.cfg?.mode || 'ask';
  $('#modeChip').className = 'chip ' + m; $('#modeChip').textContent = MODES[m][0];
}
// usage.cost (dsh 0.9.0+) is exact only if it covers the whole session. A session begun before 0.9.0 starts cost at its
// first newer call, so cost < costOff (the cheapest the whole session could have been): show the off-peak..peak range then.
const spentExact = u => u.cost != null && u.cost + 1e-9 >= (u.costOff || 0);
function meter() {
  const s = S.cur; if (!s) { $('#meter').textContent = ''; return; }
  const u = s.usage || {}, ctx = u.lastPrompt || 0;
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const c = v => '$' + (v < 0.01 ? v.toFixed(4) : v.toFixed(3));
  $('#meter').innerHTML = `<span><b>${esc(modelName(s.model))}</b> · ${s.thinking === false ? 'no thinking' : esc(s.effort) + ' thinking'}</span><span><b>${k(ctx)}</b> context · ${u.tps ? `<b>${u.tps}</b> tok/s · ` : ''}<i class="mx">${k((u.hit || 0) + (u.miss || 0))} in · ${k(u.out || 0)} out · </i><b>${spentExact(u) ? c(u.cost) : c(u.costOff || 0) + '–' + c(u.costPeak || 0)}</b></span>`; ui();
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
  if (r && !S.running) N?.keepAwake?.();
  S.running = r;
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
  if (builtin() && S.health && !S.health.hasKey) return keyScreen(e);
  const recent = S.cur ? [] : S.sessions.slice(0, 3);
  e.innerHTML = `<h2>What should dsh do?</h2><div class="where">${S.cur ? 'Working in <code>' + esc(short(S.cur.cwd)) + '</code>' : 'A new session starts in <code>' + esc(short(newStart())) + '</code>'}</div>
    <div class="group"><h3>Start with</h3><div class="rows" id="starters"></div></div>
    ${recent.length ? '<div class="group"><h3>Pick up where you left off</h3><div class="rows" id="recent"></div></div>' : ''}`;
  for (const t of ['Summarise this project and how to build it', builtin() ? 'Build a small to-do web page and preview it' : 'What changed in git recently?', 'Find TODOs and rank them by importance', 'Check disk usage and the biggest folders here']) {
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
  const lt = S.items.findLastIndex(x => x.kind === 'user' && !x.steer);
  const steps = (lt < 0 ? [] : S.items.slice(lt + 1)).filter(x => !x.parent && (x.kind === 'think' || x.kind === 'tool' || x.kind === 'text'));
  const failed = !S.running && last()?.kind === 'apierr';
  bar.classList.toggle('on', (!!steps.length || failed) && (S.running || !!S.cur));
  if (!steps.length) { segs.textContent = ''; $('#runText').innerHTML = failed ? `<b>Failed</b> · ${esc(API_ERR[last().kind2] || API_ERR.bad)}` : ''; return; }
  const now = Date.now(), dur = x => x.ms ?? (x.t0 ? now - x.t0 : 1200);
  const cur = steps[steps.length - 1], w = waitingTool(), tools = steps.filter(x => x.kind === 'tool').length;
  const total = steps.reduce((a, x) => a + (x.ms ?? (x.t0 ? now - x.t0 : 0)), 0);
  $('#runText').innerHTML = w ? `<b>Needs you</b> · ${esc(tname(w.name))}` : failed ? `<b>Failed</b> · ${esc(API_ERR[last().kind2] || API_ERR.bad)}`
    : S.running ? (cur.kind === 'think' && cur.live ? '<b>Thinking</b>' : cur.kind === 'tool' && cur.status === 'run' ? `<b>${esc(tname(cur.name))}</b>` : cur.live ? '<b>Writing</b>' : waitText()) + (/Waiting/.test(waitText()) && !cur.live && cur.status !== 'run' ? '' : liveTps() ? ` · ~${liveTps()} tok/s` : total ? ' · ' + fmtMs(Math.round(total / 100) * 100) : '')
    : `${tools} tool call${tools === 1 ? '' : 's'}${total ? ' · ' + fmtMs(Math.round(total / 100) * 100) : ''}`;
  // A segment needs 6px plus a 2px gap; 9px leaves slack. On a long run the newest steps keep their own segment and
  // everything before them folds into one, so the strip never spills under its label.
  const fit = Math.max(8, Math.floor((segs.clientWidth || 240) / 9));
  let shown = steps;
  if (steps.length > fit) {
    const early = steps.slice(0, steps.length - fit + 1);
    shown = [{ fold: early, el: early[0].el, ms: early.reduce((a, x) => a + dur(x), 0) }, ...steps.slice(-(fit - 1))];
  }
  while (segs.children.length > shown.length) segs.lastChild.remove();
  shown.forEach((x, i) => {
    let b = segs.children[i]; if (!b) { b = h('button'); segs.append(b); }
    if (x.fold) {
      b.dataset.s = x.fold.some(y => y.status === 'fail') ? 'fail' : 'ok'; b.style.flex = `${Math.max(400, Math.min(x.ms, 60000))} 1 0`;
      b.ariaLabel = `${x.fold.length} earlier steps`; b.onclick = () => { haptic(); stick = false; x.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
      return;
    }
    const st = x.kind === 'tool' ? x.status || 'run' : x.live ? 'run' : x.kind === 'think' ? 'think' : 'reply';
    b.dataset.s = st; b.style.flex = `${Math.max(400, Math.min(dur(x), 60000))} 1 0`;
    b.ariaLabel = x.kind === 'tool' ? `${tname(x.name)}, ${statusText(x)}` : x.kind === 'think' ? 'Thinking' : 'Reply';
    b.onclick = () => { haptic(); stick = false; x.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (x.kind === 'tool' && layout.mode === 'wide') { if (chatFull) setChatFull(false); S.sel = x.id; S.itab = 'activity'; for (const t of S.items) if (t.kind === 'tool') t.el.classList.toggle('sel', t.id === S.sel); ui(); } };
  });
}
setInterval(() => { if (S.running) strip(); }, 1000);
// Between steps dsh is waiting on DeepSeek; say so, and how long, so a slow network doesn't look like a frozen app.
function waitText() {
  const s = Math.round((Date.now() - (S.lastEv || Date.now())) / 1000);
  return s < 3 ? '<b>Working</b>' : `<b>Waiting for DeepSeek</b> · ${s} s`;
}

/* ---------- composer ---------- */
const input = $('#input');
function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, innerHeight * .34) + 'px'; }
// Mid-run the button is Stop while the box is empty and Send (queued for after this step) once you type.
function syncSend() {
  const b = $('#sendBtn'), typed = !!input.value.trim(), k = S.running && !typed ? 'stop' : 'send';
  b.disabled = !S.running && !typed;
  if (b.dataset.k !== k) { b.dataset.k = k; b.innerHTML = I[k]; b.classList.toggle('stop', k === 'stop'); }
  b.ariaLabel = k === 'stop' ? 'Stop' : S.running ? 'Send after this step' : 'Send';
}
input.addEventListener('input', () => { grow(); syncSend(); slash(); local.set('draft', input.value); });
input.addEventListener('keydown', e => {
  if (!$('#slash').hidden && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); $('#slash .sel')?.click(); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !matchMedia('(pointer:coarse)').matches && !e.shiftKey)) { e.preventDefault(); send(); }
});
$('#sendBtn').onclick = () => S.running && !input.value.trim() ? stop() : send();

const COMMANDS = [
  ['/new', 'New session', () => newSession()], ['/compact', 'Summarise history to free context', () => compact()],
  ['/mode', 'Permission mode', () => modeSheet()], ['/model', 'Model and thinking', () => optionsSheet()],
  ['/cwd', 'Change working directory', () => pickDir(S.cur?.cwd, d => patch({ cwd: d }))], ['/settings', 'Connection, key, defaults', () => settingsSheet()],
  ['/agents', 'Subagents', () => agentPage('agents')], ['/plugins', 'MCP tool servers', () => agentPage('plugins')], ['/skills', 'Skills dsh can load', () => agentPage('skills')], ['/instructions', 'DSH.md and other instruction files', () => agentPage('instructions')],
];
function slash() {
  const v = input.value, box = $('#slash');
  if (!/^\/\w*$/.test(v)) { box.hidden = true; return; }
  const list = COMMANDS.filter(c => c[0].startsWith(v));
  box.hidden = !list.length; box.textContent = '';
  list.forEach((c, i) => { const b = h('button', i ? '' : 'sel', `<b>${c[0]}</b><span>${c[1]}</span>`); b.onclick = () => { input.value = ''; grow(); box.hidden = true; syncSend(); c[2](); }; box.append(b); });
}

async function send() {
  const text = input.value.trim(); if (!text) return;
  const cmd = COMMANDS.find(c => c[0] === text); if (cmd) { input.value = ''; grow(); $('#slash').hidden = true; return cmd[2](); }
  if (S.running) return steer(text);
  haptic();
  try {
    if (!S.cur) { const s = await api('POST', '/api/sessions', {}); await load(s.id); }
    input.value = ''; grow(); local.set('draft', ''); syncSend(); $('#slash').hidden = true;
    const p = add({ kind: 'user', text, pending: true, turn: userTurns() }); emptyState(); stick = true; follow();
    const r = await api('POST', `/api/sessions/${S.cur.id}/messages`, { text });
    // A run had already started (a second Send before its run_start): dsh queued this one as steering.
    if (r.queued) { dropItem(p); if (!S.readQ.has(r.queued) && !S.queue.some(x => x.qid === r.queued)) queuedAdd({ qid: r.queued, text }); }
  } catch (e) {
    const p = S.items.find(x => x.pending); if (p) { dropItem(p); input.value = text; grow(); syncSend(); }
    toast(e.message); emptyState();
  }
}
// Live steering: mid-run, a message waits under the chat and dsh reads it after the current step
// (its tool results, or the reply it is writing). It can be cancelled until then.
async function steer(text) {
  haptic(); if (!S.cur) return;
  input.value = ''; grow(); local.set('draft', ''); syncSend(); $('#slash').hidden = true;
  const q = queuedAdd({ text }); stick = true; follow();
  try {
    const r = await api('POST', `/api/sessions/${S.cur.id}/messages`, { text });
    if (!r.queued) { queuedDrop(q); return; } // the run had just ended: it started a new one, whose user event draws the bubble
    const dup = S.queue.find(x => x !== q && x.qid === r.queued); if (dup) queuedDrop(dup);
    if (S.readQ.has(r.queued)) { queuedDrop(q); return; } // dsh read it before this reply arrived
    q.qid = r.queued; paintQueued(q);
  } catch (e) { queuedDrop(q); input.value = text + (input.value ? '\n\n' + input.value : ''); grow(); syncSend(); toast(e.message); }
}
S.queue = [];
function queuedAdd(q) {
  q.el = h('div', 'msg user queued', '<span class="qt"></span><span class="qs"><span class="ql"></span><button class="qx" aria-label="Cancel queued message"></button></span>');
  q.el.querySelector('.qx').innerHTML = I.x;
  q.el.querySelector('.qx').onclick = () => cancelQueued(q);
  S.queue.push(q); $('#queue').append(q.el); paintQueued(q); return q;
}
function paintQueued(q) { q.el.querySelector('.qt').textContent = q.text; q.el.querySelector('.ql').textContent = q.qid ? 'Queued · read after this step' : 'Sending…'; q.el.querySelector('.qx').hidden = !q.qid; }
function queuedDrop(q) { q.el.remove(); const i = S.queue.indexOf(q); if (i >= 0) S.queue.splice(i, 1); }
async function cancelQueued(q) {
  haptic();
  try { await api('DELETE', `/api/sessions/${S.cur.id}/queue/${q.qid}`); if (S.queue.includes(q)) queuedDrop(q); input.value = q.text + (input.value ? '\n\n' + input.value : ''); grow(); syncSend(); local.set('draft', input.value); }
  catch (e) { toast(e.message); }
}
async function stop() { haptic(); if (!S.cur) return setRunning(false); try { await api('POST', `/api/sessions/${S.cur.id}/stop`); } catch (e) { toast(e.message); } }
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

/* ---------- agent setup: plugins (MCP servers), skills, instruction files ---------- */
// A full-screen page over the chat, since it is managed rather than glanced at. Everything is read
// for the open session's folder (or the default folder), because skills and instruction files can
// live in the project as well as in ~/.dsh.
const PTABS = [['agents', 'Subagents'], ['plugins', 'Plugins'], ['skills', 'Skills'], ['memory', 'Memory'], ['instructions', 'Instructions']];
const RISK = { read: 'Read only', edit: 'Edits files', exec: 'Runs anything' };
const SOURCES = { project: ['This project', '.dsh/skills in the session folder'], dsh: ['All projects', '~/.dsh/skills'], builtin: ['Built in', 'Ship with dsh'], claude: ['Claude Code', '~/.claude/skills'] };
const pageCwd = () => S.cur?.cwd || S.cfg?.cwd || home();
const cwdQ = () => 'cwd=' + encodeURIComponent(pageCwd());
const sw = (on, attrs) => `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" ${attrs}><i></i></button>`;
const kb = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';

// The page also shows Usage (S.ptab 'usage'), so the last tab is only a default when it is one of these.
function agentPage(tab = PTABS.some(t => t[0] === S.ptab) ? S.ptab : 'agents') {
  if (!PTABS.some(t => t[0] === tab)) tab = 'agents';
  S.ptab = tab; drawer(false); closeSheet();
  const page = $('#page'); page.hidden = false; page.ariaLabel = 'Agent setup'; document.body.classList.add('paged'); syncPreview();
  $('#pageTitle').textContent = 'Agent'; $('#pageSub').textContent = 'For ' + short(pageCwd());
  $('#ptabs').innerHTML = PTABS.map(([k, l]) => `<button role="tab" data-t="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}</button>`).join('');
  $('#ptabs').querySelectorAll('button').forEach(b => b.onclick = () => { haptic(); agentPage(b.dataset.t); });
  $('#pbody').scrollTop = 0;
  ({ agents: agentsTab, plugins: pluginsTab, skills: skillsTab, memory: memoryTab, instructions: instructionsTab })[tab]();
}
function closePage() { $('#page').hidden = true; document.body.classList.remove('paged'); syncPreview(); }
const pbody = html => { if (html != null) $('#pbody').innerHTML = html; return $('#pbody'); };
const pageOn = t => !$('#page').hidden && S.ptab === t;

/* plugins */
const mcpState = m => m.state === 'up' ? ['up', `Connected · ${m.tools} tool${m.tools === 1 ? '' : 's'}`] : m.state === 'off' ? ['off', 'Off'] : m.state === 'down' ? ['down', `Can't connect: ${m.error || 'no reply'}`] : ['wait', 'Connecting…'];
function pluginsTab() {
  pbody(`<p class="lead">Tool servers (MCP) that dsh connects to. Their tools sit next to the built-in ones and ask for approval the same way. Saved in <code>~/.dsh/mcp.json</code>.</p><div id="mcpList">${S.mcp ? '' : '<p class="hint">Checking servers…</p>'}</div>
    <div class="rowbtns"><button class="secondary" id="mcpReload">${I.retry}Reconnect all</button><button class="primary" id="mcpAdd">${I.plus}Add server</button></div>`);
  if (S.mcp) drawPlugins();
  $('#mcpAdd').onclick = () => pluginForm();
  $('#mcpReload').onclick = async () => { haptic(); $('#mcpList').innerHTML = '<p class="hint">Reconnecting…</p>'; try { S.mcp = await api('POST', '/api/mcp/reload'); } catch (e) { toast(e.message); } if (pageOn('plugins')) drawPlugins(); };
  api('GET', '/api/mcp').then(r => { S.mcp = r; if (pageOn('plugins')) drawPlugins(); }).catch(e => { if (pageOn('plugins')) $('#mcpList').innerHTML = `<p class="err-text">${esc(e.message)}</p>`; });
}
function drawPlugins() {
  const box = $('#mcpList'); if (!box) return;
  if (!S.mcp.length) { box.innerHTML = '<div class="empty-note">No servers yet. Add one by URL (a server already running) or by the command that starts it.</div>'; return; }
  // A broken mcp.json comes back as one status row: show its error, it is not a server to open.
  box.innerHTML = `<div class="rows">${S.mcp.map((m, i) => { if (m.invalid) return `<div class="row"><span class="sdot down"></span><span class="rx"><span class="r1">mcp.json can't be read</span><span class="r2">${esc(m.error || '')}. Fix the file; until then no plugin changes are saved.</span></span></div>`; const [k, t] = mcpState(m); return `<button data-i="${i}"><span class="sdot ${k}"></span><span class="rx"><span class="r1">${esc(m.name)}</span><span class="r2">${esc(t)}</span></span>${I.chev}</button>`; }).join('')}</div>`;
  box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => pluginSheet(S.mcp[+b.dataset.i]));
}
async function pluginSheet(m) {
  const [, st] = mcpState(m);
  const b = sheet(`<h3>${esc(m.name)}</h3><div class="kvs"><div class="kv"><span>Status</span><b>${esc(st)}</b></div><div class="kv"><span>${m.transport === 'http' ? 'URL' : 'Command'}</span><b class="code">${esc(m.target)}</b></div>${m.start ? `<div class="kv"><span>Start with</span><b class="code">${esc(m.start)}</b></div>` : ''}<div class="kv"><span>Tools without hints</span><b>${RISK[m.risk]}</b></div>${m.server ? `<div class="kv"><span>Server</span><b>${esc(m.server.name || '')} ${esc(m.server.version || '')}</b></div>` : ''}${m.env.length ? `<div class="kv"><span>Environment</span><b class="code">${esc(m.env.join(', '))}</b></div>` : ''}</div>
    <h4>Tools</h4><div id="mcpTools"><p class="hint">${m.state === 'up' ? 'Loading…' : 'Shown once the server is connected.'}</p></div>
    <div class="rowbtns"><button class="secondary" data-a="toggle">${m.disabled ? 'Turn on' : 'Turn off'}</button><button class="secondary" data-a="edit">${I.pen}Edit</button></div>
    <button class="ghost-danger wide" data-a="del">${I.trash}Remove server</button>`, {
    toggle: async () => { closeSheet(); try { S.mcp = await api('PATCH', '/api/mcp/' + m.name, { disabled: !m.disabled }); toast(m.disabled ? `${m.name} turned on` : `${m.name} turned off`); } catch (e) { toast(e.message); } pluginsTab(); },
    edit: () => pluginForm(m),
    del: async () => { if (!confirm(`Remove ${m.name}? Its tools stop being available to dsh.`)) return; closeSheet(); try { S.mcp = await api('DELETE', '/api/mcp/' + m.name); toast('Removed'); } catch (e) { toast(e.message); } pluginsTab(); },
  });
  if (m.state !== 'up') return;
  try {
    const tools = await api('GET', `/api/mcp/${m.name}/tools`), box = b.querySelector('#mcpTools'); if (!box) return;
    box.innerHTML = tools.length ? `<div class="rows">${tools.map(t => `<div class="row"><span class="rx"><span class="r1 code">${esc(t.name)}</span><span class="r2">${esc(t.description.split('\n')[0] || 'No description')}</span></span>${t.readOnly ? '<span class="rv">Read only</span>' : ''}</div>`).join('')}</div>` : '<p class="hint">This server offers no tools.</p>';
  } catch {}
}
// The stdio command as one editable line, quoted so an argument with a space survives dsh splitting it again.
// Needs dsh to report command and args; older ones send only the joined target.
const shq = a => /^[^\s"']+$/.test(a) ? a : a.includes('"') ? `'${a}'` : `"${a}"`;
const cmdLine = m => m.command ? [m.command, ...(m.args || [])].map(shq).join(' ') : m.target;
function pluginForm(m) {
  let kind = m ? m.transport : 'http', risk = m?.risk || 'exec';
  const b = sheet(`<h3>${m ? 'Edit ' + esc(m.name) : 'Add server'}</h3>
    <label class="field"><span>Name</span><input id="mName" value="${esc(m?.name || '')}" ${m ? 'disabled' : ''} placeholder="files" autocapitalize="off" spellcheck="false"></label>
    ${seg('kind', [['http', 'By URL'], ['stdio', 'By command']], kind)}
    <label class="field" style="margin-top:14px" id="mUrlF"><span>URL</span><input id="mUrl" value="${esc(m?.transport === 'http' ? m.target : '')}" placeholder="http://127.0.0.1:9090/mcp" autocapitalize="off" spellcheck="false" inputmode="url"></label>
    <label class="field" style="margin-top:14px" id="mCmdF"><span>Command</span><input id="mCmd" value="${esc(m?.transport === 'stdio' ? cmdLine(m) : '')}" placeholder="npx -y @modelcontextprotocol/server-filesystem ~" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Start command, optional</span><input id="mStart" value="${esc(m?.start || '')}" placeholder="Runs once when the server can't be reached" autocapitalize="off" spellcheck="false"></label>
    <h4>Tools without a read-only or destructive hint</h4>${seg('risk', Object.entries(RISK), risk)}
    <p class="hint">Read only tools run without asking. Others follow the session's permission mode.</p>
    <button class="primary wide" data-a="save" style="margin-top:18px">Save</button><div class="err-text" id="mErr"></div>`, {
    kind: el => { kind = el.dataset.v; mark(el); show(); },
    risk: el => { risk = el.dataset.v; mark(el); },
    save: async el => {
      const name = (m?.name || $('#mName').value).trim(), body = { risk, start: $('#mStart').value.trim() };
      if (kind === 'http') body.url = $('#mUrl').value.trim(); else body.command = $('#mCmd').value.trim();
      if (!m) body.create = true; // dsh refuses to replace an existing server under this name
      if (!/^[\w-]{1,40}$/.test(name)) return ($('#mErr').textContent = 'Name: letters, digits, dashes or underscores.');
      // Adding under a name in use would replace that server and hand it the old one's environment.
      if (!m && (S.mcp || []).some(x => x.name === name)) return ($('#mErr').textContent = `A server named ${name} already exists. Pick another name, or edit that one.`);
      el.disabled = true;
      try { S.mcp = await api('PUT', '/api/mcp/' + name, body); closeSheet(); toast(m ? 'Saved' : `${name} added`); pluginsTab(); }
      catch (e) { $('#mErr').textContent = e.message; el.disabled = false; }
    },
  });
  const mark = el => el.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === el));
  const show = () => { b.querySelector('#mUrlF').hidden = kind !== 'http'; b.querySelector('#mCmdF').hidden = kind === 'http'; };
  show();
}

/* subagents */
// dsh designs subagents itself as it works; these are the saved ones it can reuse by name, Claude Code style.
const ASRC = { project: ['This project', '.dsh/agents in the session folder'], dsh: ['All projects', '~/.dsh/agents'], builtin: ['Presets', 'Ship with dsh'], claude: ['Claude Code', '~/.claude/agents, tool names mapped'] };
const AMODEL = { inherit: 'Session model', 'deepseek-flash': 'Flash', 'deepseek-v4-pro': 'V4 Pro' };
const toolsText = a => !a.tools ? 'All tools' : a.tools.length <= 3 ? a.tools.map(tname).join(', ') : `${a.tools.length} tools`;
async function agentsTab() {
  pbody('<p class="hint">Loading subagents…</p>');
  try { S.agents = await api('GET', '/api/agents?' + cwdQ()); } catch (e) { return pbody(`<p class="err-text">${esc(e.message)}</p>`); }
  if (pageOn('agents')) drawAgents();
}
function drawAgents() {
  const { agents, claude } = S.agents;
  const group = src => {
    const list = agents.filter(x => x.source === src), [title, where] = ASRC[src];
    const head = `<div class="ghead"><div><h3>${title}</h3><p class="r2">${where}</p></div>${src === 'claude' ? sw(claude, 'data-claude aria-label="Use Claude Code subagents"') : ''}</div>`;
    if (!list.length) return src === 'claude' || src === 'builtin' ? '' : head + `<div class="empty-note">None yet.</div>`;
    return head + `<div class="rows${src === 'claude' && !claude ? ' dim' : ''}">${list.map(x => `<div class="row"><button class="rx" data-open="${esc(x.id)}"><span class="r1">${esc(x.name)}${x.shadowed ? ' <span class="tag">Hidden by another with this name</span>' : ''}</span><span class="r2">${esc(x.description || 'No description')}</span><span class="r3">${esc(AMODEL[x.model] || x.model)} · ${esc(toolsText(x))}</span></button>${sw(x.enabled, `data-id="${esc(x.id)}" aria-label="Use ${esc(x.name)}"` + (src === 'claude' && !claude ? ' disabled' : ''))}</div>`).join('')}</div>`;
  };
  const on = agents.filter(x => x.enabled && !x.shadowed).length;
  pbody(`<p class="lead">dsh spawns subagents on its own: a helper with a fresh context, its own tools and model, for one part of a task. It writes their role as it goes. Saved subagents are roles it can reuse by name. ${on} saved in use.</p>
    ${['project', 'dsh', 'builtin', 'claude'].map(g => { const html = group(g); return html ? `<div class="group">${html}</div>` : ''; }).join('')}
    <div class="rowbtns"><button class="secondary" id="agAsk">Ask dsh to write one</button><button class="primary" id="agNew">${I.plus}New subagent</button></div>`);
  const box = pbody();
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => agentSheet(b.dataset.open));
  box.querySelectorAll('.switch[data-id]').forEach(b => b.onclick = async () => { haptic(); try { S.agents = await api('PATCH', '/api/agents', { cwd: pageCwd(), id: b.dataset.id, enabled: !b.classList.contains('on') }); drawAgents(); } catch (e) { toast(e.message); } });
  box.querySelector('[data-claude]')?.addEventListener('click', async () => { haptic(); try { S.agents = await api('PATCH', '/api/agents', { cwd: pageCwd(), claude: !claude }); drawAgents(); } catch (e) { toast(e.message); } });
  $('#agNew').onclick = () => agentForm();
  $('#agAsk').onclick = () => askChat('Design and save a subagent for ');
}
async function agentSheet(id) {
  let a; try { a = await api('GET', `/api/agents/read?${cwdQ()}&id=${encodeURIComponent(id)}`); } catch (e) { return toast(e.message); }
  const b = sheet(`<h3>${esc(a.name)}</h3><p class="hint" style="margin:-8px 0 12px">${esc(ASRC[a.source][0])} · <code>${esc(short(a.file))}</code></p>
    <div class="kvs">${a.description ? `<div class="kv"><span>Used when</span><b style="text-align:left">${esc(a.description)}</b></div>` : ''}<div class="kv"><span>Model</span><b>${esc(AMODEL[a.model] || a.model)}${a.effort ? ' · ' + esc(a.effort) + ' thinking' : ''}</b></div><div class="kv"><span>Tools</span><b style="text-align:left">${a.tools ? a.tools.map(n => `<code>${esc(n)}</code>`).join(' ') : 'All tools'}</b></div></div>
    <h4>System prompt</h4><div class="mdbox md" id="agBody"></div>
    <div class="rowbtns"><button class="secondary" data-a="toggle">${a.enabled ? 'Turn off' : 'Turn on'}</button><button class="secondary" data-a="edit">${a.editable ? 'Edit' : 'Duplicate'}</button>${a.enabled ? '<button class="primary" data-a="use">Use in chat</button>' : ''}</div>
    ${a.editable ? `<button class="ghost-danger wide" data-a="del">${I.trash}Delete</button>` : ''}`, {
    use: () => askChat(`Use the ${a.name} subagent to `),
    edit: () => agentForm(a.editable ? a : { ...a, id: null, name: a.name + '-copy' }),
    toggle: async () => { closeSheet(); try { S.agents = await api('PATCH', '/api/agents', { cwd: pageCwd(), id, enabled: !a.enabled }); drawAgents(); } catch (e) { toast(e.message); } },
    del: async () => { if (!confirm(`Delete the subagent ${a.name}?`)) return; closeSheet(); try { S.agents = await api('POST', '/api/agents/delete', { cwd: pageCwd(), id }); drawAgents(); toast('Deleted'); } catch (e) { toast(e.message); } },
  });
  renderMd(b.querySelector('#agBody'), a.prompt);
}
// a: an existing definition to edit (a.id set) or prefill a new one from (a.id null).
function agentForm(a = {}) {
  const all = (S.agents?.tools || []).map(t => t.name);
  let scope = a.source === 'project' ? 'project' : 'dsh', model = a.model === 'deepseek-flash' ? 'flash' : a.model === 'deepseek-v4-pro' ? 'pro' : 'inherit', effort = a.effort || '';
  let picked = new Set(a.tools || []), preset = !a.tools ? 'all' : READ_TOOLS.every(n => picked.has(n)) && picked.size === READ_TOOLS.length ? 'read' : 'pick';
  const chips = () => `<div class="chips" id="agTools"${preset === 'pick' ? '' : ' hidden'}>${all.map(n => `<button type="button" data-a="tool" data-v="${esc(n)}" class="chip${picked.has(n) ? ' on' : ''}" aria-pressed="${picked.has(n)}">${esc(tname(n))}</button>`).join('')}</div>`;
  const b = sheet(`<h3>${a.id ? 'Edit ' + esc(a.name) : 'New subagent'}</h3>
    <label class="field"><span>Name</span><input id="agName" value="${esc(a.name || '')}" placeholder="code-reviewer" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Use it when</span><input id="agDesc" value="${esc(a.description || '')}" placeholder="Reviewing a change for bugs before it is committed"></label>
    <h4>Model</h4>${seg('model', [['inherit', 'Session'], ['flash', 'Flash'], ['pro', 'V4 Pro']], model)}
    <h4>Thinking</h4>${seg('effort', [['', 'Session'], ['low', 'Low'], ['high', 'High'], ['max', 'Max']], effort)}
    <h4>Tools</h4>${seg('preset', [['all', 'All'], ['read', 'Read only'], ['pick', 'Choose']], preset)}${chips()}
    ${a.id ? '' : `<h4>Available in</h4>${seg('scope', [['dsh', 'All projects'], ['project', 'This project']], scope)}`}
    <label class="field" style="margin-top:16px"><span>System prompt</span><textarea id="agText" rows="9" placeholder="Who the subagent is, how it works, and what its final report must contain.">${esc(a.prompt || '')}</textarea></label>
    <button class="primary wide" data-a="save">${a.id ? 'Save' : 'Create subagent'}</button><div class="err-text" id="agErr"></div>`, {
    model: el => { model = el.dataset.v; on(el); },
    effort: el => { effort = el.dataset.v; on(el); },
    scope: el => { scope = el.dataset.v; on(el); },
    preset: el => { preset = el.dataset.v; on(el); if (preset === 'read') picked = new Set(READ_TOOLS); $('#agTools').hidden = preset !== 'pick'; $('#agTools').querySelectorAll('.chip').forEach(c => { c.classList.toggle('on', picked.has(c.dataset.v)); c.ariaPressed = picked.has(c.dataset.v); }); },
    tool: el => { const n = el.dataset.v; picked.has(n) ? picked.delete(n) : picked.add(n); el.classList.toggle('on', picked.has(n)); el.ariaPressed = picked.has(n); },
    save: async el => {
      const tools = preset === 'all' ? null : preset === 'read' ? READ_TOOLS : [...picked];
      if (tools && !tools.length) { $('#agErr').textContent = 'Pick at least one tool, or choose All.'; return; }
      el.disabled = true;
      try { S.agents = await api('POST', '/api/agents', { cwd: pageCwd(), id: a.id || undefined, scope, name: $('#agName').value, description: $('#agDesc').value, model, effort: effort || undefined, tools, prompt: $('#agText').value }); closeSheet(); drawAgents(); toast(a.id ? 'Saved' : 'Subagent created'); }
      catch (e) { $('#agErr').textContent = e.message; el.disabled = false; }
    },
  });
  function on(el) { el.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === el)); }
  return b;
}
const READ_TOOLS = ['read_file', 'list_dir', 'grep', 'glob', 'web_fetch'];

/* skills */
async function skillsTab() {
  pbody('<p class="hint">Loading skills…</p>');
  try { S.skills = await api('GET', '/api/skills?' + cwdQ()); } catch (e) { return pbody(`<p class="err-text">${esc(e.message)}</p>`); }
  if (pageOn('skills')) drawSkills();
}
function drawSkills() {
  const { skills, claude } = S.skills;
  const group = src => {
    const list = skills.filter(x => x.source === src), [title, where] = SOURCES[src];
    const head = src === 'claude' ? `<div class="ghead"><div><h3>${title}</h3><p class="r2">${where}</p></div>${sw(claude, 'data-claude aria-label="Use Claude Code skills"')}</div>` : `<div class="ghead"><div><h3>${title}</h3><p class="r2">${where}</p></div></div>`;
    if (!list.length) return src === 'claude' ? '' : head + `<div class="empty-note">None yet.</div>`;
    return head + `<div class="rows${src === 'claude' && !claude ? ' dim' : ''}">${list.map(x => `<div class="row"><button class="rx" data-open="${esc(x.id)}"><span class="r1">${esc(x.name)}${x.shadowed ? ' <span class="tag">Hidden by another with this name</span>' : ''}</span><span class="r2">${esc(x.description || 'No description')}</span></button>${sw(x.enabled, `data-id="${esc(x.id)}" aria-label="Use ${esc(x.name)}"` + (src === 'claude' && !claude ? ' disabled' : ''))}</div>`).join('')}</div>`;
  };
  const on = skills.filter(x => x.enabled && !x.shadowed).length;
  pbody(`<p class="lead">Instructions for a kind of task. dsh sees each skill's name and description, and loads the full instructions when a task matches. ${on} in use.</p>
    <div class="group">${group('project')}</div><div class="group">${group('dsh')}</div>${skills.some(x => x.source === 'builtin') ? `<div class="group">${group('builtin')}</div>` : ''}${skills.some(x => x.source === 'claude') ? `<div class="group">${group('claude')}</div>` : ''}
    <div class="rowbtns"><button class="primary" id="skNew">${I.plus}New skill</button></div>`);
  const box = pbody();
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => skillSheet(b.dataset.open));
  box.querySelectorAll('.switch[data-id]').forEach(b => b.onclick = async () => { haptic(); try { S.skills = await api('PATCH', '/api/skills', { cwd: pageCwd(), id: b.dataset.id, enabled: !b.classList.contains('on') }); drawSkills(); } catch (e) { toast(e.message); } });
  box.querySelector('[data-claude]')?.addEventListener('click', async () => { haptic(); try { S.skills = await api('PATCH', '/api/skills', { cwd: pageCwd(), claude: !claude }); drawSkills(); } catch (e) { toast(e.message); } });
  $('#skNew').onclick = skillForm;
}
async function skillSheet(id) {
  let s; try { s = await api('GET', `/api/skills/read?${cwdQ()}&id=${encodeURIComponent(id)}`); } catch (e) { return toast(e.message); }
  const body = s.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const b = sheet(`<h3>${esc(s.name)}</h3><p class="hint" style="margin:-8px 0 12px">${esc(SOURCES[s.source][0])} · <code>${esc(short(s.file))}</code></p>
    ${s.description ? `<div class="kvs"><div class="kv"><span>Used when</span><b style="text-align:left">${esc(s.description)}</b></div></div>` : ''}
    <h4>Instructions</h4><div class="mdbox md" id="skBody"></div>
    <div class="rowbtns"><button class="secondary" data-a="toggle">${s.enabled ? 'Turn off' : 'Turn on'}</button>${s.enabled ? '<button class="primary" data-a="use">Use in chat</button>' : ''}</div>
    ${s.source === 'project' || s.source === 'dsh' ? `<button class="ghost-danger wide" data-a="del">${I.trash}Delete</button>` : ''}`, {
    use: () => askChat(`Use the ${s.name} skill. `),
    toggle: async () => { closeSheet(); try { S.skills = await api('PATCH', '/api/skills', { cwd: pageCwd(), id, enabled: !s.enabled }); drawSkills(); } catch (e) { toast(e.message); } },
    del: async () => { if (!confirm(`Delete the skill ${s.name}? This removes its folder.`)) return; closeSheet(); try { S.skills = await api('POST', '/api/skills/delete', { cwd: pageCwd(), id }); drawSkills(); toast('Deleted'); } catch (e) { toast(e.message); } },
  });
  renderMd(b.querySelector('#skBody'), body);
}
function skillForm() {
  let scope = 'dsh';
  sheet(`<h3>New skill</h3>
    <label class="field"><span>Name</span><input id="skName" placeholder="release-apk" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Use it when</span><input id="skDesc" placeholder="Building and shipping a new APK version"></label>
    <h4>Available in</h4>${seg('scope', [['dsh', 'All projects'], ['project', 'This project']], scope)}
    <label class="field" style="margin-top:16px"><span>Instructions</span><textarea id="skText" rows="9" placeholder="Steps, commands and rules dsh should follow. Markdown works."></textarea></label>
    <button class="primary wide" data-a="save">Create skill</button><div class="err-text" id="skErr"></div>`, {
    scope: el => { scope = el.dataset.v; el.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === el)); },
    save: async el => {
      el.disabled = true;
      try { S.skills = await api('POST', '/api/skills', { cwd: pageCwd(), scope, name: $('#skName').value, description: $('#skDesc').value, body: $('#skText').value }); closeSheet(); drawSkills(); toast('Skill created'); }
      catch (e) { $('#skErr').textContent = e.message; el.disabled = false; }
    },
  });
}

// Leave the page with a message started in the composer, for the user to finish or send.
// A draft already in the box stays: the prompt goes after it.
function askChat(text) { closeSheet(); closePage(); const d = input.value.trim(); input.value = d ? d + '\n\n' + text : text; grow(); syncSend(); local.set('draft', input.value); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }

/* memory */
async function memoryTab() {
  pbody('<p class="hint">Loading memory…</p>');
  let m; try { m = await api('GET', '/api/memory'); } catch (e) { return pbody(`<p class="err-text">${esc(e.message)}</p>`); }
  if (!pageOn('memory')) return;
  const TYPE = { user: 'About you', feedback: 'How to work', project: 'Project', reference: 'Reference' };
  // Index lines whose memory file is gone still go into every prompt: list them so they can be forgotten.
  const have = new Set(m.items.map(x => x.file)), orphans = [];
  for (const l of String(m.index || '').split('\n')) { const f = l.match(/\(([\w.-]+\.md)\)/)?.[1]; if (f && f !== 'MEMORY.md' && !have.has(f)) orphans.push({ file: f, line: l.replace(/^\s*[-*]\s*/, '') }); }
  pbody(`<p class="lead">What dsh remembers between sessions, kept in <code>~/.dsh/memory</code>. The index goes into every session; dsh reads a memory when it's relevant. It saves preferences, corrections and lasting facts as you work, using the dsh-memory-evolve skill.</p>
    ${m.items.length || orphans.length ? `<div class="rows">${m.items.map(x => `<button data-f="${esc(x.file)}"><span class="rx"><span class="r1">${esc(x.name)}</span><span class="r2">${esc(x.description || 'No description')}</span></span><span class="rv">${esc(TYPE[x.type] || x.type)}</span></button>`).join('')}${orphans.map(x => `<div class="row"><span class="rx"><span class="r1">${esc(x.file.replace(/\.md$/, ''))}</span><span class="r2">${esc(x.line)}</span><span class="r3">In the index, file missing</span></span><button class="secondary" data-orphan="${esc(x.file)}">Forget</button></div>`).join('')}</div>`
      : m.index ? '' : '<div class="empty-note">Nothing saved yet. Tell dsh something to remember, or correct how it works, and it lands here.</div>'}
    ${m.index ? `<h4>Index in every prompt</h4><pre class="ipre">${esc(m.index)}</pre>` : ''}
    <div class="rowbtns"><button class="secondary" id="memTidy">Tidy memory</button><button class="primary" id="memLearn">Learn from session</button></div>
    <p class="hint">Tidy merges duplicates and drops stale memories. Learn runs dsh-evolve: it reviews the session for mistakes and corrections and proposes skills, rules or memories before writing anything.</p>`);
  pbody().querySelectorAll('[data-f]').forEach(b => b.onclick = () => memorySheet(b.dataset.f));
  pbody().querySelectorAll('[data-orphan]').forEach(b => b.onclick = async () => { haptic(); try { await api('POST', '/api/memory/delete', { file: b.dataset.orphan }); toast('Forgotten'); } catch (e) { toast(e.message); } memoryTab(); });
  $('#memTidy').onclick = () => askChat('Use the dsh-memory-evolve skill to tidy my memory.');
  $('#memLearn').onclick = () => askChat('Use the dsh-evolve skill on this session.');
}
async function memorySheet(file) {
  let r; try { r = await api('GET', '/api/memory/read?file=' + encodeURIComponent(file)); } catch (e) { return toast(e.message); }
  const b = sheet(`<h3>${esc(file.replace(/\.md$/, ''))}</h3><p class="hint" style="margin:-8px 0 12px"><code>~/.dsh/memory/${esc(file)}</code></p><div class="mdbox md" id="memBody"></div>
    <button class="ghost-danger wide" data-a="del">${I.trash}Forget this</button>`, {
    del: async () => { if (!confirm('Forget this memory? dsh stops seeing it from the next step.')) return; closeSheet(); try { await api('POST', '/api/memory/delete', { file }); toast('Forgotten'); } catch (e) { toast(e.message); } memoryTab(); },
  });
  renderMd(b.querySelector('#memBody'), r.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''));
}

/* instruction files */
async function instructionsTab() {
  pbody('<p class="hint">Loading…</p>');
  let files; try { files = await api('GET', '/api/instructions?' + cwdQ()); } catch (e) { return pbody(`<p class="err-text">${esc(e.message)}</p>`); }
  if (!pageOn('instructions')) return;
  const label = { global: 'Every session', 'DSH.md': 'This project', 'AGENTS.md': 'This project, shared with other agents', 'CLAUDE.md': 'This project, Claude Code' };
  pbody(`<p class="lead">DeepSeek has no instructions file of its own, so dsh uses <b>DSH.md</b>: one in <code>~/.dsh</code> for every session, and one in each project. It also reads <b>AGENTS.md</b> and <b>CLAUDE.md</b>, the files other agents use, from the session's folder.</p>
    ${files.map((f, i) => `<div class="panel ifile${f.exists ? '' : ' missing'}"><div class="ihead2"><div><h3>${esc(f.name)}</h3><p class="r2">${esc(label[f.key])}</p></div><span class="pill">${f.exists ? 'Loaded · ' + kb(f.size) : 'Not created'}</span></div>
      <p class="fpath code">${esc(short(f.path))}</p>
      ${f.exists ? `<div class="md ipreview" data-p="${i}"></div>` : ''}
      <div class="rowbtns">${f.exists ? `<button class="secondary" data-more="${i}">Show all</button>` : ''}${f.editable ? `<button class="${f.exists ? 'secondary' : 'primary'}" data-edit="${i}">${f.exists ? I.pen + 'Edit' : I.plus + 'Create'}</button>` : `<span class="hint" style="margin:auto 0">${f.truncated ? 'Too large to edit here: use a text editor' : 'Read only here: Claude Code owns it'}</span>`}</div></div>`).join('')}
    <button class="secondary wide" id="sysBtn">${I.file}Full system prompt</button>`);
  const box = pbody();
  box.querySelectorAll('[data-p]').forEach(el => renderMd(el, files[+el.dataset.p].content));
  box.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { const p = box.querySelector(`[data-p="${b.dataset.more}"]`); p.classList.toggle('all'); b.textContent = p.classList.contains('all') ? 'Show less' : 'Show all'; });
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => instructionEditor(files[+b.dataset.edit]));
  $('#sysBtn').onclick = async () => {
    try { const r = await api('GET', '/api/system?' + (S.cur ? 'session=' + S.cur.id : cwdQ())); sheet(`<h3>System prompt</h3><p class="hint" style="margin:-8px 0 12px">What dsh sends ahead of the conversation, built fresh each step. ${kb(r.text.length)}.</p><pre class="ipre sys">${esc(r.text)}</pre>`); }
    catch (e) { toast(e.message); }
  };
}
function instructionEditor(f) {
  sheet(`<h3>${f.exists ? 'Edit' : 'Create'} ${esc(f.name)}</h3><p class="hint" style="margin:-8px 0 12px"><code>${esc(short(f.path))}</code></p>
    <textarea id="insText" class="editor" spellcheck="false" placeholder="${f.key === 'global' ? 'How you like dsh to work, in every project: tone, tools to prefer, things never to do.' : 'How to build, test and ship this project, and its conventions.'}">${esc(f.content)}</textarea>
    <div class="rowbtns"><button class="secondary" data-a="cancel">Cancel</button><button class="primary" data-a="save">Save</button></div><div class="err-text" id="insErr"></div>`, {
    cancel: closeSheet,
    save: async el => {
      el.disabled = true;
      // dsh (dsh-evolve) and other agents edit these files too: don't write over a change made since the editor opened.
      try { const now = (await api('GET', '/api/instructions?' + cwdQ())).find(x => x.key === f.key); if (now && (now.content || '') !== (f.content || '') && !confirm(`${f.name} changed on disk since you opened it. Save anyway and replace those changes?`)) { el.disabled = false; return; } } catch {}
      try { await api('PUT', '/api/instructions', { cwd: pageCwd(), key: f.key, content: $('#insText').value }); closeSheet(); toast(`${f.name} saved; dsh reads it from the next step`); instructionsTab(); }
      catch (e) { $('#insErr').textContent = e.message; el.disabled = false; }
    },
  });
}

/* ---------- drawer & sheets ---------- */
function drawer(on) { document.body.classList.toggle('drawer', on); $('#drawer').ariaHidden = !on; if (on) { refreshSessions(); refreshBalance(); } syncPreview(); }
document.querySelector('.brand').innerHTML = MARK + '<span>DSHA</span>';
$('#menuBtn').innerHTML = I.menu; $('#menuBtn').onclick = () => { haptic(); drawer(true); };
$('#moreBtn').innerHTML = I.more; $('#moreBtn').onclick = () => { haptic(); optionsSheet(); };
$('#fsBtn').onclick = () => { haptic(); setChatFull(!chatFull); };
$('#agentBtn').innerHTML = `${I.agents}<span class="rx"><span class="r1">Subagents, plugins and skills</span></span>${I.chev}`; $('#agentBtn').onclick = () => agentPage();
$('#pageBack').innerHTML = I.back; $('#pageBack').onclick = closePage;
$('#settingsBtn').innerHTML = I.gear; $('#settingsBtn').onclick = () => { drawer(false); settingsSheet(); };
$('#newBtn').innerHTML = I.plus + 'New session'; $('#newBtn').onclick = () => { drawer(false); newSession(); };
$('#newBtnWide').innerHTML = I.plus; $('#newBtnWide').onclick = () => { haptic(); newSession(); };
$('#scrim').onclick = () => { drawer(false); agSide(false); closeSheet(); };
$('#modeChip').onclick = () => { haptic(); modeSheet(); };
$('#meter').onclick = usageSheet; $('#meter').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); usageSheet(); } };
$('#balBtn').onclick = () => usagePage();
$('#cwdChip').onclick = () => S.cur && pickDir(S.cur.cwd, d => patch({ cwd: d }));

function sheet(html, actions = {}) {
  const b = $('#sheetBody'); b.innerHTML = html; $('#sheet').hidden = false; $('#sheet').dataset.k = ''; document.body.classList.add('sheet');
  b.querySelectorAll('[data-a]').forEach(el => el.addEventListener('click', e => { haptic(); actions[el.dataset.a]?.(el, e); }));
  syncPreview();
  return b;
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet'); syncPreview(); }
const seg = (name, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="${name}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

function modeSheet() {
  const cur = S.cur?.mode || S.cfg?.mode;
  sheet(`<h3>Permission mode</h3>${seg('m', Object.entries(MODES).map(([k, v]) => [k, v[0]]), cur)}<p class="hint">${Object.values(MODES).map(v => `<b>${v[0]}</b>: ${v[1]}.`).join('<br>')}</p>${S.cur?.allow?.length ? `<h4>Always allowed here</h4><div class="rows"><button data-a="reset">${I.x}<span>${esc(S.cur.allow.map(tname).join(', '))}</span></button></div><p class="hint">Tap to reset.</p>` : ''}`, {
    m: el => { closeSheet(); if (S.cur) patch({ mode: el.dataset.v }); else api('PUT', '/api/config', { mode: el.dataset.v }).then(c => { S.cfg = c; header(); }); },
    reset: () => { closeSheet(); patch({ allow: [] }); },
  });
}

// defaults: edit the config for new sessions even while a session is open (Settings > Defaults).
async function optionsSheet(defaults = false) {
  const s = defaults ? null : S.cur; const tgt = s || S.cfg; if (!tgt) return settingsSheet();
  const models = S.models || [{ id: tgt.model }];
  const b = sheet(`<h3>${s ? 'Session' : 'Defaults'}</h3>
    <h4>Model</h4>${seg('model', models.map(m => [m.id, modelName(m.id)]), tgt.model)}
    <h4>Thinking</h4>${seg('effort', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['max', 'Max']], tgt.thinking === false ? 'off' : tgt.effort)}
    <p class="hint">Flash is fast and cheap; Pro is stronger on hard problems. Higher thinking spends more tokens before acting.</p>
    <h4>Step limit</h4>${seg('steps', [[0, 'No limit'], [300, 300], [1000, 1000], [3000, 3000]], S.cfg?.maxSteps)}
    <p class="hint">With no limit a run goes on until it finishes, you stop it or your DeepSeek balance runs out. A step is often 5 to 10 seconds. Applies to every session, including a run in progress.</p>
    ${s ? `<h4>Session</h4><div class="rows">
      <button data-a="rename">${I.pen}<span>Rename</span></button>
      <button data-a="cwd">${I.folder}<span>${esc(short(s.cwd))}</span></button>
      <button data-a="compact">${I.retry}<span>Compact history</span></button>
      <button data-a="export">${I.share}<span>Share transcript</span></button>
      <button data-a="del" class="danger">${I.trash}<span>Delete session</span></button></div>` : ''}`, {
    model: el => set({ model: el.dataset.v }),
    effort: el => set(el.dataset.v === 'off' ? { thinking: false } : { thinking: true, effort: el.dataset.v }),
    steps: async el => { S.cfg = await api('PUT', '/api/config', { maxSteps: +el.dataset.v }); optionsSheet(defaults); },
    rename: () => { const t = prompt('Session name', s.title); if (t) { closeSheet(); patch({ title: t }); } },
    cwd: () => pickDir(s.cwd, d => patch({ cwd: d })),
    compact: () => { closeSheet(); compact(); },
    export: () => { closeSheet(); const t = transcript(); N ? N.share(t) : copy(t); },
    del: async () => { if (!confirm('Delete this session?')) return; closeSheet(); try { await api('DELETE', '/api/sessions/' + s.id); noSession(); emptyState(); refreshSessions(); } catch (e) { toast(e.message); } },
  });
  async function set(p) {
    if (s) await patch(p); else { S.cfg = await api('PUT', '/api/config', p); }
    optionsSheet(defaults);
  }
}
// Markdown of the session as it reads on screen: each tool with its outcome, a subagent's steps under its card.
function transcript() {
  const ST = { denied: ' · denied', fail: ' · failed', waiting: ' · waiting for approval', run: ' · running' };
  const code = t => { t = String(t ?? '').slice(0, 400); if (!/[\n`]/.test(t)) return t ? ` \`${t}\`` : ''; const f = '`'.repeat(Math.max(3, ...(t.match(/`+/g) || []).map(x => x.length + 1))); return `\n${f}\n${t}\n${f}`; };
  const line = (it, pre) => it.name === 'agent' ? `${pre}- **${agentLabel(it)}** subagent${it.args?.description ? ': ' + it.args.description : ''}${ST[it.status] || ''}`
    : `${pre}- ${tname(it.name)}${ST[it.status] || ''}:${code(it.summary).replace(/\n/g, '\n' + pre + '  ')}`;
  const out = [];
  for (const it of S.items) {
    if (it.kind === 'user') out.push(`**You:** ${it.text}`);
    else if (it.kind === 'text') out.push(it.text);
    else if (it.kind === 'tool' && !it.parent) out.push([line(it, ''), ...S.items.filter(x => x.parent === it.id).map(x => line(x, '  '))].join('\n'));
  }
  return `# ${S.cur.title}\n\n` + out.join('\n\n');
}

async function newSession() {
  const recents = [...new Set(S.sessions.map(x => x.cwd))].filter(d => !isTempDir(d)).slice(0, 5);
  let start = newStart();
  // The open session's or the default folder may have been deleted since; then start at home.
  if (start !== home()) try { await api('GET', '/api/fs?path=' + encodeURIComponent(start)); } catch { start = home(); }
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
  // A folder that is gone or unreadable (a deleted session folder, /data/data above Termux's home): step up to
  // the nearest one that opens, so the picker is always a way out.
  const go = async (p, climb) => {
    let r; try { r = await api('GET', `/api/fs?path=${encodeURIComponent(p)}${hidden ? '&hidden=1' : ''}`); }
    catch (e) { const up = p.replace(/\/+[^/]*\/*$/, '') || '/'; if (climb && up !== p) return go(up, climb); if (climb && climb !== 'home' && p !== home()) return go(home(), 'home'); return toast(e.message); } // a tapped subfolder that won't open: say so, stay put
    cur = r.path;
    sheet(`<h3>Choose folder</h3><div class="path">${esc(short(r.path))}</div><div class="rowbtns"><button class="secondary" data-a="hid">${hidden ? 'Hide' : 'Show'} hidden</button><button class="primary" data-a="use">Use this folder</button></div><h4>Folders</h4><div class="rows">${settings().standalone && !r.path.startsWith('/storage/emulated/0') ? `<button data-a="phone">${I.folder}<span>Phone storage</span></button>` : ''}${r.path !== '/' ? `<button data-a="up">${I.up}<span>..</span></button>` : ''}${r.dirs.map((d, i) => `<button data-a="d" data-i="${i}">${I.folder}<span>${esc(d)}</span></button>`).join('') || '<div class="hint" style="padding:14px 16px;margin:0">No subfolders</div>'}</div>`, {
      phone: () => settings().allFiles ? go('/storage/emulated/0') : toast('Allow all files in Settings first'),
      up: () => go(r.parent, true), d: el => go(r.path.replace(/\/$/, '') + '/' + r.dirs[+el.dataset.i]),
      hid: () => { hidden = !hidden; go(cur); }, use: () => { closeSheet(); done(cur); },
    });
  };
  go(cur, true);
}

let pairDone = null;
function pairTermux(cb) {
  if (!N) return cb(null, 'Pairing needs the Android app. Paste the token from `dsh token` instead.');
  pairDone = (ok, err) => { pairDone = null; cb(ok, err); };
  N.pairTermux();
}

async function settingsSheet() {
  const c = settings();
  const key = S.health?.hasKey;
  const sa = !!c.standalone, bi = sa && c.backend === 'builtin';
  const b = sheet(`<h3>Settings</h3>
    <h4>Backend</h4>${sa ? seg('backend', [['builtin', 'Built in'], ['termux', 'Termux']], c.backend) : ''}
    ${bi ? `<div class="kvs" style="margin-top:12px"><div class="kv"><span>dsh</span><b>${S.health ? esc(S.health.version) + ' in this app' : 'Not running'}</b></div><div class="kv"><span>Files</span><b>${c.allFiles ? 'All files allowed' : 'App storage only'}</b></div></div>
    <div class="rowbtns"><button class="secondary" data-a="restart">${I.retry}Restart dsh</button>${c.allFiles ? '' : '<button class="secondary" data-a="files">Allow all files</button>'}</div>
    <p class="hint">dsh runs inside DSHA with Android's own shell: no git, Python or packages. Switch to Termux for a full Linux toolbox.</p>` : `${sa ? '<div style="height:12px"></div>' : ''}
    <button class="primary wide" data-a="pair">${I.link}Pair with dsh in Termux</button>
    <p class="hint">Starts <code>dsh</code> in Termux and fetches its token. First time, Android asks to let DSHA run Termux commands.</p>
    <label class="field"><span>URL</span><input id="fUrl" value="${esc(c.url)}" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Token (<code>dsh token</code>)</span><input id="fTok" type="password" value="${esc(c.token)}" autocapitalize="off" spellcheck="false"></label>
    <button class="secondary wide" data-a="save">Save and reconnect</button>
    <div class="err-text" id="pairErr"></div>`}
    <h4>Appearance</h4>${seg('theme', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], local.get('theme') || 'system')}
    <h4>DeepSeek API key</h4>
    <div class="kvs"><div class="kv"><span>Status</span><b>${key ? 'Set on backend' : 'Not set'}</b></div><div class="kv"><span>Balance</span><b id="bal">${balHtml()}</b></div></div>
    <label class="field" style="margin-top:14px"><span>Replace key</span><input id="fKey" type="password" placeholder="sk-…" autocapitalize="off" spellcheck="false"></label>
    <button class="secondary wide" data-a="key">Verify and save key</button><p class="hint">${bi ? 'Stored only inside this app.' : 'Stored only on the backend, in <code>~/.config/deepseek/key</code>.'}</p>
    <h4>Defaults for new sessions</h4>
    <div class="rows"><button data-a="defs">${I.gear}<span>${esc(S.cfg ? `${modelName(S.cfg.model)} · ${S.cfg.thinking === false ? 'no thinking' : S.cfg.effort + ' thinking'} · ${MODES[S.cfg.mode]?.[0] || S.cfg.mode}` : 'Unknown')}</span></button><button data-a="dcwd">${I.folder}<span>${esc(short(S.cfg?.cwd || ''))}</span></button></div>
    ${N ? `<h4>Notifications</h4><button class="secondary wide" data-a="notif">Allow notifications</button><p class="hint">Get notified when a run finishes or needs approval while DSHA is in the background.</p><h4>Screen off</h4><div class="kvs"><div class="kv"><span>Battery</span><b>${N.batteryExempt?.() ? 'Unrestricted' : 'Optimised'}</b></div></div>${N.batteryExempt?.() ? '' : '<button class="secondary wide" data-a="battery">Let runs continue when locked</button>'}<p class="hint">During a run DSHA keeps the phone awake until dsh is idle. Android battery optimisation can still pause it; set DSHA${c.backend === 'builtin' ? '' : ' and Termux'} to Unrestricted.</p>` : ''}
    <h4>About</h4><div class="kvs"><div class="kv"><span>DSHA</span><b>${esc(c.version)}</b></div><div class="kv"><span>dsh</span><b>${esc(S.health?.version || 'Not connected')}</b></div></div><div class="rows" style="margin-top:10px"><button data-a="agent">${I.book}<span>Plugins, skills and instructions</span></button><button data-a="lic">${I.file}<span>Third-party licences</span></button></div>`, {
    backend: el => { if (el.dataset.v === c.backend) return; if (S.running && !confirm('Switching backend stops the current run. Switch anyway?')) return; haptic(); N?.setBackend(el.dataset.v); closeSheet(); noSession(); boot(); },
    restart: () => { haptic(); N?.restartBackend(); closeSheet(); toast('Restarting dsh'); setTimeout(boot, 2500); },
    files: () => N?.askAllFiles(),
    theme: el => { local.set('theme', el.dataset.v); applyTheme(); b.querySelectorAll('[data-a=theme]').forEach(x => x.classList.toggle('on', x === el)); },
    pair: el => { el.disabled = true; $('#pairErr').textContent = ''; pairTermux((ok, err) => { el.disabled = false; if (ok) { toast('Paired'); closeSheet(); boot(); } else $('#pairErr').textContent = err; }); },
    save: () => { saveSettings($('#fUrl').value.trim().replace(/\/+$/, ''), $('#fTok').value.trim()); closeSheet(); boot(); },
    key: async el => { const k = $('#fKey').value.trim(); if (!k) return; el.disabled = true; try { await api('PUT', '/api/key', { key: k }); toast('Key saved'); S.health = await api('GET', '/api/health'); settingsSheet(); } catch (e) { toast(e.message); el.disabled = false; } },
    defs: () => optionsSheet(true),
    dcwd: () => pickDir(S.cfg?.cwd, async d => { S.cfg = await api('PUT', '/api/config', { cwd: d }); toast('Default folder set'); }),
    battery: () => { N?.askBatteryExempt?.(); closeSheet(); },
    notif: () => N.askNotifications(),
    agent: () => agentPage(),
    lic: async () => { const t = await fetch('vendor/LICENSES.txt').then(r => r.text()); sheet(`<h3>Licences</h3><pre style="white-space:pre-wrap;font-size:11px;color:var(--muted)">${esc(t)}</pre>`); },
  });
  $('#sheet').dataset.k = 'settings'; $('#sheet').dataset.af = String(!!c.allFiles);
  refreshBalance(true);
}

/* ---------- Standalone first run: dsh starting inside the app, then the DeepSeek key ---------- */
let startTries = 0;
function startingUp(err) {
  // First start unpacks dsh and boots Node; give it about 15 s before calling it a failure.
  if (startTries++ < 20) { onboardScreen('Starting dsh…', 'The agent runs inside this app. The first start takes a few seconds.'); setTimeout(boot, 750); return; }
  startTries = 0;
  const logTail = N?.backendLog?.() || '';
  onboardScreen("dsh didn't start", err || 'No answer from the built-in backend.', `<button class="primary wide" id="obRestart">${I.retry}Restart dsh</button>${logTail ? `<pre class="oblog">${esc(logTail.slice(-1500))}</pre>` : ''}<button class="secondary wide" id="obTermux">Use dsh in Termux instead</button>`);
  $('#obRestart').onclick = () => { haptic(); N?.restartBackend(); setTimeout(boot, 2000); onboardScreen('Restarting dsh…', ''); };
  $('#obTermux').onclick = () => { haptic(); N?.setBackend('termux'); boot(); };
}
function onboardScreen(title, text, more = '') {
  log.textContent = ''; S.items = [];
  const e = $('#empty'); e.hidden = false;
  e.innerHTML = `<div class="onboard">${MARK.replace('class="mark"', 'class="mark big"')}<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${more}</div>`;
  header(); conn(false);
}
function keyScreen(e) {
  e.innerHTML = `<div class="onboard">${MARK.replace('class="mark"', 'class="mark big"')}<h2>Add your DeepSeek key</h2>
    <p>dsh works through your own DeepSeek account. Create an API key and add a few dollars of balance, then paste the key here. It stays inside this app.</p>
    <a class="secondary wide oblink" href="https://platform.deepseek.com/api_keys">${I.link}Open platform.deepseek.com</a>
    <label class="field"><span>API key</span><input id="obKey" type="password" placeholder="sk-…" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
    <button class="primary wide" id="obKeySave">Verify and save</button><div class="err-text" id="obKeyErr"></div></div>`;
  const save = async () => {
    const k = $('#obKey').value.trim(), b = $('#obKeySave'); if (!k) return;
    b.disabled = true; $('#obKeyErr').textContent = '';
    try { await api('PUT', '/api/key', { key: k }); S.health = await api('GET', '/api/health'); haptic(); toast('Key saved'); refreshBalance(true); emptyState(); }
    catch (er) { $('#obKeyErr').textContent = er.message; b.disabled = false; }
  };
  $('#obKeySave').onclick = save;
  $('#obKey').onkeydown = ev => { if (ev.key === 'Enter') save(); };
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
  if (settings().standalone) { const b = h('button', 'secondary wide', 'Use the built-in dsh'); b.onclick = () => { haptic(); N?.setBackend('builtin'); boot(); }; $('#obSet').after(b); }
  header(); conn(false);
}

// No session open: no stream, no run, an empty transcript.
function noSession() { S.close?.(); S.close = null; S.cur = null; fromMessages([]); setRunning(false); header(); meter(); }
async function boot() {
  try {
    S.health = await api('GET', '/api/health');
    S.cfg = await api('GET', '/api/config');
  } catch (e) {
    if (builtin()) return startingUp(e.message);
    return onboarding(settings().token ? e.message : '');
  }
  startTries = 0; conn(true); header(); refreshBalance(true);
  api('GET', '/api/models').then(r => { S.models = r.data; }).catch(() => {});
  await refreshSessions();
  // Standalone without a key: nothing works yet, so the key screen comes before any session.
  if (builtin() && !S.health.hasKey) { noSession(); emptyState(); return; }
  const lastId = local.get('last');
  const pick = S.sessions.find(x => x.id === lastId) || S.sessions[0];
  if (pick && Date.now() - pick.updated < 6 * 3600e3) await load(pick.id).catch(() => noSession());
  else noSession();
  emptyState();
  if (!S.health.hasKey && !builtin()) { add({ kind: 'notice', err: true, text: 'No DeepSeek API key on the backend yet. Add one in Settings.' }); emptyState(); }
}

/* ---------- subagents sidebar ---------- */
// Claude Code style: the session's subagents as one tree under dsh. Each agent keeps one identity
// (its initial on a pale tint, hues in order of first appearance, neighbours far apart) on its chat
// card, its row and its detail. Folded it is a panel from the right; unfolded, the Agents tab.
const AG_HUES = [214, 32, 152, 340, 56, 188];
const agHue = new Map(), agView = { sel: null, open: new Set() };
const subagents = () => S.items.filter(x => x.kind === 'tool' && x.name === 'agent');
const agSteps = it => S.items.filter(x => x.parent === it.id);
function agIdent(it) { const n = agentLabel(it); if (!agHue.has(n)) agHue.set(n, AG_HUES[agHue.size % AG_HUES.length]); return { n, hue: agHue.get(n) }; }
const agMono = (it, cls = '') => { const { n, hue } = agIdent(it); return `<span class="agm ${cls}" style="--h:${hue}" aria-hidden="true">${esc(n[0] || '?')}</span>`; };
const agState = it => it.status === 'waiting' || agSteps(it).some(x => x.status === 'waiting') ? 'need' : it.status || 'run';
const AG_STATE = { run: 'Working', need: 'Needs you', ok: 'Done', fail: 'Failed', denied: 'Denied' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function agMeta(it) {
  const steps = it.stats?.steps ?? (it.step != null ? it.step + 1 : 0), out = [];
  if (steps) out.push(plural(steps, 'step'));
  if (it.nTools) out.push(plural(it.nTools, 'tool'));
  if (it.ms != null) out.push(fmtMs(it.ms));
  return out.join(' · ');
}
const agLive = s => s === 'run' ? '<span class="livedot"></span>' : '';

function agentsHtml() {
  const list = subagents();
  if (agView.sel && !list.some(x => x.id === agView.sel)) agView.sel = null;
  if (agView.sel) return agDetailHtml(tool(agView.sel));
  const live = list.filter(x => x.status === 'run' || x.status === 'waiting').length;
  const root = `<div class="agroot"><span class="agnode${S.running ? ' run' : ''}"></span><span class="rx"><span class="r1">dsh</span><span class="r2">Main agent · ${esc(modelName(S.cur?.model || S.cfg?.model || 'deepseek-v4-pro'))}</span></span>
    <span class="agst${S.running ? ' run' : ''}"><span class="l1">${S.running ? live ? `Waiting on ${plural(live, 'agent')}` : 'Working' : 'Idle'}</span></span></div>`;
  const rows = list.map(it => { const s = agState(it); return `<button class="agrow" data-ag="${esc(it.id)}">${agMono(it)}<span class="rx"><span class="r1">${esc(agIdent(it).n)}</span><span class="r2">${esc(it.args?.description || '')}</span>${agMeta(it) ? `<span class="r2 r3">${esc(agMeta(it))}</span>` : ''}</span><span class="agst ${s}"><span class="l1">${agLive(s)}${AG_STATE[s]}</span></span></button>`; }).join('');
  return `<div class="ihead"><h2>Agents</h2>${list.length ? `<span class="pill">${plural(list.length, 'subagent')}</span>` : ''}</div>
    <div class="agtree${rows ? ' kids' : ''}">${root}${rows ? `<div class="agkids">${rows}</div>` : ''}</div>
    ${rows ? '' : '<p class="hint">No subagents in this session yet. dsh starts one when part of a task goes better in a fresh context, with its own tools and model.</p>'}
    <div class="rows agsaved"><button data-agsaved>${I.book}<span>Saved subagents</span>${I.chev}</button></div>`;
}
function agDetailHtml(it) {
  const a = it.args || {}, st = it.stats || {}, s = agState(it), steps = agSteps(it), meta = agMeta(it);
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const kv = [['Model', cap(modelName(st.model || a.model || S.cur?.model || 'inherit'))], a.tools && ['Tools', a.tools.map(tname).join(', ')], st.in != null && ['Tokens', `${k(st.in)} in · ${k(st.out)} out`]].filter(Boolean);
  const done = it.status && it.status !== 'run' && it.status !== 'waiting';
  return `<div class="agdhead"><button class="icon" data-agback aria-label="All agents">${I.back}</button>${agMono(it, 'big')}<div class="rx"><h2>${esc(agIdent(it).n)}</h2><span>${esc(a.description || '')}</span></div></div>
    <p class="agstate ${s}">${agLive(s)}${AG_STATE[s]}${meta ? ' · ' + esc(meta) : ''}</p>
    <div class="kvs agkv">${kv.map(([l, v]) => `<div class="kv"><span>${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="panel"><h3>Task</h3><div class="agtext">${esc(a.prompt || '')}</div>${a.role ? `<h3 class="agh">Role</h3><div class="agtext">${esc(a.role)}</div>` : ''}</div>
    ${steps.length ? `<div class="panel"><h3>Steps</h3><div class="agsteps">${steps.map(agStepHtml).join('')}</div></div>` : ''}
    ${done && it.content ? `<div class="panel"><h3>${s === 'ok' ? 'Report to dsh' : 'Result'}</h3><div class="md agreport"></div></div>` : ''}
    <div class="rowbtns"><button class="secondary" data-agchat>Show in chat</button></div>`;
}
function agStepHtml(x) {
  const st = x.status || 'run', open = agView.open.has(x.id), id = esc(x.id);
  return `<div class="agstep ${st}"><button data-step="${id}" aria-expanded="${open}">${TOOL_ICON[x.name] || I.term}<span class="tn">${esc(tname(x.name))}</span><span class="ts">${esc(x.summary || '')}</span><span class="st">${esc(statusText(x))}</span></button>`
    + (open ? `<pre class="ipre">${esc(tail(x.content ?? x.output ?? '', 4000)) || 'Running…'}</pre>` : '')
    + (st === 'waiting' ? `<div class="rowbtns"><button class="secondary" data-d="deny" data-sid="${id}">Deny</button><button class="secondary" data-d="always" data-sid="${id}">Always</button><button class="primary" data-d="allow" data-sid="${id}">Allow</button></div>` : '')
    + '</div>';
}
// Rebuilt only when something it shows has changed, so streaming text elsewhere never resets it.
const agSig = () => [agView.sel, [...agView.open].join(), S.running, ...subagents().map(it => [it.id, it.status, it.nTools, it.step, it.agent, ...agSteps(it).map(x => x.status + (agView.open.has(x.id) ? String(x.content ?? x.output ?? '').length : ''))].join())].join('|');
function renderAgents(box, force) {
  const sig = agSig(); if (!force && box.dataset.agsig === sig) return; box.dataset.agsig = sig;
  const keep = box.scrollTop; box.innerHTML = agentsHtml(); box.scrollTop = keep;
  const rep = box.querySelector('.agreport'); if (rep) renderMd(rep, tool(agView.sel)?.content);
  const go = sel => { haptic(); agView.sel = sel; renderAgents(box, true); box.scrollTop = 0; };
  box.querySelectorAll('[data-ag]').forEach(b => b.onclick = () => go(b.dataset.ag));
  box.querySelector('[data-agback]')?.addEventListener('click', () => go(null));
  box.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { haptic(); const id = b.dataset.step; agView.open.has(id) ? agView.open.delete(id) : agView.open.add(id); renderAgents(box, true); });
  box.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => { const t = tool(b.dataset.sid); if (t) decide(t, b.dataset.d); });
  box.querySelector('[data-agchat]')?.addEventListener('click', () => { haptic(); const t = tool(agView.sel); agSide(false); stick = false; t?.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  box.querySelector('[data-agsaved]')?.addEventListener('click', () => { agSide(false); agentPage(); });
}
function agSide(on) {
  if (on === document.body.classList.contains('agside')) return;
  document.body.classList.toggle('agside', on); $('#agside').ariaHidden = !on;
  if (on) renderAgents($('#agsideBody'), true);
  syncPreview();
}
function openAgents(id) {
  haptic(); agView.sel = id || null;
  if (layout.mode === 'wide') { if (chatFull) setChatFull(false); S.itab = 'agents'; $('#ibody').dataset.agsig = ''; ui(true); }
  else agSide(true);
}
// The top-bar button: shown once the session has a subagent, with the number still running.
function agBtn() {
  const list = subagents(), b = $('#agentsBtn'), live = list.filter(x => x.status === 'run' || x.status === 'waiting').length, need = list.some(x => agState(x) === 'need');
  b.hidden = !list.length;
  const sig = `${list.length}/${live}/${need}`; if (b.dataset.sig === sig) return; b.dataset.sig = sig;
  b.innerHTML = I.agents + (live ? `<span class="agbadge${need ? ' need' : ''}">${live}</span>` : '');
  b.ariaLabel = `Subagents: ${list.length}` + (live ? `, ${live} running` : '') + (need ? ', one needs you' : '');
}
$('#agentsBtn').onclick = () => openAgents();

/* ---------- foldable layout ---------- */
// Three modes. cover/phone: single column. wide (unfolded, or half-open like a
// book): chat in the pane left of the hinge, inspector on the right. tabletop
// (half-folded with the hinge horizontal, "Flex mode"): chat above the hinge,
// a control deck below it. The hinge comes from the native TYPE_HINGE_ANGLE
// sensor plus the screen centre (window.native.posture), or from the browser's
// Viewport Segments API when the WebView has it.
const layout = { mode: 'phone', angle: -1, cx: null, cy: null };
window.native.posture = (angle, cx, cy) => { Object.assign(layout, { angle, cx, cy }); relayout(); };

// Fullscreen chat: in wide mode the chat can take the pane the Inspector would
// use. The choice survives unfolding/folding; the button only exists in wide.
let chatFull = local.get('chatFull') === '1';
function paintFull() {
  const on = chatFull && layout.mode === 'wide';
  document.body.classList.toggle('chatfull', on);
  const b = $('#fsBtn');
  b.innerHTML = on ? I.shrink : I.expand;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', on ? 'Exit fullscreen chat' : 'Fullscreen chat');
}
function setChatFull(on) {
  chatFull = !!on; local.set('chatFull', chatFull ? '1' : '0'); paintFull();
  syncPreview();
  requestAnimationFrame(follow);
}
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
  paintFull();
  if (changed) { if (mode === 'wide') { if (document.body.classList.contains('agside')) { agSide(false); S.itab = 'agents'; } drawer(false); for (const t of S.items) t.el?.classList.remove('open'); } if (mode !== 'wide') S.sel = null; for (const t of S.items) if (t.kind === 'tool') paint(t); ui(true); requestAnimationFrame(follow); }
  syncPreview();
}
addEventListener('resize', relayout);
window.viewport?.addEventListener?.('segmentschange', relayout);

let uiQueued = false;
function ui(now) {
  if (now) return renderUI();
  if (!uiQueued) { uiQueued = true; requestAnimationFrame(() => { uiQueued = false; renderUI(); }); }
}
function renderUI() {
  agBtn(); if (document.body.classList.contains('agside')) renderAgents($('#agsideBody'));
  if (layout.mode === 'phone') return;
  if (layout.mode === 'wide') inspector(); else if (layout.mode === 'tabletop') deckLive(); syncPreview(); }

const waitingTool = () => S.items.find(x => x.kind === 'tool' && x.status === 'waiting');
const focusTool = () => S.items.find(x => x.id === S.sel) || waitingTool() || [...S.items].reverse().find(x => x.kind === 'tool');
const liveThink = () => { const l = [...S.items].reverse().find(x => x.kind !== 'notice'); return l?.kind === 'think' && l.live ? l : null; };
const tail = (t, n = 6000) => (t = String(t || ''), t.length > n ? '…' + t.slice(-n) : t);


/* ---------- preview pane ---------- */
// Preview is a real browser pane, not an iframe: the native side lays a second
// WebView (no bridge, http/https only) over #previewHost at the rect measured
// here. The HTML underneath is the toolbar, the empty state and the status line.
const preview = { url: '', title: '', loading: false, canBack: false, error: '', console: '' };
let previewUrl = local.get('previewUrl') || '';
const previewShown = () => S.itab === 'preview' && layout.mode === 'wide' && !chatFull;
const overlaysOpen = () => ['sheet', 'paged', 'drawer', 'agside'].some(c => document.body.classList.contains(c));
let pvRaf = 0;

function syncPreview() {
  if (pvRaf) cancelAnimationFrame(pvRaf);
  pvRaf = requestAnimationFrame(() => {
    pvRaf = 0;
    const host = $('#previewHost');
    if (!host || !previewUrl || !previewShown() || overlaysOpen()) { window.Native?.previewHide?.(); return; }
    const r = host.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) { window.Native?.previewHide?.(); return; }
    window.Native?.previewShow?.(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
  });
}

function renderPreviewBar() {
  const input = $('#pvUrl');
  if (input && document.activeElement !== input) input.value = preview.url || previewUrl;
  const st = $('#pvStatus');
  if (st) {
    if (preview.error) st.innerHTML = `<span class="pv-err">${esc(preview.error)}</span>`;
    else if (!(preview.url || previewUrl)) st.textContent = 'No page loaded';
    else st.textContent = (preview.title || preview.url || previewUrl) + (preview.loading ? ' · loading' : '');
  }
  const c = $('#pvConsole');
  if (c) c.textContent = preview.console;
}

function previewBody(box) {
  box.dataset.tab = 'preview';
  const u = preview.url || previewUrl;
  box.innerHTML = `
    <form id="pvForm" autocomplete="off">
      <input id="pvUrl" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="http://127.0.0.1:5173" aria-label="Preview URL" value="${esc(u)}">
      <button class="pill" type="submit">Go</button>
    </form>
    <div id="previewHost"><div class="pv-empty"><span class="pv-glyph">${I.globe}</span><b>Nothing loaded</b><span>A page you are building, or a local dev server. http and https only.</span></div></div>
    <div id="pvFoot"><span id="pvStatus"></span><button class="icon" id="pvReload" type="button" aria-label="Reload preview">${I.retry}</button><button class="icon" id="pvOut" type="button" aria-label="Open in browser">${I.link}</button></div>`;
  $('#pvForm').onsubmit = e => { e.preventDefault(); haptic(); openPreview($('#pvUrl').value); };
  $('#pvReload').onclick = () => { haptic(); if (!previewUrl) return; preview.loading = true; renderPreviewBar(); window.Native?.previewReload?.(); };
  $('#pvOut').onclick = () => { haptic(); const u = preview.url || previewUrl; if (!u) return; if (window.Native?.previewExternal) window.Native.previewExternal(u); else window.open(u, '_blank', 'noopener'); };
  renderPreviewBar();
  syncPreview();
}

// Pages on this phone or the local network, which a link tap should show in the pane rather than leave the app for.
const isLocalUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|[\w-]+\.local)$/.test(x.hostname); } catch { return false; } };
function showPreview(url) {
  if (chatFull) setChatFull(false);
  drawer(false); S.itab = 'preview'; ui(true);
  openPreview(url);
}
function openPreview(raw) {
  let u = String(raw || '').trim();
  if (!u) { preview.error = 'Enter a URL first.'; renderPreviewBar(); return; }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'http://' + u;
  let parsed = null;
  try { parsed = new URL(u); } catch {}
  if (!parsed || !/^https?:$/.test(parsed.protocol)) { preview.error = 'Only http and https pages can be previewed.'; renderPreviewBar(); return; }
  previewUrl = parsed.href; local.set('previewUrl', previewUrl);
  preview.error = ''; preview.loading = true; preview.title = ''; preview.console = '';
  renderPreviewBar();
  syncPreview();
  const ok = window.Native?.previewOpen?.(previewUrl);
  if (ok === false) { preview.error = 'That URL cannot be previewed.'; preview.loading = false; }
  else if (!window.Native) preview.loading = false; // browser: the pane is a placeholder
  renderPreviewBar();
}

window.native.previewState = (url, canBack, loading) => {
  if (url && /^https?:/i.test(url)) { preview.url = url; previewUrl = url; local.set('previewUrl', url); }
  preview.canBack = !!canBack; preview.loading = !!loading;
  if (!loading) preview.error = '';
  renderPreviewBar();
};
window.native.previewTitle = t => { preview.title = String(t || ''); renderPreviewBar(); };
window.native.previewError = e => { preview.error = String(e || ''); preview.loading = false; renderPreviewBar(); };
window.native.previewConsole = (msg, level) => {
  preview.console = String(level || '').toLowerCase().replace('consolemessagel', 'l') + ': ' + String(msg || '');
  preview.console = preview.console.length > 90 ? preview.console.slice(0, 89) + '…' : preview.console;
  renderPreviewBar();
};

// After a run, a local dev server has probably changed: reload it in place.
function reloadPreviewAfterRun() {
  if (!previewUrl || layout.mode !== 'wide' || S.itab !== 'preview') return;
  let host = '';
  try { host = new URL(previewUrl).hostname; } catch { return; }
  if (host === '127.0.0.1' || host === 'localhost') window.Native?.previewReload?.();
}

S.itab = 'activity';
function inspector() {
  const tabs = [['activity', I.activity, 'Activity'], ['agents', I.agents, 'Agents'], ['tasks', I.list, 'Tasks'], ['stats', I.chart, 'Session'], ['sessions', I.folder, 'Sessions'], ['preview', I.globe, 'Preview']];
  const nt = (S.todos || []).filter(x => x.status !== 'completed').length;
  const nav = $('#itabs');
  const na = subagents().filter(x => x.status === 'run' || x.status === 'waiting').length;
  const sig = S.itab + nt + !!waitingTool() + '/' + na;
  if (nav.dataset.sig !== sig) {
    nav.dataset.sig = sig;
    nav.innerHTML = tabs.map(([k, ic, l]) => `<button role="tab" data-t="${k}" class="${S.itab === k ? 'on' : ''}" aria-selected="${S.itab === k}">${l}${k === 'tasks' && nt ? `<span class="count">${nt}</span>` : ''}${k === 'agents' && na ? `<span class="count">${na} running</span>` : ''}${k === 'activity' && waitingTool() ? '<span class="count need">Needs you</span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { haptic(); S.itab = b.dataset.t; nav.dataset.sig = ''; inspector(); syncPreview(); });
    requestAnimationFrame(() => nav.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  const box = $('#ibody'), keepScroll = box.scrollTop, atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.classList.toggle('previewing', S.itab === 'preview');
  if (S.itab === 'agents') { if (box.dataset.tab !== 'agents') { box.dataset.tab = 'agents'; box.dataset.agsig = ''; } renderAgents(box); return; }
  if (S.itab === 'sessions') { if (box.dataset.tab !== 'sessions') { box.dataset.tab = 'sessions'; renderSessions(box); } return; }
  if (S.itab === 'preview') { if (box.dataset.tab !== 'preview' || !$('#previewHost')) previewBody(box); else renderPreviewBar(); return; }
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
  if (S.itab === 'stats') box.innerHTML = S.cur ? `<div class="ihead"><h2>${esc(S.cur.title)}</h2></div>` + statsHtml(S.cur) : '<div class="iempty">No session open.</div>';
}

// Usage dashboard: the Inspector's Session tab when unfolded, the Usage sheet (tap the meter) otherwise.
function statsHtml(s) {
  const u = s.usage || {}, inTok = (u.hit || 0) + (u.miss || 0), hitPct = inTok ? Math.round(100 * (u.hit || 0) / inTok) : 0;
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const tools = S.items.filter(x => x.kind === 'tool'), files = new Map();
  for (const t of tools) if (t.args?.path && /file|list_dir/.test(t.name)) files.set(t.args.path, t.name === 'read_file' || t.name === 'list_dir' ? (files.get(t.args.path) || 'read') : t.name === 'write_file' ? 'write' : 'edit');
  const ctx = u.lastPrompt || 0;
  return `<div class="panel"><h3>Context window</h3><div class="kpi" style="padding:0"><b style="margin:0">${k(ctx)}</b></div><div class="plan"><i style="width:${Math.min(100, 100 * ctx / 1048576)}%"></i></div><div class="planends"><span>${k(ctx)} used</span><span>1M</span></div></div>
    <div class="kpis"><div class="kpi"><span>Balance</span><b class="balv">${balHtml()}</b><small>DeepSeek account</small></div>
    ${spentExact(u) ? `<div class="kpi"><span>Spent</span><b>$${u.cost.toFixed(4)}</b><small>$${(u.costPeak || 0).toFixed(4)} at full price</small></div>`
      : `<div class="kpi"><span>Spent</span><b>$${(u.costOff || 0).toFixed(4)}–${(u.costPeak || 0).toFixed(4)}</b><small>${u.cost != null ? 'Partly before' : 'Before'} dsh 0.9.0: off-peak to full price</small></div>`}
    <div class="kpi"><span>Speed</span><b>${u.tps ? u.tps + ' tok/s' : 'None yet'}</b><small>${u.genMs ? `${Math.round(u.genOut / (u.genMs / 1000))} tok/s average` : 'Measured per model call'}</small></div>
    <div class="kpi"><span>Cache hits</span><b>${hitPct}%</b><small>${k(u.hit || 0)} of ${k(inTok)} in</small></div>
    <div class="kpi"><span>Tool calls</span><b>${tools.length}</b><small>${tools.filter(t => t.status === 'fail').length} failed · ${tools.filter(t => t.status === 'denied').length} denied</small></div>
    <div class="kpi"><span>Output</span><b>${k(u.out || 0)}</b><small>tokens written</small></div></div>
    <div class="panel"><h3>Session</h3><div class="kv"><span>Model</span><b>${esc(modelName(s.model))}</b></div><div class="kv"><span>Thinking</span><b>${s.thinking === false ? 'Off' : esc(cap(s.effort))}</b></div><div class="kv"><span>Mode</span><b>${esc(MODES[s.mode]?.[0] || s.mode)}</b></div><div class="kv"><span>Folder</span><b>${esc(short(s.cwd))}</b></div></div>
    ${files.size ? `<div class="panel"><h3>Files touched</h3><ul class="files">${[...files].map(([p, m]) => `<li><span>${esc(p)}</span><em>${m === 'read' ? 'Read' : m === 'write' ? 'Written' : 'Edited'}</em></li>`).join('')}</ul></div>` : ''}`;
}
function usageSheet() {
  if (!S.cur) return toast('Open a session to see its usage');
  haptic(); sheet(`<h3>Usage</h3>${statsHtml(S.cur)}<button class="secondary wide" data-a="all">All sessions and total spend</button>`, { all: () => usagePage() }); refreshBalance(true);
}

/* ---------- usage page: total spend, by day, by model, per session ---------- */
// dsh logs every model call with what it cost at that hour (peak or off-peak); sessions from before
// the ledger come back as an off-peak estimate, flagged as such.
const money = v => '$' + (v >= 10 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : '0');
const spent = x => (x.cost || 0) + (x.est || 0);
const ktok = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// DeepSeek's peak windows (01-04, 06-10 UTC, weekdays), as local times, and the next switch from now.
function peakClock(now = new Date()) {
  const peakAt = t => { const d = new Date(t), w = d.getUTCDay(), h = d.getUTCHours(); return w >= 1 && w <= 5 && (h >= 1 && h < 4 || h >= 6 && h < 10); };
  // On today's date, so the local offset (summer time or not) is the one in force now.
  const hm = (h, m = 0) => { const d = new Date(+now); d.setUTCHours(h, m, 0, 0); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const on = peakAt(+now); let t = Math.ceil(+now / 9e5) * 9e5; // look ahead in 15 min steps (some zones sit on :30)
  for (let i = 0; i < 7 * 96 && peakAt(t) === on; i++) t += 9e5;
  const at = new Date(t), sameDay = at.toDateString() === now.toDateString();
  const when = (sameDay ? '' : at.toLocaleDateString(undefined, { weekday: 'short' }) + ' ') + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { on, next: when, windows: [`${hm(1)}–${hm(4)}`, `${hm(6)}–${hm(10)}`] };
}
async function usagePage(tab = S.utab || 'overview') {
  S.utab = tab; S.ptab = 'usage'; drawer(false); closeSheet();
  const page = $('#page'); page.hidden = false; page.ariaLabel = 'Usage'; document.body.classList.add('paged'); syncPreview();
  $('#pageTitle').textContent = 'Usage'; $('#pageSub').textContent = S.usage ? 'Since ' + new Date(S.usage.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  $('#ptabs').innerHTML = [['overview', 'Overview'], ['sessions', 'Sessions']].map(([k, l]) => `<button role="tab" data-t="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}</button>`).join('');
  $('#ptabs').querySelectorAll('button').forEach(b => b.onclick = () => { haptic(); usagePage(b.dataset.t); });
  // Draw what is cached now (never leave the previous page's body, and its buttons, under this title), refresh after.
  $('#pbody').scrollTop = 0;
  if (S.usage) (tab === 'sessions' ? usageSessions : usageOverview)(S.usage); else pbody('<div class="iempty">Loading…</div>');
  refreshBalance(true);
  try { S.usage = await api('GET', '/api/usage'); } catch (e) { if (!S.usage) return pbody(`<div class="iempty">${esc(e.message)}</div>`); }
  if (!pageOn('usage') || S.utab !== tab) return;
  $('#pageSub').textContent = 'Since ' + new Date(S.usage.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  (tab === 'sessions' ? usageSessions : usageOverview)(S.usage);
}
function usageOverview(u) {
  const t = u.total, p = u.periods, c = peakClock(), max = Math.max(...u.days.map(spent), 1e-9);
  const peakShare = t.cost > 0 ? Math.round(t.peak / t.cost * 100) : null;
  const b = pbody(`<div class="ubody">
    <div class="kpis">
      <div class="kpi"><span>Total spent</span><b>${money(spent(t))}</b><small>${ktok(t.hit + t.miss)} in · ${ktok(t.out)} out</small></div>
      <div class="kpi"><span>Last 30 days</span><b>${money(spent(p.month))}</b><small>7 days: ${money(spent(p.week))}</small></div>
      <div class="kpi"><span>Today</span><b>${money(spent(p.today))}</b><small>${p.today.calls} model call${p.today.calls === 1 ? '' : 's'}</small></div>
      <div class="kpi"><span>Balance</span><b class="balv">${balHtml()}</b><small>DeepSeek account</small></div>
    </div>
    <div class="panel"><h3>Pricing now</h3>
      <div class="kv"><span>${c.on ? 'Peak now' : 'Off-peak now'}</span><b>${c.on ? 'Half price' : 'Full price'} at ${esc(c.next)}</b></div>
      <div class="kv"><span>Peak hours</span><b>${c.windows.map(w => `<span class="nw">${esc(w)}</span>`).join(' and ')}</b></div>
      ${peakShare != null ? `<div class="kv"><span>Spend at peak rates</span><b>${peakShare}%</b></div>` : ''}
    </div>
    <div class="panel"><h3>Daily spend, last 30 days</h3>
      <div class="ubars">${u.days.map((d, i) => `<button data-i="${i}" aria-label="${esc(dayLabel(d.day))}: ${money(spent(d))}${d.est > 0 ? ', estimated' : ''}"${i === u.days.length - 1 ? ' class="sel" aria-pressed="true"' : ' aria-pressed="false"'}><i style="height:${spent(d) > 0 ? Math.max(3, spent(d) / max * 100) : 0}%"></i></button>`).join('')}</div>
      <div class="uaxis"><span>${esc(dayLabel(u.days[0].day))}</span><span>Today</span></div>
      <div class="ucap" id="ucap"></div>
    </div>
    <div class="panel"><h3>By model</h3>${u.models.map(m => `<div class="kv"><span>${esc(modelName(m.model))}</span><b>${money(spent(m))} · ${ktok(m.hit + m.miss + m.out)} tokens</b></div>`).join('') || '<div class="hint">No model calls yet.</div>'}</div>
    ${t.est > 0 ? `<p class="hint">${money(t.est)} of this is estimated: sessions from before dsh 0.9.0 kept only their totals, so that part is priced at off-peak rates. From now on every call is logged at the rate of its hour.</p>` : ''}
  </div>`);
  const cap = i => { const d = u.days[i]; b.querySelector('#ucap').innerHTML = `<b>${esc(dayLabel(d.day))}</b> ${money(spent(d))}${d.est > 0 ? ' (estimated)' : ''} · ${d.calls} call${d.calls === 1 ? '' : 's'} · ${ktok(d.out)} out`; };
  // A bar is a few px wide on the cover screen: the whole strip is the target, a touch picks the nearest day and a drag scrubs.
  const strip = b.querySelector('.ubars'), btns = [...strip.children];
  const pick = i => { if (btns[i].classList.contains('sel')) return; haptic(); for (const y of btns) { y.classList.toggle('sel', y === btns[i]); y.ariaPressed = String(y === btns[i]); } cap(i); };
  const at = e => { const r = strip.getBoundingClientRect(); pick(Math.max(0, Math.min(btns.length - 1, Math.floor((e.clientX - r.left) / r.width * btns.length)))); };
  strip.onpointerdown = e => { at(e); strip.setPointerCapture?.(e.pointerId); };
  strip.onpointermove = e => { if (e.buttons) at(e); };
  btns.forEach((x, i) => x.onclick = () => pick(i)); // keyboard and TalkBack
  cap(u.days.length - 1);
}
function usageSessions(u) {
  const by = S.usort || 'recent';
  const list = [...u.sessions].sort(by === 'cost' ? (a, b) => spent(b) - spent(a) : (a, b) => b.updated - a.updated);
  const top = Math.max(...list.map(spent), 1e-9);
  const b = pbody(`<div class="ubody">${seg('sort', [['recent', 'Recent'], ['cost', 'Most spent']], by)}
    <div class="ulist">${list.map((x, i) => `<div class="urow${S.uopen === x.id ? ' open' : ''}" data-i="${i}"><button class="uhead" aria-expanded="${S.uopen === x.id}"><span class="rx"><span class="r1">${esc(x.title)}</span><span class="r2">${esc(new Date(x.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} · ${x.turns} turn${x.turns === 1 ? '' : 's'} · ${ktok(x.hit + x.miss + x.out)} tokens${x.running ? ' · running' : ''}</span><span class="ushare" aria-hidden="true"><i style="width:${spent(x) / top * 100}%"></i></span></span><b>${x.est > 0 && !x.cost ? '≈' : ''}${money(spent(x))}</b></button>
      ${S.uopen === x.id ? `<div class="udetail"><div class="kv"><span>Input</span><b>${ktok(x.hit + x.miss)} · ${x.hit + x.miss ? Math.round(x.hit / (x.hit + x.miss) * 100) : 0}% cache hits</b></div><div class="kv"><span>Output</span><b>${ktok(x.out)}${x.reasoning ? ` · ${ktok(x.reasoning)} reasoning` : ''}</b></div><div class="kv"><span>Model calls</span><b>${x.calls || 'Not logged'}</b></div>${x.cost > 0 ? `<div class="kv"><span>At peak rates</span><b>${money(x.peak)}</b></div>` : ''}${x.est > 0 ? `<div class="kv"><span>Estimated</span><b>${money(x.est)}, before logging</b></div>` : ''}${x.cwd ? `<div class="kv"><span>Folder</span><b class="path">${esc(short(x.cwd))}</b></div>` : ''}${x.deleted ? '' : '<button class="secondary wide" data-a="open">Open session</button>'}</div>` : ''}</div>`).join('') || '<div class="iempty">No sessions yet.</div>'}</div></div>`);
  b.querySelectorAll('[data-a="sort"]').forEach(x => x.ariaPressed = String(x.dataset.v === by));
  b.querySelectorAll('[data-a="sort"]').forEach(x => x.onclick = () => { haptic(); S.usort = x.dataset.v; usageSessions(u); });
  b.querySelectorAll('.urow').forEach(r => {
    const x = list[+r.dataset.i];
    r.querySelector('.uhead').onclick = () => { haptic(); S.uopen = S.uopen === x.id ? null : x.id; usageSessions(u); };
    const o = r.querySelector('[data-a="open"]'); if (o) o.onclick = () => { haptic(); closePage(); load(x.id); };
  });
}

/* ---------- account balance: on boot, after each run, and whenever a view of it opens ---------- */
let balAt = 0;
async function refreshBalance(force) {
  if (!force && Date.now() - balAt < 20000) return; balAt = Date.now();
  try { const r = await api('GET', '/api/balance'); S.balance = (r.balance_infos || []).map(x => `${x.total_balance} ${x.currency}`).join(', ') || 'Unknown'; }
  catch { S.balance = S.balance || 'Unavailable'; }
  $('#balBtn').innerHTML = `<span>Balance</span><b>${esc(S.balance)}</b>`;
  document.querySelectorAll('.balv, #bal').forEach(e => { e.innerHTML = balHtml(); });
}
// Each amount with its currency on one line ("1234.56 USD" never splits).
const balHtml = () => esc(S.balance || '…').split(', ').map(x => `<span class="nw">${x}</span>`).join(', ');

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
