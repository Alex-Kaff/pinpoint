/* Drives the real overlay content script in a real browser against a page that
   looks like an Astro dev page, with the extension APIs stubbed. Checks the
   drag-select flow, the note panel, and the metadata handed to the background.

   Run: node test/overlay.test.mjs      (needs the repo's playwright install)
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIM = fs.readFileSync(path.join(HERE, '..', 'extension', 'lib', 'browser-shim.js'), 'utf8');
const OVERLAY = fs.readFileSync(path.join(HERE, '..', 'extension', 'content', 'overlay.js'), 'utf8');

const PAGE = `<!doctype html><meta charset="utf-8"><title>Sample</title>
<style>
  body { margin: 0; font: 16px system-ui; }
  header { padding: 24px; background: #eee; }
  h1 { margin: 0 0 8px; }
  nav a { margin-right: 12px; }
  .card { margin: 40px 24px; padding: 20px; border: 1px solid #ccc; width: 400px; }
</style>
<header data-astro-source-file="src/components/Header.astro" data-astro-source-loc="4:0">
  <h1 id="brand" data-astro-source-file="src/components/Header.astro" data-astro-source-loc="12:4">Kaffetzakis</h1>
  <nav class="nav">
    <a href="#a" class="link">Work</a>
    <a href="#b" class="link">About</a>
  </nav>
</header>
<div class="card" data-testid="promo"><p>Body copy that sits far below the header.</p></div>`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : ''));
}

// A real origin, so the recorded URL is the kind an agent would actually get.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(origin + '/en/');

// Stub the extension APIs the overlay talks to, and record every call.
await page.evaluate(() => {
  window.__calls = [];
  window.browser = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(msg) {
        window.__calls.push(msg);
        if (msg.type === 'capture-region') {
          // Record whether the overlay really took itself out of the picture.
          const host = document.querySelector('pinpoint-overlay');
          window.__visibilityDuringShot = host && host.style.visibility;
          return Promise.resolve({
            ok: true,
            shotId: 'shot1',
            thumb: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            width: Math.round(msg.rect.width),
            height: Math.round(msg.rect.height)
          });
        }
        if (msg.type === 'save-region') return Promise.resolve({ ok: true, count: 1, path: 'C:\\tmp\\a.png', via: 'native' });
        return Promise.resolve({ ok: true });
      }
    }
  };
});

await page.addScriptTag({ content: SHIM });
await page.addScriptTag({ content: OVERLAY });
await page.evaluate(() => window.__pinpointOverlay.begin(0));

const shadow = 'pinpoint-overlay';
check('overlay mounts into a shadow root',
  await page.evaluate((t) => !!document.querySelector(t)?.shadowRoot?.querySelector('.root'), shadow));
check('page markup is untouched',
  await page.evaluate(() => document.body.querySelectorAll('div.root, .hud').length === 0));

// Drag a rectangle over the header.
await page.mouse.move(20, 20);
await page.mouse.down();
await page.mouse.move(300, 60, { steps: 8 });
const sizeLabel = await page.evaluate((t) =>
  document.querySelector(t).shadowRoot.querySelector('.size')?.textContent, shadow);
check('live size readout while dragging', sizeLabel === '280 × 40', sizeLabel);

await page.mouse.move(520, 130, { steps: 8 });
await page.mouse.up();
await page.waitForFunction((t) =>
  !!document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });
check('note panel appears after the drag', true);

const capture = await page.evaluate(() => window.__calls.find((c) => c.type === 'capture-region'));
check('capture rect matches the drag',
  capture && Math.round(capture.rect.x) === 20 && Math.round(capture.rect.y) === 20 &&
  Math.round(capture.rect.width) === 500 && Math.round(capture.rect.height) === 110,
  JSON.stringify(capture && capture.rect));
check('capture reports the css viewport width', capture && capture.viewport.width === 1000);

// The overlay must not appear in its own screenshot, and must come back after.
const duringShot = await page.evaluate(() => window.__visibilityDuringShot);
check('overlay hides itself for the shot', duringShot === 'hidden', duringShot);
check('overlay comes back after the shot',
  await page.evaluate((t) => document.querySelector(t).style.visibility === 'visible', shadow));

// Type a note and save with Ctrl+Enter.
await page.evaluate((t) => {
  const ta = document.querySelector(t).shadowRoot.querySelector('textarea');
  ta.focus();
  ta.value = 'Give the heading more room.';
}, shadow);
await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => window.__calls.some((c) => c.type === 'save-region'), null, { timeout: 5000 });

const save = await page.evaluate(() => window.__calls.find((c) => c.type === 'save-region'));
check('save carries the note', save.description === 'Give the heading more room.');
check('save carries the url and title', save.meta.url === origin + '/en/' && save.meta.title === 'Sample', save.meta.url);
check('save carries viewport and scroll', save.meta.viewport.width === 1000 && save.meta.scroll.y === 0);

const els = save.meta.elements;
const selectors = els.map((e) => e.selector);
check('elements inside the region were collected', els.length >= 3, selectors.slice(0, 4).join(' | '));
check('the heading is identified by its id', selectors.includes('#brand'), selectors.join(' | '));
check('astro source locations are carried through',
  els.some((e) => e.source === 'src/components/Header.astro:12:4'),
  JSON.stringify(els.find((e) => e.source)));
check('nav links get positional selectors',
  selectors.some((s) => /nav\.nav > a(\.link)?:nth-of-type\(2\)/.test(s)), selectors.join(' | '));
check('element text is captured', els.some((e) => e.text === 'Kaffetzakis'));
check('the far-away card is excluded', !selectors.some((s) => s.includes('promo')), selectors.join(' | '));
check('overlay elements never appear in the results',
  !selectors.some((s) => s.includes('pinpoint')), selectors.join(' | '));

// Back to idle, ready for the next region, with the saved count shown.
await page.waitForFunction((t) =>
  !document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });
const hud = await page.evaluate((t) =>
  document.querySelector(t).shadowRoot.querySelector('.hud')?.textContent, shadow);
check('returns to idle showing the running count', /1\s*saved/.test(hud || ''), hud);

// Escape tears the whole thing down.
await page.keyboard.press('Escape');
check('escape removes the overlay',
  await page.evaluate((t) => !document.querySelector(t), shadow));

/* --------------------------------------------------------- element picker mode */

