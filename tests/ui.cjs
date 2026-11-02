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
    const next = script.shift();
    if (typeof next === 'function') return next(res);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const c of next || [delta({ content: 'ok' })]) { res.write(`data: ${JSON.stringify(c)}\n\n`); await new Promise(r => setTimeout(r, 8)); }
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
  const dsh = spawn(process.execPath, [path.resolve(__dirname, '../server/dsh.mjs'), 'serve'], { env: { ...process.env, HOME: tmp, DSH_TEMP_ROOTS: path.join(tmp, 'scratch'), DSH_RETRY_WAITS: '300', DSH_HOME: path.join(tmp, 'home'), DSH_KEY_FILE: path.join(tmp, 'key') }, stdio: ['ignore', 'pipe', 'inherit'] });
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

    // Preview: the Inspector's Preview tab positions the native pane over #previewHost.
    await page.evaluate(() => {
      window.__pv = { show: [], hide: 0, open: [], reload: 0 };
      window.Native = {
        previewShow: (l, t, w, h) => { window.__pv.show.push([l, t, w, h]); return true; },
        previewHide: () => { window.__pv.hide++; },
        previewOpen: u => { window.__pv.open.push(u); return true; },
        previewReload: () => { window.__pv.reload++; },
        previewExternal: () => {},
      };
    });
    await page.locator('#itabs [data-t=preview]').click();
    await page.locator('#pvUrl').waitFor();
    assert.ok(await page.locator('.pv-empty').isVisible());
    await page.locator('#pvUrl').fill('127.0.0.1:5173');
    await page.locator('#pvForm button[type=submit]').click(); await page.waitForTimeout(250);
    assert.equal((await page.evaluate(() => window.__pv.open)).pop(), 'http://127.0.0.1:5173/');
    const hostBox = await page.locator('#previewHost').boundingBox();
    const pane = await page.evaluate(() => window.__pv.show.at(-1));
    assert.ok(pane, 'the native pane is positioned');
    assert.ok(Math.abs(pane[0] - Math.round(hostBox.x)) <= 1 && Math.abs(pane[1] - Math.round(hostBox.y)) <= 1, 'pane sits on the host rect: ' + pane + ' vs ' + JSON.stringify(hostBox));
    assert.ok(pane[2] > 150 && pane[3] > 200, 'pane fills the Inspector: ' + pane);
    await page.evaluate(() => { window.native.previewState('http://127.0.0.1:5173/', false, false); window.native.previewTitle('My app'); });
    assert.match(await page.locator('#pvStatus').textContent(), /My app/);
    // Switching tabs hides the pane, and so does anything that covers the Inspector.
    await page.locator('#itabs [data-t=activity]').click(); await page.waitForTimeout(200);
    const hid = await page.evaluate(() => window.__pv.hide);
    assert.ok(hid > 0, 'leaving the tab hides the pane');
    await page.locator('#itabs [data-t=preview]').click(); await page.waitForTimeout(200);
    const shown = await page.evaluate(() => window.__pv.show.length);
    await page.getByRole('button', { name: 'Session options' }).click(); await page.waitForTimeout(200);
    assert.ok((await page.evaluate(() => window.__pv.hide)) > hid, 'a sheet over the Inspector hides the pane');
    await page.locator('#scrim').click({ position: { x: 200, y: 60 } }); await page.waitForTimeout(250);
    assert.ok((await page.evaluate(() => window.__pv.show.length)) > shown, 'closing the sheet brings it back');
    await page.screenshot({ path: shot('unfolded-preview') });
    // Fullscreen chat gives the pane up too, and restores it on the way back.
    await page.locator('#fsBtn').click(); await page.waitForTimeout(200);
    assert.ok((await page.evaluate(() => window.__pv.hide)) > hid, 'fullscreen chat hides the pane');
    await page.locator('#fsBtn').click(); await page.waitForTimeout(250);
    assert.ok(await page.locator('#previewHost').isVisible());
    // Only http(s) reaches the native pane.
    await page.locator('#pvUrl').fill('javascript:alert(1)');
    await page.locator('#pvForm button[type=submit]').click(); await page.waitForTimeout(150);
    assert.match(await page.locator('#pvStatus').textContent(), /http and https/);
    await page.locator('#pvUrl').fill('http://127.0.0.1:5173');
    await page.locator('#itabs button', { hasText: 'Activity' }).click();
    // dsh can open a page itself: the Preview tab comes forward with it, and local links in replies open there too.
    await page.evaluate(() => window.native.posture(180, 374, 440));
    script = [[delta({ tool_calls: [{ index: 0, id: 'pv1', type: 'function', function: { name: 'preview', arguments: '{"url":"http://127.0.0.1:4321"}' } }] })], [delta({ content: 'Running at http://localhost:4321/about now.' })]];
    await page.locator('#input').fill('Start the site and show me');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.md', { hasText: 'Running at' }).waitFor();
    assert.equal(await page.locator('#itabs [data-t=preview]').getAttribute('aria-selected'), 'true');
    assert.equal((await page.evaluate(() => window.__pv.open)).includes('http://127.0.0.1:4321/'), true);
    await page.locator('#itabs button', { hasText: 'Activity' }).click();
    await page.locator('.md a', { hasText: 'localhost:4321' }).click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__pv.open)).pop(), 'http://localhost:4321/about');
    await page.locator('#itabs button', { hasText: 'Activity' }).click();

    // New session on the unfolded screen: the drawer, and its New session button, are hidden here.
    assert.equal(await page.locator('#menuBtn').isVisible(), false);
    assert.ok(await page.locator('#newBtnWide').isVisible());
    await page.locator('#newBtnWide').click();
    await page.locator('#sheet h3', { hasText: 'New session' }).waitFor();
    assert.ok(await page.locator('#sheet .rowbtns .primary').isVisible(), 'the sheet offers Start');
    await page.locator('#scrim').click({ position: { x: 200, y: 60 } }); await page.waitForTimeout(200);
    // The Inspector's Sessions tab carries the same way in, for when you are already there.
    await page.locator('#itabs [data-t=sessions]').click();
    await page.locator('#ibody .newSess').waitFor();
    await page.locator('#ibody .newSess').click();
    await page.locator('#sheet h3', { hasText: 'New session' }).waitFor();
    await page.locator('#scrim').click({ position: { x: 200, y: 60 } }); await page.waitForTimeout(200);
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

    // The Usage page: total spend from dsh's ledger, a daily chart, then per-session spend.
    await page.getByRole('button', { name: 'All sessions and total spend' }).click();
    await page.locator('#pbody .kpi', { hasText: 'Total spent' }).waitFor();
    assert.match(await page.locator('#pbody .kpi', { hasText: 'Total spent' }).locator('b').textContent(), /^\$0\.\d+$/);
    assert.equal(await page.locator('.ubars button').count(), 30);
    assert.match(await page.locator('#ucap').textContent(), /^\S+ \d+ \$[\d.]+ · \d+ calls? · /);
    const bars = await page.evaluate(() => { const b = document.querySelector('.ubars'); return { over: b.scrollWidth - b.clientWidth, todayH: b.lastElementChild.firstElementChild.getBoundingClientRect().height }; });
    assert.ok(bars.over <= 0 && bars.todayH > 0, 'daily bars fit and today has spend: ' + JSON.stringify(bars));
    await page.waitForTimeout(200); await page.screenshot({ path: shot('usage-page') });
    await page.getByRole('tab', { name: 'Sessions' }).click();
    await page.locator('.urow').first().waitFor();
    await page.getByRole('button', { name: 'Most spent' }).click();
    const costs = await page.locator('.uhead b').allTextContents();
    const nums = costs.map(c => +c.replace(/[^\d.]/g, ''));
    assert.deepEqual(nums, [...nums].sort((a, b) => b - a), 'sorted by spend: ' + costs);
    await page.locator('.uhead').first().click();
    await page.locator('.udetail', { hasText: 'Model calls' }).waitFor();
    await page.waitForTimeout(200); await page.screenshot({ path: shot('usage-sessions') });
    await page.locator('#pageBack').click(); await page.waitForTimeout(250);

    // An older session in a temp folder gets a warning and a one-tap move to home; new sessions never start there.
    const scratch = path.join(tmp, 'scratch', 'live'); fs.mkdirSync(scratch, { recursive: true });
    const sid = await page.evaluate(() => localStorage.getItem('dsha.last'));
    await fetch(`http://127.0.0.1:${DSH}/api/sessions/${sid}`, { method: 'PATCH', headers: { authorization: 'Bearer uitoken', 'content-type': 'application/json' }, body: JSON.stringify({ cwd: scratch }) });
    await page.reload(); await page.locator('#tempBar', { hasText: 'Temporary folder' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('temp-folder') });
    await page.getByRole('button', { name: 'Use home folder' }).click();
    await page.locator('#tempBar').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#cwdChip').textContent(), '~');

    // DeepSeek trouble: one quiet retry, then an error card that survives a reload and retries in place.
    const busy = res => { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Server overloaded, please try again later"}}'); };
    script = [busy, busy, [delta({ content: 'Back online.' })]];
    await page.locator('#input').fill('Are you there?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.notice', { hasText: 'Trying again in' }).waitFor();
    await page.locator('.apierr', { hasText: 'DeepSeek is overloaded' }).waitFor({ timeout: 10000 });
    assert.match(await page.locator('#runText').textContent(), /Failed/);
    await page.reload(); await page.locator('.apierr', { hasText: '503' }).waitFor();
    await page.waitForTimeout(250); await page.screenshot({ path: shot('api-error') });
    await page.locator('.apierr').getByRole('button', { name: 'Retry' }).click();
    await page.locator('.md', { hasText: 'Back online.' }).waitFor();
    assert.equal(await page.locator('.apierr').count(), 0);
    assert.equal(await page.locator('.msg.user', { hasText: 'Are you there?' }).count(), 1);

    // Subagents in chat: dsh designs one, its steps sit inside the agent card, and they come back after a reload.
    script = [
      [delta({ tool_calls: [{ index: 0, id: 'sa', type: 'function', function: { name: 'agent', arguments: JSON.stringify({ description: 'Survey the project', name: 'surveyor', role: 'You survey projects.', tools: ['read_file', 'list_dir'], model: 'flash', prompt: 'List the files and read the README.' }) } }] })],
      [delta({ tool_calls: [{ index: 0, id: 's1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] })],
      [delta({ tool_calls: [{ index: 0, id: 's2', type: 'function', function: { name: 'read_file', arguments: '{"path":"../README.md"}' } }] })],
      [delta({ content: 'A README and src/.' })],
      [delta({ content: 'The surveyor found a README and src/.' })],
    ];
    await page.locator('#input').fill('Survey this with a subagent');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.md', { hasText: 'The surveyor found' }).waitFor({ timeout: 20000 });
    const card = page.locator('.tool.agentcard').last();
    assert.match(await card.locator('> .head .tn').textContent(), /Surveyor/);
    assert.match(await card.locator('> .head .st').textContent(), /Done · .* · 2 tools/);
    assert.equal(await card.locator('.subs > .tool.sub').count(), 2);
    await page.waitForTimeout(250); await page.screenshot({ path: shot('subagent') });
    await page.reload(); await page.locator('.tool.agentcard').last().waitFor();
    assert.equal(await page.locator('.tool.agentcard').last().locator('.subs > .tool.sub').count(), 2, 'subagent steps survive a reload');
    assert.match(await page.locator('.tool.agentcard').last().locator('.subs .tn').first().textContent(), /List folder/);

    // Subagents sidebar: folded, the top-bar button opens a panel from the right with dsh's tree;
    // a row opens that agent's detail. Unfolded, the same body is the Inspector's Agents tab.
    await page.locator('#agentsBtn').click();
    await page.locator('#agside .agrow').first().waitFor();
    assert.equal(await page.locator('#agside .agrow').count(), 1);
    assert.match(await page.locator('#agside .agrow .r1').textContent(), /Surveyor/);
    assert.match(await page.locator('#agside .agrow .agst').textContent(), /Done/); assert.match(await page.locator('#agside .agrow .r3').textContent(), /2 tools/);
    await page.waitForTimeout(300); await page.screenshot({ path: shot('agents-side') });
    await page.locator('#agside .agrow').click();
    await page.locator('#agside .agdhead h2', { hasText: 'Surveyor' }).waitFor();
    assert.match(await page.locator('#agside .agtext').first().textContent(), /List the files/);
    assert.equal(await page.locator('#agside .agstep').count(), 2);
    assert.match(await page.locator('#agside .agreport').textContent(), /A README and src/);
    assert.match(await page.locator('#agside .agkv').textContent(), /2 in|in ·/, 'token counts survive the reload');
    await page.locator('#agside .agstep button').first().click();
    await page.locator('#agside .agstep .ipre').waitFor();
    await page.waitForTimeout(200); await page.screenshot({ path: shot('agent-detail') });
    assert.ok(await page.evaluate(() => window.native.back()), 'back leaves the detail');
    await page.locator('#agside .agrow').waitFor();
    assert.ok(await page.evaluate(() => window.native.back()), 'back closes the panel');
    assert.ok(await page.evaluate(() => !document.body.classList.contains('agside')));
    await page.setViewportSize({ width: 748, height: 880 }); await page.evaluate(() => window.native.posture(180, 374, 440)); await page.waitForTimeout(250);
    await page.locator('.tool.agentcard > .head').last().click();
    await page.locator('#ibody .agdhead h2', { hasText: 'Surveyor' }).waitFor();
    assert.equal(await page.locator('#itabs [data-t=agents]').getAttribute('aria-selected'), 'true');
    await page.waitForTimeout(250); await page.screenshot({ path: shot('unfolded-agents') });
    await page.locator('#ibody [data-agback]').click(); await page.locator('#ibody .agrow').waitFor();
    await page.locator('#itabs [data-t=activity]').click();
    await page.setViewportSize({ width: 360, height: 780 }); await page.evaluate(() => window.native.posture(0, 180, 390)); await page.waitForTimeout(250);

    // Live steering: mid-run the send button queues the message under the chat; dsh reads it after
    // the step's tool results and it becomes a normal bubble. The model sees it as the last turn.
    let release;
    script = [res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); release = () => { res.write(`data: ${JSON.stringify(delta({ tool_calls: [{ index: 0, id: 'st1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] }))}\n\n`); res.end('data: [DONE]\n\n'); }; },
      [delta({ content: 'Looked in src as well.' })]];
    await page.locator('#input').fill('Look around');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Stop' }).waitFor();
    await page.locator('#input').fill('Also look in src');
    await page.getByRole('button', { name: 'Send after this step' }).click();
    await page.locator('#queue .queued', { hasText: 'Queued' }).waitFor();
    assert.equal(await page.locator('#input').inputValue(), '');
    await page.waitForTimeout(200); await page.screenshot({ path: shot('steer-queued') });
    release();
    await page.locator('.md', { hasText: 'Looked in src as well.' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('#queue .queued').count(), 0);
    assert.equal(await page.locator('.msg.user.steer', { hasText: 'Also look in src' }).count(), 1);
    await page.waitForTimeout(200); await page.screenshot({ path: shot('steer-read') });
    await page.reload(); await page.locator('.md', { hasText: 'Looked in src as well.' }).waitFor();
    assert.equal(await page.locator('.msg.user.steer', { hasText: 'Also look in src' }).count(), 1, 'the steer survives a reload');

    // Agent setup page: subagents first, then plugins, skills, instruction files.
    await page.getByRole('button', { name: 'Sessions' }).click(); await page.waitForTimeout(250);
    await page.locator('#agentBtn').click();
    await page.locator('#pbody .rows .r1', { hasText: 'general-purpose' }).waitFor();
    assert.ok(await page.locator('#pbody .rows .r1', { hasText: 'explore' }).isVisible());
    await page.waitForTimeout(250); await page.screenshot({ path: shot('subagents') });
    await page.getByRole('button', { name: 'New subagent' }).click();
    await page.locator('#agName').fill('reviewer'); await page.locator('#agDesc').fill('Reviewing a change for bugs');
    await page.locator('#sheet [data-a=model][data-v=flash]').click();
    await page.locator('#sheet [data-a=preset][data-v=pick]').click();
    await page.locator('#agTools .chip', { hasText: 'Read file' }).click();
    await page.locator('#agTools .chip', { hasText: 'Search' }).click();
    await page.locator('#agText').fill('You review diffs for bugs.');
    await page.waitForTimeout(200); await page.screenshot({ path: shot('subagent-form') });
    await page.locator('#sheet [data-a=save]').click();
    await page.locator('#pbody .rows .r1', { hasText: 'reviewer' }).waitFor();
    assert.match(fs.readFileSync(path.join(tmp, 'home', 'agents', 'reviewer.md'), 'utf8'), /tools: read_file, grep\nmodel: flash/);
    assert.match(await page.locator('#pbody .row', { hasText: 'reviewer' }).locator('.r3').textContent(), /Flash · Read file, Search/);
    await page.locator('#pbody [data-open="dsh:reviewer"]').click();
    await page.locator('#sheet [data-a=edit]').click();
    await page.locator('#agText').fill('You review diffs for bugs and style.');
    await page.locator('#sheet [data-a=save]').click(); await page.waitForTimeout(300);
    assert.match(fs.readFileSync(path.join(tmp, 'home', 'agents', 'reviewer.md'), 'utf8'), /bugs and style/);
    await page.locator('#ptabs [data-t=plugins]').click();
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

    // DSHA Standalone (?standalone=1 in a browser): no Termux pairing; with no key yet the empty
    // state is the key screen, the key goes to dsh, and Settings offers Built in / Termux and a restart.
    const sa = await ctx.newPage();
    sa.on('pageerror', e => errors.push(e.message));
    let noKey = true;
    await sa.route('**/api/health', async r => { const res = await r.fetch(); const j = await res.json(); if (noKey) j.hasKey = false; r.fulfill({ response: res, json: j }); });
    await sa.setViewportSize({ width: 360, height: 780 });
    await sa.goto(`http://127.0.0.1:${STATIC}/?standalone=1`);
    await sa.getByRole('heading', { name: 'Add your DeepSeek key' }).waitFor();
    assert.equal(await sa.locator('#obPair').count(), 0, 'no Termux pairing in Standalone');
    await sa.waitForTimeout(200); await sa.screenshot({ path: shot('standalone-key') });
    await sa.locator('#obKey').fill('nonsense');
    await sa.locator('#obKeySave').click();
    await sa.locator('#obKeyErr', { hasText: 'does not look like a DeepSeek key' }).waitFor();
    noKey = false;
    await sa.locator('#obKey').fill('sk-test-0123456789');
    await sa.locator('#obKeySave').click();
    await sa.getByRole('heading', { name: 'What should dsh do?' }).waitFor();
    assert.equal(await sa.locator('#starters button', { hasText: 'Build a small to-do web page' }).count(), 1);
    await sa.locator('#menuBtn').click(); await sa.locator('#settingsBtn').click();
    await sa.locator('#sheet .seg [data-v=builtin].on').waitFor();
    assert.match(await sa.locator('#sheet .kvs').first().textContent(), /in this app.*App storage only/s);
    assert.equal(await sa.locator('#sheet [data-a=pair]').count(), 0);
    await sa.waitForTimeout(250); await sa.screenshot({ path: shot('standalone-settings') });
    await sa.close();
    assert.deepEqual(errors, []);
    console.log('ui ok');
  } finally {
    await browser.close(); dsh.kill(); mock.close(); stat.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
