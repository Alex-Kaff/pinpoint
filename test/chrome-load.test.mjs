/* Loads the built Chrome extension into a real Chrome and drives one capture
   end to end — the parts that only differ on Chrome and that a stubbed test
   cannot reach: the service worker booting, executeScript injection,
   captureVisibleTab, the OffscreenCanvas crop, and the Downloads fallback the
   extension uses when no native host is registered.

   Run: node test/chrome-load.test.mjs      (needs `npm run build` first)
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIds } from '../scripts/ids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist', 'chrome');

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/chrome is missing — run: npm run build');
  process.exit(1);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : ''));
}

const PAGE = fs.readFileSync(path.join(HERE, 'fixture.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-chrome-'));
const downloads = path.join(profile, 'downloads');
fs.mkdirSync(downloads, { recursive: true });

/* In use, activeTab is granted by the click that starts a capture. A test
   drives the worker directly, with no click to grant it, so load a copy that
   already holds the permission the user would have handed over. Everything
   else — code, ids, manifest — is the shipped build. */
const loadDir = path.join(profile, 'extension');
fs.cpSync(DIST, loadDir, { recursive: true });
const testManifest = JSON.parse(fs.readFileSync(path.join(loadDir, 'manifest.json'), 'utf8'));
testManifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(loadDir, 'manifest.json'), JSON.stringify(testManifest, null, 2));

/* Windows browsers find the host through a registry value, so a throwaway
   profile still sees it. macOS ones read <user-data-dir>/NativeMessagingHosts
   — the documented ~/Library path works only because it is the default user
   data dir — so hand this profile a copy, or the native route can never be
   exercised here. */
const installedManifest = [
  path.join(HERE, '..', 'native-host', 'manifest.chrome.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome',
    'NativeMessagingHosts', 'com.kaffetzakis.pinpoint.json')
].find((p) => fs.existsSync(p));

if (installedManifest) {
  const d = path.join(profile, 'NativeMessagingHosts');
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(installedManifest, path.join(d, 'com.kaffetzakis.pinpoint.json'));
}

// Keep the fallback download inside the throwaway profile instead of the
// real Downloads folder.
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'Default', 'Preferences'),
  JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, savefile: { default_directory: downloads } })
);

console.log('chrome extension end-to-end');

// Extensions need a real browser process, not the headless shell.
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1000, height: 700 },
  args: [`--disable-extensions-except=${loadDir}`, `--load-extension=${loadDir}`, '--no-first-run']
});

const problems = [];
const cleanup = [];   // real files the native host wrote, if one is installed
context.on('weberror', (e) => problems.push('page: ' + e.error().message));

try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  check('service worker starts', !!sw);

  // The native host manifest allowlists this id up front, so it has to be
  // exactly what the committed key produces.
  const extensionId = new URL(sw.url()).host;
  check('the packing key pins the extension id', extensionId === extensionIds().chrome, extensionId);

  const globals = await sw.evaluate(() => ({
    ppx: typeof PPX,
    pp: typeof PP,
    browser: typeof browser,
    session: typeof browser.storage.session
  }));
  check('importScripts loads the shim and shared lib in order',
    globals.ppx === 'object' && globals.pp === 'object' && globals.browser === 'object',
    JSON.stringify(globals));
  check('storage.session is available for parked captures', globals.session === 'object');

  // FileReader does not exist in a service worker; the hand-rolled encoder must.
  const dataUrl = await sw.evaluate(() => blobToDataUrl(new Blob(['hello'], { type: 'text/plain' })));
  check('blobToDataUrl works without FileReader',
    dataUrl === 'data:text/plain;base64,' + btoa('hello'), dataUrl);

  // --- the popup, talking to the worker over runtime.sendMessage ------------
  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('console', (m) => { if (m.type() === 'error') popupErrors.push(m.text()); });
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !!document.querySelector('#list .empty, #list .item'), null, { timeout: 10000 });
  check('popup renders against the worker', true);
  check('popup has no console errors', popupErrors.length === 0, popupErrors.join(' | '));
  await popup.close();

  // --- one capture, all the way to a file ----------------------------------
  const page = await context.newPage();
  await page.goto(origin + '/en/work/');
  await page.bringToFront();

  const started = await sw.evaluate(async (url) => {
    const [tab] = await browser.tabs.query({ url });
    await startCapture(tab.id, 'region');
    return tab.id;
  }, origin + '/en/work/');
  check('executeScript injects the overlay', typeof started === 'number');

  await page.waitForFunction(() =>
    !!document.querySelector('pinpoint-overlay')?.shadowRoot?.querySelector('.root'), null, { timeout: 10000 });
  check('overlay mounts on the page', true);

  /* Drag a box, type a note, save — and hand back the item that landed.
     The overlay drops back to idle after a save, so this can run twice. */
  async function captureOnce(note) {
    await page.mouse.move(40, 40);
    await page.mouse.down();
    await page.mouse.move(420, 220, { steps: 10 });
    await page.mouse.up();

    await page.waitForFunction(() =>
      !!document.querySelector('pinpoint-overlay').shadowRoot.querySelector('.panel'), null, { timeout: 15000 });
    const thumb = await page.evaluate(() => {
      const img = document.querySelector('pinpoint-overlay').shadowRoot.querySelector('img');
      return !!img && img.src.startsWith('data:image/');
    });

    await page.evaluate((t) => {
      const ta = document.querySelector('pinpoint-overlay').shadowRoot.querySelector('textarea');
      ta.focus();
      ta.value = t;
    }, note);
    await page.keyboard.press('Control+Enter');

    const item = await sw.evaluate(async (n) => {
      for (let i = 0; i < 100; i++) {
        const items = await PP.getItems();
        const hit = items.find((x) => x.description === n);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    }, note);
    return { item, thumb };
  }

  const first = await captureOnce('The heading crowds the logo.');
  check('captureVisibleTab and the crop produce a thumbnail', first.thumb);
  check('the capture is stored with a note and a real file',
    !!(first.item && first.item.path && fs.existsSync(first.item.path)),
    first.item && `${first.item.via} ${first.item.path}`);
  if (installedManifest) {
    check('the native host takes the save when it is installed',
      !!(first.item && first.item.via === 'native'), first.item && first.item.via);
    if (first.item && first.item.via === 'native') cleanup.push(first.item.path);
  } else {
    console.log('  --   no native host installed, skipping the native route');
  }

  // Now force the no-host case: Chrome's Downloads API is the fallback, and
  // it has to accept the data: URL a service worker can produce.
  await sw.evaluate(() => { nativeSend = () => Promise.reject(new Error('test: pretend no host')); });

  const fallback = await captureOnce('This card should go full width.');
  check('the downloads fallback writes a real file',
    !!(fallback.item && fallback.item.via === 'downloads' && fallback.item.path && fs.existsSync(fallback.item.path)),
    fallback.item && `${fallback.item.via} ${fallback.item.path}`);

  check('nothing threw on the page', problems.length === 0, problems.join(' | '));
} finally {
  await context.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  for (const f of cleanup) fs.rmSync(f, { force: true });
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
