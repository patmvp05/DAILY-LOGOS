/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Sync status tracking for the navbar badge, deliberately free of any Firebase
// import. Keeping it standalone breaks the sync.ts <-> diagnostics.ts import
// cycle (diagnostics reports the last error; sync logs through diagnostics) and
// lets the status rules be unit tested without initialising Firebase.

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
type Listener = (status: SyncStatus) => void;

export interface SyncFailure {
  operation: string;
  code: string;
  message: string;
  at: string; // ISO
}

/**
 * Firestore error codes meaning "this will not succeed on its own". These
 * represent data that genuinely did not save, so the badge must keep showing
 * them. Everything else (a dropped connection, a timeout) is transient and
 * should stop showing once traffic is flowing again.
 */
export const TERMINAL_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'not-found',
  'failed-precondition',
]);

let inflight = 0;
let lastSyncError: SyncFailure | null = null;
// Whether the current red badge reflects a real, unrecoverable failure.
// A transient failure must NOT latch: the badge used to stay red for the whole
// session after a single blip, because only a later successful WRITE cleared
// it — so someone who was just reading saw a permanent error for a problem that
// had already resolved.
let errorIsTerminal = false;

const listeners = new Set<Listener>();

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const emit = (s: SyncStatus) => listeners.forEach((l) => l(s));

const notify = () => {
  if (isOffline()) return emit('offline');
  emit(inflight > 0 ? 'syncing' : 'synced');
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
}

export const syncTracker = {
  subscribe(l: Listener) {
    listeners.add(l);
    notify();
    return () => { listeners.delete(l); };
  },
  begin() { inflight++; notify(); },
  end(success: boolean, code?: string) {
    inflight = Math.max(0, inflight - 1);
    if (success) {
      errorIsTerminal = false;
      lastSyncError = null;
      notify();
      return;
    }
    errorIsTerminal = !!code && TERMINAL_CODES.has(code);
    emit('error');
  },
  /**
   * Called when a snapshot arrives, which proves the connection is healthy.
   * Clears a lingering TRANSIENT error; a terminal one stays visible because
   * it means something really did fail to save.
   */
  noteHealthyTraffic() {
    if (errorIsTerminal) return;
    if (lastSyncError && !TERMINAL_CODES.has(lastSyncError.code)) lastSyncError = null;
    if (inflight === 0) notify();
  },
  /** Test seam. */
  _reset() {
    inflight = 0;
    lastSyncError = null;
    errorIsTerminal = false;
    listeners.clear();
  },
};

export const getLastSyncError = (): SyncFailure | null => lastSyncError;

/** Record a failure from outside the write path (e.g. a snapshot listener). */
export function recordSyncError(operation: string, e: unknown) {
  const err = e as { code?: string; message?: string };
  lastSyncError = {
    operation,
    code: err?.code || 'unknown',
    message: String(err?.message || e).slice(0, 300),
    at: new Date().toISOString(),
  };
}

/** A human-readable one-liner for the badge tooltip / diagnostics report. */
export function describeSyncError(f: SyncFailure | null): string {
  if (!f) return '';
  const hint =
    f.code === 'permission-denied'
      ? ' — the security rules rejected this write. If a feature was just added, its rules may not be published yet.'
      : f.code === 'unavailable'
        ? ' — could not reach Firestore. This usually clears itself when the connection returns.'
        : f.code === 'unauthenticated'
          ? ' — signed out. Sign in again to resume syncing.'
          : '';
  return `${f.operation} failed (${f.code})${hint}`;
}
