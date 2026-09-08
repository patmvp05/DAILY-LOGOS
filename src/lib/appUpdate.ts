/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Holds a downloaded app update until applying it can't interrupt anything.
 *
 * The app used to run the service worker in `autoUpdate` mode, which hard-
 * reloads the page the instant a new deploy activates (vite-plugin-pwa's
 * generated register code does `wb.on('activated', () => location.reload())`
 * with no hook to intercept). Combined with the update check that fires on
 * every foreground (see main.tsx), the first time you opened the app after a
 * deploy you would tap into a chapter and the page would reload underneath you
 * a second or two later — the reader vanished and you had to tap again. It read
 * exactly like a modal bug; it was the whole app restarting.
 *
 * So the service worker now parks in `waiting` (registerType: 'prompt', and
 * crucially NO workbox skipWaiting) and hands the "apply it" function here. We
 * apply it at a moment that costs the user nothing: when no full-screen surface
 * is open, or when the app is backgrounded. Still fully automatic — there is no
 * prompt to dismiss — it just never happens mid-sentence.
 *
 * Deliberately framework-free and dependency-free (no React, no Firebase) so
 * main.tsx can reach it from outside the tree and so the decision below is
 * unit-testable.
 */

export interface UpdateApplyState {
  /** An update has downloaded and is waiting to take over. */
  pending: boolean;
  /** A full-screen surface is open — isAnyOverlayOpen(), the scroll-lock list. */
  overlayOpen: boolean;
  /**
   * A confirm dialog is waiting on an answer. It is rendered by App.tsx outside
   * the overlay list, and it gates the destructive actions (reset progress,
   * clear a sprint) — reloading would silently discard a decision in progress.
   */
  confirmOpen: boolean;
  /** A Google sign-in is in flight; reloading aborts the handshake. */
  isSigningIn: boolean;
  /** The app is backgrounded — document.visibilityState === 'hidden'. */
  documentHidden: boolean;
}

/**
 * May we apply a pending update right now?
 *
 * Backgrounded wins over everything: if the user isn't looking, reloading is
 * free, and it is the backstop that stops a reader left open overnight from
 * pinning the app to an old build forever. Otherwise we wait for every overlay
 * to close — reloading behind an open modal would still throw away what they
 * were doing.
 */
export function shouldApplyUpdate(s: UpdateApplyState): boolean {
  if (!s.pending) return false;
  // The only rule that outranks "backgrounded": a redirect sign-in is still in
  // flight precisely while the page is hidden.
  if (s.isSigningIn) return false;
  if (s.documentHidden) return true;
  return !s.overlayOpen && !s.confirmOpen;
}

/*
 * Deliberately NOT guarded on: an in-flight Firestore write. firebase.ts
 * initialises with persistentLocalCache, so a queued write survives the reload
 * in IndexedDB and replays — blocking on it would only cost us the one moment
 * (backgrounding) that is guaranteed free.
 *
 * And deliberately no idle timer as a second backstop. Reading a chapter
 * produces zero input events for minutes at a time — that IS the activity — so
 * any "no interaction for N minutes" rule fires mid-read, which is the bug this
 * whole module exists to prevent. Backgrounding is the only signal that means
 * "nothing on screen can be interrupted".
 */

let applyFn: (() => void) | null = null;
let applied = false;
const listeners = new Set<() => void>();

/**
 * Called from the service-worker registration once a new version is waiting.
 * `apply` messages the waiting worker to take over, which reloads the page.
 */
export function setPendingUpdate(apply: () => void): void {
  if (applied) return;
  applyFn = apply;
  listeners.forEach((l) => l());
}

export function hasPendingUpdate(): boolean {
  return applyFn !== null && !applied;
}

/** Subscribe to "an update just became available". Returns an unsubscribe. */
export function subscribeToUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Apply the pending update, at most once. Latching on `applied` matters because
 * the reload it triggers is asynchronous: without it, a visibilitychange landing
 * in the same tick would message the worker twice.
 */
export function applyPendingUpdate(): boolean {
  if (!hasPendingUpdate()) return false;
  const fn = applyFn!;
  applied = true;
  applyFn = null;
  try {
    fn();
  } catch {
    // Messaging the waiting worker failed. Put it back rather than pinning this
    // session to the old build until the app is restarted.
    applied = false;
    applyFn = fn;
    return false;
  }
  return true;
}

/** Test seam — resets module state between cases. Not used by the app. */
export function __resetAppUpdateForTests(): void {
  applyFn = null;
  applied = false;
  listeners.clear();
}
