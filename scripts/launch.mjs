#!/usr/bin/env node
/* Opens a dedicated dev browser with Pinpoint already loaded, against a
   persistent profile — so pinned toolbar buttons, logins and captures all
   survive between runs.

     node scripts/launch.mjs firefox [url]
     node scripts/launch.mjs chrome  [url]

   Firefox goes through web-ext, which side-loads the add-on temporarily and
   needs no signing. Chrome takes the built folder straight off the command
   line. Either way the build runs first. */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './ids.mjs';

const browser = (process.argv[2] || 'firefox').toLowerCase();
const url = process.argv[3] || '';
if (browser !== 'firefox' && browser !== 'chrome') {
  console.error('usage: node scripts/launch.mjs <firefox|chrome> [url]');
  process.exit(1);
}

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), browser], { stdio: 'inherit' });

const dist = path.join(ROOT, 'dist', browser);
const profile = path.join(os.homedir(), '.pinpoint-dev-profile-' + browser);
fs.mkdirSync(profile, { recursive: true });
console.log('profile    ' + profile);

if (browser === 'firefox') {
  const args = [
    '--yes', 'web-ext', 'run',
    '--source-dir', dist,
    '--firefox-profile', profile,
    '--keep-profile-changes',
    '--no-reload'
  ];
  if (url) args.push('--start-url', url);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  spawn(npx, args, { stdio: 'inherit', shell: process.platform === 'win32' });
} else {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
    : [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) {
    console.error('Chrome not found. Set CHROME_PATH, or load ' + path.relative(ROOT, dist) + ' by hand:');
    console.error('  chrome://extensions -> Developer mode -> Load unpacked');
    process.exit(1);
  }
  const args = [`--user-data-dir=${profile}`, `--load-extension=${dist}`, '--no-first-run'];
  if (url) args.push(url);
  spawn(exe, args, { stdio: 'inherit' });
}
