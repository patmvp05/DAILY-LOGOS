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
  getDocs
} from 'firebase/firestore';
import { db, getUserRef, getProgressCollection, getHistoryCollection, getJournalsCollection, getDevotionalsCollection, getCompletedBooksCollection, bookKeyToDocId } from './firebase';
import { Progress, UserSettings, HistoryEntry, ProverbJournal, Devotional } from '../types';

type Listener = (status: 'idle' | 'syncing' | 'synced' | 'error') => void;
let inflight = 0;
const listeners = new Set<Listener>();
const notify = () => {
  const status = inflight > 0 ? 'syncing' : 'synced';
  listeners.forEach(l => l(status));
};

export const syncTracker = {
  subscribe(l: Listener) { 
    listeners.add(l); 
    return () => { listeners.delete(l); }; 
  },
  begin() { inflight++; notify(); },
  end(success: boolean) {
    inflight = Math.max(0, inflight - 1);
    if (!success) listeners.forEach(l => l('error'));
    else notify();
  }
};

const wrap = <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
  return (async (...args: Parameters<T>) => {
    syncTracker.begin();
    try {
      const result = await fn(...args);
      syncTracker.end(true);
      return result;
    } catch (e) {
      syncTracker.end(false);
      throw e;
    }
  }) as T;
};

export const writeCompletedBook = wrap(async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await setDoc(ref, {
    categoryId,
    bookName,
    completedAt: new Date().toISOString()
  });
});

export const deleteCompletedBook = wrap(async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await deleteDoc(ref);
});

export const writeJournal = wrap(async (uid: string, journal: ProverbJournal) => {
  const ref = doc(getJournalsCollection(uid), journal.id);
  await setDoc(ref, journal);
});

export const deleteJournal = wrap(async (uid: string, id: string) => {
  const ref = doc(getJournalsCollection(uid), id);
  await deleteDoc(ref);
});

export const writeActionBatch = wrap(async (uid: string, actions: {
  progress?: Progress;
  history?: HistoryEntry | HistoryEntry[];
  completedBooks?: { categoryId: string; bookName: string }[];
  deletedBooks?: { categoryId: string; bookName: string }[];
}) => {
  const batch = writeBatch(db);
  
  if (actions.progress) {
    const ref = doc(getProgressCollection(uid), actions.progress.categoryId);
    batch.set(ref, {
      ...actions.progress,
      updatedAt: serverTimestamp()
    });
  }
  
  if (actions.history) {
    const entries = Array.isArray(actions.history) ? actions.history : [actions.history];
    entries.forEach(h => {
      const ref = doc(getHistoryCollection(uid), h.id);
      batch.set(ref, h);
    });
  }
  
  if (actions.completedBooks) {
    actions.completedBooks.forEach(b => {
      const key = `${b.categoryId}:${b.bookName}`;
      const docId = bookKeyToDocId(key);
      const ref = doc(getCompletedBooksCollection(uid), docId);
      batch.set(ref, {
        categoryId: b.categoryId,
        bookName: b.bookName,
        completedAt: new Date().toISOString()
      });
    });
  }

  if (actions.deletedBooks) {
    actions.deletedBooks.forEach(b => {
      const key = `${b.categoryId}:${b.bookName}`;
      const docId = bookKeyToDocId(key);
      const ref = doc(getCompletedBooksCollection(uid), docId);
      batch.delete(ref);
    });
  }
  
  await batch.commit();
});

export const setUserSettings = wrap(async (uid: string, settings: UserSettings) => {
  const ref = getUserRef(uid);
  try {
    await setDoc(ref, {
      ...settings,
      updatedAt: serverTimestamp()
    });
  } catch (error: any) {
    if (error?.code === 'permission-denied') {
      console.error("Theme sync rejected by rules — update firestore.rules", error);
    }
    throw error;
  }
});

export const resetUserData = wrap(async (uid: string) => {
  const collections = [
    getProgressCollection(uid),
    getHistoryCollection(uid),
    getJournalsCollection(uid),
    getCompletedBooksCollection(uid),
    getDevotionalsCollection(uid), // Added missing collection
  ];
  
  await Promise.all(collections.map(async (col) => {
    const snap = await getDocs(col);
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
