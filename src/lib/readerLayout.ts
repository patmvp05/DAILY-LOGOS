/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The geometry that lets the reader's action bar appear without disturbing the
 * text.
 *
 * The bar is a flex sibling of the scroll area, so revealing it shortens the
 * scroller by its own height. Nothing MOVES when that happens — shrinking a
 * scroller raises its maximum scrollTop, and scrollTop is only ever clamped
 * from above — but the bottom strip of the viewport becomes bar instead of
 * text. Without reserved space the last line or two of the chapter would drop
 * out of sight at the exact moment you finished reading them.
 *
 * The fix is static, not corrective: keep a blank tail below the last verse
 * that is always at least as tall as the bar plus the scroll-end slop. Then the
 * bar can only ever appear over blank space. (The corrective alternative —
 * scrolling down by the bar's height once it appears — does move the text, in
 * an unrequested ~100px jump, and on iOS it fights live momentum scrolling.)
 *
 * Kept here rather than inline so the invariant can be proved for every
 * safe-area inset instead of eyeballed on one device.
 */

/** Slop in the "scrolled to the end" test, absorbing fractional scrollHeight. */
export const READER_END_SLOP_PX = 24;

/** Reserved blank tail below the last verse. Grows with the home indicator. */
export const READER_TAIL_CSS = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
const TAIL_BASE_PX = 88; // 5.5rem

/** The scroll wrapper's own bottom padding: py-8, or sm:py-12 from 640px up. */
const WRAPPER_PAD_BOTTOM_PX = { narrow: 32, wide: 48 };

/** Bar height: 1px border + py-4 (sm:py-5) + a 52px button + the safe area. */
export function actionBarPx(safeAreaBottomPx: number, wide: boolean): number {
  return 1 + (wide ? 20 : 16) + 52 + Math.max(16, safeAreaBottomPx);
}

/** Total blank space below the last verse. */
export function reservedTailPx(safeAreaBottomPx: number, wide: boolean): number {
  return TAIL_BASE_PX + safeAreaBottomPx
    + (wide ? WRAPPER_PAD_BOTTOM_PX.wide : WRAPPER_PAD_BOTTOM_PX.narrow);
}

/**
 * THE INVARIANT. While this holds, both reveal paths are safe for free:
 *
 *  - scrolled to the end (`scrollTop + clientHeight >= scrollHeight - SLOP`):
 *    the earliest firing point still leaves `tail - SLOP >= bar` px of blank
 *    below the text, so the bar covers none of it.
 *  - fits without scrolling (`scrollHeight <= clientHeight + SLOP`): the text
 *    bottom is at most `clientHeight + SLOP - tail`, and needing that to be
 *    `<= clientHeight - bar` reduces to the same `tail >= bar + SLOP`.
 *
 * One inequality covers both, which is why the two thresholds share a constant.
 */
export function tailClearsActionBar(safeAreaBottomPx: number, wide: boolean): boolean {
  return reservedTailPx(safeAreaBottomPx, wide)
    >= actionBarPx(safeAreaBottomPx, wide) + READER_END_SLOP_PX;
}
