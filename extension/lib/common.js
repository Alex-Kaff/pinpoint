/* Shared between the background script, the popup and the options page.
   Loaded as a classic script, so everything hangs off one global. */
const PP = (() => {
  const NATIVE_ID = 'com.kaffetzakis.pinpoint';

  const DEFAULTS = {
    outputDir: '',            // '' -> let the native host pick (%TEMP%\pinpoint)
    includeUrl: true,
    includeElements: true,
    includeSource: true,      // data-astro-source-file / -loc when present
    includeRect: false,
    maxElements: 12,
    clipboard: 'file',        // file | text | both
    clipboardIncludeImages: false,
    imageFormat: 'png',       // png | jpeg
    jpegQuality: 0.92,
    bundleName: 'pinpoint-notes'
  };

  async function getSettings() {
    const { settings } = await browser.storage.local.get('settings');
    return { ...DEFAULTS, ...(settings || {}) };
  }

  async function setSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await browser.storage.local.set({ settings: next });
    return next;
  }

  async function getItems() {
    const { items } = await browser.storage.local.get('items');
    return Array.isArray(items) ? items : [];
  }

  async function setItems(items) {
    await browser.storage.local.set({ items });
    return items;
  }

  function shortUrl(url, max = 64) {
    try {
      const u = new URL(url);
      const s = u.host + u.pathname + u.search;
      return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
    } catch {
      return String(url || '').slice(0, max);
    }
  }

  function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  /* The payload an agent actually reads: image path on its own line, then the note,
     then whatever metadata the settings turned on, then a blank line. */
  function buildBundle(items, s) {
    const blocks = items.map((it) => {
      const lines = [];
      lines.push(it.path || '(image not saved to disk)');
      const note = (it.description || '').trim();
      lines.push(note || '(no note)');
      if (s.includeUrl && it.url) lines.push(`url: ${it.url}`);
      // Element mode: the one thing the note is actually about goes first.
      if (it.target) {
        const t = it.target;
        lines.push(`element: ${t.selector}` + (t.text ? `  — "${t.text}"` : ''));
        if (s.includeSource && t.source) lines.push(`  source: ${t.source}`);
        for (const [k, v] of Object.entries(t.attrs || {})) lines.push(`  ${k}: ${v}`);
      }
      if (s.includeRect && it.rect) {
        const r = it.rect;
        lines.push(`region: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} css px (viewport ${it.viewport?.width}x${it.viewport?.height}, scroll ${Math.round(it.scroll?.x || 0)},${Math.round(it.scroll?.y || 0)})`);
      }
      let els = (it.elements || []).slice(0, s.maxElements);
      // Don't repeat the target in the surrounding-elements list.
      if (it.target) els = els.filter((e) => e.selector !== it.target.selector);
      if (s.includeElements && els.length) {
        lines.push(it.target ? 'also inside:' : 'elements:');
        for (const el of els) {
          let line = `  - ${el.selector}`;
          if (el.text) line += `  \u2014 "${el.text}"`;
          lines.push(line);
          if (s.includeSource && el.source) lines.push(`    source: ${el.source}`);
        }
      }
      return lines.join('\n');
    });
    return blocks.join('\n\n') + '\n';
  }

  return { NATIVE_ID, DEFAULTS, getSettings, setSettings, getItems, setItems, shortUrl, stamp, buildBundle };
})();

if (typeof module !== 'undefined') module.exports = PP;
