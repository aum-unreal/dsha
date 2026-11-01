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

const PID = path.join(HOME, 'dsh.pid'), LOG = path.join(HOME, 'dsh.log');
const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const base = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`;

const alive = () => { try { const p = +fs.readFileSync(PID, 'utf8'); process.kill(p, 0); return p; } catch { return 0; } };
async function call(method, p, body) {
  const r = await fetch(base + p, { method, headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
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
    const bye = () => { try { if (+fs.readFileSync(PID, 'utf8') === process.pid) fs.rmSync(PID); } catch {} process.exit(0); };
    process.on('SIGTERM', bye); process.on('SIGINT', bye);
    break;
  }
  case 'start': await start(); console.log(`dsh running on ${base} (pid ${alive()})`); break;
  case 'stop': { const p = alive(); if (p) { process.kill(p, 'SIGTERM'); console.log('stopped', p); } else console.log('not running'); break; }
  case 'restart': { const p = alive(); if (p) { process.kill(p, 'SIGTERM'); await new Promise(r => setTimeout(r, 500)); } await start(); console.log(`dsh restarted (pid ${alive()})`); break; }
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
    if (!k) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); k = await new Promise(r => rl.question('DeepSeek API key: ', r)); rl.close(); }
    writeKey(k); console.log('saved'); break;
  }
  case 'ls': { await start(); for (const s of await call('GET', '/api/sessions')) console.log(`${s.id}  ${new Date(s.updated).toISOString().slice(0, 16)}  ${s.cwd}  ${s.title}`); break; }
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
  let after = s.live?.seq || 0, busy = false, mode = '', ctrl;
  const listen = async () => {
    ctrl = new AbortController();
    const r = await fetch(`${base}/api/sessions/${s.id}/events?after=${after}`, { headers: { authorization: 'Bearer ' + cfg.token }, signal: ctrl.signal });
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
      case 'reasoning': put('r', dim(ev.d)); break;
      case 'text': put('t', ev.d); break;
      case 'tool_call': put('', `\n${cyan('● ' + ev.name)} ${dim(String(ev.summary).slice(0, 300))}\n`); break;
      case 'tool_output': break;
      case 'tool_result': put('', dim((ev.ok ? '  ✓ ' : '  ✗ ') + ev.content.split('\n').slice(0, 6).join('\n    ').slice(0, 600)) + '\n'); break;
      case 'approval':
        rl.question(`${cyan('?')} allow ${ev.name}: ${ev.summary}  [y]es / [a]lways / [n]o › `, a => call('POST', `/api/sessions/${s.id}/approve`, { id: ev.id, decision: /^a/i.test(a) ? 'always' : /^y/i.test(a) ? 'allow' : 'deny' }));
        break;
      case 'usage': break;
      case 'notice': put('', dim(`\n[${ev.text}]\n`)); break;
      case 'error': put('', red(`\n${ev.message}\n`)); break;
      case 'run_end': { busy = false; const u = ev.total; put('', dim(`\n[${ev.reason}]\n`)); rl.prompt(); break; }
    }
  };
  listen().catch(() => {});
  process.on('SIGINT', () => { if (busy) call('POST', `/api/sessions/${s.id}/stop`); else process.exit(0); });
  rl.prompt();
  rl.on('line', async line => {
    const t = line.trim(); if (!t) return rl.prompt();
    try {
      if (t === '/quit' || t === '/exit') process.exit(0);
      if (t === '/stop') { await call('POST', `/api/sessions/${s.id}/stop`); return; }
      if (t === '/compact') { await call('POST', `/api/sessions/${s.id}/compact`); console.log(dim('compacted')); return rl.prompt(); }
      const m = t.match(/^\/(mode|model|effort)\s+(\S+)/);
      if (m) { await call('PATCH', `/api/sessions/${s.id}`, { [m[1]]: m[2] }); console.log(dim(`${m[1]} = ${m[2]}`)); return rl.prompt(); }
      if (busy) { console.log(dim('busy — /stop first')); return; }
      busy = true; mode = '';
      await call('POST', `/api/sessions/${s.id}/messages`, { text: t });
    } catch (e) { busy = false; console.log(red(e.message)); rl.prompt(); }
  });
}
