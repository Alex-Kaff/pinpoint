/* Pinpoint overlay. Injected on demand; everything lives in a shadow root so
   the host page's CSS cannot reach it and ours cannot leak out. */
(() => {
  if (window.__pinpointOverlay) {
    return;   // already loaded; the background sends "pinpoint:begin" separately
  }

  const HOST_TAG = 'pinpoint-overlay';
  const SKIP_TAGS = new Set(['html', 'body', 'script', 'style', 'link', 'meta', 'title', 'noscript', 'head', 'br', 'template']);
  const MIN_SIZE = 8;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
    .root { position: fixed; inset: 0; cursor: crosshair; }
    .root.review { cursor: default; }
    .veil { position: absolute; inset: 0; background: rgba(12, 13, 22, .38); }
    .sel {
      position: absolute; border: 1px solid #ffb27a;
      box-shadow: 0 0 0 100vmax rgba(12, 13, 22, .38);
      background: transparent; pointer-events: none;
    }
    .sel::after {
      content: ''; position: absolute; inset: -1px;
      outline: 1px dashed rgba(255, 255, 255, .55); outline-offset: 0;
    }
    .size {
      position: absolute; transform: translateY(-100%); margin-top: -6px;
      background: #14151f; color: #f4f4f8; font-size: 11px; line-height: 1;
      padding: 4px 6px; border-radius: 4px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .hud {
      position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
      background: rgba(20, 21, 31, .94); color: #e9e9f2; font-size: 12.5px;
      padding: 8px 14px; border-radius: 999px; display: flex; gap: 12px; align-items: center;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .35); pointer-events: none;
    }
    .hud b { color: #ffb27a; font-weight: 600; }
    kbd {
      background: #2c2e40; border-radius: 3px; padding: 1px 5px; font-size: 11px;
      font-family: ui-monospace, Consolas, monospace;
    }
    .panel {
      position: absolute; width: 380px; max-width: calc(100vw - 24px);
      background: #191a26; color: #ececf4; border: 1px solid #33344a;
      border-radius: 10px; box-shadow: 0 18px 48px rgba(0, 0, 0, .5);
      padding: 12px; display: flex; flex-direction: column; gap: 9px;
    }
    .panel .preview {
      max-height: 130px; width: 100%; object-fit: contain; object-position: left top;
      background: #0f101a; border-radius: 6px; border: 1px solid #2a2b3d;
    }
    .panel textarea {
      width: 100%; min-height: 74px; max-height: 40vh; resize: vertical;
      background: #10111b; color: #f2f2f8; border: 1px solid #383a52; border-radius: 6px;
      padding: 8px 9px; font-size: 13px; line-height: 1.45; outline: none;
      font-family: inherit;
    }
    .panel textarea:focus { border-color: #8f8cff; }
    .meta { font-size: 11px; color: #9a9ab4; display: flex; justify-content: space-between; gap: 8px; }
    .meta button.link {
      background: none; border: 0; color: #9a9ab4; cursor: pointer; font-size: 11px;
      text-decoration: underline; padding: 0;
    }
    .els {
      max-height: 108px; overflow: auto; font-size: 11px; color: #b9b9d0;
      font-family: ui-monospace, Consolas, monospace; background: #10111b;
      border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 8px; line-height: 1.5;
    }
    .els div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
    .row .spacer { flex: 1; font-size: 11px; color: #7d7d9a; }
    button.btn {
      font: inherit; font-size: 12.5px; padding: 7px 13px; border-radius: 6px; cursor: pointer;
      border: 1px solid #3a3c55; background: #23253440; color: #dcdcea;
    }
    button.btn:hover { background: #2b2d40; }
    button.btn.primary { background: #6c68ff; border-color: #6c68ff; color: #fff; }
    button.btn.primary:hover { background: #7d79ff; }
    .toast {
      position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%);
      background: #1d2a1f; color: #cfeccf; border: 1px solid #33552f;
      font-size: 12.5px; padding: 8px 14px; border-radius: 8px; pointer-events: none;
      max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .toast.err { background: #2c1c1f; color: #f2c9c9; border-color: #5d3038; }
    .root.pick { cursor: default; }
    .hi {
      position: absolute; border: 2px solid #6c68ff; background: rgba(108, 104, 255, .13);
      border-radius: 2px; pointer-events: none; transition: all .05s linear;
    }
    .hi.locked { border-color: #ffb27a; background: rgba(255, 178, 122, .11); transition: none; }
    .hi-label {
      position: absolute; background: #14151f; color: #f4f4f8; font-size: 11px; line-height: 1.35;
      padding: 4px 7px; border-radius: 4px; pointer-events: none; max-width: 64vw;
      font-family: ui-monospace, Consolas, monospace; box-shadow: 0 4px 14px rgba(0, 0, 0, .4);
    }
    .hi-label b { color: #ffb27a; font-weight: 500; }
    .hi-label i { color: #9698b4; font-style: normal; }
    .target {
      font-size: 11px; color: #b9b9d0; font-family: ui-monospace, Consolas, monospace;
      background: #10111b; border: 1px solid #2a2b3d; border-left: 2px solid #ffb27a;
      border-radius: 5px; padding: 6px 8px; line-height: 1.5;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `;

  /* --------------------------------------------------------------- selectors */

  function esc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&');
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      let s = node.tagName.toLowerCase();
      const testid = node.getAttribute('data-testid') || node.getAttribute('data-test-id');
      if (testid) {
        s += '[data-testid="' + testid + '"]';
      } else {
        const cls = Array.from(node.classList)
          .filter((c) => !/^(astro-|svelte-|css-|jsx-|sc-|emotion-)/.test(c) && !/^[a-z]{1,2}[0-9]{4,}$/i.test(c) && c.length < 32)
          .slice(0, 2);
        if (cls.length) s += '.' + cls.map(esc).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(s);
      if (!parent || parent === document.body || parent === document.documentElement) break;
      node = parent;
    }
    return parts.join(' > ');
  }

  /* Astro's dev server stamps the originating file on every element it renders,
     which is the single most useful thing an agent can be handed. */
  function sourceOf(el) {
    const file = el.getAttribute('data-astro-source-file');
    if (!file) return null;
    const loc = el.getAttribute('data-astro-source-loc');
    return loc ? file + ':' + loc : file;
  }

  /* What the agent needs to know about the one element you actually pointed at —
     an image's source, a field's name and current value, a link's target. */
  function describeTarget(el) {
    const tag = el.tagName.toLowerCase();
    const attrs = {};
    const add = (k, v) => {
      if (v == null) return;
      const s = String(v).trim();
      if (s) attrs[k] = s.length > 160 ? s.slice(0, 159) + '…' : s;
    };

    if (tag === 'img') {
      add('src', el.currentSrc || el.getAttribute('src'));
      add('alt', el.getAttribute('alt'));
      if (el.naturalWidth) add('natural', el.naturalWidth + '×' + el.naturalHeight);
    } else if (tag === 'a') {
      add('href', el.getAttribute('href'));
    } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      add('type', el.type);
      add('name', el.getAttribute('name'));
      add('placeholder', el.getAttribute('placeholder'));
      if (el.type !== 'password') add('value', el.value);
      if (el.required) add('required', 'true');
      if (el.disabled) add('disabled', 'true');
    } else if (tag === 'video' || tag === 'audio') {
      add('src', el.currentSrc || el.getAttribute('src'));
    } else if (tag === 'svg' || tag === 'canvas') {
      add('size', Math.round(el.getBoundingClientRect().width) + '×' + Math.round(el.getBoundingClientRect().height));
    }
    add('aria-label', el.getAttribute('aria-label'));
    add('role', el.getAttribute('role'));

    const r = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      tag,
      text: textOf(el),
      source: sourceOf(el),
      attrs,
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    };
  }

  function textOf(el) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120) return t ? t.slice(0, 80) + '…' : '';
    return t;
  }

  function collectElements(sel, limit) {
    const found = [];
    // Work off x/y/width/height only; callers hand us plain rects, not DOMRects.
    const selLeft = sel.x;
    const selTop = sel.y;
    const selRight = sel.x + sel.width;
    const selBottom = sel.y + sel.height;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || tag === HOST_TAG) continue;
      if (el.closest && el.closest(HOST_TAG)) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const ix = Math.max(0, Math.min(r.right, selRight) - Math.max(r.left, selLeft));
      const iy = Math.max(0, Math.min(r.bottom, selBottom) - Math.max(r.top, selTop));
      const inter = ix * iy;
      if (inter <= 0) continue;
      const cover = inter / (r.width * r.height);
      // Mostly inside the box, or centred in it — the second case keeps wide
      // headings and full-bleed rows that the drag obviously meant to include,
      // while the cover floor keeps page-sized wrappers out.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const centred = cx >= selLeft && cx <= selRight && cy >= selTop && cy <= selBottom;
      if (!(cover >= 0.5 || (centred && cover >= 0.05))) continue;

      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) continue;

      const source = sourceOf(el);
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      const interactive = /^(a|button|input|select|textarea|label|summary|img|video|canvas|svg)$/.test(tag);
      const named = !!(el.id || el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
      const score = (source ? 3 : 0) + (named ? 3 : 0) + (hasOwnText ? 2 : 0) +
        (interactive ? 2 : 0) + (cover >= 0.9 ? 1 : 0);

      found.push({ el, score, area: r.width * r.height, rect: r, source, tag });
    }

    found.sort((a, b) => (b.score - a.score) || (a.area - b.area));
    const picked = found.slice(0, Math.max(1, limit));
    picked.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    return picked.map((f) => ({
      selector: cssPath(f.el),
      tag: f.tag,
      text: textOf(f.el),
      source: f.source,
      rect: {
        x: Math.round(f.rect.left), y: Math.round(f.rect.top),
        width: Math.round(f.rect.width), height: Math.round(f.rect.height)
      }
    }));
  }

  /* ------------------------------------------------------------------- state */

  const state = {
    host: null,
    shadow: null,
    root: null,
    selEl: null,
    sizeEl: null,
    hudEl: null,
    panel: null,
    phase: 'off',        // off | idle | drag | shooting | review
    mode: 'region',      // region | element
    start: null,
    rect: null,
    shotId: null,
    saved: 0,
    hiEl: null,
    hiLabelEl: null,
    pick: { el: null, down: [], x: 0, y: 0 }   // down = the path walked up, for narrowing back
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mount() {
    const host = document.createElement(HOST_TAG);
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const root = el('div', 'root');
    shadow.append(style, root);
    (document.documentElement || document.body).appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.root = root;

    root.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('scroll', onScroll, true);
  }

  function unmount() {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('scroll', onScroll, true);
    if (state.host && state.host.parentNode) state.host.remove();
    state.host = state.shadow = state.root = state.selEl = state.sizeEl = state.hudEl = state.panel = null;
    state.hiEl = state.hiLabelEl = null;
    state.phase = 'off';
    state.rect = null;
    state.shotId = null;
    state.pick = { el: null, down: [], x: 0, y: 0 };
  }

  function renderIdle() {
    state.phase = 'idle';
    state.rect = null;
    state.root.textContent = '';

    const hud = el('div', 'hud');
    if (state.mode === 'element') {
      state.root.className = 'root pick';
      state.hiEl = el('div', 'hi');
      state.hiEl.style.display = 'none';
      state.hiLabelEl = el('div', 'hi-label');
      state.hiLabelEl.style.display = 'none';
      state.root.append(state.hiEl, state.hiLabelEl);
      hud.append(
        'Click the element to comment on · ',
        el('kbd', null, '↑'), el('kbd', null, '↓'), ' widen / narrow · ',
        el('kbd', null, 'Esc'), ' to finish'
      );
    } else {
      state.root.className = 'root';
      state.root.appendChild(el('div', 'veil'));
      hud.append('Drag to mark a region · ', el('kbd', null, 'Esc'), ' to finish');
    }
    if (state.saved) hud.append(' · ', el('b', null, String(state.saved)), ' saved');
    state.hudEl = hud;
    state.root.appendChild(hud);

    // Re-acquire whatever is under the cursor so the highlight is never stale.
    if (state.mode === 'element') highlightAt(state.pick.x, state.pick.y, true);
  }

  /* ---------------------------------------------------------- element picker */

  /* The overlay swallows every event so the page can't be clicked through, so
     hit-testing goes through the element stack with our own nodes filtered out. */
  function hitTest(x, y) {
    const stack = document.elementsFromPoint(x, y) || [];
    for (const node of stack) {
      if (!node.tagName) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === HOST_TAG) continue;
      if (node.closest && node.closest(HOST_TAG)) continue;
      if (node === document.documentElement || node === document.body) continue;
      return node;
    }
    return null;
  }

  function highlightAt(x, y, keepPath) {
    const found = hitTest(x, y);
    if (!found) {
      if (!keepPath) state.pick.down = [];
      return setHighlight(null);
    }
    if (found !== state.pick.el) state.pick.down = [];
    setHighlight(found);
  }

  function setHighlight(target) {
    state.pick.el = target;
    if (!state.hiEl) return;
    if (!target) {
      state.hiEl.style.display = 'none';
      state.hiLabelEl.style.display = 'none';
      state.hiLabelEl.textContent = '';
      return;
    }
    const r = target.getBoundingClientRect();
    state.hiEl.style.display = 'block';
    Object.assign(state.hiEl.style, {
      left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px'
    });

    const label = state.hiLabelEl;
    label.textContent = '';
    label.append(el('b', null, cssPath(target)));
    label.append(el('i', null, '  ' + Math.round(r.width) + '×' + Math.round(r.height)));
    const src = sourceOf(target);
    if (src) {
      label.appendChild(document.createElement('br'));
      label.append(el('i', null, src));
    }
    label.style.display = 'block';

    // Above the element if there's room, otherwise just below its top edge.
    const lh = label.offsetHeight || 22;
    const top = r.top - lh - 6 >= 0 ? r.top - lh - 6 : Math.min(r.top + 6, window.innerHeight - lh - 6);
    label.style.top = Math.max(4, top) + 'px';
    label.style.left = Math.max(4, Math.min(r.left, document.documentElement.clientWidth - label.offsetWidth - 8)) + 'px';
  }

  function widen() {
    const cur = state.pick.el;
    const parent = cur && cur.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return;
    state.pick.down.push(cur);
    setHighlight(parent);
  }

  function narrow() {
    const back = state.pick.down.pop();
    if (back && back.isConnected) setHighlight(back);
  }

  function onScroll() {
    if (state.mode !== 'element') return;
    if (state.phase === 'idle') highlightAt(state.pick.x, state.pick.y, true);
    else if (state.phase === 'review' && state.pick.el) setHighlight(state.pick.el);
  }

  async function pickCurrent() {
    const target = state.pick.el;
    if (!target) return;
    state.phase = 'shooting';

    // Freeze the highlight on the chosen element and drop the instructions.
    state.hiEl.classList.add('locked');
    if (state.hudEl) state.hudEl.remove();

    const r = target.getBoundingClientRect();
    const pad = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const x = Math.max(0, r.left - pad);
    const y = Math.max(0, r.top - pad);
    const rect = {
      x, y,
      width: Math.max(1, Math.min(vw, r.right + pad) - x),
      height: Math.max(1, Math.min(vh, r.bottom + pad) - y)
    };
    if (rect.width < 2 || rect.height < 2) {
      renderIdle();
      toast('That element has no visible area on screen.', true);
      return;
    }
    await shoot(rect, describeTarget(target));
  }

  function toast(text, isError) {
    const t = el('div', 'toast' + (isError ? ' err' : ''), text);
    state.root.appendChild(t);
    setTimeout(() => t.remove(), isError ? 4200 : 2200);
  }

  /* ------------------------------------------------------------------ events */

  function onWheel(e) {
    if (state.phase === 'drag' || state.phase === 'review' || state.phase === 'shooting') {
      e.preventDefault();
    }
  }

  function onKey(e) {
    if (state.phase === 'off') return;
    if (state.mode === 'element' && state.phase === 'idle' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowUp') widen(); else narrow();
      return;
    }
    if (state.mode === 'element' && state.phase === 'idle' && e.key === 'Enter' && state.pick.el) {
      e.preventDefault();
      e.stopPropagation();
      pickCurrent();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === 'review') {
        discard();
        renderIdle();
      } else {
        finish();
      }
    }
  }

  function onDown(e) {
    if (state.phase !== 'idle' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (state.mode === 'element') {
      highlightAt(e.clientX, e.clientY, true);
      pickCurrent();
      return;
    }

    state.phase = 'drag';
    state.start = { x: e.clientX, y: e.clientY };

    state.root.textContent = '';
    state.selEl = el('div', 'sel');
    state.sizeEl = el('div', 'size');
    state.root.append(state.selEl, state.sizeEl);
    drawRect(state.start.x, state.start.y, 0, 0);
  }

  function onMove(e) {
    if (state.mode === 'element') {
      state.pick.x = e.clientX;
      state.pick.y = e.clientY;
      if (state.phase === 'idle') highlightAt(e.clientX, e.clientY);
      return;
    }
    if (state.phase !== 'drag') return;
    const x = Math.min(e.clientX, state.start.x);
    const y = Math.min(e.clientY, state.start.y);
    const w = Math.abs(e.clientX - state.start.x);
    const h = Math.abs(e.clientY - state.start.y);
    drawRect(x, y, w, h);
  }

  function drawRect(x, y, w, h) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, vw - x); h = Math.min(h, vh - y);
    state.rect = { x, y, width: w, height: h, right: x + w, bottom: y + h };
    Object.assign(state.selEl.style, {
      left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px'
    });
    state.sizeEl.textContent = Math.round(w) + ' × ' + Math.round(h);
    Object.assign(state.sizeEl.style, {
      left: x + 'px',
      top: (y > 24 ? y : y + h + 26) + 'px'
    });
  }

  async function onUp(e) {
    if (state.phase !== 'drag') return;
    e.preventDefault();
    e.stopPropagation();
    const r = state.rect;
    if (!r || r.width < MIN_SIZE || r.height < MIN_SIZE) {
      renderIdle();
      return;
    }
    state.phase = 'shooting';
    await shoot(r);
  }

  function nextFrame() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  async function shoot(rect, target) {
    // Take the overlay out of the picture, literally, before the screenshot.
    const elements = collectElements(rect, 40);
    state.host.style.setProperty('visibility', 'hidden', 'important');
    await nextFrame();
    await new Promise((r) => setTimeout(r, 24));

    let res;
    try {
      res = await browser.runtime.sendMessage({
        type: 'capture-region',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
      });
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    state.host.style.setProperty('visibility', 'visible', 'important');

    if (!res || !res.ok) {
      renderIdle();
      toast('Capture failed: ' + ((res && res.error) || 'unknown error'), true);
      return;
    }
    state.shotId = res.shotId;
    showPanel(rect, res, elements, target);
  }

  function discard() {
    if (state.shotId) {
      browser.runtime.sendMessage({ type: 'discard-region', shotId: state.shotId }).catch(() => {});
      state.shotId = null;
    }
  }

  function showPanel(rect, shot, elements, target) {
    state.phase = 'review';
    state.root.className = state.mode === 'element' ? 'root pick review' : 'root review';

    const panel = el('div', 'panel');

    // In element mode the locked highlight stays on the page while you type, so
    // there is never any doubt about which element the note is attached to.
    if (target) {
      const chip = el('div', 'target');
      chip.textContent = target.selector + (target.text ? '  — "' + target.text + '"' : '');
      chip.title = target.selector + (target.source ? '\n' + target.source : '');
      panel.appendChild(chip);
    }
    if (shot.thumb) {
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = shot.thumb;
      panel.appendChild(img);
    }

    const ta = document.createElement('textarea');
    ta.placeholder = target ? 'What should change about this element?' : 'What should change here?';
    panel.appendChild(ta);

    const meta = el('div', 'meta');
    meta.appendChild(el('span', null, shot.width + '×' + shot.height + ' px · ' + elements.length + ' elements'));
    const toggle = el('button', 'link', 'show elements');
    meta.appendChild(toggle);
    panel.appendChild(meta);

    const list = el('div', 'els');
    list.style.display = 'none';
    for (const item of elements.slice(0, 12)) {
      const line = el('div', null, item.selector + (item.source ? '  ← ' + item.source : ''));
      line.title = item.selector + (item.source ? '\n' + item.source : '');
      list.appendChild(line);
    }
    panel.appendChild(list);
    toggle.addEventListener('click', () => {
      const on = list.style.display === 'none';
      list.style.display = on ? 'block' : 'none';
      toggle.textContent = on ? 'hide elements' : 'show elements';
    });

    const row = el('div', 'row');
    const hint = el('span', 'spacer', 'Ctrl+Enter saves');
    const cancel = el('button', 'btn', 'Discard');
    const save = el('button', 'btn primary', target ? 'Save element' : 'Save region');
    row.append(hint, cancel, save);
    panel.appendChild(row);

    // Sit the panel next to the selection without covering it, if there is room.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pw = 380;
    const ph = 320;
    let left = Math.min(rect.x, vw - pw - 12);
    let top = rect.bottom + 12;
    if (top + ph > vh) top = Math.max(12, rect.y - ph - 12);
    if (top + ph > vh) top = Math.max(12, vh - ph - 12);
    panel.style.left = Math.max(12, left) + 'px';
    panel.style.top = top + 'px';

    state.panel = panel;
    state.root.appendChild(panel);
    ta.focus();

    const doSave = async () => {
      save.disabled = cancel.disabled = true;
      save.textContent = 'Saving…';
      const res = await browser.runtime.sendMessage({
        type: 'save-region',
        shotId: state.shotId,
        description: ta.value,
        meta: {
          url: location.href,
          title: document.title,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          viewport: { width: vw, height: vh },
          scroll: { x: window.scrollX, y: window.scrollY },
          mode: state.mode,
          target: target || null,
          elements
        }
      }).catch((e) => ({ ok: false, error: e.message }));

      state.shotId = null;
      if (res && res.ok) state.saved = res.count;
      renderIdle();
      if (res && res.ok) {
        toast('Saved — ' + (res.path || 'in memory') + (res.via === 'downloads' ? ' (downloads fallback)' : ''));
      } else {
        toast('Save failed: ' + ((res && res.error) || 'unknown error'), true);
      }
    };

    save.addEventListener('click', doSave);
    cancel.addEventListener('click', () => { discard(); renderIdle(); });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); doSave(); }
      ev.stopPropagation();
    });
    panel.addEventListener('pointerdown', (ev) => ev.stopPropagation(), true);
  }

  function finish() {
    discard();
    unmount();
  }

  function begin(count, mode) {
    if (typeof count === 'number') state.saved = count;
    if (mode === 'element' || mode === 'region') state.mode = mode;
    if (state.phase !== 'off') {
      // Already up — switching modes mid-session just re-renders.
      discard();
      renderIdle();
      return;
    }
    mount();
    renderIdle();
  }

  PPX.onMessage((msg) => {
    if (!msg) return;
    if (msg.type === 'pinpoint:begin') { begin(msg.count, msg.mode); return Promise.resolve({ ok: true }); }
    if (msg.type === 'pinpoint:stop') { finish(); return Promise.resolve({ ok: true }); }
  });

  window.__pinpointOverlay = { begin, finish, _internals: { collectElements, cssPath } };
})();
