/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which UI surfaces must lock body scroll while they are open.
 *
 * Kept as a pure function, separate from App.tsx, because the list is easy to
 * forget to update: the Bible reader and the devotional reader were both
 * missing from it, so opening a chapter on a phone left the page behind
 * scrolling under the modal — you'd land partway down the page and have to
 * scroll back up before you could read. Every full-screen overlay belongs here.
 */
export interface ModalOpenState {
  showSettings?: boolean;
  showHistory?: boolean;
  activePlanCategory?: unknown;
  selectingCategoryId?: unknown;
  activeDevotion?: unknown;
  /** Bible chapter reader. */
  readerCategoryId?: unknown;
  /** In-app devotional reader. */
  activeInternalDevotional?: unknown;
  showProverbModal?: boolean;
  showSprintModal?: boolean;
  isStartMenuOpen?: boolean;
}

/** Every key of ModalOpenState — the single source of truth for the lock. */
export const SCROLL_LOCKING_SURFACES = [
  'showSettings',
  'showHistory',
  'activePlanCategory',
  'selectingCategoryId',
  'activeDevotion',
  'readerCategoryId',
  'activeInternalDevotional',
  'showProverbModal',
  'showSprintModal',
  'isStartMenuOpen',
] as const;

/** True when any overlay is open, so the body behind it must not scroll. */
export function isAnyOverlayOpen(s: ModalOpenState): boolean {
  return SCROLL_LOCKING_SURFACES.some((k) => !!s[k]);
}
