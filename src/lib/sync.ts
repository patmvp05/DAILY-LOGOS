/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, getUserRef, getProgressCollection, getHistoryCollection, getJournalsCollection, getDevotionalsCollection, getCompletedBooksCollection, bookKeyToDocId, getDocsCacheFirst, getDocCacheFirst } from './firebase';
import { Progress, UserSettings, HistoryEntry, ProverbJournal } from '../types';
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue, type PendingAction } from './syncQueue';

/**
 * Example of a converted read function using cache-first pattern.
 * High-performance fetch for initial data load.
 */
export async function fetchUserStatsCacheFirst(uid: string) {
  try {
    const userSnap = await getDocCacheFirst(getUserRef(uid));
    const historySnap = await getDocsCacheFirst(getHistoryCollection(uid));
    
    return {
      settings: userSnap.exists() ? userSnap.data() as UserSettings : null,
      historyCount: historySnap.size
    };
  } catch (error) {
    console.error("Cache-first fetch failed:", error);
    return null;
  }
}

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

// Internal implementation functions (unwrapped)
const _writeCompletedBook = async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await setDoc(ref, {
    categoryId,
    bookName,
    completedAt: new Date().toISOString()
  });
};

const _deleteCompletedBook = async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await deleteDoc(ref);
};

const _writeJournal = async (uid: string, journal: ProverbJournal) => {
  const ref = doc(getJournalsCollection(uid), journal.id);
  await setDoc(ref, journal);
};

const _deleteJournal = async (uid: string, id: string) => {
  const ref = doc(getJournalsCollection(uid), id);
  await deleteDoc(ref);
};

const _writeActionBatch = async (uid: string, actions: {
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
};

const _setUserSettings = async (uid: string, settings: UserSettings) => {
  const ref = getUserRef(uid);
  await setDoc(ref, {
    ...settings,
    updatedAt: serverTimestamp()
  });
};

const _resetUserData = async (uid: string) => {
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
};

const wrap = <T extends (...args: unknown[]) => Promise<unknown>>(type: string, fn: T): T => {
  return (async (...args: Parameters<T>) => {
    if (!navigator.onLine) {
      console.log(`[Sync] Offline. Queuing ${type}`);
      await addToSyncQueue({ type: type as PendingAction['type'], payload: args as unknown[] });
      notify();
      return;
    }

    syncTracker.begin();
    try {
      const result = await fn(...args);
      syncTracker.end(true);
      return result;
    } catch (_e) {
      console.warn(`[Sync] Action ${type} failed, queuing for retry:`, _e);
      await addToSyncQueue({ type: type as PendingAction['type'], payload: args as unknown[] });
      syncTracker.end(false);
    }
  }) as T;
};

export const writeCompletedBook = wrap('writeCompletedBook', _writeCompletedBook);
export const deleteCompletedBook = wrap('deleteCompletedBook', _deleteCompletedBook);
export const writeJournal = wrap('writeJournal', _writeJournal);
export const deleteJournal = wrap('deleteJournal', _deleteJournal);
export const writeActionBatch = wrap('writeActionBatch', _writeActionBatch);
export const setUserSettings = wrap('setUserSettings', _setUserSettings);
export const resetUserData = wrap('resetUserData', _resetUserData);

/**
 * Processes all pending actions in the queue.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) return;
  
  const queue = await getSyncQueue();
  if (queue.length === 0) return;

  console.log(`[Sync] Processing queue with ${queue.length} items`);
  syncTracker.begin();

  // Mapping of action types to their internal implementations
  const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {
    writeCompletedBook: _writeCompletedBook as (...args: unknown[]) => Promise<void>,
    deleteCompletedBook: _deleteCompletedBook as (...args: unknown[]) => Promise<void>,
    writeJournal: _writeJournal as (...args: unknown[]) => Promise<void>,
    deleteJournal: _deleteJournal as (...args: unknown[]) => Promise<void>,
    writeActionBatch: _writeActionBatch as (...args: unknown[]) => Promise<void>,
    setUserSettings: _setUserSettings as (...args: unknown[]) => Promise<void>,
    resetUserData: _resetUserData as (...args: unknown[]) => Promise<void>,
  };

  for (const action of queue) {
    try {
      const handler = handlers[action.type];
      if (handler) {
        await handler(...action.payload);
        await removeFromSyncQueue(action.id);
      } else {
        console.warn(`[Sync] No handler for action type: ${action.type}`);
        await removeFromSyncQueue(action.id); // Remove unknown actions
      }
    } catch (e) {
      console.error(`[Sync] Failed to process queued action ${action.type}:`, e);
      break; // Stop to preserve order
    }
  }

  syncTracker.end(true);
}

