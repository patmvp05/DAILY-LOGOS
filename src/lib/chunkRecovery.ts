/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recovering from a lazily-imported chunk that no longer exists.
 *
 * App.tsx code-splits Dashboard and AppModals, Firebase Hosting serves only the
 * newest release, and a tab left open across a deploy still holds the previous
 * build's chunk hashes. Opening a modal then rejects with "Failed to fetch
 * dynamically imported module" — and React unmounts the whole tree on an
 * uncaught render error, so with no boundary that is a white screen with no way
 * back. (The service worker's precache normally covers this; the gap is a page
 * that has already been handed to a newer worker, or a cold cache.)
 *
 * A stale chunk is fixed by reloading — that fetches a fresh index.html with the
 * new hashes. So this case self-heals silently. The danger is a reload loop, so
 * it is allowed once per tab session; anything still broken after that gets a
 * visible fallback instead.
 */

const RELOAD_KEY = 'logos_chunk_reload_v1';

/**
 * Is this the "your chunk is gone" error rather than a real bug?
 *
 * Message-matched because there is no error code for it: browsers each phrase it
 * differently, and Vite/webpack add their own. Kept pure and exported so the
 * strings are testable — getting this wrong in either direction is bad, since a
 * false positive turns a genuine crash into a reload.
 */
export function isStaleChunkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  const text = `${e?.name ?? ''} ${e?.message ?? ''} ${String(err ?? '')}`;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \S+ failed|dynamically imported module/i
    .test(text);
}

/** sessionStorage throws in some privacy modes; never let that break recovery. */
function readFlag(): boolean {
  try { return sessionStorage.getItem(RELOAD_KEY) === '1'; } catch { return false; }
}

export function markAutoReloaded(): void {
  try { sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* best effort */ }
}

export function clearAutoReloaded(): void {
  try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* best effort */ }
}

/** One silent reload per tab session. A loop is worse than the error. */
export function canAutoReload(): boolean {
  return !readFlag();
}

/**
 * Reload once to pick up the current build. Returns false if we already spent
 * this session's one attempt, in which case the caller should show a fallback.
 */
export function attemptChunkReload(): boolean {
  if (!canAutoReload()) return false;
  markAutoReloaded();
  window.location.reload();
  return true;
}

/**
 * Re-arm the one-shot after the app has clearly survived. Without this a tab
 * that self-healed once could never do it again, and these tabs stay open for
 * days. The delay only has to outlast a reload loop, which would recur in
 * milliseconds.
 */
export function armChunkRecoveryReset(delayMs = 10_000): void {
  setTimeout(clearAutoReloaded, delayMs);
}
