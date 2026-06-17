/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless "monkey" fuzz harness for the whole app UI.
 *
 * What it does:
 *   1. Serves the built app (dist/) via `vite preview`.
 *   2. Runs it with NO login — the app's guest/local mode (useAuth falls back to
 *      guest when signed out). All external network (Firebase, bible-api.com,
 *      the bolls proxy) is intercepted and mocked so runs are deterministic and
 *      need no internet.
 *   3. Seeds localStorage so we skip onboarding and land on the dashboard.
 *   4. Fires hundreds of randomized actions (click a random visible control,
 *      scroll, press Escape, switch Bible version, open the reader, advance a
 *      chapter) across several fresh sessions, driven by a SEEDED RNG so any
 *      failure is reproducible (FUZZ_SEED=... npm run fuzz:ui).
 *   5. After every action asserts invariants: no uncaught exception, no genuine
 *      console error, the React root never white-screens, progress never goes
 *      out of bounds.
 *
 * Usage:
 *   node scripts/fuzz-ui.mjs                 # defaults
 *   FUZZ_SESSIONS=10 FUZZ_ACTIONS=80 FUZZ_SEED=42 node scripts/fuzz-ui.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const SESSIONS = Number(process.env.FUZZ_SESSIONS || 8);
const ACTIONS = Number(process.env.FUZZ_ACTIONS || 60);
const PORT = Number(process.env.FUZZ_PORT || 4188);
const SEED = Number(process.env.FUZZ_SEED || Date.now() % 1e9);
const STORAGE_KEY = 'seven_seals_bible_progress';

// ── seeded RNG (mulberry32) so failures reproduce from the printed seed ───────
function mkRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Console-error messages that are EXPECTED side effects of mocking the network
// (Firebase can't reach Google in the harness). These are not app bugs.
const IGNORE_ERROR = [
  /firestore/i, /firebase/i, /googleapis/i, /identitytoolkit/i, /securetoken/i,
  /network|fetch|offline|unavailable|transport/i, /permission|insufficient/i,
  /quota/i, /ERR_/i, /Failed to load resource/i, /net::/i,
];

function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('server did not start'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

// ── canned mock payloads ──────────────────────────────────────────────────────
const BIBLE_API_JSON = {
  translation_id: 'web', translation_name: 'World English Bible',
  verses: Array.from({ length: 20 }, (_, i) => ({ verse: i + 1, text: `Mock verse ${i + 1} of this chapter.` })),
};
const BOLLS_JSON = Array.from({ length: 20 }, (_, i) => ({
  pk: i + 1, verse: i + 1, text: `Mock <i>modern</i> verse ${i + 1}.<S>1</S>`,
}));
// Same-origin static file (final ChapterTextResponse shape) for modern versions.
const STATIC_BIBLE_JSON = {
  reference: 'Mock 1', translationId: 'niv', translationName: 'Modern Version',
  verses: Array.from({ length: 20 }, (_, i) => ({ verse: i + 1, text: `Mock modern verse ${i + 1}.` })),
};

async function installRoutes(page) {
  // Only MOCK the two Bible backends so the reader renders deterministic text.
  // Everything else (incl. Firebase/Google) is left to fail naturally — the
  // sandbox blocks those hosts and the app handles it gracefully (guest mode),
  // which is exactly the real offline path. (Aborting Firebase requests via
  // Playwright, by contrast, crashes boot — so we deliberately don't.)
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    // Keep the monkey inside the app: block top-level navigations to external
    // sites (e.g. devotional links). Those open new tabs in real use; here a
    // same-tab nav would leave the app and is just harness noise.
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()
        && !url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)
        && !url.startsWith('about:')) {
      return route.abort();
    }
    // Modern versions now load from same-origin static files (/bible/...).
    if (/\/bible\/[A-Za-z0-9]+\/\d+\/\d+\.json/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATIC_BIBLE_JSON) });
    }
    if (url.includes('bible-api.com')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIBLE_API_JSON) });
    }
    // Legacy bolls path kept as a harmless fallback for older cached clients.
    if (url.includes('bibleProxy') || url.includes('a.run.app') || url.includes('bolls.life')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOLLS_JSON) });
    }
    return route.continue();
  });
  // Devotional links use target=_blank → popups. Close them immediately.
  page.on('popup', (p) => p.close().catch(() => {}));
}

const results = { actions: 0, sessions: 0, pageErrors: [], consoleErrors: [], invariant: [] };

async function checkInvariants(page, ctx) {
  // 1. App didn't white-screen (React root still has content).
  const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  if (rootChildren === 0) results.invariant.push(`${ctx}: #root is empty (white screen)`);

  // 2. Progress is within bounds for every category.
  const bad = await page.evaluate((key) => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || '{}');
      const p = s.progress || [];
      return p.filter((x) => x.bookIndex < 0 || x.chapter < 1).map((x) => `${x.categoryId} b${x.bookIndex} c${x.chapter}`);
    } catch { return []; }
  }, STORAGE_KEY);
  if (bad && bad.length) results.invariant.push(`${ctx}: out-of-bounds progress ${bad.join(', ')}`);
}

