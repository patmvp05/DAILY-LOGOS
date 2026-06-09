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
  getDoc,
  runTransaction
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
  getDocsCacheFirst, 
  getDocCacheFirst 
} from './firebase';
import { type User } from 'firebase/auth';
import { Progress, UserSettings, HistoryEntry, ProverbJournal, Devotional } from '../types';
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

const _writeDevotional = async (uid: string, devotional: Devotional) => {
  const ref = doc(getDevotionalsCollection(uid), devotional.id);
  await setDoc(ref, { name: devotional.name, description: devotional.description, url: devotional.url });
};

const _deleteDevotional = async (uid: string, id: string) => {
  const ref = doc(getDevotionalsCollection(uid), id);
  await deleteDoc(ref);
};

const _writeActionBatch = async (uid: string, actions: {
  progress?: Progress;
  history?: HistoryEntry | HistoryEntry[];
  completedBooks?: { categoryId: string; bookName: string }[];
  deletedBooks?: { categoryId: string; bookName: string }[];
  forceProgressOverwrite?: boolean;
}) => {
  await runTransaction(db, async (t) => {
    // 1. Read existing progress to avoid clobbering newer cloud progress 
    let cloudProgress: Progress | null = null;
    let progressRef: ReturnType<typeof doc> | null = null;
    if (actions.progress) {
      progressRef = doc(getProgressCollection(uid), actions.progress.categoryId);
      const snap = await t.get(progressRef);
      if (snap.exists()) {
        cloudProgress = snap.data() as Progress;
      }
    }

    // 2. Perform writes
    // History is append-only
    if (actions.history) {
      const entries = Array.isArray(actions.history) ? actions.history : [actions.history];
      entries.forEach(h => {
        const ref = doc(getHistoryCollection(uid), h.id);
        t.set(ref, h);
      });
    }

    if (actions.progress && progressRef) {
      const localp = actions.progress;
      let shouldWriteProgress = true;
      
      if (cloudProgress && !actions.forceProgressOverwrite) {
        const cloudp = cloudProgress as Progress;
        const isCloudFurther = (cloudp.bookIndex > localp.bookIndex) || 
                               (cloudp.bookIndex === localp.bookIndex && cloudp.chapter > localp.chapter);
        
        const localTime = localp.updatedAtMillis || Date.now();
        const cloudTime = cloudp.updatedAtMillis || 0;

        // Skip overwrite if cloud is logically further, UNLESS local explicitly jumped backwards very recently
        // (If localTime is significantly newer than cloudTime by > 2 hours, we assume it's a deliberate reset/jump)
        if (isCloudFurther) {
          if (localTime > cloudTime + 7200000) {
            shouldWriteProgress = true; // Deliberate jump backward
          } else {
            shouldWriteProgress = false;
          }
        } else if (cloudp.bookIndex === localp.bookIndex && cloudp.chapter === localp.chapter) {
           if (cloudTime > localTime) {
             shouldWriteProgress = false;
           }
        }
      }

      if (shouldWriteProgress) {
        const updatedProgressWithTimestamp = {
          ...actions.progress,
          updatedAtMillis: actions.progress.updatedAtMillis || Date.now()
        };
        t.set(progressRef, {
          ...updatedProgressWithTimestamp,
          updatedAt: serverTimestamp()
        });
      }
    }
    
    if (actions.completedBooks) {
      actions.completedBooks.forEach(b => {
        const key = `${b.categoryId}:${b.bookName}`;
        const docId = bookKeyToDocId(key);
        const ref = doc(getCompletedBooksCollection(uid), docId);
        t.set(ref, {
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
        t.delete(ref);
      });
    }
  });
};

const _setUserSettings = async (uid: string, settings: Partial<UserSettings>) => {
  const ref = getUserRef(uid);
  
  // Last-write-wins guard: Check cloud's updatedAt before writing.
  if (settings.updatedAt) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const cloudData = snap.data();
        const cloudUpdated = cloudData.updatedAt;
        if (cloudUpdated) {
          const incomingTime = new Date(settings.updatedAt as string).getTime();
          const cloudTime = cloudUpdated.toMillis ? cloudUpdated.toMillis() : new Date(cloudUpdated as string).getTime();
          if (incomingTime < cloudTime) {
            const cloudISO = cloudUpdated.toMillis ? new Date(cloudUpdated.toMillis()).toISOString() : cloudUpdated;
            console.warn("[startDate write] conflict refused — local data is stale", { 
              localUpdatedAt: settings.updatedAt, 
              cloudUpdatedAt: cloudISO
            });
            throw new Error('STALE_DATA_CONFLICT');
          }
        }
      }
    } catch (e) {
      // Re-throw STALE_DATA_CONFLICT — it must reach processSyncQueue for proper discard.
      if (e instanceof Error && e.message === 'STALE_DATA_CONFLICT') throw e;
      console.warn("[Sync] Last-write-wins check failed, proceeding anyway:", e);
    }
  }

  const dataToUpdate: any = {
    ...settings,
    updatedAt: serverTimestamp()
  };

  await setDoc(ref, dataToUpdate, { merge: true });
};

