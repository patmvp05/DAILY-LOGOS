/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Directed end-to-end proof that the selected Bible version actually changes
 * the text shown on the dashboard (card previews + daily proverb) — the exact
 * bug the user reported ("Proverbs and the other ones still pull KJV").
 *
 * The network mock ENCODES the requested translation code into the verse text,
 * so we can assert the visible text reflects the chosen version. Covers:
 *   A. Seeded 'web'  → dashboard shows WEB text, never NIV.
 *   B. Seeded 'niv'  → dashboard shows NIV text, never WEB.
 *   C. The real user flow: open Settings, pick NIV, and watch the dashboard
 *      previews switch from WEB to NIV.
 *
 * Run with: node scripts/verify-version-switch.mjs   (build dist/ first)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = Number(process.env.VVS_PORT || 4196);
const STORAGE_KEY = 'seven_seals_bible_progress';
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; fails.push(`${name}${detail ? ' :: ' + detail : ''}`); console.log(`  ✗ ${name} ${detail}`); } }

function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => { s.destroy(); Date.now() - start > timeoutMs ? reject(new Error('no server')) : setTimeout(tryOnce, 300); });
    };
    tryOnce();
  });
}

// Pull the translation code out of any backend's URL (bible-api query, legacy
// bolls get-text path, or same-origin static /bible/CODE/... file).
function codeFromUrl(url) {
  const m1 = url.match(/translation=([a-z0-9-]+)/i);
  if (m1) return m1[1].toUpperCase();
  const dec = decodeURIComponent(url);
  const m2 = dec.match(/get-text\/([A-Za-z0-9]+)\//);
  if (m2) return m2[1].toUpperCase();
  const m3 = url.match(/\/bible\/([A-Za-z0-9]+)\//);
  if (m3) return m3[1].toUpperCase();
  return 'UNK';
}

async function installRoutes(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()
        && !url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith('about:')) {
      return route.abort();
    }
    // Same-origin static Bible files for modern versions: /bible/CODE/book/ch.json.
    // Encode the requested code into the verse text so the test can assert the
    // visible text reflects the chosen version.
    if (/\/bible\/[A-Za-z0-9]+\/\d+\/\d+\.json/.test(url)) {
      const CODE = codeFromUrl(url);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reference: `${CODE} ref`, translationId: CODE.toLowerCase(), translationName: CODE,
        verses: Array.from({ length: 8 }, (_, i) => ({ verse: i + 1, text: `${CODE} verse ${i + 1} sample reading content here.` })),
      }) });
    }
    if (url.includes('bible-api.com')) {
      const CODE = codeFromUrl(url);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        translation_id: CODE.toLowerCase(), translation_name: CODE,
        verses: Array.from({ length: 8 }, (_, i) => ({ verse: i + 1, text: `${CODE} verse ${i + 1} sample reading content here.` })),
      }) });
    }
    if (url.includes('bibleProxy') || url.includes('a.run.app') || url.includes('bolls.life')) {
      const CODE = codeFromUrl(url);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        Array.from({ length: 8 }, (_, i) => ({ pk: i + 1, verse: i + 1, text: `${CODE} verse ${i + 1} sample reading content here.` }))
      ) });
    }
    return route.continue();
  });
  page.on('popup', (p) => p.close().catch(() => {}));
}

async function newSession(browser, version) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([key, v]) => {
    try { localStorage.setItem(key, JSON.stringify({ settings: { startDate: '2026-03-15', theme: 'system', bibleVersion: v } })); } catch { /* */ }
  }, [STORAGE_KEY, version]);
  const page = await ctx.newPage();
  await installRoutes(page);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, { timeout: 8000 }).catch(() => {});
  return { ctx, page };
}

async function bodyHasVerse(page, code, timeout = 8000) {
  return page.waitForFunction((c) => document.body.innerText.includes(`${c} verse`), code, { timeout })
    .then(() => true).catch(() => false);
}

async function main() {
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', env: process.env });
  let browser;
  try {
    await waitForPort(PORT);
    browser = await chromium.launch();

    // A. Seeded WEB
    console.log('A. Seeded version = web');
    {
      const { ctx, page } = await newSession(browser, 'web');
      ok('dashboard renders WEB text', await bodyHasVerse(page, 'WEB'));
      const body = await page.evaluate(() => document.body.innerText);
      ok('does NOT show NIV text', !body.includes('NIV verse'));
      await ctx.close();
    }

    // B. Seeded NIV
    console.log('B. Seeded version = niv');
    {
      const { ctx, page } = await newSession(browser, 'niv');
      ok('dashboard renders NIV text', await bodyHasVerse(page, 'NIV'));
      const body = await page.evaluate(() => document.body.innerText);
      ok('does NOT show WEB text', !body.includes('WEB verse'));
      await ctx.close();
    }

    // C. Real user flow: start on WEB, open Settings, switch to NIV.
    console.log('C. User flow: open Settings → switch web → niv');
    {
      const { ctx, page } = await newSession(browser, 'web');
      ok('starts on WEB text', await bodyHasVerse(page, 'WEB'));

      await page.click('[title="Account Settings"]', { timeout: 5000 });
      const select = page.locator('select').filter({ has: page.locator('option', { hasText: 'New International Version' }) }).first();
      await select.waitFor({ state: 'visible', timeout: 5000 });
      await select.selectOption('niv');
      await page.keyboard.press('Escape');

      const switched = await bodyHasVerse(page, 'NIV', 10000);
      ok('after switching to NIV, dashboard shows NIV text', switched);
      const body = await page.evaluate(() => document.body.innerText);
      ok('WEB text no longer present after switch', !body.includes('WEB verse'), body.slice(0, 120).replace(/\n/g, ' '));
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    preview.kill('SIGTERM');
  }

  console.log(`\n── verify-version-switch ──`);
  if (failed) {
    console.error(`FAIL ${passed}/${passed + failed}`);
    fails.forEach((f) => console.error('  • ' + f));
    process.exit(1);
  }
  console.log(`VERSION-SWITCH PASS ${passed}/${passed + failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
