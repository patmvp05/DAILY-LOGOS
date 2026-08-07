/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  getDoc
} from 'firebase/firestore';
import {
  db,
  getUserRef,
  getProgressCollection,
  getHistoryCollection,
  getJournalsCollection,
  getDevotionalsCollection,
  getCompletedBooksCollection,
  getSprintsCollection,
  bookKeyToDocId,
  getDocsCacheFirst
} from './firebase';
import { type User } from 'firebase/auth';
import { Progress, UserSettings, HistoryEntry, ProverbJournal, SprintHour } from '../types';
import { logDiagnostic } from './diagnostics';
import { syncTracker, recordSyncError } from './syncStatus';

export { syncTracker, recordSyncError, getLastSyncError, describeSyncError } from './syncStatus';
export type { SyncFailure, SyncStatus } from './syncStatus';

// Wraps a write so the badge reflects in-flight state. Writes are durable
// in Firestore's local cache immediately; the promise resolves on server ack.
const track = <T extends unknown[]>(operation: string, fn: (...args: T) => Promise<void>) => {
  return async (...args: T) => {
    syncTracker.begin();
    try {
      await fn(...args);
      syncTracker.end(true);
    } catch (e) {
      recordSyncError(operation, e);
      console.error(`[Sync] ${operation} failed:`, e);
      logDiagnostic('sync', 'error', `${operation} failed`, e);
      syncTracker.end(false, (e as { code?: string })?.code);
      throw e;
    }
  };
};

export const writeCompletedBook = track('writeCompletedBook', async (uid: string, categoryId: string, bookName: string) => {
  const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
  await setDoc(doc(getCompletedBooksCollection(uid), docId), {
    categoryId,
    bookName,
    completedAt: new Date().toISOString()
  });
});

export const deleteCompletedBook = track('deleteCompletedBook', async (uid: string, categoryId: string, bookName: string) => {
  const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
  await deleteDoc(doc(getCompletedBooksCollection(uid), docId));
});

/**
 * Persist a single hour of a sprint.
 *
 * Writes ONLY the touched hour, with merge:true — Firestore deep-merges map
 * fields, so two devices ticking different hours of the same day both survive.
 * Writing the whole `hours` map instead would let the second writer clobber the
 * first device's tick.
 */
export const writeSprintHour = track('writeSprintHour', async (
  uid: string,
  date: string,
  hour: number,
  slot: SprintHour
) => {
  await setDoc(
    doc(getSprintsCollection(uid), date),
    {
      date,
      hours: { [String(hour)]: { done: slot.done, reference: slot.reference ?? '' } },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
});

export const deleteSprint = track('deleteSprint', async (uid: string, date: string) => {
  await deleteDoc(doc(getSprintsCollection(uid), date));
});

export const writeJournal = track('writeJournal', async (uid: string, journal: ProverbJournal) => {
  await setDoc(doc(getJournalsCollection(uid), journal.id), journal);
});

export const deleteJournal = track('deleteJournal', async (uid: string, id: string) => {
  await deleteDoc(doc(getJournalsCollection(uid), id));
});

export const writeActionBatch = track('writeActionBatch', async (uid: string, actions: {
  progress?: Progress;
  history?: HistoryEntry | HistoryEntry[];
  completedBooks?: { categoryId: string; bookName: string }[];
  deletedBooks?: { categoryId: string; bookName: string }[];
  forceProgressOverwrite?: boolean;
}) => {
  const batch = writeBatch(db);

  if (actions.history) {
    const entries = Array.isArray(actions.history) ? actions.history : [actions.history];
    entries.forEach(h => batch.set(doc(getHistoryCollection(uid), h.id), h));
  }

  if (actions.progress) {
    const ref = doc(getProgressCollection(uid), actions.progress.categoryId);
    // serverMillis is derived from this doc's own updatedAt on read; persisting
    // a device's copy would let a stale value survive a pending write.
    const { serverMillis: _ignored, ...progressDoc } = actions.progress;
    void _ignored;
    batch.set(ref, {
      ...progressDoc,
      updatedAtMillis: actions.progress.updatedAtMillis || Date.now(),
      updatedAt: serverTimestamp()
    });
  }

  if (actions.completedBooks) {
    actions.completedBooks.forEach(b => {
      const docId = bookKeyToDocId(`${b.categoryId}:${b.bookName}`);
      batch.set(doc(getCompletedBooksCollection(uid), docId), {
        categoryId: b.categoryId,
        bookName: b.bookName,
        completedAt: new Date().toISOString()
      });
    });
  }

  if (actions.deletedBooks) {
    actions.deletedBooks.forEach(b => {
      const docId = bookKeyToDocId(`${b.categoryId}:${b.bookName}`);
      batch.delete(doc(getCompletedBooksCollection(uid), docId));
    });
  }

  await batch.commit();
});

/**
 * Write the user's settings document.
 *
 * ALWAYS sends startDate + theme, never just the field that changed. With
 * merge:true a write to a users/{uid} doc that does not exist yet is a CREATE,
 * and the create rule runs isValidUser(), which requires
 * hasAll(['startDate','theme','updatedAt']). A partial {theme} write therefore
 * failed with permission-denied — a TERMINAL code, so the sync badge latched
 * red — for any account whose cloud user doc had never been created (e.g. a
 * start date chosen as a guest, then signing in: onboarding is gated on the
 * LOCAL startDate, so the doc-creating path never ran). Sending all three
 * fields still satisfies the update rule's
 * affectedKeys().hasOnly(['theme','updatedAt','startDate']).
 *
 * `current` is the app's live settings, so an unchanged field is written back
 * as-is rather than being invented.
 */
export const setUserSettings = track('setUserSettings', async (
  uid: string,
  settings: Partial<UserSettings>,
  current?: Partial<UserSettings>
) => {
  await setDoc(getUserRef(uid), {
    startDate: settings.startDate ?? current?.startDate ?? new Date().toISOString(),
    theme: settings.theme ?? current?.theme ?? 'system',
    updatedAt: serverTimestamp()
  }, { merge: true });
});

export async function initializeUser(user: User) {
  const userRef = getUserRef(user.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      console.log('[Sync] initializeUser: Existing user found.', { uid: user.uid });
      return userSnap.data();
    }
    console.log('[Sync] initializeUser: Profile missing, onboarding required.', { uid: user.uid });
    return null;
  } catch (error) {
    console.error('[Sync] initializeUser failed:', error);
    throw error;
  }
}

export const resetUserData = track('resetUserData', async (uid: string) => {
  const collections = [
    getProgressCollection(uid),
    getHistoryCollection(uid),
    getJournalsCollection(uid),
    getCompletedBooksCollection(uid),
    getDevotionalsCollection(uid),
  ];

  await Promise.all(collections.map(async (col) => {
    const snap = await getDocsCacheFirst(col);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }));

  await setDoc(getUserRef(uid), {
    startDate: new Date().toISOString(),
    theme: 'system',
    updatedAt: serverTimestamp()
  });
});
