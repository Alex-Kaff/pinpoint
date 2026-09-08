/* Pinpoint background: owns the native host connection, the screenshot crop,
   the item store, and the bundle/clipboard hand-off. */

/* ---------------------------------------------------------------- native host */

const native = {
  port: null,
  seq: 0,
  pending: new Map(),
  status: 'unknown',   // unknown | ok | missing
  error: null,
  info: null
};

function nativeDisconnect(err) {
  native.port = null;
  native.status = 'missing';
  native.error = err || 'native host disconnected';
  for (const [, p] of native.pending) p.reject(new Error(native.error));
  native.pending.clear();
}

function nativeConnect() {
  if (native.port) return native.port;
  const port = browser.runtime.connectNative(PP.NATIVE_ID);
  port.onMessage.addListener((msg) => {
    const p = native.pending.get(msg && msg.id);
    if (!p) return;
    native.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok === false) p.reject(new Error(msg.error || 'native host error'));
    else p.resolve(msg);
  });
  port.onDisconnect.addListener((p) => {
    const e = (p && p.error && p.error.message) || (browser.runtime.lastError && browser.runtime.lastError.message);
    nativeDisconnect(e || 'native host is not installed');
  });
  native.port = port;
  return port;
}

function nativeSend(payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = nativeConnect();
    } catch (e) {
      nativeDisconnect(e.message);
      return reject(e);
    }
    const id = ++native.seq;
    const timer = setTimeout(() => {
      native.pending.delete(id);
      reject(new Error('native host timed out'));
    }, timeoutMs);
    native.pending.set(id, { resolve, reject, timer });
    try {
      port.postMessage({ id, ...payload });
    } catch (e) {
      native.pending.delete(id);
      clearTimeout(timer);
      nativeDisconnect(e.message);
      reject(e);
    }
  });
}

async function nativePing() {
  try {
    const s = await PP.getSettings();
    const res = await nativeSend({ type: 'ping', outputDir: s.outputDir }, 8000);
    native.status = 'ok';
    native.error = null;
    native.info = res;
    return { ok: true, ...res };
  } catch (e) {
    native.status = 'missing';
    native.error = e.message;
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------- capture */

/* A capture lives between "you let go of the mouse" and "you hit save", which can
   easily be longer than the ~30s idle timeout that unloads an MV3 event page.
   So park it in session storage, with an in-memory mirror for speed. */
const shotCache = new Map();      // shotId -> { dataUrl, thumb, width, height }
const sessionStore = browser.storage.session || null;

async function putPending(id, shot) {
  shotCache.set(id, shot);
  if (sessionStore) {
    try { await sessionStore.set({ ['shot:' + id]: shot }); } catch (e) { /* keep the memory copy */ }
  }
}

async function takePending(id) {
  let shot = shotCache.get(id);
  if (!shot && sessionStore) {
    try {
      const got = await sessionStore.get('shot:' + id);
      shot = got['shot:' + id];
    } catch (e) { /* nothing to recover */ }
  }
  return shot;
}

async function dropPending(id) {
  shotCache.delete(id);
  if (sessionStore) {
    try { await sessionStore.remove('shot:' + id); } catch (e) { /* already gone */ }
  }
}

/* Chrome's service worker has no FileReader, so encode by hand. */
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(bin);
}

async function cropShot(fullDataUrl, rect, cssViewportWidth, settings) {
  const blob = await (await fetch(fullDataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  // captureVisibleTab may hand back device pixels, so derive the scale from the image itself.
  const scale = bmp.width / cssViewportWidth;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.width * scale)));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.height * scale)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const type = settings.imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const outBlob = await canvas.convertToBlob(
    type === 'image/jpeg' ? { type, quality: settings.jpegQuality } : { type }
  );

  // A small preview keeps the popup list cheap to store and render.
  const tw = Math.min(360, sw);
  const th = Math.max(1, Math.round((sh * tw) / sw));
  const tc = new OffscreenCanvas(tw, th);
  tc.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th);
  const thumbBlob = await tc.convertToBlob({ type: 'image/jpeg', quality: 0.7 });

  bmp.close();
  return {
    dataUrl: await blobToDataUrl(outBlob),
    thumb: await blobToDataUrl(thumbBlob),
    width: sw,
    height: sh,
    ext: type === 'image/jpeg' ? 'jpg' : 'png'
  };
}

