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
  bookKeyToDocId,
  getDocsCacheFirst
} from './firebase';
import { type User } from 'firebase/auth';
import { Progress, UserSettings, HistoryEntry, ProverbJournal } from '../types';
import { logDiagnostic } from './diagnostics';

// Lightweight write-status tracker driving the navbar sync badge.
// Firestore itself handles offline queueing, durability, and retry —
// this only reports whether writes are in flight.
type Listener = (status: 'idle' | 'syncing' | 'synced' | 'error' | 'offline') => void;
let inflight = 0;
const listeners = new Set<Listener>();
const notify = () => {
  if (!navigator.onLine) {
    listeners.forEach(l => l('offline'));
    return;
  }
  const status = inflight > 0 ? 'syncing' : 'synced';
  listeners.forEach(l => l(status));
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
  end(success: boolean) {
    inflight = Math.max(0, inflight - 1);
    if (!success) listeners.forEach(l => l('error'));
    else notify();
  }
};

// Wraps a write so the badge reflects in-flight state. Writes are durable
// in Firestore's local cache immediately; the promise resolves on server ack.
const track = <T extends unknown[]>(fn: (...args: T) => Promise<void>) => {
  return async (...args: T) => {
    syncTracker.begin();
    try {
      await fn(...args);
      syncTracker.end(true);
    } catch (e) {
      console.error('[Sync] Write failed:', e);
      logDiagnostic('sync', 'error', 'Write failed', e);
      syncTracker.end(false);
      throw e;
    }
  };
};

export const writeCompletedBook = track(async (uid: string, categoryId: string, bookName: string) => {
  const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
  await setDoc(doc(getCompletedBooksCollection(uid), docId), {
    categoryId,
    bookName,
    completedAt: new Date().toISOString()
  });
});

export const deleteCompletedBook = track(async (uid: string, categoryId: string, bookName: string) => {
  const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
  await deleteDoc(doc(getCompletedBooksCollection(uid), docId));
});

export const writeJournal = track(async (uid: string, journal: ProverbJournal) => {
  await setDoc(doc(getJournalsCollection(uid), journal.id), journal);
});

export const deleteJournal = track(async (uid: string, id: string) => {
  await deleteDoc(doc(getJournalsCollection(uid), id));
});

export const writeActionBatch = track(async (uid: string, actions: {
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

export const setUserSettings = track(async (uid: string, settings: Partial<UserSettings>) => {
  await setDoc(getUserRef(uid), {
    ...settings,
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

export const resetUserData = track(async (uid: string) => {
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
