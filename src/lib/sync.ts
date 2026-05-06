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
  
  // Write history BEFORE progress updates (as requested)
  if (actions.history) {
    const entries = Array.isArray(actions.history) ? actions.history : [actions.history];
    entries.forEach(h => {
      const ref = doc(getHistoryCollection(uid), h.id);
      batch.set(ref, h);
    });
  }

  if (actions.progress) {
    const ref = doc(getProgressCollection(uid), actions.progress.categoryId);
    batch.set(ref, {
      ...actions.progress,
      updatedAt: serverTimestamp()
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

const _setUserSettings = async (uid: string, settings: Partial<UserSettings>) => {
  const ref = getUserRef(uid);
  await setDoc(ref, {
    ...settings,
    updatedAt: serverTimestamp()
  }, { merge: true });
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

const wrap = <T extends (...args: any[]) => Promise<any>>(
  type: PendingAction['type'], 
  fn: T,
  getPath: (...args: Parameters<T>) => string
): T => {
  return (async (...args: Parameters<T>) => {
    const path = getPath(...args);
    
    if (!navigator.onLine) {
      console.log(`[Sync] Offline. Queuing ${type} for ${path}`);
      await addToSyncQueue({ 
        type: type as PendingAction['type'], 
        payload: args as unknown[],
        path
      });
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
      await addToSyncQueue({ 
        type: type as PendingAction['type'], 
        payload: args as unknown[],
        path
      });
      syncTracker.end(false);
    }
  }) as T;
};

export const writeCompletedBook = wrap('writeCompletedBook', _writeCompletedBook, (uid, cat, book) => `${uid}/books/${cat}:${book}`);
export const deleteCompletedBook = wrap('deleteCompletedBook', _deleteCompletedBook, (uid, cat, book) => `${uid}/books/${cat}:${book}`);
export const writeJournal = wrap('writeJournal', _writeJournal, (uid, journal) => `${uid}/journals/${(journal as ProverbJournal).id}`);
export const deleteJournal = wrap('deleteJournal', _deleteJournal, (uid, id) => `${uid}/journals/${id}`);
export const writeActionBatch = wrap('writeActionBatch', _writeActionBatch, (uid, actions) => {
  const a = actions as any;
  if (a.progress) return `${uid}/progress/${a.progress.categoryId}`;
  if (a.history) return `${uid}/history/${Array.isArray(a.history) ? a.history[0].id : a.history.id}`;
  return `${uid}/batch/${Date.now()}`;
});
export const setUserSettings = wrap('setUserSettings', _setUserSettings, (uid) => `${uid}/settings`);
export const resetUserData = wrap('resetUserData', _resetUserData, (uid) => `${uid}/reset`);

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
      }
      // Always remove if handler processed (success) or handler missing
      await removeFromSyncQueue(action.id);
    } catch (e) {
      const error = e as any;
      console.error(`[Sync] Failed to process queued action ${action.type}:`, e);
      
      // If it's a permission/validation error (terminal), remove it from queue
      const isTerminal = error?.code === 'permission-denied' || error?.name === 'FirebaseError';
      if (isTerminal) {
        console.warn(`[Sync] Terminal error for ${action.type}, removing from queue.`);
        await removeFromSyncQueue(action.id);
      } else {
        // Network error or something transient, stop and retry later to preserve order
        break;
      }
    }
  }

  syncTracker.end(true);
}

// Reconnection trigger
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sync] Back online, triggering queue process...');
    processSyncQueue();
  });
}

