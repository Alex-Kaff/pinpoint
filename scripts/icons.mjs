#!/usr/bin/env node
/* Rasterises extension/icons/icon.svg into the PNG sizes Chrome needs —
   Firefox happily renders the SVG, Chrome does not accept it at all.
   The PNGs are committed, so this only runs when the artwork changes.

   node scripts/icons.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './ids.mjs';

const ICONS = path.join(ROOT, 'extension', 'icons');
const SIZES = [48, 96, 128];
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    const file = path.join(ICONS, `icon-${size}.png`);
    await page.locator('svg').screenshot({ path: file, omitBackground: true });
    await page.close();
    console.log('wrote ' + path.relative(ROOT, file));
  }
} finally {
  await browser.close();
}