export async function initializeUser(user: User) {
  const userRef = getUserRef(user.uid);
  
  try {
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      console.log('[Sync] initializeUser: Existing user found.', { 
        uid: user.uid 
      });
      return userData;
    } else {
      console.log('[Sync] initializeUser: Profile missing, onboarding required.', { uid: user.uid });
      return null;
    }
  } catch (error) {
    console.error("[Sync] initializeUser failed:", error);
    throw error;
  }
}

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
    
    // OFFLINE-FIRST Write-Through cache
    // Always dispatch to IndexedDB sync queue first for 100% crash/interrupt durability (iOS Safari pagehide)
    await addToSyncQueue({ 
      type: type as PendingAction['type'], 
      payload: args,
      path
    });
    
    // Notify local listeners that there's pending work
    notify();

    // Fire and forget background sync if online.
    // We let processSyncQueue execute the actual _fn so we benefit from its error handling,
    // deduplication, and lock-mutex.
    if (navigator.onLine) {
      processSyncQueue().catch(e => console.error("Immediate background sync failed:", e));
    }
  }) as T;
};

export const writeCompletedBook = wrap('writeCompletedBook', _writeCompletedBook, (uid, cat, book) => `${uid}/books/${cat}:${book}`);
export const deleteCompletedBook = wrap('deleteCompletedBook', _deleteCompletedBook, (uid, cat, book) => `${uid}/books/${cat}:${book}`);
export const writeJournal = wrap('writeJournal', _writeJournal, (uid, journal) => `${uid}/journals/${(journal as ProverbJournal).id}`);
export const deleteJournal = wrap('deleteJournal', _deleteJournal, (uid, id) => `${uid}/journals/${id}`);
export const writeDevotional = wrap('writeDevotional', _writeDevotional, (uid, devotional) => `${uid}/devotionals/${(devotional as Devotional).id}`);
export const deleteDevotional = wrap('deleteDevotional', _deleteDevotional, (uid, id) => `${uid}/devotionals/${id}`);
export const writeActionBatch = wrap('writeActionBatch', _writeActionBatch, (uid, actions) => {
    const a = actions as { progress?: Progress; history?: HistoryEntry | HistoryEntry[] };
    if (a.progress) return `${uid}/progress/${a.progress.categoryId}`;
    if (a.history) return `${uid}/history/${Array.isArray(a.history) ? a.history[0].id : a.history.id}`;
    return `${uid}/batch/${Date.now()}`;
  });
export const setUserSettings = wrap('setUserSettings', _setUserSettings, (uid) => `${uid}/settings`);
export const resetUserData = wrap('resetUserData', _resetUserData, (uid) => `${uid}/reset`);

let isProcessingQueue = false;

/**
 * Processes all pending actions in the queue sequentially.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) return;
  if (isProcessingQueue) return;
  
  isProcessingQueue = true;
  try {
    let queue = await getSyncQueue();
    while (queue.length > 0) {
      console.log(`[Sync] Processing queue with ${queue.length} items`);
      syncTracker.begin();

      // Mapping of action types to their internal implementations
      const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {
        writeCompletedBook: _writeCompletedBook as (...args: unknown[]) => Promise<void>,
        deleteCompletedBook: _deleteCompletedBook as (...args: unknown[]) => Promise<void>,
        writeJournal: _writeJournal as (...args: unknown[]) => Promise<void>,
        deleteJournal: _deleteJournal as (...args: unknown[]) => Promise<void>,
        writeDevotional: _writeDevotional as (...args: unknown[]) => Promise<void>,
        deleteDevotional: _deleteDevotional as (...args: unknown[]) => Promise<void>,
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
        } catch (err: unknown) {
          const e = err as { code?: string; message?: string };
          console.error(`[Sync] Failed to process queued action ${action.type}:`, e);
          
          // Terminal errors (like permission denied) mean it will never succeed, discard to prevent blocking
          const isTerminal = e?.code === 'permission-denied' || (e?.code === 'not-found' && action.type !== 'setUserSettings');
          if (isTerminal) {
            console.warn(`[Sync] Terminal error for ${action.type}, removing from queue.`);
            await removeFromSyncQueue(action.id);
          } else if (e?.message === 'STALE_DATA_CONFLICT') {
            console.warn(`[Sync] Stale data conflict, discarding stale action.`);
            await removeFromSyncQueue(action.id);
          } else {
            // Transient/Network error, break loop and retain in queue for next run
            break;
          }
        }
      }
      
      syncTracker.end(true);
      
      // Re-fetch queue in case new items were added while we processed
      const newQueue = await getSyncQueue();
      // Only continue if the queue actually has DIFFERENT items than we just iterated over
      // (to prevent infinite loops on un-removable transient network failures)
      if (newQueue.length === queue.length && newQueue.every((item, i) => item.id === queue[i].id)) {
        break; 
      }
      queue = newQueue;
  }
  } finally {
    isProcessingQueue = false;
  }
}

// Reconnection trigger
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sync] Back online, triggering queue process...');
    processSyncQueue();
  });

  // Safari PWA resume / focus synchronization trigger
  window.addEventListener('focus', () => {
    console.log('[Sync] Window focused, triggering queue process...');
    processSyncQueue();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[Sync] App became visible, triggering queue process...');
      processSyncQueue();
    }
  });

  // Periodic fallback check (every 30 seconds) to auto-heal if events were missed
  setInterval(() => {
    if (navigator.onLine) {
      processSyncQueue();
    }
  }, 30000);
}
