/* Where the two extension identities come from.

   Firefox takes the id straight out of the manifest. Chrome derives it from
   the packing key, so the manifest carries a committed public key purely to
   keep the id stable — the native host manifest has to name it up front. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOST_NAME = 'com.kaffetzakis.pinpoint';

/* Chrome's id is the first 128 bits of SHA-256 over the DER public key,
   rendered in the a-p alphabet instead of 0-f. */
export function chromeIdFromKey(base64Key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex');
  return [...digest.slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

export function readManifest(browserName) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', browserName + '.json'), 'utf8'));
}

export function extensionIds() {
  const firefox = readManifest('firefox').browser_specific_settings.gecko.id;
  const chrome = chromeIdFromKey(readManifest('chrome').key);
  return { firefox, chrome };
}
