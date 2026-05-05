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
import { AppAction } from '../state/appReducer';
import { Progress, HistoryEntry, ProverbJournal, Devotional } from '../types';

export function useFirestoreSync(user: User | null, dispatch: React.Dispatch<AppAction>, setSyncStatus: (status: 'synced' | 'syncing' | 'error' | 'idle') => void) {
  const retryTimeouts = useRef<Record<string, number>>({});
  const initialLoadTracker = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    let isActive = true;
    const currentUnsubs: (() => void)[] = [];
    const collectionsToSync = ['UserSettings', 'Progress', 'CompletedBooks', 'Journals', 'Devotionals', 'History'];
    
    setSyncStatus('syncing');

    const checkInitialSyncDone = () => {
      if (initialLoadTracker.current.size >= collectionsToSync.length) {
        setSyncStatus('synced');
      }
    };

    const setupListener = (
      name: string, 
      ref: any, 
      onUpdate: (snap: any) => void
    ) => {
      let retryCount = 0;
      let currentUnsub: (() => void) | null = null;
      
      const attach = () => {
        if (!isActive) return;
        
        currentUnsub = onSnapshot(ref, { includeMetadataChanges: false }, (snap) => {
          if (!isActive) return;
          retryCount = 0; // Reset on successful hit
          
          onUpdate(snap);
          
          initialLoadTracker.current.add(name);
          checkInitialSyncDone();
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
    setupListener('UserSettings', getUserRef(user.uid), (doc) => {
      if (doc.exists()) {
        queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_USER_DATA', data: doc.data() }));
      } else {
        // If it's a new user, we still count it as synced
        initialLoadTracker.current.add('UserSettings');
      }
    });

    // 2. Progress
    setupListener('Progress', getProgressCollection(user.uid), (snap) => {
      const progress = snap.docs.map((doc: any) => {
        const data = doc.data();
        const updatedAtMillis = data.updatedAt?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt).getTime() : 0);
        return { ...data, updatedAtMillis } as Progress;
      });
      queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_PROGRESS', progress }));
    });

    // 3. Completed Books
    setupListener('CompletedBooks', getCompletedBooksCollection(user.uid), (snap) => {
      const completed = snap.docs.map((doc: any) => {
        const d = doc.data();
        if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
        return d.key;
      }).filter((k: string): k is string => !!k);
      queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_COMPLETED', completed }));
    });

    // 4. Journals
    setupListener('Journals', getJournalsCollection(user.uid), (snap) => {
      const journals = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ProverbJournal));
      queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_JOURNALS', journals }));
    });

    // 5. Devotionals
    setupListener('Devotionals', getDevotionalsCollection(user.uid), (snap) => {
      const devotionals = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Devotional));
      queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_DEVOTIONALS', devotionals }));
    });

    // 6. History
    const historyQuery = query(
      getHistoryCollection(user.uid), 
      orderBy('timestampMillis', 'desc'), 
      limit(250)
    );
    setupListener('History', historyQuery, (snap) => {
      const history = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as HistoryEntry));
      queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_HISTORY', history }));
    });

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
