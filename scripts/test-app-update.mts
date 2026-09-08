/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that a new deploy can never reload the app out from under the reader.
 *
 * The bug: the service worker ran in `autoUpdate` mode, whose generated code is
 * `wb.on('activated', () => window.location.reload())` with no hook to
 * intercept. main.tsx checks for updates on every foreground, so the first time
 * you opened the app after a deploy you would tap into a chapter and the page
 * would reload a second or two later. It looked exactly like the reader closing
 * itself; it was the whole app restarting.
 *
 * Most of this is guarding the CONFIGURATION, because the failure is silent:
 * putting `skipWaiting: true` back in vite.config.ts would make the worker
 * activate at install time, so it never enters `waiting`, `onNeedRefresh` is
 * never called, nothing is ever handed to appUpdate.ts — and the deferral would
 * quietly do nothing while looking perfectly fine in the source.
 *
 * Run with: npx tsx scripts/test-app-update.mts
 */
import { readFileSync } from 'node:fs';
import {
  shouldApplyUpdate,
  setPendingUpdate,
  hasPendingUpdate,
  applyPendingUpdate,
  subscribeToUpdates,
  __resetAppUpdateForTests,
} from '../src/lib/appUpdate';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── The decision itself
{
  const IDLE = { pending: true, overlayOpen: false, confirmOpen: false,
                 isSigningIn: false, documentHidden: false };
  const at = (over: Partial<typeof IDLE>) => shouldApplyUpdate({ ...IDLE, ...over });

  ok('nothing pending -> never applies', at({ pending: false }) === false);
  ok('nothing pending, even backgrounded -> never applies',
     at({ pending: false, documentHidden: true }) === false);

  ok('pending + nothing in the way -> applies', at({}) === true);

  // THE REGRESSION: an update landing while the reader is open must wait.
  ok('pending + reader open -> WAITS', at({ overlayOpen: true }) === false);

  // A confirm dialog is rendered outside the overlay list but still holds a
  // decision the user is part-way through.
  ok('pending + confirm dialog open -> WAITS', at({ confirmOpen: true }) === false);

  // Backgrounded is the backstop: a reader left open overnight must not pin the
  // app to an old build forever.
  ok('pending + reader open + backgrounded -> applies anyway',
     at({ overlayOpen: true, documentHidden: true }) === true);
  ok('pending + confirm open + backgrounded -> applies anyway',
     at({ confirmOpen: true, documentHidden: true }) === true);

  // Sign-in is the one thing that outranks backgrounded: a redirect handshake is
  // in flight precisely while the page is hidden.
  ok('pending + signing in -> WAITS', at({ isSigningIn: true }) === false);
  ok('pending + signing in + backgrounded -> STILL waits',
     at({ isSigningIn: true, documentHidden: true }) === false);
}

// ── The pending-update latch
{
  __resetAppUpdateForTests();
  ok('nothing pending on a fresh load', hasPendingUpdate() === false);
  ok('applying with nothing pending is a no-op', applyPendingUpdate() === false);

  let applyCount = 0;
  let notified = 0;
  const unsubscribe = subscribeToUpdates(() => { notified++; });

  setPendingUpdate(() => { applyCount++; });
  ok('an update registers as pending', hasPendingUpdate() === true);
  ok('subscribers are told an update arrived', notified === 1);
  ok('registering does not apply on its own', applyCount === 0,
     'the whole point is that it waits');

  ok('applying reports that it did something', applyPendingUpdate() === true);
  ok('applying calls the activate function exactly once', applyCount === 1);

  // The reload it triggers is async, so a visibilitychange landing in the same
  // tick would otherwise message the waiting worker twice.
  ok('applying twice is a no-op', applyPendingUpdate() === false);
  ok('the activate function is never called twice', applyCount === 1);
  ok('nothing is pending after applying', hasPendingUpdate() === false);

  // A worker that somehow reports again after we already reloaded must not
  // re-arm and reload a second time.
  setPendingUpdate(() => { applyCount++; });
  ok('a late second update cannot re-arm after applying', hasPendingUpdate() === false);
  ok('and cannot run', applyCount === 1);

  // A failed hand-off must not pin the session to the old build.
  __resetAppUpdateForTests();
  let attempts = 0;
  setPendingUpdate(() => { attempts++; throw new Error('worker went away'); });
  ok('a throwing applier reports failure', applyPendingUpdate() === false);
  ok('and the update stays pending for the next safe moment', hasPendingUpdate() === true);
  ok('so it can be retried', attempts === 1);

  unsubscribe();
  __resetAppUpdateForTests();
  setPendingUpdate(() => {});
  ok('unsubscribing works', notified === 1);
  __resetAppUpdateForTests();
}

