/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * How long after a modal mounts its dismiss/close handlers stay inert.
 *
 * Comfortably longer than the ~300ms iOS ghost-click latency, and far shorter
 * than any deliberate open-then-close: a person cannot tap a card, see the
 * chapter, decide against it and hit Close inside 450ms.
 */
const GRACE_MS = 450;

/**
 * Shared mount clock. Starts at Infinity so everything is blocked until the
 * mount effect stamps a real deadline. (Reading the clock during render is
 * impure — and the effect runs right after the first paint, long before any
 * tap can land.)
 */
function useGraceGuard(fn: () => void, graceMs: number): () => void {
  const readyAtRef = useRef(Infinity);
  useEffect(() => {
    readyAtRef.current = Date.now() + graceMs;
  }, [graceMs]);

  return useCallback(() => {
    if (Date.now() < readyAtRef.current) return;
    fn();
  }, [fn]);
}

/**
 * Guards a modal's backdrop-dismiss handler against the tap that opened it.
 *
 * On mobile (iOS especially), tapping a control that mounts a full-screen
 * overlay can emit a delayed "ghost click" at the same screen coordinates
 * ~300ms later. While the modal window animates in from a scaled-down state,
 * the dismiss overlay is still under those coordinates, so the ghost click
 * lands on the overlay and closes the modal on the very tap that opened it —
 * the user sees it flash open and immediately shut, and has to tap again.
 *
 * Swallowing dismiss events for a short grace period after mount prevents this
 * without affecting a genuine backdrop tap a moment later.
 *
 * This covers the backdrop ONLY. For a modal that is full-bleed on a phone,
 * the backdrop is not what's under the finger — see useTapGuard.
 */
export function useOverlayDismiss(onDismiss: () => void, graceMs = GRACE_MS) {
  return useGraceGuard(onDismiss, graceMs);
}

/**
 * The same grace, for handlers INSIDE the modal window.
 *
 * useOverlayDismiss assumes the ghost click lands on the backdrop. That holds
 * for a modal inset from the screen edges (`inset-4`), which is what it was
 * written against. It does not hold for the Bible reader or the sprint sheet:
 * both are `fixed inset-0` below the `sm` breakpoint, so on a phone the window
 * covers the entire viewport and the ghost click lands on the WINDOW. Whatever
 * sits at the original tap coordinates receives it — and a dashboard card can
 * sit anywhere, including directly over the header X or the action bar.
 *
 * That made two things possible on a phone: the reader closing on the tap that
 * opened it, and (on a chapter short enough that the action bar is revealed
 * immediately) a ghost click on "Next Chapter" silently advancing a chapter the
 * user never read.
 *
 * Wrap any handler that closes the modal or mutates progress:
 *   const guardedClose = useTapGuard(onClose);
 *   <button onClick={guardedClose}>
 *
 * Same shape as useOverlayDismiss (a hook taking the handler) rather than a
 * factory you call during render: passing a ref-reading closure through a
 * function call in the render body reads, to React's lint, as calling it during
 * render — and DevotionalReaderModal's close handler does read a ref.
 *
 * Do NOT wrap ordinary in-modal interactions — tapping a verse, switching a
 * tab. Those are harmless if they fire early, and blocking them would just make
 * the first tap feel dead.
 */
export function useTapGuard(onTap: () => void, graceMs = GRACE_MS) {
  return useGraceGuard(onTap, graceMs);
}