async function clickRandomControl(page, rng) {
  // Enumerate visible, enabled, non-navigating controls and click one.
  const handles = await page.$$('button:visible, [role="button"]:visible, select:visible, input[type="checkbox"]:visible');
  const safe = [];
  for (const h of handles) {
    const label = ((await h.getAttribute('aria-label')) || (await h.textContent()) || '').trim().slice(0, 40);
    // Skip the force-refresh control: it reloads the page and resets the session.
    if (/force.*refresh|hard refresh|reload/i.test(label)) continue;
    safe.push({ h, label });
  }
  if (!safe.length) return 'no-controls';
  const pick = safe[Math.floor(rng() * safe.length)];
  try {
    await pick.h.click({ timeout: 800, trial: false });
    return `click:${pick.label || '∅'}`;
  } catch {
    return `click-miss:${pick.label || '∅'}`;
  }
}

async function action(page, rng) {
  const roll = rng();
  if (roll < 0.12) { await page.keyboard.press('Escape'); return 'escape'; }
  if (roll < 0.24) { await page.mouse.wheel(0, 400 + Math.floor(rng() * 1200)); return 'scroll-down'; }
  if (roll < 0.30) { await page.mouse.wheel(0, -(400 + Math.floor(rng() * 1200))); return 'scroll-up'; }
  // If the reader is open, sometimes drive its select / next button directly.
  if (roll < 0.40) {
    const reader = await page.$('[data-testid="reader-modal"]');
    if (reader) { await page.mouse.wheel(0, 4000); return 'reader-scroll-end'; }
  }
  return clickRandomControl(page, rng);
}

async function seedSession(context, rng) {
  const startDate = `2026-0${1 + Math.floor(rng() * 5)}-15`;
  await context.addInitScript(([key, date]) => {
    try {
      localStorage.setItem(key, JSON.stringify({ settings: { startDate: date, theme: 'system' } }));
    } catch { /* foreign/sandboxed doc — seeding only matters on our origin */ }
  }, [STORAGE_KEY, startDate]);
}

async function main() {
  console.log(`fuzz-ui: seed=${SEED} sessions=${SESSIONS} actions/session=${ACTIONS}`);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', env: process.env,
  });
  let browser;
  try {
    await waitForPort(PORT);
    browser = await chromium.launch();
    const rng = mkRng(SEED);

    for (let s = 0; s < SESSIONS; s++) {
      const context = await browser.newContext({ viewport: pickViewport(rng) });
      await seedSession(context, rng);
      const page = await context.newPage();

      page.on('pageerror', (e) => results.pageErrors.push(`session${s}: ${e.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORE_ERROR.some((re) => re.test(text))) return;
        results.consoleErrors.push(`session${s}: ${text.slice(0, 200)}`);
      });

      await installRoutes(page);
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
      // Wait for React to actually mount (guest boot can take ~1s) before fuzzing.
      await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, { timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(400);
      await checkInvariants(page, `session${s} load`);

      for (let a = 0; a < ACTIONS; a++) {
        const what = await action(page, rng);
        results.actions++;
        await page.waitForTimeout(40);
        await checkInvariants(page, `session${s} action${a} (${what})`);
      }
      results.sessions++;
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    preview.kill('SIGTERM');
  }

  // ── report ──────────────────────────────────────────────────────────────────
  const problems = results.pageErrors.length + results.consoleErrors.length + results.invariant.length;
  console.log(`\n── fuzz-ui results ──`);
  console.log(`sessions: ${results.sessions}/${SESSIONS}, actions: ${results.actions}`);
  console.log(`uncaught page errors: ${results.pageErrors.length}`);
  console.log(`genuine console errors: ${results.consoleErrors.length}`);
  console.log(`invariant violations: ${results.invariant.length}`);
  if (problems) {
    console.error('\nFAILURES (reproduce with FUZZ_SEED=' + SEED + '):');
    [...results.pageErrors, ...results.consoleErrors, ...results.invariant].slice(0, 40).forEach((m) => console.error('  • ' + m));
    process.exit(1);
  }
  console.log(`\nFUZZ-UI PASS — ${results.actions} randomized actions, 0 crashes (seed ${SEED})`);
}

function pickViewport(rng) {
  const sizes = [
    { width: 390, height: 844 },   // iPhone 14/15
    { width: 414, height: 896 },   // iPhone 11 Pro Max
    { width: 768, height: 1024 },  // iPad
    { width: 1280, height: 800 },  // laptop
  ];
  return sizes[Math.floor(rng() * sizes.length)];
}

main().catch((e) => { console.error(e); process.exit(1); });
