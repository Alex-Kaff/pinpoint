#!/usr/bin/env node
/*
  Undoes install.mjs. Captured screenshots are left alone.
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_NAME } from '../scripts/ids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === 'win32';

const WINDOWS_KEYS = [
  'Software\\Mozilla',
  'Software\\Google\\Chrome',
  'Software\\Chromium',
  'Software\\Microsoft\\Edge',
  'Software\\BraveSoftware\\Brave-Browser'
];

const support = path.join(os.homedir(), 'Library', 'Application Support');
const MAC_DIRS = ['Mozilla', 'Google/Chrome', 'Chromium', 'Microsoft Edge', 'BraveSoftware/Brave-Browser'];

if (IS_WINDOWS) {
  for (const base of WINDOWS_KEYS) {
    const key = `HKCU\\${base}\\NativeMessagingHosts\\${HOST_NAME}`;
    try {
      execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      console.log('removed ' + key);
    } catch {
      // Not registered for that browser; nothing to undo.
    }
  }
} else {
  for (const rel of MAC_DIRS) {
    const file = path.join(support, ...rel.split('/'), 'NativeMessagingHosts', HOST_NAME + '.json');
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log('removed ' + file);
    }
  }
}

for (const name of ['manifest.firefox.json', 'manifest.chrome.json', 'pinpoint-host.bat', 'pinpoint-host.sh']) {
  const p = path.join(HERE, name);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('removed ' + p);
  }
}

console.log('Uninstalled. Pinpoint falls back to your Downloads folder until you re-install the host.');
