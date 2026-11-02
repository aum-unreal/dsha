#!/usr/bin/env node
// dsh — DeepSeek harness. Backend for the DSHA app, plus a terminal client
// that shares the same sessions.
//   dsh serve            run the server in the foreground
//   dsh start|stop|status|restart   manage it in the background (pid in ~/.dsh/dsh.pid)
//   dsh token            print the app pairing token
//   dsh key [sk-…]       set the DeepSeek API key (prompts if omitted)
//   dsh [-c] [dir]       terminal chat in dir (-c continues the latest session there)
//   dsh ls               list sessions
//   dsh mcp [reload]     MCP servers from ~/.dsh/mcp.json: state and tool counts
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, writeKey, readKey, HOME } from './lib/store.mjs';
import { createServer, VERSION } from './lib/server.mjs';
// A stray rejection is logged, not fatal: dsh serves every session from one process.
process.on('unhandledRejection', e => console.error('dsh: unhandled rejection:', e));

const PID = path.join(HOME, 'dsh.pid'), LOG = path.join(HOME, 'dsh.log');
const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const base = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`;

// The pid file can outlive dsh (SIGKILL, OOM kill, crash) and its pid be reused by another Termux process,
// so a pid only counts when that process really is `dsh.mjs serve`.
const isDsh = p => { try { const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0'); return a.some(x => x.endsWith('dsh.mjs')) && a.includes('serve'); } catch { return false; } };
const alive = () => { let p = 0; try { p = +fs.readFileSync(PID, 'utf8'); process.kill(p, 0); } catch { return 0; } return p && isDsh(p) ? p : 0; };
async function call(method, p, body) {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}
// The running server's pid: the pid file, else what /api/health reports (both checked to be dsh).
const dshPid = async () => alive() || await call('GET', '/api/health').then(h => h.pid && isDsh(h.pid) ? h.pid : 0, () => 0);
// SIGTERM, then SIGKILL if it is still there after 5 s; throws if even that doesn't end it.
async function kill(p) {
  const gone = async ms => { for (let i = 0; i < ms / 100; i++) { try { process.kill(p, 0); } catch { return true; } await new Promise(r => setTimeout(r, 100)); } return false; };
  process.kill(p, 'SIGTERM'); if (await gone(5000)) return;
  console.error(`dsh (pid ${p}) did not exit on SIGTERM; killing it`);
  try { process.kill(p, 'SIGKILL'); } catch {} if (!(await gone(3000))) throw new Error(`could not stop dsh (pid ${p})`);
}
async function up() { try { await call('GET', '/api/health'); return true; } catch { return false; } }
async function start() {
  if (await up()) return;
  fs.mkdirSync(HOME, { recursive: true });
  const out = fs.openSync(LOG, 'a');
  const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, stdio: ['ignore', out, out] });
  p.unref();
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100));
  if (!(await up())) throw new Error('dsh did not start; see ' + LOG);
}

switch (cmd) {
  case 'serve': {
    const srv = createServer();
    srv.listen(cfg.port, cfg.host, () => {
      fs.writeFileSync(PID, String(process.pid));
      console.log(`${new Date().toISOString()} dsh ${VERSION} listening on ${cfg.host}:${cfg.port}${readKey() ? '' : ' (no API key yet)'}`);
    });
    const clean = () => { try { if (+fs.readFileSync(PID, 'utf8') === process.pid) fs.rmSync(PID); } catch {} };
    process.on('exit', clean); process.on('SIGTERM', () => process.exit(0)); process.on('SIGINT', () => process.exit(0));
    break;
  }
  case 'start': await start(); console.log(`dsh running on ${base} (pid ${alive()})`); break;
  case 'stop': { const p = await dshPid(); if (p) { await kill(p); console.log('stopped', p); } else console.log('not running'); break; }
  case 'restart': { const p = await dshPid(); if (p) await kill(p); await start(); console.log(`dsh restarted (pid ${alive()})`); break; }
  case 'status': { const ok = await up(); console.log(ok ? `running on ${base} pid ${alive()}` : 'not running'); if (ok) console.log(await call('GET', '/api/health')); break; }
  case 'token': console.log(cfg.token); break;
  case 'mcp': {
    await start();
    const list = rest[0] === 'reload' ? await call('POST', '/api/mcp/reload') : await call('GET', '/api/mcp');
    if (!list.length) console.log('no MCP servers configured (' + path.join(HOME, 'mcp.json') + ')');
    for (const s of list) console.log(`${s.name.padEnd(12)} ${s.transport.padEnd(6)} ${s.state.padEnd(10)} ${s.state === 'up' ? s.tools + ' tools' + (s.server ? ` (${s.server.name} ${s.server.version || ''})` : '') : s.error || ''}`);
    break;
  }
  case 'url': console.log(base); break;
  case 'key': {
    let k = rest[0];
    if (!k) {
      // Typed without echo; an empty answer keeps the saved key.
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY }), q = 'DeepSeek API key: ';
      if (process.stdin.isTTY) rl._writeToOutput = t => { if (t.startsWith(q) || t.includes('\n')) process.stdout.write(t.startsWith(q) ? q : '\n'); };
      k = await new Promise(r => { rl.question(q, r); rl.on('close', () => r('')); }); rl.close();
    }
    k = String(k || '').trim();
    if (!k) { console.log('unchanged'); break; }
    if (!/^sk-[\w-]{10,}$/.test(k)) { console.error('That does not look like a DeepSeek key (sk-…); unchanged'); process.exitCode = 1; break; }
    writeKey(k); console.log('saved'); break;
  }
  case 'ls': {
    await start();
    for (const s of await call('GET', '/api/sessions')) { const d = new Date(s.updated || s.created || NaN); console.log(`${s.id}  ${isNaN(d) ? '?'.padEnd(16) : d.toISOString().slice(0, 16)}  ${s.cwd ?? '?'}  ${s.title ?? ''}`); }
    break;
  }
  case '-h': case '--help': case 'help': console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); break;
  default: await chat(cmd === '-c' ? rest[0] : cmd, cmd === '-c');
}

async function chat(dir, cont) {
  await start();
  const cwd = path.resolve(dir || process.cwd());
  let s = cont ? (await call('GET', '/api/sessions')).find(x => x.cwd === cwd) : null;
  s = s ? await call('GET', '/api/sessions/' + s.id) : await call('POST', '/api/sessions', { cwd });
  const dim = t => `\x1b[2m${t}\x1b[0m`, cyan = t => `\x1b[36m${t}\x1b[0m`, red = t => `\x1b[31m${t}\x1b[0m`;
  console.log(dim(`dsh ${VERSION} · ${s.model} · ${s.mode} · ${cwd} · session ${s.id}\n/stop /mode ask|edits|auto /model <name> /compact /quit`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' });
  // Joining a run in progress replays it from its start, so its output so far and any open approval show.
  let after = 0, busy = false, mode = '', closed = false, boot = null;
  // Events up to replayTo are a replay of what already happened: of its approvals only the ones still open are asked.
  let replayTo = 0, open = new Set();
  const prompt = () => { if (!closed) rl.prompt(); };
  // Approvals waiting on this client, oldest first. Only one readline question can be open at a time; it is
  // withdrawn when the approval is decided elsewhere (the app, a stop, the run's end).
  const asks = []; let asking = null;
  const decide = (ev, decision) => call('POST', `/api/sessions/${s.id}/approve`, { id: ev.id, decision })
    .then(r => { if (!r.ok) put('', dim('\n[that approval was already decided]\n')); }, e => put('', red(`\n${e.message}\n`)));
  const ask = () => {
    // With input gone (Ctrl-D, the end of a piped script) nobody can answer: deny, so the run can end.
    if (closed) { if (asking) { asking.ac.abort(); asking = null; } for (const ev of asks.splice(0)) { put('', dim(`\n[no input left: denied ${ev.name}]\n`)); decide(ev, 'deny'); } return; }
    if (asking || !asks.length) return;
    const ev = asking = asks[0], ac = new AbortController(); ev.ac = ac;
    rl.question(`${cyan('?')} allow ${ev.name}: ${ev.summary}  [y]es / [a]lways / [n]o › `, { signal: ac.signal }, a => {
      asks.shift(); asking = null;
      decide(ev, /^a/i.test(a) ? 'always' : /^y/i.test(a) ? 'allow' : 'deny');
      ask();
    });
  };
  const drop = id => {
    const i = id == null ? 0 : asks.findIndex(x => x.id === id); if (i < 0) return;
    const gone = id == null ? asks.splice(0) : asks.splice(i, 1);
    if (gone.includes(asking)) { asking.ac.abort(); asking = null; ask(); }
  };
  // Server identity: after a restart the event seqs start again from 1, so the stream is read from 0.
  const sync = async () => {
    const h = await call('GET', '/api/health'), snap = await call('GET', '/api/sessions/' + s.id);
    if (boot !== h.boot) { if (boot) { drop(); put('', dim('\n[dsh restarted]\n')); } after = snap.live.running ? snap.live.fromSeq : boot ? 0 : snap.live.seq; boot = h.boot; }
    replayTo = snap.live.seq; open = new Set(snap.live.waiting);
    if (busy && !snap.live.running && after >= snap.live.seq) { busy = false; prompt(); }
    busy ||= snap.live.running;
    if (closed && !busy) process.exit(0);
  };
  const listen = async () => {
    const r = await fetch(`${base}/api/sessions/${s.id}/events?after=${after}`, { headers: { authorization: 'Bearer ' + cfg.token } });
    if (!r.ok) throw Object.assign(new Error(`events: ${r.status}`), { status: r.status });
    let buf = ''; const dec = new TextDecoder();
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find(l => l.startsWith('data: ')); if (!line) continue;
        const ev = JSON.parse(line.slice(6)); after = ev.seq; show(ev);
      }
    }
  };
  const put = (m, t) => { if (mode !== m) { process.stdout.write('\n'); mode = m; } process.stdout.write(t); };
  const show = ev => {
    switch (ev.type) {
      case 'run_start': busy = true; break;
      case 'reasoning': put('r', dim(ev.d)); break;
      case 'text': put('t', ev.d); break;
      case 'tool_call': put('', `\n${cyan('● ' + ev.name)} ${dim(String(ev.summary).slice(0, 300))}\n`); break;
      case 'tool_output': break;
      case 'tool_result': put('', dim((ev.ok ? '  ✓ ' : '  ✗ ') + String(ev.content).split('\n').slice(0, 6).join('\n    ').slice(0, 600)) + '\n'); break;
      case 'approval': if ((ev.seq > replayTo || open.has(ev.id)) && !asks.some(x => x.id === ev.id)) { asks.push(ev); ask(); } break;
      case 'approval_done': drop(ev.id); break;
      case 'usage': break;
      case 'notice': put('', dim(`\n[${ev.text}]\n`)); break;
      case 'queued': put('', dim(`\n[queued, read after this step: ${ev.text.slice(0, 120)}]\n`)); break;
      case 'steer': put('', dim('\n[dsh read your queued message]\n')); break;
      case 'unqueued': if (ev.returned) put('', dim(`\n[not sent, the run ended: ${ev.text}]\n`)); break;
      case 'error': put('', red(`\n${ev.message}\n`)); break;
      case 'run_end': { busy = false; drop(); put('', dim(`\n[${ev.reason}]\n`)); if (closed) process.exit(0); prompt(); break; }
    }
  };
  // The stream ends when dsh restarts or dies: say so, and reattach (with backoff) once it answers again.
  (async () => {
    for (let fails = 0; ; ) {
      // A deleted session (404) or a changed token (401) won't come back by retrying.
      try { await sync(); fails = 0; await listen(); } catch (e) { if (e.status === 404 || e.status === 401) { put('', red(`\n${e.status === 404 ? 'This session was deleted.' : 'dsh refused the token: ' + e.message}\n`)); process.exit(1); } }
      if (fails++ === 0) put('', dim('\n[lost the connection to dsh; reconnecting…]\n'));
      await new Promise(r => setTimeout(r, Math.min(5000, 500 * fails)));
    }
  })();
  // Ctrl-C stops a run, and quits when idle. On a terminal readline gets it (raw mode), not the process.
  const interrupt = () => { if (busy) { put('', dim('\n[stopping]\n')); call('POST', `/api/sessions/${s.id}/stop`).catch(() => {}); } else process.exit(0); };
  rl.on('SIGINT', interrupt); process.on('SIGINT', interrupt);
  // End of input (Ctrl-D, a piped script) quits once the run in progress has ended.
  rl.on('close', () => { closed = true; if (!busy) process.exit(0); ask(); });
  prompt();
  rl.on('line', async line => {
    const t = line.trim(); if (!t) return prompt();
    try {
      if (t === '/quit' || t === '/exit') process.exit(0);
      if (t === '/stop') { await call('POST', `/api/sessions/${s.id}/stop`); return; }
      if (t === '/compact') { await call('POST', `/api/sessions/${s.id}/compact`); console.log(dim('compacted')); return prompt(); }
      const m = t.match(/^\/(mode|model|effort)\s+(\S+)/);
      if (m) { await call('PATCH', `/api/sessions/${s.id}`, { [m[1]]: m[2] }); console.log(dim(`${m[1]} = ${m[2]}`)); return prompt(); }
      // Mid-run it is queued and read after the current step (live steering).
      busy = true; mode = '';
      await call('POST', `/api/sessions/${s.id}/messages`, { text: t });
    } catch (e) { busy = false; console.log(red(e.message)); prompt(); }
  });
}
