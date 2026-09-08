/* Renders the popup and the on-page overlay with the extension APIs stubbed,
   fails on any console error or uncaught exception, and writes PNGs so the UI
   can be eyeballed without installing anything.

   node test/ui-shots.mjs [outDir]
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, '..', 'extension');
const OUT = process.argv[2] || path.join(HERE, '..', 'dist', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(label + ': ' + m.text()); });
  page.on('pageerror', (e) => problems.push(label + ': ' + e.message));
}

const THUMB = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#2a2c3f"/><rect x="12" y="16" width="110" height="14" rx="3" fill="#8f8cff"/><rect x="12" y="42" width="136" height="8" rx="3" fill="#4a4d68"/><rect x="12" y="58" width="96" height="8" rx="3" fill="#4a4d68"/></svg>`
).toString('base64');

const ITEMS = [
  {
    id: 'a', path: 'C:\\Users\\alexk\\AppData\\Local\\Temp\\pinpoint\\20260902\\20260902-141233-01-localhost-4321.png',
    via: 'native', description: 'The heading crowds the logo — give it more room and drop it a size on mobile.',
    url: 'http://localhost:4321/en/', thumb: THUMB,
    elements: [{ selector: 'header.site-header > h1', source: 'src/components/Header.astro:12:4' }]
  },
  {
    id: 'b', path: 'C:\\Users\\alexk\\AppData\\Local\\Temp\\pinpoint\\20260902\\20260902-141251-02-localhost-4321.png',
    via: 'native', description: 'This card should go full width below 900px.',
    url: 'http://localhost:4321/en/work/', thumb: THUMB,
    elements: [{ selector: '.card', source: null }, { selector: '.card > p', source: null }]
  }
];

const browser = await chromium.launch();

/* ---------------------------------------------------------------- the popup */
{
  const page = await browser.newPage({ viewport: { width: 420, height: 460 } });
  watch(page, 'popup');
  await page.addInitScript((items) => {
    const state = { ok: true, items, settings: {}, native: { status: 'ok', info: { outputDir: 'C:\\...\\Temp\\pinpoint' } } };
    window.browser = {
      runtime: {
        sendMessage: (m) => Promise.resolve(m.type === 'get-state' ? state : { ok: true }),
        openOptionsPage: () => {}
      },
      tabs: { query: () => Promise.resolve([{ id: 1 }]) },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } }
    };
  }, ITEMS);
  await page.goto(pathToFileURL(path.join(EXT, 'popup', 'popup.html')).href);
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 2, null, { timeout: 5000 });
  const badge = await page.textContent('#status');
  const count = await page.textContent('#count');
  console.log('  popup renders     badge="' + badge + '" count="' + count + '"');
  if (badge !== 'host ready' || count !== '2 notes') problems.push('popup: unexpected header state');
  await page.screenshot({ path: path.join(OUT, 'popup.png') });
  await page.close();
}

/* -------------------------------------------------------------- the options */
{
  const page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
  watch(page, 'options');
  await page.addInitScript(() => {
    window.browser = {
      runtime: { sendMessage: () => Promise.resolve({ ok: true, version: '0.1.0', outputDir: 'C:\\Users\\alexk\\AppData\\Local\\Temp\\pinpoint' }) },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
      permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) }
    };
  });
  await page.goto(pathToFileURL(path.join(EXT, 'options', 'options.html')).href);
  await page.waitForFunction(() => document.getElementById('preview').textContent.includes('.png'), null, { timeout: 5000 });
  const preview = await page.textContent('#preview');
  console.log('  options renders   preview first line = ' + preview.split('\n')[0].slice(-40));
  await page.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });
  await page.close();
}

/* ------------------------------------------------------------- the overlay  */
{
  const PAGE = fs.readFileSync(path.join(HERE, 'fixture.html'), 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  watch(page, 'overlay');
  await page.goto('http://127.0.0.1:' + server.address().port + '/en/');
  await page.evaluate(() => {
    window.browser = {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: (msg) => Promise.resolve(
          msg.type === 'capture-region'
            ? { ok: true, shotId: 'x', thumb: null, width: Math.round(msg.rect.width), height: Math.round(msg.rect.height) }
            : { ok: true, count: 1, path: 'C:\\tmp\\a.png', via: 'native' }
        )
      }
    };
  });
  await page.addScriptTag({ path: path.join(EXT, 'lib', 'browser-shim.js') });
  await page.addScriptTag({ path: path.join(EXT, 'content', 'overlay.js') });

  await page.evaluate(() => window.__pinpointOverlay.begin(0));
  await page.screenshot({ path: path.join(OUT, 'overlay-idle.png') });

  await page.mouse.move(60, 150);
  await page.mouse.down();
  await page.mouse.move(640, 330, { steps: 10 });
  await page.screenshot({ path: path.join(OUT, 'overlay-dragging.png') });
  await page.mouse.up();

  await page.waitForSelector('pinpoint-overlay', { state: 'attached' });
  await page.waitForFunction(() =>
    !!document.querySelector('pinpoint-overlay').shadowRoot.querySelector('.panel'), null, { timeout: 5000 });
  await page.evaluate(() => {
    const sr = document.querySelector('pinpoint-overlay').shadowRoot;
    sr.querySelector('textarea').value = 'Move the strapline under the title and cut the gap in half.';
    sr.querySelector('.meta button.link').click();
  });
  await page.screenshot({ path: path.join(OUT, 'overlay-note.png') });

  // Element picker: hovering, then the locked note panel.
  await page.evaluate(() => {
    const sr = document.querySelector('pinpoint-overlay').shadowRoot;
    sr.querySelector('.panel').remove();
    window.__pinpointOverlay.begin(1, 'element');
  });
  await page.mouse.move(400, 700);
  await page.mouse.move(300, 232);        // the hero paragraph
  await page.screenshot({ path: path.join(OUT, 'picker-hover.png') });

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() =>
    !!document.querySelector('pinpoint-overlay').shadowRoot.querySelector('.panel'), null, { timeout: 5000 });
  await page.evaluate(() => {
    const sr = document.querySelector('pinpoint-overlay').shadowRoot;
    sr.querySelector('textarea').value = 'Cut this to one line and move it above the title.';
  });
  await page.screenshot({ path: path.join(OUT, 'picker-note.png') });

  const locked = await page.evaluate(() => {
    const sr = document.querySelector('pinpoint-overlay').shadowRoot;
    return sr.querySelector('.hi')?.classList.contains('locked') && !!sr.querySelector('.target');
  });
  if (!locked) problems.push('overlay: element stayed unlocked or the target chip is missing');
  console.log('  picker renders    hover + locked note captured');

  await page.close();
  server.close();
}

await browser.close();

console.log('\nshots in ' + OUT);
if (problems.length) {
  console.log('\nproblems:');
  for (const p of problems) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('no console errors in any surface');
}
