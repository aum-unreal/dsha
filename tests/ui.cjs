// Browser test of the web UI against a real dsh server and a scripted mock model.
// Reuses Folio's Playwright + Mesa launcher. Writes tests/ui-*.png.
if (process.platform === 'android') Object.defineProperty(process, 'platform', { value: 'linux' });
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('../../folio/node_modules/playwright');
const launch = require('../../folio/tests/gpu-launch.cjs');
const root = path.resolve(__dirname, '../assets'), shot = n => path.join(__dirname, `ui-${n}.png`);
const STATIC = 8796, DSH = 8797, MOCK = 8798;

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dsha-ui-'));
const work = path.join(tmp, 'project'); fs.mkdirSync(path.join(work, 'src'), { recursive: true });
fs.writeFileSync(path.join(work, 'README.md'), '# demo\n');
fs.mkdirSync(path.join(tmp, 'home'));
fs.writeFileSync(path.join(tmp, 'home/config.json'), JSON.stringify({ port: DSH, token: 'uitoken', base: `http://127.0.0.1:${MOCK}`, cwd: work }));
fs.writeFileSync(path.join(tmp, 'key'), 'sk-test-0123456789\n');

const delta = d => ({ choices: [{ index: 0, delta: d }] });
const chunk = (s, n = 6) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g'));
let script = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', async () => {
    if (req.url === '/models') return res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
    if (req.url === '/user/balance') return res.end(JSON.stringify({ balance_infos: [{ currency: 'USD', total_balance: '5.73' }] }));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const c of script.shift() || [delta({ content: 'ok' })]) { res.write(`data: ${JSON.stringify(c)}\n\n`); await new Promise(r => setTimeout(r, 8)); }
    res.end('data: [DONE]\n\n');
  });
});
const usage = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5200, prompt_cache_hit_tokens: 4096, prompt_cache_miss_tokens: 1104, completion_tokens: 380 } };
const reply = `The project is tiny: a README and an empty \`src/\` folder.

## What I found
- **README.md**: a single heading, \`# demo\`
- **src/**: empty, so nothing to build yet

\`\`\`bash
ls -la
cat README.md
\`\`\`

Want me to scaffold a package.json?`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain' };
const stat = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]), file = path.join(root, name === '/' ? 'index.html' : name);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (e, d) => e ? res.writeHead(404).end() : (res.setHeader('content-type', types[path.extname(file)] || 'text/plain'), res.end(d)));
});

(async () => {
  await new Promise(r => mock.listen(MOCK, '127.0.0.1', r));
  await new Promise(r => stat.listen(STATIC, '127.0.0.1', r));
  const dsh = spawn(process.execPath, [path.resolve(__dirname, '../server/dsh.mjs'), 'serve'], { env: { ...process.env, DSH_HOME: path.join(tmp, 'home'), DSH_KEY_FILE: path.join(tmp, 'key') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => dsh.stdout.once('data', r));
  const browser = await chromium.launch({ ...launch(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([u]) => { localStorage.setItem('dsha.url', u); localStorage.setItem('dsha.token', 'uitoken'); }, [`http://127.0.0.1:${DSH}`]);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${STATIC}/`);
    await page.getByRole('heading', { name: 'What should dsh do?' }).waitFor();
    assert.match(await page.locator('#meter').textContent(), /^$/);
    await page.screenshot({ path: shot('empty') });

    script = [
      [...chunk('The user wants an overview. I should list the directory first, then read the README.', 5).map(d => delta({ reasoning_content: d })),
        delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls -la && cat README.md"}' } }] }), usage],
      [delta({ tool_calls: [{ index: 0, id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] })],
      [delta({ reasoning_content: 'Enough context.' }), ...chunk(reply, 8).map(d => delta({ content: d })), usage],
    ];
    await page.locator('#input').fill('What is in this project?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.tool.waiting').waitFor();
    assert.equal(await page.locator('.tool.waiting .cmd').textContent(), 'ls -la && cat README.md');
    assert.equal(await page.locator('#modeChip').textContent(), 'Ask');
    await page.screenshot({ path: shot('approval') });
    await page.locator('.tool.waiting .allow').click();
    await page.locator('.turnfoot').waitFor();
    assert.equal(await page.locator('.tool.ok').count(), 2);
    assert.equal(await page.locator('.md h2').textContent(), 'What found'.replace('What', 'What I'));
    assert.ok(await page.locator('.md pre .hljs-built_in, .md pre code').count());
    assert.match(await page.locator('.think').first().textContent(), /Thought|Thoughts/);
    assert.match(await page.locator('#meter').textContent(), /ctx 5\.2k/);
    assert.equal(await page.locator('#title').textContent(), 'What is in this project?');
    await page.screenshot({ path: shot('reply'), fullPage: false });

    // Reload: history must rebuild identically from the server.
    const norm = t => t.replace(/\d+(\.\d+)?(ms|s)\b/g, '#');
    const before = await page.locator('#log').innerText();
    await page.reload(); await page.locator('.turnfoot').waitFor();
    assert.equal(await page.locator('.tool').count(), 2);
    assert.equal(norm(await page.locator('#log').innerText()), norm(before));
    await page.locator('.tool').first().locator('.head').click();
    assert.match(await page.locator('.tool.open .res').textContent(), /README\.md[\s\S]*# demo[\s\S]*\[exit 0\]/);
    await page.screenshot({ path: shot('tool-open') });

    // Drawer, sheets, slash menu.
    await page.getByRole('button', { name: 'Sessions' }).click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('.sitem').count(), 1);
    await page.screenshot({ path: shot('drawer') });
    await page.locator('#scrim').click({ position: { x: 400, y: 400 } }); await page.waitForTimeout(250);
    await page.locator('#modeChip').click();
    await page.getByRole('button', { name: 'Auto' }).click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('#modeChip').textContent(), 'Auto');
    await page.getByRole('button', { name: 'Session options' }).click();
    await page.locator('#sheet .seg button', { hasText: 'v4-pro' }).click(); await page.waitForTimeout(200);
    await page.screenshot({ path: shot('options') });
    assert.match(await page.locator('#meter').textContent(), /v4-pro/);
    await page.locator('#scrim').click({ position: { x: 200, y: 60 } });
    await page.locator('#input').fill('/co');
    await page.locator('#slash').waitFor();
    await page.screenshot({ path: shot('slash') });
    await page.locator('#input').fill('');
    await page.locator('#cwdChip').click(); await page.locator('#sheet .list button', { hasText: 'src' }).click();
    await page.getByRole('button', { name: 'Use this folder' }).click(); await page.waitForTimeout(200);
    assert.match(await page.locator('#cwdChip').textContent(), /project\/src$/);
    await page.getByRole('button', { name: 'Sessions' }).click(); await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('#bal').filter({ hasText: '5.73 USD' }).waitFor();
    await page.waitForTimeout(400); await page.screenshot({ path: shot('settings') });
    assert.deepEqual(errors, []);
    console.log('ui ok');
  } finally {
    await browser.close(); dsh.kill(); mock.close(); stat.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
