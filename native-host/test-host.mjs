#!/usr/bin/env node
/* End-to-end check of the native host without a browser in the picture:
   speaks the same framed protocol, then verifies the files landed and that
   the system clipboard really holds a file drop. */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'pinpoint-selftest');
const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const CAN_CLIP = IS_WINDOWS || IS_MAC;

/* Read the file paths back off the clipboard, however this platform stores them. */
function readClipboardFiles() {
  const r = IS_WINDOWS
    ? spawnSync('powershell.exe',
      ['-NoProfile', '-STA', '-Command', 'Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }'],
      { encoding: 'utf8', windowsHide: true })
    // clip-files.jxa.js writes NSURLs, so read the same class back out.
    : spawnSync('osascript', ['-l', 'JavaScript', '-e',
      'ObjC.import("AppKit"); ObjC.unwrap($.NSPasteboard.generalPasteboard' +
      '.readObjectsForClassesOptions($([$.NSURL]), $()) || $([]))' +
      '.map(function (u) { return ObjC.unwrap(u.path); }).join("\\n")'],
    { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const child = spawn(process.execPath, [path.join(HERE, 'host.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buf = Buffer.alloc(0);
const waiters = new Map();

child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    const w = waiters.get(msg.id);
    if (w) {
      waiters.delete(msg.id);
      w(msg);
    }
  }
});

let seq = 0;
function call(payload) {
  const id = ++seq;
  const body = Buffer.from(JSON.stringify({ id, ...payload }), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  child.stdin.write(Buffer.concat([header, body]));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + payload.type)), 20000);
    waiters.set(id, (m) => { clearTimeout(timer); resolve(m); });
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : ''));
}

// 1x1 red PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  fs.rmSync(OUT, { recursive: true, force: true });

  const ping = await call({ type: 'ping', outputDir: OUT });
  check('ping', ping.ok === true && !!ping.version, 'v' + ping.version);

  const shot = await call({ type: 'saveShot', name: 'selftest-01.png', outputDir: OUT, data: PNG });
  check('saveShot writes a png', shot.ok === true && fs.existsSync(shot.path), shot.path || shot.error);

  const shot2 = await call({ type: 'saveShot', name: 'selftest-01.png', outputDir: OUT, data: PNG });
  check('saveShot de-duplicates names', shot2.ok === true && shot2.path !== shot.path, path.basename(shot2.path || ''));

  const text = shot.path + '\nmake the heading smaller\nurl: http://localhost:4321/\n';
  const bundle = await call({ type: 'writeBundle', name: 'selftest.txt', text, outputDir: OUT, clipboard: CAN_CLIP });
  check('writeBundle writes the txt', bundle.ok === true && fs.existsSync(bundle.path), bundle.path || bundle.error);

  if (bundle.ok) {
    const onDisk = fs.readFileSync(bundle.path, 'utf8');
    check(IS_WINDOWS ? 'bundle uses CRLF' : 'bundle uses LF',
      IS_WINDOWS ? onDisk.includes('\r\n') : !onDisk.includes('\r'));
  }

  if (CAN_CLIP) {
    check('clipboard reported ok', bundle.clipboard === true, bundle.error || '');
  }

  if (bundle.clipboard) {
    const clip = readClipboardFiles();
    check('clipboard holds the file itself', clip.includes(path.basename(bundle.path)), clip.split('\n')[0] || '(empty)');
  }

  const outside = path.join(os.tmpdir(), 'pinpoint-should-not-delete.txt');
  fs.writeFileSync(outside, 'keep me');
  const bad = await call({ type: 'deleteFile', path: outside, outputDir: OUT });
  check('refuses deletes outside the output folder', bad.ok === false && fs.existsSync(outside), bad.error || '');
  fs.unlinkSync(outside);

  const del = await call({ type: 'deleteFile', path: shot2.path, outputDir: OUT });
  check('deletes inside the output folder', del.ok === true && !fs.existsSync(shot2.path));

  const unknown = await call({ type: 'nope' });
  check('rejects unknown message types', unknown.ok === false);
} catch (e) {
  check('threw', false, e.message);
} finally {
  child.stdin.end();
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) process.exitCode = 1;
child.kill();
