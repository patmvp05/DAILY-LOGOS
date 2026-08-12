/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that every full-screen overlay locks body scroll.
 *
 * The bug: the Bible reader (readerCategoryId) and the devotional reader
 * (activeInternalDevotional) were missing from the useScrollLock condition in
 * App.tsx, while every other modal was present. On a phone that left the page
 * behind still scrolling under the open reader — you'd end up partway down the
 * page and have to scroll back up before you could read the chapter.
 *
 * These tests read App.tsx itself, so adding a new overlay to UiContext without
 * wiring it into the lock fails here rather than shipping.
 *
 * Run with: npx tsx scripts/test-overlay-scroll-lock.mts
 */
import { readFileSync } from 'node:fs';
import { isAnyOverlayOpen, SCROLL_LOCKING_SURFACES } from '../src/lib/overlayState';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

// ── The predicate itself
{
  ok('nothing open -> no lock', isAnyOverlayOpen({}) === false);
  ok('all falsy -> no lock', isAnyOverlayOpen({
    showSettings: false, showHistory: false, activePlanCategory: null,
    selectingCategoryId: null, activeDevotion: null, readerCategoryId: null,
    activeInternalDevotional: null, showProverbModal: false,
    showSprintModal: false, isStartMenuOpen: false,
  }) === false);

  // THE REGRESSION: the Bible reader stores a category id string, not a bool.
  ok('Bible reader open -> LOCKS', isAnyOverlayOpen({ readerCategoryId: 'law' }) === true);
  ok('devotional reader open -> LOCKS',
     isAnyOverlayOpen({ activeInternalDevotional: { slug: 'my-utmost' } }) === true);

  // Every surface must independently trigger the lock.
  for (const key of SCROLL_LOCKING_SURFACES) {
    ok(`"${key}" alone triggers the lock`,
       isAnyOverlayOpen({ [key]: key.startsWith('show') || key.startsWith('is') ? true : 'x' }) === true);
  }
}

// ── App.tsx must actually route through the predicate with every surface
{
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  ok('App.tsx uses isAnyOverlayOpen (not an ad-hoc inline chain)',
     app.includes('useScrollLock(isAnyOverlayOpen('),
     'useScrollLock must be driven by the shared predicate');

  // Grab the argument object passed to isAnyOverlayOpen.
  const m = /useScrollLock\(isAnyOverlayOpen\(\{([\s\S]*?)\}\)\)/.exec(app);
  ok('the lock call is parseable', !!m);
  const passed = m ? m[1] : '';
  for (const key of SCROLL_LOCKING_SURFACES) {
    ok(`App.tsx passes "${key}" into the lock`, passed.includes(key),
       'add it to the useScrollLock(isAnyOverlayOpen({...})) call');
  }

  // And each one must actually be destructured from useUi, or it'd be undefined.
  const destructured = /=\s*useUi\(\);/.test(app)
    ? app.slice(app.indexOf('} = useUi();') - 1200, app.indexOf('} = useUi();'))
    : '';
  for (const key of ['readerCategoryId', 'activeInternalDevotional']) {
    ok(`"${key}" is destructured from useUi (else it is silently undefined)`,
       destructured.includes(key));
  }
}

// ── The reader scroll areas must contain their overscroll
{
  const files = [
    ['ReaderModal', '../src/components/modals/ReaderModal.tsx'],
    ['DevotionalReaderModal', '../src/components/modals/DevotionalReaderModal.tsx'],
  ] as const;
  for (const [name, rel] of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const scroller = /className="[^"]*overflow-y-auto[^"]*"/.exec(src)?.[0] ?? '';
    ok(`${name}'s scroll area uses ios-scroll (overscroll-behavior: contain)`,
       scroller.includes('ios-scroll'),
       `found: ${scroller || '(no overflow-y-auto container)'}`);
  }
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  ok('ios-scroll really sets overscroll-behavior: contain',
     /\.ios-scroll\s*\{[^}]*overscroll-behavior:\s*contain/.test(css));
}

console.log('');
if (fail === 0) {
  console.log(`OVERLAY-SCROLL-LOCK PASS ${pass} / ${pass}`);
} else {
  console.log(`OVERLAY-SCROLL-LOCK FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
