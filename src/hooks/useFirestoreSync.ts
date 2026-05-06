/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { 
  onSnapshot, 
  query, 
  orderBy, 
  type QuerySnapshot, 
  type DocumentSnapshot,
} from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { 
  getUserRef, 
  getProgressCollection, 
  getHistoryCollection, 
  getJournalsCollection, 
  getDevotionalsCollection, 
  getCompletedBooksCollection 
} from '../lib/firebase';
import { AppAction } from '../state/appReducer';
import { Progress, HistoryEntry, ProverbJournal, Devotional, AppState, UserSettings } from '../types';

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
        dispatch({ type: 'HYDRATE_STATE', state: initialData.current, isCloudData: true });
        setSyncStatus('synced');
      }
    };

    const setupListener = <S extends DocumentSnapshot<any, any> | QuerySnapshot<any, any>, T>(
      name: string, 
      ref: any, 
      stateKey: keyof AppState | null,
      onUpdate: (snap: S) => T,
      action: AppAction['type']
    ) => {
      let retryCount = 0;
      let currentUnsub: (() => void) | null = null;
      
      const attach = () => {
        if (!isActive) return;
        
        currentUnsub = onSnapshot(ref, { includeMetadataChanges: false }, (snap: any) => {
          if (!isActive) return;
          retryCount = 0; // Reset on successful hit
          
          const processedData = onUpdate(snap as S);
          
          if (!isInitialLoadComplete.current) {
            if (stateKey) {
              (initialData.current as any)[stateKey] = processedData;
            }
            initialLoadTracker.current.add(name);
            checkInitialSyncDone();
          } else {
            // After initial load, dispatch normally
            if (action === 'CLOUD_SYNC_USER_DATA') dispatch({ type: action, data: processedData as any });
            else if (action === 'CLOUD_SYNC_PROGRESS') dispatch({ type: action, progress: processedData as Progress[] });
            else if (action === 'CLOUD_SYNC_COMPLETED') dispatch({ type: action, completed: Array.from(processedData as Set<string>) });
            else if (action === 'CLOUD_SYNC_JOURNALS') dispatch({ type: action, journals: processedData as ProverbJournal[] });
            else if (action === 'CLOUD_SYNC_DEVOTIONALS') dispatch({ type: action, devotionals: processedData as Devotional[] });
            else if (action === 'CLOUD_SYNC_HISTORY') dispatch({ type: action, history: processedData as HistoryEntry[] });
          }
        }, (err: Error) => {
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
    setupListener<DocumentSnapshot, UserSettings>('UserSettings', getUserRef(user.uid), 'settings', (doc) => {
      if (!doc.exists()) {
        console.log("[Sync] UserSettings document does not exist on server/cache.");
        return { theme: 'system', startDate: '', userName: '' };
      }
      
      const data = doc.data() as any;
      const settings: UserSettings = { 
        theme: data.theme || 'system',
        startDate: '',
        userName: data.userName || ''
      };
      
      // Handle potential Timestamp or string for both startDate and planStartDate
      const rawStart = data.startDate || data.planStartDate;
      if (rawStart) {
        if (typeof rawStart === 'string') {
          settings.startDate = rawStart;
        } else if (rawStart && typeof rawStart === 'object' && 'toMillis' in rawStart) {
          settings.startDate = new Date((rawStart as any).toMillis()).toISOString();
        } else if (rawStart && typeof rawStart === 'object' && 'seconds' in rawStart) {
          settings.startDate = new Date((rawStart as any).seconds * 1000).toISOString();
        }
      }
      
      console.log(`[Sync] UserSettings loaded:`, settings.startDate);
      return settings;
    }, 'CLOUD_SYNC_USER_DATA');

    // 2. Progress
    setupListener<QuerySnapshot, Progress[]>('Progress', getProgressCollection(user.uid), 'progress', (snap) => {
      return snap.docs.map((doc) => {
        const data = doc.data();
        const updatedAtMillis = (data.updatedAt as { toMillis?: () => number })?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt as string).getTime() : 0);
        return { ...data, updatedAtMillis } as unknown as Progress;
      });
    }, 'CLOUD_SYNC_PROGRESS');

    // 3. Completed Books
    setupListener<QuerySnapshot, Set<string>>('CompletedBooks', getCompletedBooksCollection(user.uid), 'completedBooks', (snap) => {
      const completed = snap.docs.map((doc) => {
        const d = doc.data();
        if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
        return d.key as string;
      }).filter((k: string): k is string => !!k);
      return new Set(completed);
    }, 'CLOUD_SYNC_COMPLETED');

    // 4. Journals
    setupListener<QuerySnapshot, ProverbJournal[]>('Journals', getJournalsCollection(user.uid), 'proverbJournals', (snap) => {
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as ProverbJournal));
    }, 'CLOUD_SYNC_JOURNALS');

    // 5. Devotionals
    setupListener<QuerySnapshot, Devotional[]>('Devotionals', getDevotionalsCollection(user.uid), 'customDevotionals', (snap) => {
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as Devotional));
    }, 'CLOUD_SYNC_DEVOTIONALS');

    // 6. History - No limit for accurate streak calculation
    const historyQuery = query(
      getHistoryCollection(user.uid), 
      orderBy('timestampMillis', 'desc')
    );
    setupListener<QuerySnapshot, HistoryEntry[]>('History', historyQuery, 'history', (snap) => {
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as HistoryEntry));
    }, 'CLOUD_SYNC_HISTORY');

    const timeoutsForCleanup = retryTimeouts.current;
    const trackerForCleanup = initialLoadTracker.current;

    return () => {
      isActive = false;
      currentUnsubs.forEach(u => u());
      Object.keys(timeoutsForCleanup).forEach(k => {
        if (timeoutsForCleanup[k]) window.clearTimeout(timeoutsForCleanup[k]);
      });
      trackerForCleanup.clear();
    };
  }, [user, dispatch, setSyncStatus]);
}
