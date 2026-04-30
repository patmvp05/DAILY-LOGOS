/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { onSnapshot, getDocs, getDoc, query, orderBy, limit } from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { 
  getUserRef, 
  getProgressCollection, 
  getHistoryCollection, 
  getJournalsCollection, 
  getDevotionalsCollection, 
  getCompletedBooksCollection,
  mapDocs
} from '../lib/firebase';
import { AppAction } from '../state/appReducer';
import { AppState, Progress, HistoryEntry, ProverbJournal, Devotional } from '../types';

export function useFirestoreSync(user: User | null, dispatch: React.Dispatch<AppAction>, setSyncStatus: (status: 'synced' | 'syncing' | 'error' | 'idle') => void) {
  const retryTimeouts = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;

    let isActive = true;
    const unsubs: (() => void)[] = [];

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    const startSync = async () => {
      setSyncStatus('syncing');
      
      try {
        const historyQuery = query(
          getHistoryCollection(user.uid), 
          orderBy('timestampMillis', 'desc'), 
          limit(250)
        );

        // Helper to load collection with its own error handling and 2s timeout
        const loadSnap = async (promise: Promise<any>, name: string) => {
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), 2000)
          );
          try {
            return await Promise.race([promise, timeoutPromise]);
          } catch (e) {
            console.warn(`Failed to load ${name} during initial sync (or timed out):`, e);
            return null;
          }
        };

        // 1. Initial One-Time Bulk Load
        console.log("Starting initial Firestore load...");
        const [
          userDoc,
          progressSnap,
          completedSnap,
          journalsSnap,
          devotionalsSnap,
          historySnap
        ] = await Promise.all([
          loadSnap(getDoc(getUserRef(user.uid)), 'UserDoc'),
          loadSnap(getDocs(getProgressCollection(user.uid)), 'Progress'),
          loadSnap(getDocs(getCompletedBooksCollection(user.uid)), 'CompletedBooks'),
          loadSnap(getDocs(getJournalsCollection(user.uid)), 'Journals'),
          loadSnap(getDocs(getDevotionalsCollection(user.uid)), 'Devotionals'),
          loadSnap(getDocs(historyQuery), 'History')
        ]);

        if (!isActive) return;

        const partialState: Partial<AppState> = {};

        // Defensive guard: if cloud is empty for all key collections, suspect data loss or first load
        const cloudIsEmpty = (!historySnap || historySnap.empty) && 
                             (!progressSnap || progressSnap.empty) && 
                             (!completedSnap || completedSnap.empty);

        if (cloudIsEmpty && isSafari) {
          console.warn("Safari detected and cloud returned empty collections. Suspending initial REPLACE_STATE to prevent overwriting local data.");
          // We return here but still setup listeners below so real data eventually hydrates if it exists
        } else if (cloudIsEmpty && !userDoc?.exists()) {
          // Truly empty new user, no need to dispatch empty state either
        } else {
          if (userDoc && userDoc.exists()) {
            const data = userDoc.data();
            partialState.settings = {
              startDate: data.startDate,
              theme: data.theme,
              userName: data.userName
            } as any;
          }

          if (progressSnap) {
            partialState.progress = progressSnap.docs.map((doc: any) => {
              const data = doc.data();
              const updatedAtMillis = data.updatedAt?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt).getTime() : 0);
              return { ...data, updatedAtMillis } as Progress;
            });
          }

          if (completedSnap) {
            partialState.completedBooks = new Set(completedSnap.docs.map((doc: any) => {
              const d = doc.data();
              if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
              return d.key;
            }).filter((k: string): k is string => !!k));
          }

          if (journalsSnap) {
            partialState.proverbJournals = mapDocs<ProverbJournal>(journalsSnap.docs);
          }

          if (devotionalsSnap) {
            partialState.customDevotionals = mapDocs<Devotional>(devotionalsSnap.docs);
          }

          if (historySnap) {
            partialState.history = mapDocs<HistoryEntry>(historySnap.docs);
          }

          // Apply whatever we managed to load
          queueMicrotask(() => {
            dispatch({ type: 'REPLACE_STATE', state: partialState as AppState });
            setSyncStatus('synced');
          });
        }

        // 2. Setup onSnapshot Listeners with Exponential Backoff
        // These will handle live updates after the initial state is established
        const setupListener = (
          name: string, 
          ref: any, 
          onUpdate: (snap: any) => void
        ) => {
          let retryCount = 0;
          let currentUnsub: (() => void) | null = null;
          
          const attach = () => {
            if (!isActive) return;
            
            currentUnsub = onSnapshot(ref, (snap) => {
              retryCount = 0; // Reset on successful hit
              onUpdate(snap);
              setSyncStatus('synced');
            }, (err) => {
              console.error(`${name} sync error:`, err);
              setSyncStatus('error');
              if (currentUnsub) currentUnsub();
              
              // Exponential backoff: 1s, 2s, 4s, ..., capped at 30s
              const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
              retryCount++;
              
              retryTimeouts.current[name] = window.setTimeout(attach, delay);
            });
            
            unsubs.push(() => {
              if (currentUnsub) currentUnsub();
            });
          };
          
          attach();
        };

        // Subscription 1: User Settings
        setupListener('UserSettings', getUserRef(user.uid), (doc) => {
          if (doc.exists()) {
            queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_USER_DATA', data: doc.data() }));
          }
        });

        // Subscription 2: Progress
        setupListener('Progress', getProgressCollection(user.uid), (snap) => {
          const progress = snap.docs.map(doc => {
            const data = doc.data();
            const updatedAtMillis = data.updatedAt?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt).getTime() : 0);
            return { ...data, updatedAtMillis } as Progress;
          });
          queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_PROGRESS', progress }));
        });

        // Subscription 3: Completed Books
        setupListener('CompletedBooks', getCompletedBooksCollection(user.uid), (snap) => {
          const completed = snap.docs.map(doc => {
            const d = doc.data();
            if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
            return d.key;
          }).filter((k): k is string => !!k);
          queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_COMPLETED', completed }));
        });

        // Subscription 4: Journals
        setupListener('Journals', getJournalsCollection(user.uid), (snap) => {
          const journals = mapDocs<ProverbJournal>(snap.docs);
          queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_JOURNALS', journals }));
        });

        // Subscription 5: Devotionals
        setupListener('Devotionals', getDevotionalsCollection(user.uid), (snap) => {
          const devotionals = mapDocs<Devotional>(snap.docs);
          queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_DEVOTIONALS', devotionals }));
        });

        // Subscription 6: History
        setupListener('History', historyQuery, (snap) => {
          const history = mapDocs<HistoryEntry>(snap.docs);
          queueMicrotask(() => dispatch({ type: 'CLOUD_SYNC_HISTORY', history }));
        });

      } catch (err) {
        console.error("Critical error during initial Firestore sync:", err);
        setSyncStatus('error');
      }
    };

    startSync();

    return () => {
      isActive = false;
      unsubs.forEach(u => u());
      Object.keys(retryTimeouts.current).forEach(k => {
        if (retryTimeouts.current[k]) clearTimeout(retryTimeouts.current[k]);
      });
    };
  }, [user, dispatch, setSyncStatus]);
}
