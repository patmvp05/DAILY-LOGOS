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
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue } from './syncQueue';

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

const wrap = <T extends (...args: any[]) => Promise<any>>(type: string, fn: T): T => {
  return (async (...args: Parameters<T>) => {
    if (!navigator.onLine) {
      console.log(`[Sync] Offline. Queuing ${type}`);
      await addToSyncQueue({ type: type as any, payload: args });
      notify();
      return;
    }

    syncTracker.begin();
    try {
      const result = await fn(...args);
      syncTracker.end(true);
      return result;
    } catch (e) {
      console.warn(`[Sync] Action ${type} failed, queuing for retry:`, e);
      await addToSyncQueue({ type: type as any, payload: args });
      syncTracker.end(false);
      // Don't throw if we queued it, so the UI can continue
    }
  }) as T;
};

export const writeCompletedBook = wrap('writeCompletedBook', async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await setDoc(ref, {
    categoryId,
    bookName,
    completedAt: new Date().toISOString()
  });
});

export const deleteCompletedBook = wrap('deleteCompletedBook', async (uid: string, categoryId: string, bookName: string) => {
  const key = `${categoryId}:${bookName}`;
  const docId = bookKeyToDocId(key);
  const ref = doc(getCompletedBooksCollection(uid), docId);
  await deleteDoc(ref);
});

export const writeJournal = wrap('writeJournal', async (uid: string, journal: ProverbJournal) => {
  const ref = doc(getJournalsCollection(uid), journal.id);
  await setDoc(ref, journal);
});

export const deleteJournal = wrap('deleteJournal', async (uid: string, id: string) => {
  const ref = doc(getJournalsCollection(uid), id);
  await deleteDoc(ref);
});

export const writeActionBatch = wrap('writeActionBatch', async (uid: string, actions: {
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

export const setUserSettings = wrap('setUserSettings', async (uid: string, settings: UserSettings) => {
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

export const resetUserData = wrap('resetUserData', async (uid: string) => {
  const collections = [
    getProgressCollection(uid),
    getHistoryCollection(uid),
    getJournalsCollection(uid),
    getCompletedBooksCollection(uid),
    getDevotionalsCollection(uid),
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

/**
 * Processes all pending actions in the queue.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) return;
  
  const queue = await getSyncQueue();
  if (queue.length === 0) return;

  console.log(`[Sync] Processing queue with ${queue.length} items`);
  syncTracker.begin();

  // We process them one by one to ensure order and catch failures
  for (const action of queue) {
    try {
      const { type, payload } = action;
      
      // Map types back to original functions (not wrapped ones to avoid recursion)
      // Since we can't easily access the unwrapped ones here without restructuring,
      // we'll just implement the mapping.
      
      let success = false;
      if (type === 'writeActionBatch') {
        const [uid, actions] = payload;
        const batch = writeBatch(db);
        if (actions.progress) batch.set(doc(getProgressCollection(uid), actions.progress.categoryId), { ...actions.progress, updatedAt: serverTimestamp() });
        if (actions.history) (Array.isArray(actions.history) ? actions.history : [actions.history]).forEach(h => batch.set(doc(getHistoryCollection(uid), h.id), h));
        if (actions.completedBooks) actions.completedBooks.forEach((b: any) => {
          const docId = bookKeyToDocId(`${b.categoryId}:${b.bookName}`);
          batch.set(doc(getCompletedBooksCollection(uid), docId), { ...b, completedAt: new Date().toISOString() });
        });
        if (actions.deletedBooks) actions.deletedBooks.forEach((b: any) => {
          const docId = bookKeyToDocId(`${b.categoryId}:${b.bookName}`);
          batch.delete(doc(getCompletedBooksCollection(uid), docId));
        });
        await batch.commit();
        success = true;
      } else if (type === 'writeCompletedBook') {
        const [uid, categoryId, bookName] = payload;
        const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
        await setDoc(doc(getCompletedBooksCollection(uid), docId), { categoryId, bookName, completedAt: new Date().toISOString() });
        success = true;
      } else if (type === 'deleteCompletedBook') {
        const [uid, categoryId, bookName] = payload;
        const docId = bookKeyToDocId(`${categoryId}:${bookName}`);
        await deleteDoc(doc(getCompletedBooksCollection(uid), docId));
        success = true;
      } else if (type === 'writeJournal') {
        const [uid, journal] = payload;
        await setDoc(doc(getJournalsCollection(uid), journal.id), journal);
        success = true;
      } else if (type === 'deleteJournal') {
        const [uid, id] = payload;
        await deleteDoc(doc(getJournalsCollection(uid), id));
        success = true;
      } else if (type === 'setUserSettings') {
        const [uid, settings] = payload;
        await setDoc(getUserRef(uid), { ...settings, updatedAt: serverTimestamp() });
        success = true;
      } else if (type === 'resetUserData') {
        // Resetting data is complex, maybe just skip or handle specially
        // For now let's just mark it as success if we tried or ignore
      }

      if (success) {
        await removeFromSyncQueue(action.id);
      }
    } catch (e) {
      console.error(`[Sync] Failed to process queued action ${action.type}:`, e);
      // Stop processing the rest of the queue if one fails, to preserve order
      break;
    }
  }

  syncTracker.end(true);
}

