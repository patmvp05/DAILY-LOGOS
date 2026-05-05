/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { 
  getUserRef, 
  getProgressCollection, 
  getHistoryCollection, 
  getJournalsCollection, 
  getDevotionalsCollection, 
  getCompletedBooksCollection 
} from '../lib/firebase';
import { AppAction, HISTORY_CAP } from '../state/appReducer';
import { Progress, HistoryEntry, ProverbJournal, Devotional, AppState } from '../types';

export function useFirestoreSync(user: User | null, dispatch: React.Dispatch<AppAction>, setSyncStatus: (status: 'synced' | 'syncing' | 'error' | 'idle') => void) {
  const retryTimeouts = useRef<Record<string, number>>({});
  const initialLoadTracker = useRef<Set<string>>(new Set());
  const initialData = useRef<Partial<AppState>>({});
  const isInitialLoadComplete = useRef(false);

  useEffect(() => {
    if (!user) return;

    let isActive = true;
    const currentUnsubs: (() => void)[] = [];
    const collectionsToSync = ['UserSettings', 'Progress', 'CompletedBooks', 'Journals', 'Devotionals', 'History'];
    
    setSyncStatus('syncing');

    const checkInitialSyncDone = () => {
      if (!isInitialLoadComplete.current && initialLoadTracker.current.size >= collectionsToSync.length) {
        isInitialLoadComplete.current = true;
        dispatch({ type: 'HYDRATE_STATE', state: initialData.current, restoredFromSnapshot: true });
        setSyncStatus('synced');
      }
    };

    const setupListener = (
      name: string, 
      ref: any, 
      stateKey: keyof AppState | null,
      onUpdate: (snap: any) => any,
      action: AppAction['type']
    ) => {
      let retryCount = 0;
      let currentUnsub: (() => void) | null = null;
      
      const attach = () => {
        if (!isActive) return;
        
        currentUnsub = onSnapshot(ref, { includeMetadataChanges: false }, (snap) => {
          if (!isActive) return;
          retryCount = 0; // Reset on successful hit
          
          const processedData = onUpdate(snap);
          
          if (!isInitialLoadComplete.current) {
            if (stateKey) {
              (initialData.current as any)[stateKey] = processedData;
            }
            initialLoadTracker.current.add(name);
            checkInitialSyncDone();
          } else {
            // After initial load, dispatch normally
            if (action === 'CLOUD_SYNC_USER_DATA') dispatch({ type: action, data: processedData });
            else if (action === 'CLOUD_SYNC_PROGRESS') dispatch({ type: action, progress: processedData });
            else if (action === 'CLOUD_SYNC_COMPLETED') dispatch({ type: action, completed: Array.from(processedData as Set<string>) });
            else if (action === 'CLOUD_SYNC_JOURNALS') dispatch({ type: action, journals: processedData });
            else if (action === 'CLOUD_SYNC_DEVOTIONALS') dispatch({ type: action, devotionals: processedData });
            else if (action === 'CLOUD_SYNC_HISTORY') dispatch({ type: action, history: processedData });
          }
        }, (err) => {
          console.error(`${name} sync error:`, err);
          setSyncStatus('error');
          if (currentUnsub) currentUnsub();
          
          // Exponential backoff for reconnection
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          retryCount++;
          
          retryTimeouts.current[name] = window.setTimeout(attach, delay);
        });
        
        currentUnsubs.push(() => {
          if (currentUnsub) currentUnsub();
        });
      };
      
      attach();
    };

    // 1. User Settings
    setupListener('UserSettings', getUserRef(user.uid), 'settings', (doc) => {
      return doc.exists() ? doc.data() : { startDate: new Date().toISOString(), theme: 'system' };
    }, 'CLOUD_SYNC_USER_DATA');

    // 2. Progress
    setupListener('Progress', getProgressCollection(user.uid), 'progress', (snap) => {
      return snap.docs.map((doc: any) => {
        const data = doc.data();
        const updatedAtMillis = data.updatedAt?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt).getTime() : 0);
        return { ...data, updatedAtMillis } as Progress;
      });
    }, 'CLOUD_SYNC_PROGRESS');

    // 3. Completed Books
    setupListener('CompletedBooks', getCompletedBooksCollection(user.uid), 'completedBooks', (snap) => {
      const completed = snap.docs.map((doc: any) => {
        const d = doc.data();
        if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
        return d.key;
      }).filter((k: string): k is string => !!k);
      return new Set(completed);
    }, 'CLOUD_SYNC_COMPLETED');

    // 4. Journals
    setupListener('Journals', getJournalsCollection(user.uid), 'proverbJournals', (snap) => {
      return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ProverbJournal));
    }, 'CLOUD_SYNC_JOURNALS');

    // 5. Devotionals
    setupListener('Devotionals', getDevotionalsCollection(user.uid), 'customDevotionals', (snap) => {
      return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Devotional));
    }, 'CLOUD_SYNC_DEVOTIONALS');

    // 6. History
    const historyQuery = query(
      getHistoryCollection(user.uid), 
      orderBy('timestampMillis', 'desc'), 
      limit(HISTORY_CAP)
    );
    setupListener('History', historyQuery, 'history', (snap) => {
      return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as HistoryEntry));
    }, 'CLOUD_SYNC_HISTORY');

    return () => {
      const timeouts = retryTimeouts.current;
      isActive = false;
      currentUnsubs.forEach(u => u());
      Object.keys(timeouts).forEach(k => {
        if (timeouts[k]) clearTimeout(timeouts[k]);
      });
      initialLoadTracker.current.clear();
    };
  }, [user, dispatch, setSyncStatus]);
}
