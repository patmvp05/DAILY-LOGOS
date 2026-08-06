/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';

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
 * without affecting a genuine backdrop tap a moment later. Only wire this to
 * the backdrop/overlay onClick — never to explicit Close/Done buttons.
 */
export function useOverlayDismiss(onDismiss: () => void, graceMs = 450) {
  // Starts at Infinity so dismissal is blocked until the mount effect stamps a
  // real deadline. (Reading the clock during render is impure — and the effect
  // runs right after the first paint, long before any tap can land.)
  const readyAtRef = useRef(Infinity);
  useEffect(() => {
    readyAtRef.current = Date.now() + graceMs;
  }, [graceMs]);

  return useCallback(() => {
    if (Date.now() < readyAtRef.current) return;
    onDismiss();
  }, [onDismiss]);
}
