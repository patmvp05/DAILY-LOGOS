/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests recovery from a lazily-imported chunk that a deploy deleted.
 *
 * There was no ErrorBoundary anywhere in the app, and React unmounts the whole
 * tree on an uncaught render error — so a failed `import()` of the Dashboard or
 * AppModals chunk produced a white screen with no way back. Firebase Hosting
 * serves only the newest release, so any tab open across a deploy is holding
 * chunk hashes that no longer exist.
 *
 * The message matching is the part worth testing in both directions: a missed
 * match leaves the white screen, and a FALSE match turns an ordinary bug into a
 * page reload, which hides it.
 *
 * Run with: npx tsx scripts/test-chunk-recovery.mts
 */
import { readFileSync } from 'node:fs';

// Stub the two browser globals the module touches, before importing it.
let reloads = 0;
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
(globalThis as Record<string, unknown>).window = { location: { reload: () => { reloads++; } } };

const { isStaleChunkError, canAutoReload, attemptChunkReload, clearAutoReloaded, markAutoReloaded } =
  await import('../src/lib/chunkRecovery');

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── What a dead chunk actually looks like, per engine
{
  const stale = [
    // Chrome / Edge
    'Failed to fetch dynamically imported module: https://daily-logos.web.app/assets/AppModals-D4x9.js',
    // Firefox
    'error loading dynamically imported module',
    // Safari — the one the user is most likely to hit
    'Importing a module script failed.',
    // webpack-style, in case a dependency throws it
    'ChunkLoadError: Loading chunk 42 failed.',
  ];
  for (const message of stale) {
    ok(`recognised: "${message.slice(0, 46)}…"`, isStaleChunkError(new TypeError(message)));
    ok(`recognised as a bare string too: "${message.slice(0, 24)}…"`, isStaleChunkError(message));
  }
}

// ── What must NOT be treated as a stale chunk
{
  const real = [
    "TypeError: Cannot read properties of undefined (reading 'verses')",
    'undefined is not a function',
    'FirebaseError: Missing or insufficient permissions.',
    'Minified React error #310',
    'Network request failed',
    'The quota has been exceeded.',
  ];
  for (const message of real) {
    ok(`NOT a stale chunk: "${message.slice(0, 40)}…"`, !isStaleChunkError(new Error(message)),
       'a false match reloads the page and hides a real bug');
  }
  ok('null is not a stale chunk', !isStaleChunkError(null));
  ok('undefined is not a stale chunk', !isStaleChunkError(undefined));
  ok('an empty error is not a stale chunk', !isStaleChunkError(new Error('')));
}

// ── One silent reload per session; a loop is worse than the error
{
  store.clear(); reloads = 0;
  ok('a fresh session may auto-reload', canAutoReload() === true);
  ok('the first attempt reloads', attemptChunkReload() === true);
  ok('and it really called reload', reloads === 1);

  ok('the second attempt refuses', attemptChunkReload() === false,
     'otherwise a chunk that is genuinely gone loops forever');
  ok('and did not reload again', reloads === 1);
  ok('canAutoReload reports the spent attempt', canAutoReload() === false);

  // The app survived, so a later deploy should be able to heal too.
  clearAutoReloaded();
  ok('clearing re-arms it', canAutoReload() === true);
  ok('and it can reload again', attemptChunkReload() === true && reloads === 2);

  // sessionStorage throws in some privacy modes — recovery must not depend on it.
  store.clear();
  const saved = (globalThis as Record<string, unknown>).sessionStorage;
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  reloads = 0;
  ok('a throwing sessionStorage still allows one reload', attemptChunkReload() === true);
  ok('and does not crash marking it', (() => { try { markAutoReloaded(); return true; } catch { return false; } })());
  (globalThis as Record<string, unknown>).sessionStorage = saved;
  store.clear();
}

// ── The boundary is actually mounted where the risk is
{
  const eb = read('../src/components/ErrorBoundary.tsx');
  ok('it is a class (hooks cannot catch render errors)',
     eb.includes('extends React.Component'));
  ok('it renders a fallback instead of unmounting',
     eb.includes('static getDerivedStateFromError'));
  ok('it logs what happened', eb.includes('componentDidCatch') && eb.includes('logDiagnostic('));
  ok('a stale chunk self-heals rather than showing an apology',
     /isStaleChunkError\(error\)\) attemptChunkReload\(\)/.test(eb));
  ok('the fallback offers a way out', eb.includes('Reload'));

  const app = read('../src/App.tsx');
  ok('the Dashboard lazy boundary is wrapped',
     /<ErrorBoundary label="Dashboard">[\s\S]*?React\.Suspense/.test(app));
  ok('the modals lazy boundary is wrapped separately',
     /<ErrorBoundary label="Modals"[^>]*>[\s\S]*?React\.Suspense/.test(app),
     'one boundary for both would let a modal chunk take the dashboard down');
  ok('the modals fallback is a banner, not a half-screen panel',
     /<ErrorBoundary label="Modals" banner>/.test(app),
     'that subtree normally draws nothing, so a page-sized error is stranger than the failure');

  const main = read('../src/main.tsx');
  ok('the whole tree has a catch-all boundary',
     /<ErrorBoundary label="App">/.test(main));
  ok('Vite preload failures are caught before React sees them',
     main.includes("'vite:preloadError'") && main.includes('attemptChunkReload()'));
  const mainCode = main.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the preload handler does NOT preventDefault',
     !/preventDefault/.test(mainCode),
     'preventDefault makes Vite continue, so the import resolves undefined and the '
     + 'failure surfaces as an unrelated TypeError that cannot be recognised');
  ok('the one-shot is re-armed once the app is up',
     main.includes('armChunkRecoveryReset()'),
     'a tab open across several deploys should be able to heal more than once');
}

console.log('');
if (fail === 0) {
  console.log(`CHUNK-RECOVERY PASS ${pass} / ${pass}`);
} else {
  console.log(`CHUNK-RECOVERY FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
