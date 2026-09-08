/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests the ghost-click guard on full-bleed modals, and that the Bible reader
 * spends no screen on chrome it doesn't need.
 *
 * Two bugs, one file, because the fixes meet in the same place.
 *
 * 1. "It opens then closes right away." useOverlayDismiss guards the BACKDROP,
 *    on the assumption that the delayed ~300ms iOS ghost click lands there. That
 *    holds for an `inset-4` modal. It does not hold for the Bible reader or the
 *    sprint sheet: both are `fixed inset-0` on a phone, so the window covers the
 *    whole viewport and the ghost click lands inside it — on whatever sits at the
 *    original tap coordinates, which for a dashboard card can be the header X or
 *    the action bar. So every full-bleed modal must guard its own close and
 *    progress-mutating handlers too, and this test finds new ones automatically
 *    rather than trusting anyone to remember.
 *
 * 2. The reader's bottom bar was permanent, spending ~100px of a phone screen on
 *    a Close button that duplicates the header X. It must now appear only once
 *    the chapter has been read.
 *
 * Run with: npx tsx scripts/test-tap-guard.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { tailClearsActionBar, actionBarPx, reservedTailPx, READER_END_SLOP_PX }
  from '../src/lib/readerLayout';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const MODAL_DIR = new URL('../src/components/modals/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const modalFiles = readdirSync(MODAL_DIR).filter((f) => f.endsWith('.tsx')).sort();

/**
 * A modal is full-bleed when its WINDOW is `fixed inset-0` — i.e. it covers the
 * whole phone screen, leaving no backdrop under the tap. Every backdrop in this
 * codebase carries a `bg-black/…` scrim, which is what separates the two.
 */
function isFullBleed(src: string): boolean {
  return [...src.matchAll(/className="(fixed inset-0[^"]*)"/g)]
    .map((m) => m[1])
    .some((c) => !c.includes('bg-black/'));
}

// ── The hook
{
  const hook = read('../src/hooks/useOverlayDismiss.ts');
  ok('useTapGuard exists', hook.includes('export function useTapGuard'));
  ok('useOverlayDismiss still exists for backdrops',
     hook.includes('export function useOverlayDismiss'));
  ok('both share one grace window',
     (hook.match(/GRACE_MS/g) ?? []).length >= 3,
     'a guard shorter than the ~300ms ghost click would not catch it');
  ok('the grace is longer than the ghost-click latency',
     /const GRACE_MS = (\d+)/.test(hook) && Number(/const GRACE_MS = (\d+)/.exec(hook)![1]) >= 350,
     `found ${/const GRACE_MS = (\d+)/.exec(hook)?.[1]}`);
  ok('the guard blocks by time, not by swallowing every click',
     hook.includes('Date.now() < readyAtRef.current'));
}

// ── Every full-bleed modal must guard its in-window close handlers
{
  const fullBleed: string[] = [];
  const inset: string[] = [];

  for (const file of modalFiles) {
    const src = readFileSync(new URL(file, MODAL_DIR), 'utf8');
    (isFullBleed(src) ? fullBleed : inset).push(file);

    // Every modal, full-bleed or not, still needs its backdrop guarded.
    ok(`${file} guards its backdrop`, src.includes('useOverlayDismiss('),
       'a modal with a dismissable backdrop needs the mount grace');

    if (!isFullBleed(src)) continue;

    ok(`${file} is full-bleed, so it imports useTapGuard`,
       src.includes('useTapGuard'),
       'inset-0 means the ghost click lands INSIDE the window, not on the backdrop');

    // The invariant: no bare close handler survives in a full-bleed modal.
    const bare = [...src.matchAll(/onClick=\{(onClose|onClear|onPrimary)\}/g)].map((m) => m[1]);
    ok(`${file} has no unguarded close/destructive handler`, bare.length === 0,
       `unguarded: ${[...new Set(bare)].join(', ')} — wrap with guard(...)`);

    ok(`${file} actually applies the guard`, /onClick=\{guarded\w+\}/.test(src),
       'importing useTapGuard without using it guards nothing');
  }

  // Sanity: the classifier must not be matching everything or nothing.
  ok('the reader is detected as full-bleed', fullBleed.includes('ReaderModal.tsx'),
     `full-bleed: ${fullBleed.join(', ')}`);
  ok('the sprint sheet is detected as full-bleed',
     fullBleed.includes('ScriptureSprintModal.tsx'));
  ok('inset modals are not misclassified',
     inset.includes('ProverbModal.tsx') && inset.includes('DevotionalReaderModal.tsx'),
     `inset: ${inset.join(', ')}`);
  ok('every modal was classified', fullBleed.length + inset.length === modalFiles.length);
}

// ── The reader's chrome
{
  const src = read('../src/components/modals/ReaderModal.tsx');

  // The action bar must be INSIDE the atEnd condition, not merely containing it.
  const barIdx = src.indexOf('key="reader-action-bar"');
  const condIdx = src.indexOf("{status === 'ready' && atEnd && (");
  ok('the action bar exists', barIdx > 0);
  ok('the action bar renders only once the chapter is read',
     condIdx > 0 && condIdx < barIdx,
     'a permanent bar costs ~100px of every phone screen');

  // The old always-on Close pill must be gone: exactly one close affordance.
  const closeButtons = (src.match(/aria-label="Close reader"/g) ?? []).length;
  ok('there is exactly one close affordance, the header X', closeButtons === 1,
     `found ${closeButtons}`);
  ok('the bottom bar no longer carries a Close button',
     !/reader-action-bar[\s\S]*?Close\s*<\/button>/.test(src));

  ok('the header X is guarded', src.includes('useTapGuard(onClose)')
     && src.includes('onClick={guardedClose}'));
  // A chapter short enough to fit reveals the bar at mount — so a ghost click
  // could land on "Next Chapter" and advance a chapter never read.
  ok('the primary action is guarded too', src.includes('useTapGuard(onPrimary)')
     && src.includes('onClick={guardedPrimary}'),
     'on a short chapter the bar is visible within the ghost-click window');

  ok('the bar keeps the home-indicator inset',
     /reader-action-bar[\s\S]*?env\(safe-area-inset-bottom/.test(src));

  // The bar must appear over reserved blank space, not over text — and NOT by
  // scrolling the text out of its way, which is a visible ~100px jump and fights
  // iOS momentum scrolling.
  ok('the tail below the last verse is reserved from the shared constant',
     src.includes('READER_TAIL_CSS'));
  ok('the old 24px spacer is gone', !src.includes('<div className="h-6" />'));
  ok('the reader does not scroll the text out of the bar\'s way',
     !src.includes('scrollTo({ top: el.scrollHeight'),
     'a corrective scroll moves the text under the reader; reserve space instead');

  // Both reveal thresholds must be the same number the tail was sized against.
  ok('the scroll-end thresholds use the shared slop',
     (src.match(/READER_END_SLOP_PX/g) ?? []).length >= 2 &&
     !/clientHeight \+ 24|scrollHeight - 24/.test(src),
     'a bare 24 can drift from the tail calculation');

  // Advancing a chapter renders a spinner, which always "fits" — measuring it
  // latched atEnd and flashed the bar over the next, unread chapter.
  ok('atEnd is never measured against a chapter that is still loading',
     /setAtEnd\(result\.key === reqKey &&/.test(src),
     'the spinner always fits, so the bar would flash over the next chapter');
  ok('scrolling cannot latch atEnd mid-load',
     /if \(!el \|\| result\.key !== reqKey\) return;/.test(src));

  // An exit animation keeps the bar mounted, and the scroller short, through the
  // exit — corrupting the very measurement that decides the next chapter.
  ok('the action bar has no exit animation',
     !/reader-action-bar[\s\S]{0,400}exit=\{/.test(src));
}

// ── The reserved-tail invariant, across every plausible device
{
  // Home indicator ~34px on most iPhones, 44-50 on some Androids, 0 on desktop.
  for (const sab of [0, 20, 34, 44, 50]) {
    for (const wide of [false, true]) {
      ok(`tail clears the action bar (safe-area ${sab}px, ${wide ? 'wide' : 'narrow'})`,
         tailClearsActionBar(sab, wide),
         `tail ${reservedTailPx(sab, wide)}px vs bar ${actionBarPx(sab, wide)}px ` +
         `+ ${READER_END_SLOP_PX}px slop`);
    }
  }
  ok('the bar grows with the safe-area inset', actionBarPx(34, false) > actionBarPx(0, false));
  ok('so does the tail', reservedTailPx(34, false) > reservedTailPx(0, false));
}

// ── The two sites the full-bleed rule misses
{
  // An inset-4 window still covers all but a 16px frame, so the ghost click
  // lands inside it too — the backdrop guard was never the whole story.
  const dev = read('../src/components/modals/DevotionalReaderModal.tsx');
  ok('the devotional reader guards its close buttons', dev.includes('useTapGuard(handleClose)')
     && (dev.match(/onClick=\{guardedClose\}/g) ?? []).length === 2,
     'its full-width Done button sits in the bottom strip, and closing LOGS a read');
  ok('no bare close handler survives there', !/onClick=\{handleClose\}/.test(dev));

  // This one opens from a verse number INSIDE the reader, and its backdrop
  // covers the whole reader window — the original ghost-click shape, never wired.
  const vcp = read('../src/components/VerseCopyPopup.tsx');
  ok('the verse-copy sheet guards its backdrop', vcp.includes('useOverlayDismiss('),
     'the ghost click from the verse tap lands squarely on it');
  ok('the verse-copy sheet guards its close button', vcp.includes('useTapGuard(onClose)')
     && vcp.includes('onClick={guardedClose}'));
  ok('its Copy button is deliberately NOT guarded', /onClick=\{handleCopy\}|onClick=\{\(\) => handleCopy/.test(vcp) || vcp.includes('Copy'),
     'blocking harmless actions just makes the first tap feel dead');
}

console.log('');
if (fail === 0) {
  console.log(`TAP-GUARD PASS ${pass} / ${pass}`);
} else {
  console.log(`TAP-GUARD FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
