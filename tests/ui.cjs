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
  const mem = path.join(tmp, 'home', 'memory'); fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, 'fold-phone.md'), '---\nname: fold-phone\ndescription: User is on a Galaxy Z Fold; judge layouts at 750 CSS px\ntype: user\n---\nInner screen about 750 CSS px wide.\n');
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [Fold phone](fold-phone.md) — judge layouts at 750px\n');
  const dsh = spawn(process.execPath, [path.resolve(__dirname, '../server/dsh.mjs'), 'serve'], { env: { ...process.env, HOME: tmp, DSH_TEMP_ROOTS: path.join(tmp, 'scratch'), DSH_HOME: path.join(tmp, 'home'), DSH_KEY_FILE: path.join(tmp, 'key') }, stdio: ['ignore', 'pipe', 'inherit'] });
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
    assert.match(await page.locator('#meter').textContent(), /5\.2k context · \d+ tok\/s/);
    // Light mode follows the system setting.
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    await page.screenshot({ path: shot('light-reply') });
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
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
    await page.locator('#sheet .seg button', { hasText: 'V4 Pro' }).click(); await page.waitForTimeout(200);
    await page.screenshot({ path: shot('options') });
    assert.match(await page.locator('#meter').textContent(), /V4 Pro/);
    await page.locator('#scrim').click({ position: { x: 200, y: 60 } });
    await page.locator('#input').fill('/co');
    await page.locator('#slash').waitFor();
    await page.screenshot({ path: shot('slash') });
    await page.locator('#input').fill('');
    await page.locator('#cwdChip').click(); await page.locator('#sheet .rows button', { hasText: 'src' }).click();
    await page.getByRole('button', { name: 'Use this folder' }).click(); await page.waitForTimeout(200);
    assert.match(await page.locator('#cwdChip').textContent(), /project\/src$/);
    await page.getByRole('button', { name: 'Sessions' }).click(); await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('#bal').filter({ hasText: '5.73 USD' }).waitFor();
    await page.locator('#sheet .seg button', { hasText: 'Light' }).click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.screenshot({ path: shot('light-settings') });
    await page.locator('#sheet .seg button', { hasText: 'System' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
    await page.waitForTimeout(400); await page.screenshot({ path: shot('settings') });
    await page.locator('#scrim').click({ position: { x: 200, y: 40 } }); await page.waitForTimeout(250);

    // Foldable: unfolded (book) → dual pane split at the hinge.
    await page.setViewportSize({ width: 748, height: 880 });
    await page.evaluate(() => window.native.posture(180, 374, 440));
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.body.classList.contains('wide')));
    assert.ok(await page.locator('#inspector').isVisible());
    assert.equal(await page.locator('#menuBtn').isVisible(), false);
    const paneW = await page.locator('#chatPane').evaluate(e => e.getBoundingClientRect().width);
    assert.ok(Math.abs(paneW - 374) < 2, 'chat pane ends at the hinge: ' + paneW);
    // Long chat: only the chat scroller may scroll, never the page (both panes moved together in 0.3.0).
    await page.evaluate(() => { const f = document.createElement('div'); f.id = 'filler'; f.style.height = '4000px'; document.querySelector('#log').append(f); const g = f.cloneNode(); g.id = 'filler2'; document.querySelector('#ibody').append(g); });
    await page.locator('#scroller').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.locator('#filler').evaluate(e => e.scrollIntoView({ block: 'end' })); // scrolls every scrollable ancestor, the page included
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'page content fits the viewport');
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'page itself must not scroll');
    assert.ok(await page.evaluate(() => { const r = document.querySelector('#top').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'top bar stays put');
    await page.evaluate(() => { document.querySelector('#filler').remove(); document.querySelector('#filler2').remove(); });
    const openBefore = await page.locator('.tool.open').count();
    await page.locator('.tool').first().locator('.head').click();
    await page.locator('#ibody .cmdline', { hasText: '$ ls -la && cat README.md' }).waitFor();
    assert.match(await page.locator('#ibody .ipre').textContent(), /# demo/);
    assert.equal(await page.locator('.tool.open').count(), openBefore); // wide mode pins to the inspector instead of expanding inline
    await page.screenshot({ path: shot('unfolded') });
    await page.locator('#itabs [data-t=stats]').click();
    await page.locator('.kpi', { hasText: 'Cache hits' }).waitFor();
    assert.match(await page.locator('.files').textContent(), /README\.md/);
    await page.screenshot({ path: shot('unfolded-stats') });
    await page.locator('#itabs button', { hasText: 'Activity' }).click();

    // Fullscreen chat: the Inspector and hinge step aside, chat takes the unfolded screen.
    await page.locator('#fsBtn').click(); await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.body.classList.contains('chatfull')));
    assert.equal(await page.locator('#inspector').isVisible(), false);
    assert.equal(await page.locator('#fsBtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#fsBtn').getAttribute('aria-label'), 'Exit fullscreen chat');
    const fullW = await page.locator('#chatPane').evaluate(e => e.getBoundingClientRect().width);
    assert.ok(Math.abs(fullW - 748) < 2, 'chat spans the unfolded screen: ' + fullW);
    await page.screenshot({ path: shot('unfolded-fullscreen') });
    // Folded, the button is gone and the class drops; unfolding restores the choice.
    await page.setViewportSize({ width: 412, height: 880 }); await page.waitForTimeout(250);
    assert.equal(await page.locator('#fsBtn').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.classList.contains('chatfull')), false);
    await page.setViewportSize({ width: 748, height: 880 });
    await page.evaluate(() => window.native.posture(180, 374, 440)); await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.body.classList.contains('chatfull')), 'unfolding remembers fullscreen');
    // Tapping a tool brings the Inspector back into view.
    await page.locator('.tool').first().locator('.head').click(); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.body.classList.contains('chatfull')), false);
    assert.ok(await page.locator('#inspector').isVisible());

    // Flex mode: half-folded in landscape → chat above the hinge, deck below; approve from the deck.
    await page.locator('#modeChip').click(); await page.getByRole('button', { name: 'Ask' }).click(); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 880, height: 748 });
    await page.evaluate(() => window.native.posture(95, 440, 374));
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.body.classList.contains('tabletop')));
    const deckTop = await page.locator('#deck').evaluate(e => e.getBoundingClientRect().top);
    assert.ok(Math.abs(deckTop - 374) < 3, 'deck starts at the hinge: ' + deckTop);
    await page.screenshot({ path: shot('tabletop-idle') });
    script = [
      [delta({ reasoning_content: 'Run it.' }), delta({ tool_calls: [{ index: 0, id: 'f1', type: 'function', function: { name: 'bash', arguments: '{"command":"for i in 1 2 3; do echo step $i; done"}' } }] })],
      [...chunk('Ran the loop: **three steps**, all fine.', 6).map(d => delta({ content: d })), usage],
    ];
    await page.locator('#input').fill('Run a quick loop');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('#deckLive .dl-ask').waitFor();
    await page.screenshot({ path: shot('tabletop-approval') });
    await page.locator('#deckLive .allow').click();
    await page.waitForFunction(() => !document.body.classList.contains('running') && document.querySelectorAll('.turnfoot').length >= 2);
    assert.match(await page.locator('.tool').last().locator('.res').textContent(), /step 3/);
    await page.screenshot({ path: shot('tabletop') });

    // Cover screen: folded shut → single column, compact.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => window.native.posture(0, 180, 390));
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => !document.body.classList.contains('wide') && !document.body.classList.contains('tabletop')));
    assert.ok(await page.locator('#menuBtn').isVisible());
    await page.screenshot({ path: shot('cover') });

    // Long run on the narrow screen: the run strip folds early steps and never spills under its label.
    script = [...Array.from({ length: 45 }, (_, i) => [delta({ tool_calls: [{ index: 0, id: 'L' + i, type: 'function', function: { name: 'read_file', arguments: '{"path":"../README.md"}' } }] })]), [delta({ content: 'Read it 45 times.' })]];
    await page.locator('#input').fill('Read the README many times');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.md', { hasText: 'Read it 45 times.' }).waitFor({ timeout: 60000 }); await page.waitForTimeout(300);
    const strip = await page.evaluate(() => { const g = document.querySelector('#runSegs'), t = document.querySelector('#runText'); return { n: g.children.length, over: g.scrollWidth - g.clientWidth, gap: t.getBoundingClientRect().left - g.getBoundingClientRect().right, fold: !!g.querySelector('[aria-label$="earlier steps"]') }; });
    assert.ok(strip.fold && strip.over <= 1 && strip.gap >= 0, 'run strip fits: ' + JSON.stringify(strip));
    await page.screenshot({ path: shot('long-run') });

    // Usage sheet from the meter, with the account balance.
    await page.locator('#meter').click();
    await page.locator('#sheet .kpi', { hasText: 'Balance' }).filter({ hasText: '5.73 USD' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('usage') });
    await page.locator('#scrim').click({ position: { x: 180, y: 20 } }); await page.waitForTimeout(250);

    // An older session in a temp folder gets a warning and a one-tap move to home; new sessions never start there.
    const scratch = path.join(tmp, 'scratch', 'live'); fs.mkdirSync(scratch, { recursive: true });
    const sid = await page.evaluate(() => localStorage.getItem('dsha.last'));
    await fetch(`http://127.0.0.1:${DSH}/api/sessions/${sid}`, { method: 'PATCH', headers: { authorization: 'Bearer uitoken', 'content-type': 'application/json' }, body: JSON.stringify({ cwd: scratch }) });
    await page.reload(); await page.locator('#tempBar', { hasText: 'Temporary folder' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('temp-folder') });
    await page.getByRole('button', { name: 'Use home folder' }).click();
    await page.locator('#tempBar').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#cwdChip').textContent(), '~');

    // Agent setup page: plugins, skills, instruction files.
    await page.getByRole('button', { name: 'Sessions' }).click(); await page.waitForTimeout(250);
    await page.locator('#agentBtn').click();
    await page.locator('#page .empty-note', { hasText: 'No servers yet' }).waitFor();
    await page.getByRole('button', { name: 'Add server' }).click();
    await page.locator('#mName').fill('web'); await page.locator('#mUrl').fill('http://127.0.0.1:1/mcp');
    await page.locator('#sheet [data-a=save]').click();
    await page.locator('#mcpList .r2', { hasText: "Can't connect" }).waitFor({ timeout: 20000 });
    await page.locator('#mcpList button', { hasText: 'web' }).click();
    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.locator('#mcpList .r2', { hasText: 'Off' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('agent-plugins') });

    await page.locator('#ptabs [data-t=skills]').click();
    await page.getByRole('button', { name: 'New skill', exact: true }).click();
    await page.locator('#skName').fill('release-apk'); await page.locator('#skDesc').fill('Building and shipping a new APK version');
    await page.locator('#skText').fill('1. Bump the version.\n2. Run `./build.sh`.');
    await page.locator('#sheet [data-a=save]').click();
    const skSwitch = page.getByRole('switch', { name: 'Use release-apk' });
    assert.equal(await skSwitch.getAttribute('aria-checked'), 'true');
    await page.waitForTimeout(250); await page.screenshot({ path: shot('agent-skills') });
    await skSwitch.click(); await page.waitForTimeout(250);
    assert.equal(await page.getByRole('switch', { name: 'Use release-apk' }).getAttribute('aria-checked'), 'false');
    await page.getByRole('switch', { name: 'Use release-apk' }).click(); await page.waitForTimeout(200);
    await page.locator('[data-open="dsh:release-apk"]').click();
    await page.locator('#skBody li', { hasText: 'Bump the version' }).waitFor();
    await page.locator('#scrim').click({ position: { x: 180, y: 20 } }); await page.waitForTimeout(250);

    assert.ok(await page.locator('.ghead h3', { hasText: 'Built in' }).isVisible());
    assert.equal(await page.getByRole('switch', { name: 'Use dsh-evolve' }).getAttribute('aria-checked'), 'true');

    await page.locator('#ptabs [data-t=memory]').click();
    await page.locator('#pbody .rows button', { hasText: 'fold-phone' }).click();
    await page.locator('#memBody', { hasText: 'Inner screen about 750 CSS px wide.' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('agent-memory') });
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Forget this' }).click();
    await page.locator('#pbody .empty-note', { hasText: 'Nothing saved yet' }).waitFor();

    await page.locator('#ptabs [data-t=instructions]').click();
    await page.locator('.ifile h3', { hasText: 'CLAUDE.md' }).waitFor();
    assert.equal(await page.locator('.ifile').count(), 4);
    await page.locator('[data-edit="0"]').click();
    await page.locator('#insText').fill('Answer in British English.');
    await page.locator('#sheet [data-a=save]').click();
    await page.locator('.ifile').first().locator('.pill', { hasText: 'Loaded' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('agent-instructions') });
    await page.locator('#sysBtn').click();
    await page.locator('#sheet pre.sys', { hasText: 'Answer in British English.' }).waitFor();
    assert.match(await page.locator('#sheet pre.sys').textContent(), /- release-apk: Building and shipping a new APK version/);
    await page.locator('#scrim').click({ position: { x: 180, y: 20 } }); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Back' }).click();
    assert.equal(await page.locator('#page').isVisible(), false);
    await page.locator('#agentBtn').evaluate(b => b.click()); await page.locator('#ptabs [data-t=memory]').click();
    await page.getByRole('button', { name: 'Learn from session' }).click();
    assert.equal(await page.locator('#page').isVisible(), false);
    assert.equal(await page.locator('#input').inputValue(), 'Use the dsh-evolve skill on this session.');
    assert.deepEqual(errors, []);
    console.log('ui ok');
  } finally {
    await browser.close(); dsh.kill(); mock.close(); stat.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