await page.evaluate(() => { window.__calls.length = 0; });
await page.addScriptTag({ content: SHIM });
await page.addScriptTag({ content: OVERLAY });   // re-inject; the guard makes this a no-op
await page.evaluate(() => window.__pinpointOverlay.begin(1, 'element'));

// Hovering highlights whatever is under the cursor, with no click involved.
await page.mouse.move(60, 40);          // over the <h1 id="brand">
const hi = async () => page.evaluate((t) => {
  const sr = document.querySelector(t).shadowRoot;
  const box = sr.querySelector('.hi');
  const label = sr.querySelector('.hi-label');
  return {
    shown: box && box.style.display !== 'none',
    rect: box && [box.style.left, box.style.top, box.style.width, box.style.height].join(' '),
    label: label && label.textContent,
    locked: box && box.classList.contains('locked')
  };
}, shadow);

let h = await hi();
check('hover highlights the element under the cursor', h.shown, h.label);
check('highlight is labelled with the selector', /#brand/.test(h.label || ''), h.label);
check('highlight label carries the source file', /Header\.astro:12:4/.test(h.label || ''), h.label);

const brandBox = await page.evaluate(() => {
  const r = document.querySelector('#brand').getBoundingClientRect();
  return [r.left + 'px', r.top + 'px', r.width + 'px', r.height + 'px'].join(' ');
});
check('highlight matches the element geometry exactly', h.rect === brandBox, h.rect + '  vs  ' + brandBox);

// Arrow up widens to the parent, arrow down goes back — the mis-click guard.
await page.keyboard.press('ArrowUp');
h = await hi();
check('ArrowUp widens to the parent', /^header/.test(h.label || ''), h.label);
await page.keyboard.press('ArrowDown');
h = await hi();
check('ArrowDown narrows back to where you were', /#brand/.test(h.label || ''), h.label);

// Moving over a different element re-targets, and empty space clears entirely.
await page.mouse.move(200, 200);        // inside the card, far from the header
h = await hi();
check('moving to another element re-targets the highlight',
  h.shown && /promo/.test(h.label || '') && !/#brand/.test(h.label || ''), h.label);

await page.mouse.move(950, 650);        // page background, nothing to pick
h = await hi();
check('empty space clears the highlight', !h.shown, h.shown ? h.label : '(hidden)');

// Click to lock in.
await page.mouse.move(60, 40);
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction((t) =>
  !!document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });

h = await hi();
check('the chosen element stays highlighted while you type', h.shown && h.locked, 'locked=' + h.locked);
check('panel names the target element',
  /#brand/.test(await page.evaluate((t) =>
    document.querySelector(t).shadowRoot.querySelector('.target')?.textContent, shadow) || ''));

