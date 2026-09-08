#!/usr/bin/env node
/* Pinpoint native messaging host.
 *
 * Speaks Firefox's native messaging protocol on stdin/stdout: a 4-byte
 * little-endian length followed by that many bytes of UTF-8 JSON.
 *
 * NOTHING may be written to stdout except framed messages — a stray console.log
 * corrupts the stream and Firefox drops the connection. Diagnostics go to stderr,
 * which Firefox surfaces in the browser console.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.3.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = path.join(os.tmpdir(), 'pinpoint');
const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/* stderr goes to Firefox's browser console, which is awkward to reach when the
   connection itself is what's broken — so mirror every line to a log file. */
const LOG_FILE = path.join(DEFAULT_BASE, 'host.log');

function log(...a) {
  const line = '[pinpoint] ' + a.join(' ') + '\n';
  process.stderr.write(line);
  try {
    fs.mkdirSync(DEFAULT_BASE, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 256 * 1024) {
      fs.writeFileSync(LOG_FILE, '');
    }
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line);
  } catch (e) { /* logging must never take the host down */ }
}

/* ------------------------------------------------------------------ helpers */

function dayFolder() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function baseDirFor(outputDir) {
  const base = outputDir && outputDir.trim() ? path.resolve(outputDir.trim()) : DEFAULT_BASE;
  return base;
}

function sessionDirFor(outputDir) {
  const dir = path.join(baseDirFor(outputDir), dayFolder());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* Deletions and reveals are only ever allowed under a directory we write to. */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeName(name, fallback) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^\.+/, '').trim();
  return clean || fallback;
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    p = path.join(dir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || out || `${cmd} exited ${code}`).trim()));
    });
  });
}

/* Putting *files* (not their names) on the clipboard is the one thing neither
   platform exposes to Node, so each hands off to its own system scripting:
   a CF_HDROP through PowerShell on Windows, an NSPasteboard write through
   JXA on macOS. */
async function copyFilesToClipboard(files) {
  const listFile = path.join(os.tmpdir(), `pinpoint-clip-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(listFile, JSON.stringify(files), 'utf8');
  try {
    if (IS_WINDOWS) {
      await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA',
        '-File', path.join(HERE, 'clip-files.ps1'), '-ListFile', listFile
      ]);
    } else if (IS_MAC) {
      await run('osascript', ['-l', 'JavaScript', path.join(HERE, 'clip-files.jxa.js'), listFile]);
    } else {
      throw new Error(`putting files on the clipboard is only implemented for Windows and macOS (this is ${process.platform})`);
    }
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
}

/* ----------------------------------------------------------------- handlers */

const handlers = {
  ping({ outputDir }) {
    const dir = baseDirFor(outputDir);
    return { version: VERSION, outputDir: dir, node: process.version, platform: process.platform };
  },

  saveShot({ name, data, outputDir }) {
    if (!data) throw new Error('no image data');
    const dir = sessionDirFor(outputDir);
    const file = uniquePath(dir, safeName(name, `region-${Date.now()}.png`));
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return { path: file, bytes: fs.statSync(file).size };
  },

  async writeBundle({ name, text, outputDir, clipboard, extraFiles }) {
    const dir = sessionDirFor(outputDir);
    const file = uniquePath(dir, safeName(name, `pinpoint-notes-${Date.now()}.txt`));
    // CRLF on Windows so the file opens sanely in Notepad; LF everywhere else.
    const body = String(text || '').replace(/\r?\n/g, IS_WINDOWS ? '\r\n' : '\n');
    fs.writeFileSync(file, body, 'utf8');

    let clipboardOk = false;
    let clipboardError = null;
    if (clipboard) {
      const files = [file, ...(Array.isArray(extraFiles) ? extraFiles : []).filter((f) => f && fs.existsSync(f))];
      try {
        await copyFilesToClipboard(files);
        clipboardOk = true;
      } catch (e) {
        clipboardError = e.message;
        log('clipboard failed:', e.message);
      }
    }
    if (clipboard && !clipboardOk) throw new Error('bundle written to ' + file + ' but clipboard failed: ' + clipboardError);
    return { path: file, clipboard: clipboardOk };
  },

  deleteFile({ path: target, outputDir }) {
    if (!target) throw new Error('no path');
    const base = baseDirFor(outputDir);
    if (!isInside(base, target) && !isInside(DEFAULT_BASE, target)) {
      throw new Error('refusing to delete outside the Pinpoint output folder');
    }
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { deleted: true };
  },

  async reveal({ path: target }) {
    if (!target || !fs.existsSync(target)) throw new Error('file not found');
    const full = path.resolve(target);
    const [cmd, args] = IS_WINDOWS ? ['explorer.exe', ['/select,', full]]
      : IS_MAC ? ['open', ['-R', full]]
        : ['xdg-open', [path.dirname(full)]];
    await new Promise((resolve) => {
      const p = spawn(cmd, args, { windowsHide: false, stdio: 'ignore' });
      // explorer.exe returns a non-zero exit code even on success, so just let it go.
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
    return { revealed: true };
  }
};

/* ----------------------------------------------------------------- protocol */

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function dispatch(msg) {
  const { id, type } = msg || {};
  const fn = handlers[type];
  if (!fn) return send({ id, ok: false, error: 'unknown message type: ' + type });
  try {
    const res = await fn(msg);
    send({ id, ok: true, ...res });
  } catch (e) {
    log('error in', type + ':', e.message);
    send({ id, ok: false, error: e.message });
  }
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (len > 512 * 1024 * 1024) {
      log('message too large, dropping connection');
      process.exit(1);
    }
    if (buf.length < 4 + len) return;
    const body = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch (e) {
      log('bad JSON:', e.message);
      continue;
    }
    dispatch(msg);
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', (e) => log('uncaught:', e.stack || e.message));

log('started, node', process.version, 'default output', DEFAULT_BASE);
