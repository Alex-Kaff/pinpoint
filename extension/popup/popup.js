const $ = (sel) => document.querySelector(sel);
const listEl = $('#list');
const noteEl = $('#note');
let state = { items: [], settings: PP.DEFAULTS, native: { status: 'unknown' } };

function say(text, isError) {
  noteEl.textContent = text;
  noteEl.classList.toggle('err', !!isError);
  noteEl.hidden = !text;
}

function renderStatus() {
  const b = $('#status');
  const n = state.native || {};
  if (n.status === 'ok') {
    b.textContent = 'host ready';
    b.className = 'status ok';
    b.title = 'Saving to ' + (n.info && n.info.outputDir ? n.info.outputDir : 'the host default');
  } else if (n.status === 'missing') {
    b.textContent = 'no host';
    b.className = 'status bad';
    b.title = (n.error || 'Native host not installed') + '\nClick to retry. Files fall back to your Downloads folder.';
  } else {
    b.textContent = 'checking…';
    b.className = 'status';
  }
}

function render() {
  renderStatus();
  const items = state.items;
  $('#count').textContent = items.length + (items.length === 1 ? ' note' : ' notes');
  $('#copy').disabled = items.length === 0;
  $('#clear').disabled = items.length === 0;

  listEl.textContent = '';
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    const kbd = (k) => { const n = document.createElement('kbd'); n.textContent = k; return n; };
    const b = (t) => { const n = document.createElement('b'); n.textContent = t; return n; };
    e.append(
      'Nothing captured yet.', document.createElement('br'),
      b('Capture region'), ' to drag a box  ', kbd('Alt'), '+', kbd('Shift'), '+', kbd('P'),
      document.createElement('br'),
      b('Pick element'), ' to click one thing  ', kbd('Alt'), '+', kbd('Shift'), '+', kbd('O')
    );
    listEl.appendChild(e);
    return;
  }

  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item';

    const img = document.createElement('img');
    img.src = it.thumb || '';
    img.title = it.path || '';
    row.appendChild(img);

    const body = document.createElement('div');
    body.className = 'body';

    const head = document.createElement('div');
    head.className = 'head';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1).padStart(2, '0');
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = PP.shortUrl(it.url);
    url.title = it.url + '\n' + (it.path || '');
    if (it.target) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = it.target.tag;
      badge.title = it.target.selector + (it.target.source ? '\n' + it.target.source : '');
      head.append(n, badge, url);
    } else {
      head.append(n, url);
    }
    body.appendChild(head);

    const ta = document.createElement('textarea');
    ta.value = it.description || '';
    ta.placeholder = 'What should change here?';
    ta.addEventListener('change', async () => {
      await browser.runtime.sendMessage({ type: 'update-item', id: it.id, patch: { description: ta.value } });
      it.description = ta.value;
    });
    body.appendChild(ta);

    const tools = document.createElement('div');
    tools.className = 'tools';

    const copyPath = document.createElement('button');
    copyPath.className = 'link';
    copyPath.textContent = 'copy path';
    copyPath.addEventListener('click', async () => {
      await navigator.clipboard.writeText(it.path || '');
      say('Path copied.');
    });

    const reveal = document.createElement('button');
    reveal.className = 'link';
    reveal.textContent = 'show in folder';
    reveal.addEventListener('click', async () => {
      const r = await browser.runtime.sendMessage({ type: 'reveal', path: it.path });
      if (!r.ok) say(r.error, true);
    });

    const els = document.createElement('span');
    els.className = 'link';
    els.style.textDecoration = 'none';
    els.style.cursor = 'default';
    els.textContent = (it.elements || []).length + ' els';
    els.title = (it.elements || [])
      .map((e) => e.selector + (e.source ? '  <- ' + e.source : ''))
      .join('\n');

    const del = document.createElement('button');
    del.className = 'link warn';
    del.textContent = 'remove';
    del.style.marginLeft = 'auto';
    del.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ type: 'delete-item', id: it.id, deleteFile: true });
      await load();
    });

    tools.append(copyPath, reveal, els, del);
    body.appendChild(tools);
    row.appendChild(body);
    listEl.appendChild(row);
  });
}

async function load() {
  state = await browser.runtime.sendMessage({ type: 'get-state' });
  render();
}

async function start(mode) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const res = await browser.runtime.sendMessage({ type: 'start-capture', tabId: tab && tab.id, mode });
  if (res && res.ok === false) {
    say(res.error, true);
    return;
  }
  window.close();
}

$('#capture').addEventListener('click', () => start('region'));
$('#pick').addEventListener('click', () => start('element'));

$('#copy').addEventListener('click', async () => {
  say('Building bundle…');
  const res = await browser.runtime.sendMessage({ type: 'copy-bundle' });
  if (!res.ok) {
    say(res.error, true);
    return;
  }
  const what = res.clipboard === 'file' ? 'File on clipboard' : 'Text on clipboard';
  say(what + ' — ' + res.count + ' regions' + (res.path ? '\n' + res.path : '') + (res.warning ? '\n' + res.warning : ''), !!res.warning);
  await load();
});

$('#clear').addEventListener('click', async () => {
  if (!confirm('Remove all ' + state.items.length + ' regions? The image files are deleted too.')) return;
  await browser.runtime.sendMessage({ type: 'clear-items', deleteFiles: true });
  say('');
  await load();
});

$('#options').addEventListener('click', () => browser.runtime.openOptionsPage());

$('#status').addEventListener('click', async () => {
  $('#status').textContent = 'checking…';
  await browser.runtime.sendMessage({ type: 'ping-native' });
  await load();
});

load().then(() => {
  if (state.native.status === 'unknown') {
    browser.runtime.sendMessage({ type: 'ping-native' }).then(load);
  }
});