async function captureRegion(tab, rect, viewportWidth) {
  const settings = await PP.getSettings();
  const full = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const shot = await cropShot(full, rect, viewportWidth, settings);
  const id = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  await putPending(id, shot);
  // Never let an abandoned overlay hold a full screenshot forever.
  setTimeout(() => dropPending(id), 10 * 60 * 1000);
  return { shotId: id, thumb: shot.thumb, width: shot.width, height: shot.height };
}

/* --------------------------------------------------------------- persistence */

function dataUrlToBase64(dataUrl) {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

async function saveViaDownloads(dataUrl, filename) {
  const id = await browser.downloads.download({
    url: dataUrl,
    filename: 'pinpoint/' + filename,
    saveAs: false,
    conflictAction: 'uniquify'
  });
  // Wait for the real on-disk path, which is what the agent will read.
  const path = await new Promise((resolve) => {
    const done = (items) => resolve((items && items[0] && items[0].filename) || null);
    const listener = (delta) => {
      if (delta.id !== id) return;
      if (delta.state && delta.state.current === 'complete') {
        browser.downloads.onChanged.removeListener(listener);
        browser.downloads.search({ id }).then(done);
      }
    };
    browser.downloads.onChanged.addListener(listener);
    setTimeout(() => {
      browser.downloads.onChanged.removeListener(listener);
      browser.downloads.search({ id }).then(done);
    }, 5000);
  });
  return { path, via: 'downloads' };
}

function pageSlug(url) {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
  } catch {
    return 'page';
  }
}

async function saveShot(shot, meta, index) {
  const settings = await PP.getSettings();
  const n = String(index).padStart(2, '0');
  const filename = PP.stamp() + '-' + n + '-' + pageSlug(meta.url) + '.' + shot.ext;

  try {
    const res = await nativeSend({
      type: 'saveShot',
      name: filename,
      outputDir: settings.outputDir,
      data: dataUrlToBase64(shot.dataUrl)
    }, 30000);
    native.status = 'ok';
    native.error = null;
    return { path: res.path, via: 'native' };
  } catch (e) {
    native.error = e.message;
    native.status = 'missing';
    return await saveViaDownloads(shot.dataUrl, filename);
  }
}

/* -------------------------------------------------------------------- bundle */

/* The background page cannot always reach the clipboard directly, so fall back
   to running the write inside the active tab. */
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* fall through */ }
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return false;
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => {
        navigator.clipboard.writeText(t).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = t;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        });
      },
      args: [text]
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function copyBundle() {
  const settings = await PP.getSettings();
  const items = await PP.getItems();
  if (!items.length) return { ok: false, error: 'Nothing captured yet.' };

  const text = PP.buildBundle(items, settings);
  const name = (settings.bundleName || 'pinpoint-notes') + '-' + PP.stamp() + '.txt';
  const wantFile = settings.clipboard === 'file' || settings.clipboard === 'both';
  const wantText = settings.clipboard === 'text' || settings.clipboard === 'both';

  if (wantFile) {
    try {
      const extra = settings.clipboardIncludeImages
        ? items.filter((i) => i.via === 'native' && i.path).map((i) => i.path)
        : [];
      const res = await nativeSend({
        type: 'writeBundle',
        name,
        text,
        outputDir: settings.outputDir,
        clipboard: true,
        extraFiles: extra
      }, 20000);
      native.status = 'ok';
      native.error = null;
      if (wantText) await copyTextToClipboard(text);
      return { ok: true, path: res.path, clipboard: 'file', count: items.length };
    } catch (e) {
      native.status = 'missing';
      native.error = e.message;
      // No host: still hand back something usable.
      const dl = await saveViaDownloads(
        'data:text/plain;charset=utf-8,' + encodeURIComponent(text.replace(/\n/g, '\r\n')),
        name
      );
      await copyTextToClipboard(text);
      return {
        ok: true,
        path: dl.path,
        clipboard: 'text',
        count: items.length,
        warning: 'Native host unavailable, so the text was copied instead of the file itself.'
      };
    }
  }

  await copyTextToClipboard(text);
  return { ok: true, clipboard: 'text', count: items.length };
}

