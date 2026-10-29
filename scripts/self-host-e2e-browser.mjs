// Browser half of scripts/self-host-e2e.sh. Opens the app the way a home
// install is opened: by the machine's network address over plain http, not
// localhost. Browsers treat that as an insecure context and leave out some
// APIs (crypto.randomUUID among them), which a localhost or https check
// never shows.
//
// Usage: node scripts/self-host-e2e-browser.mjs <app url>
// Prints one "ok"/"FAIL" line per check and exits 1 on a failure. Needs
// Playwright with Chromium (`require('playwright')`).
import { createRequire } from 'node:module';

const url = process.argv[2];
if (!url) {
  console.error('usage: self-host-e2e-browser.mjs <app url>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${label}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/login`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => {
    let id = '';
    try {
      id = crypto.randomUUID();
    } catch {
      // Left empty: the check below fails.
    }
    return { secure: window.isSecureContext, id };
  });
  console.log(`  info  ${url} is ${state.secure ? 'a secure' : 'an insecure'} context`);
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state.id), 'crypto.randomUUID works over plain http');
  check(errors.length === 0, `sign-in page loads with no script errors${errors.length ? `: ${errors[0]}` : ''}`);
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
