#!/usr/bin/env node
/* Assembles a loadable extension folder per browser.

   The two engines disagree on exactly one file — the manifest — so the source
   in extension/ carries no manifest at all and this drops the right one in.

     node scripts/build.mjs              both browsers
     node scripts/build.mjs firefox      just one
     node scripts/build.mjs --zip        also pack dist/pinpoint-<browser>-<v>.zip
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readManifest } from './ids.mjs';

const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

// Chrome's service-worker entry means nothing to Firefox, and vice versa.
const EXCLUDE = { firefox: new Set(['sw.js']), chrome: new Set([]) };

const args = process.argv.slice(2);
const zip = args.includes('--zip');
const wanted = args.filter((a) => !a.startsWith('--'));
const browsers = wanted.length ? wanted : ['firefox', 'chrome'];

function copyTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst, skip);
    else fs.copyFileSync(src, dst);
  }
}

function pack(dir, out) {
  fs.rmSync(out, { force: true });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${dir}\\*' -DestinationPath '${out}' -Force`
    ], { stdio: 'ignore' });
  } else {
    execFileSync('zip', ['-qr', out, '.'], { cwd: dir, stdio: 'ignore' });
  }
}

for (const browser of browsers) {
  if (!EXCLUDE[browser]) throw new Error(`unknown browser: ${browser} (firefox | chrome)`);
  const manifest = readManifest(browser);
  const out = path.join(DIST, browser);

  fs.rmSync(out, { recursive: true, force: true });
  copyTree(SRC, out, EXCLUDE[browser]);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Every icon the manifest promises has to be there, or the browser refuses
  // the whole extension — and the PNGs are generated, not hand-written.
  for (const file of Object.values(manifest.icons || {})) {
    if (!fs.existsSync(path.join(out, file))) {
      throw new Error(`${file} is missing — run: node scripts/icons.mjs`);
    }
  }

  console.log(`${browser.padEnd(8)} ${path.relative(ROOT, out)}`);
  if (zip) {
    const archive = path.join(DIST, `pinpoint-${browser}-${manifest.version}.zip`);
    pack(out, archive);
    console.log(`${''.padEnd(8)} ${path.relative(ROOT, archive)}`);
  }
}
