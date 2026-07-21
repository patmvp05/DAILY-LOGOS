/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';

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
  // Seeded on first render (synchronously) so an early ghost click is guarded
  // even before effects run.
  const readyAtRef = useRef<number | null>(null);
  if (readyAtRef.current === null) {
    readyAtRef.current = Date.now() + graceMs;
  }

  return useCallback(() => {
    if (readyAtRef.current !== null && Date.now() < readyAtRef.current) return;
    onDismiss();
  }, [onDismiss]);
}
