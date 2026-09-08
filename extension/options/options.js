const FIELDS = {
  outputDir: 'value',
  bundleName: 'value',
  clipboard: 'value',
  clipboardIncludeImages: 'checked',
  includeUrl: 'checked',
  includeElements: 'checked',
  includeSource: 'checked',
  includeRect: 'checked',
  maxElements: 'number',
  imageFormat: 'value',
  jpegQuality: 'number'
};

/* The preview shows paths in the shape this machine will actually produce. */
const SAMPLE_DIR = navigator.userAgent.includes('Windows')
  ? 'C:\\Users\\you\\AppData\\Local\\Temp\\pinpoint\\20260902\\'
  : '/var/folders/t/pinpoint/20260902/';

const SAMPLE = [{
  path: SAMPLE_DIR + '20260902-141233-01-localhost-4321.png',
  description: 'The heading crowds the logo — give it more room and drop it a size on mobile.',
  url: 'http://localhost:4321/en/',
  rect: { x: 220, y: 96, width: 640, height: 180 },
  viewport: { width: 1440, height: 900 },
  scroll: { x: 0, y: 240 },
  elements: [
    { selector: 'header.site-header > h1', text: 'Kaffetzakis', source: 'src/components/Header.astro:12:4' },
    { selector: 'header.site-header > nav.nav > a:nth-of-type(2)', text: 'Work', source: 'src/components/Header.astro:19:8' }
  ]
}, {
  path: SAMPLE_DIR + '20260902-141251-02-localhost-4321.png',
  description: 'This field should reject a bare domain and say so under the input.',
  url: 'http://localhost:4321/en/contact/',
  target: {
    selector: '#email',
    tag: 'input',
    text: '',
    source: 'src/components/Contact.astro:31:6',
    attrs: { type: 'email', name: 'email', placeholder: 'you@example.com', value: 'alex@' }
  },
  elements: [
    { selector: 'form.contact > label', text: 'Email', source: 'src/components/Contact.astro:30:4' }
  ]
}];

function readForm() {
  const out = {};
  for (const [id, kind] of Object.entries(FIELDS)) {
    const el = document.getElementById(id);
    out[id] = kind === 'checked' ? el.checked : kind === 'number' ? Number(el.value) : el.value;
  }
  return out;
}

function writeForm(s) {
  for (const [id, kind] of Object.entries(FIELDS)) {
    const el = document.getElementById(id);
    if (kind === 'checked') el.checked = !!s[id];
    else el.value = s[id];
  }
}

let savedTimer;
function flashSaved() {
  const el = document.getElementById('saved');
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.hidden = true; }, 1200);
}

function renderPreview(s) {
  document.getElementById('preview').textContent = PP.buildBundle(SAMPLE, s);
}

async function save() {
  const s = readForm();
  await PP.setSettings(s);
  renderPreview({ ...PP.DEFAULTS, ...s });
  flashSaved();
}

async function refreshHost() {
  const el = document.getElementById('hostStatus');
  el.textContent = 'Checking native host…';
  el.className = 'status';
  const res = await browser.runtime.sendMessage({ type: 'ping-native' });
  if (res && res.ok) {
    el.textContent = 'Native host v' + (res.version || '?') + ' connected — writing to ' + res.outputDir;
    el.className = 'status ok';
  } else {
    el.textContent = 'Native host not reachable (' + ((res && res.error) || 'unknown') + '). Run native-host\\install.ps1, then reload this page.';
    el.className = 'status bad';
  }
}

async function refreshGrant() {
  const has = await browser.permissions.contains({ origins: ['<all_urls>'] });
  document.getElementById('grant').disabled = has;
  document.getElementById('grantState').textContent = has
    ? 'Granted — the shortcut works everywhere.'
    : 'Not granted — the shortcut only works after you open the toolbar popup once per page.';
}

document.getElementById('grant').addEventListener('click', async () => {
  await browser.permissions.request({ origins: ['<all_urls>'] });
  refreshGrant();
});

(async () => {
  const s = await PP.getSettings();
  writeForm(s);
  renderPreview(s);
  for (const id of Object.keys(FIELDS)) {
    document.getElementById(id).addEventListener('change', save);
  }
  refreshHost();
  refreshGrant();
})();