// ── vite.config.ts: the silent-failure guard
{
  const cfg = read('../vite.config.ts');
  const code = cfg.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  ok("registerType is 'prompt'", /registerType:\s*'prompt'/.test(code),
     "autoUpdate hard-reloads on activation with no way to intercept");
  ok("registerType is NOT 'autoUpdate'", !/registerType:\s*'autoUpdate'/.test(code));

  // This is the one that matters most: it breaks the deferral without breaking
  // anything visible.
  ok('workbox skipWaiting is absent', !/\bskipWaiting\s*:\s*true/.test(code),
     'skipWaiting activates at install, so the worker never waits and ' +
     'onNeedRefresh never fires — the deferral silently stops working');

  ok('clientsClaim is still set', /clientsClaim:\s*true/.test(code),
     'harmless without skipWaiting, and wanted once we do activate');
}

// ── main.tsx: the handoff
{
  const main = read('../src/main.tsx');
  ok('main.tsx keeps the value registerSW returns',
     /const\s+updateSW\s*=\s*registerSW\(/.test(main),
     'that return value is the only way to activate the waiting worker');
  ok('onNeedRefresh hands the update to appUpdate.ts',
     /onNeedRefresh\(\)\s*\{[\s\S]*?setPendingUpdate\(/.test(main));
  ok('onNeedRefresh does not apply it immediately',
     !/onNeedRefresh\(\)\s*\{[\s\S]*?location\.reload/.test(main));
  ok('main.tsx never reloads the page itself', !main.includes('location.reload'));
  ok('the foreground update check is still there',
     main.includes('visibilitychange') && main.includes('registration.update()'),
     'iOS suspends PWAs for days; without this a deploy is never noticed');
}

// ── App.tsx: applied only when idle
{
  const app = read('../src/App.tsx');
  ok('App.tsx wires the deferral', app.includes('useDeferredAppUpdate('));
  ok('the deferral is gated on the shared overlay value, not called bare',
     /useDeferredAppUpdate\(\{[\s\S]*?overlayOpen:\s*anyOverlayOpen/.test(app),
     'passing nothing (or false) would reload straight over an open reader');
  ok('the confirm dialog is part of the busy signal',
     /useDeferredAppUpdate\(\{[\s\S]*?confirmOpen:/.test(app));
  ok('an in-flight sign-in is part of the busy signal',
     /useDeferredAppUpdate\(\{[\s\S]*?isSigningIn/.test(app));

  const hook = read('../src/hooks/useDeferredAppUpdate.ts');
  ok('the hook routes through the tested decision', hook.includes('shouldApplyUpdate('));
  ok('the hook re-checks when the app is backgrounded',
     hook.includes("addEventListener('visibilitychange'"));
  ok('the hook re-checks when an update arrives', hook.includes('subscribeToUpdates('));
  ok('the hook cleans up its listener',
     hook.includes("removeEventListener('visibilitychange'"));
}

// ── appUpdate.ts must stay importable from outside React
{
  const mod = read('../src/lib/appUpdate.ts');
  ok('appUpdate.ts imports nothing',
     !/^\s*import\s/m.test(mod),
     'main.tsx reaches it from outside the React tree, and this test imports ' +
     'it in plain Node — a react or firebase import would break both');
}

console.log('');
if (fail === 0) {
  console.log(`APP-UPDATE PASS ${pass} / ${pass}`);
} else {
  console.log(`APP-UPDATE FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