const pickCapture = await page.evaluate(() => window.__calls.find((c) => c.type === 'capture-region'));
const brandRect = await page.evaluate(() => {
  const r = document.querySelector('#brand').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
check('the shot is the element box plus a small pad',
  Math.abs(pickCapture.rect.x - (brandRect.x - 6)) < 1 &&
  Math.abs(pickCapture.rect.width - (brandRect.w + 12)) < 1,
  JSON.stringify(pickCapture.rect));

await page.evaluate((t) => {
  const ta = document.querySelector(t).shadowRoot.querySelector('textarea');
  ta.focus();
  ta.value = 'Drop this a size on mobile.';
}, shadow);
await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => window.__calls.some((c) => c.type === 'save-region'), null, { timeout: 5000 });

const pickSave = await page.evaluate(() => window.__calls.find((c) => c.type === 'save-region'));
check('save records element mode', pickSave.meta.mode === 'element', pickSave.meta.mode);
check('save carries the target selector', pickSave.meta.target.selector === '#brand', pickSave.meta.target.selector);
check('save carries the target source', pickSave.meta.target.source === 'src/components/Header.astro:12:4');
check('save carries the target text', pickSave.meta.target.text === 'Kaffetzakis');

// An image and a text field carry their own useful attributes.
await page.waitForFunction((t) =>
  !document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });
await page.evaluate(() => {
  const img = document.createElement('img');
  img.id = 'shot';
  img.alt = 'A screenshot';
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  img.style.cssText = 'position:fixed;left:700px;top:500px;width:120px;height:80px';
  document.body.appendChild(img);
  const input = document.createElement('input');
  input.id = 'email';
  input.type = 'email';
  input.name = 'email';
  input.placeholder = 'you@example.com';
  input.value = 'alex@test.dev';
  input.style.cssText = 'position:fixed;left:700px;top:600px;width:200px;height:30px';
  document.body.appendChild(input);
});

async function pickAt(x, y) {
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction((t) =>
    !!document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });
  await page.evaluate((t) => {
    const sr = document.querySelector(t).shadowRoot;
    sr.querySelector('textarea').value = 'note';
  }, shadow);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__calls.some((c) => c.type === 'save-region'), null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.__calls.find((c) => c.type === 'save-region'));
  await page.waitForFunction((t) =>
    !document.querySelector(t).shadowRoot.querySelector('.panel'), shadow, { timeout: 5000 });
  return saved.meta.target;
}

const imgTarget = await pickAt(760, 540);
check('an image reports src, alt and natural size',
  imgTarget.tag === 'img' && imgTarget.attrs.alt === 'A screenshot' && !!imgTarget.attrs.natural,
  JSON.stringify(imgTarget.attrs));

const inputTarget = await pickAt(800, 615);
check('a text field reports type, name, placeholder and value',
  inputTarget.tag === 'input' && inputTarget.attrs.type === 'email' &&
  inputTarget.attrs.name === 'email' && inputTarget.attrs.value === 'alex@test.dev',
  JSON.stringify(inputTarget.attrs));

// Passwords are the one thing never recorded.
await page.evaluate(() => {
  const p = document.createElement('input');
  p.type = 'password';
  p.name = 'pw';
  p.value = 'hunter2';
  p.style.cssText = 'position:fixed;left:700px;top:660px;width:200px;height:30px';
  document.body.appendChild(p);
});
const pwTarget = await pickAt(800, 675);
check('a password field never records its value',
  pwTarget.attrs.type === 'password' && !('value' in pwTarget.attrs),
  JSON.stringify(pwTarget.attrs));

await page.keyboard.press('Escape');
check('escape leaves element mode too',
  await page.evaluate((t) => !document.querySelector(t), shadow));

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) process.exitCode = 1;