/* ------------------------------------------------------------------- overlay */

async function startCapture(tabId, mode) {
  let target;
  if (tabId) target = await browser.tabs.get(tabId);
  else target = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target) throw new Error('No active tab.');
  if (PPX.isRestricted(target.url)) {
    throw new Error('The browser does not let extensions run on this page.');
  }
  await browser.scripting.executeScript({
    target: { tabId: target.id },
    files: ['lib/browser-shim.js', 'content/overlay.js']
  });
  const count = (await PP.getItems()).length;
  await browser.tabs.sendMessage(target.id, {
    type: 'pinpoint:begin',
    count,
    mode: mode === 'element' ? 'element' : 'region'
  });
  return { ok: true };
}

/* ----------------------------------------------------------------- messaging */

PPX.onMessage((msg, sender) => {
  switch (msg && msg.type) {
    case 'start-capture':
      return startCapture(msg.tabId, msg.mode).catch((e) => ({ ok: false, error: e.message }));

    case 'capture-region':
      return captureRegion(sender.tab, msg.rect, msg.viewport.width)
        .then((r) => ({ ok: true, ...r }))
        .catch((e) => ({ ok: false, error: e.message }));

    case 'discard-region':
      return dropPending(msg.shotId).then(() => ({ ok: true }));

    case 'save-region':
      return (async () => {
        const shot = await takePending(msg.shotId);
        if (!shot) return { ok: false, error: 'That capture expired, take it again.' };
        const items = await PP.getItems();
        const saved = await saveShot(shot, msg.meta, items.length + 1);
        await dropPending(msg.shotId);
        items.push({
          id: msg.shotId,
          path: saved.path,
          via: saved.via,
          description: msg.description || '',
          url: msg.meta.url,
          title: msg.meta.title,
          mode: msg.meta.mode || 'region',
          target: msg.meta.target || null,
          rect: msg.meta.rect,
          viewport: msg.meta.viewport,
          scroll: msg.meta.scroll,
          elements: msg.meta.elements || [],
          thumb: shot.thumb,
          width: shot.width,
          height: shot.height,
          createdAt: Date.now()
        });
        await PP.setItems(items);
        return { ok: true, path: saved.path, via: saved.via, count: items.length };
      })().catch((e) => ({ ok: false, error: e.message }));

    case 'get-state':
      return (async () => ({
        ok: true,
        items: await PP.getItems(),
        settings: await PP.getSettings(),
        native: { status: native.status, error: native.error, info: native.info }
      }))();

    case 'ping-native':
      return nativePing();

    case 'update-item':
      return (async () => {
        const items = await PP.getItems();
        const it = items.find((x) => x.id === msg.id);
        if (it) Object.assign(it, msg.patch);
        await PP.setItems(items);
        return { ok: true };
      })();

    case 'delete-item':
      return (async () => {
        const items = await PP.getItems();
        const gone = items.find((x) => x.id === msg.id);
        const next = items.filter((x) => x.id !== msg.id);
        await PP.setItems(next);
        if (msg.deleteFile && gone && gone.via === 'native' && gone.path) {
          nativeSend({ type: 'deleteFile', path: gone.path }, 5000).catch(() => {});
        }
        return { ok: true, count: next.length };
      })();

    case 'clear-items':
      return (async () => {
        const items = await PP.getItems();
        await PP.setItems([]);
        if (msg.deleteFiles) {
          for (const it of items) {
            if (it.via === 'native' && it.path) {
              nativeSend({ type: 'deleteFile', path: it.path }, 5000).catch(() => {});
            }
          }
        }
        return { ok: true };
      })();

    case 'copy-bundle':
      return copyBundle().catch((e) => ({ ok: false, error: e.message }));

    case 'reveal':
      return nativeSend({ type: 'reveal', path: msg.path }, 8000)
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: e.message }));

    default:
      return false;
  }
});

browser.commands.onCommand.addListener((cmd) => {
  if (cmd === 'capture-region') startCapture(null, 'region').catch(() => {});
  if (cmd === 'pick-element') startCapture(null, 'element').catch(() => {});
});

browser.runtime.onInstalled.addListener(() => {
  nativePing();
});
