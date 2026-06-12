/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import {
  onSnapshot,
  query,
  orderBy,
  type QuerySnapshot,
  type DocumentSnapshot,
  type DocumentReference,
  type CollectionReference,
  type Query
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
import { logDiagnostic } from '../lib/diagnostics';

const COLLECTION_COUNT = 6;

/**
 * Attaches realtime listeners for the signed-in user's data.
 * Firestore's SDK handles caching, offline behavior, and reconnection;
 * each snapshot is dispatched straight into the reducer, which owns
 * merge/conflict logic.
 */
// Listeners that error out (e.g. transient permission-denied during a rules
// rollout) don't auto-retry in the Firestore SDK, so without a manual
// re-subscribe the user would be stuck showing a sync error indefinitely.
const RETRY_DELAY_MS = 15000;

export function useFirestoreSync(user: User | null, dispatch: React.Dispatch<AppAction>, setSyncStatus: (status: 'synced' | 'syncing' | 'error' | 'idle') => void) {
  const [retryCount, setRetryCount] = React.useState(0);

  useEffect(() => {
    if (!user) return;

    let isActive = true;
    const unsubs: (() => void)[] = [];
    const firstFire = new Set<string>();

    setSyncStatus('syncing');
    logDiagnostic('sync', 'info', 'Starting cloud sync', { uid: user.uid.slice(0, 6), attempt: retryCount + 1 });

    let retryScheduled = false;
    const scheduleRetry = () => {
      if (retryScheduled) return;
      retryScheduled = true;
      setTimeout(() => {
        if (isActive) setRetryCount((c) => c + 1);
      }, RETRY_DELAY_MS);
    };

    const listen = <S extends DocumentSnapshot | QuerySnapshot>(
      name: string,
      ref: DocumentReference | CollectionReference | Query,
      onSnap: (snap: S) => void
    ) => {
      unsubs.push(onSnapshot(ref as Query, (snap) => {
        if (!isActive) return;
        onSnap(snap as S);
        firstFire.add(name);
        if (firstFire.size >= COLLECTION_COUNT) {
          setSyncStatus('synced');
          logDiagnostic('sync', 'info', 'Cloud sync established');
        }
      }, (err: Error) => {
        if (!isActive) return;
        console.error(`${name} sync error:`, err);
        logDiagnostic('sync', 'error', `${name} listener error`, err);
        setSyncStatus('error');
        scheduleRetry();
      }));
    };

    // 1. User settings document
    listen<DocumentSnapshot>('UserSettings', getUserRef(user.uid), (doc) => {
      let settings: UserSettings = { theme: 'system', startDate: '', userName: '' };
      if (doc.exists()) {
        const data = doc.data() as Record<string, unknown>;
        const toISO = (v: unknown): string => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'toMillis' in v) return new Date((v as { toMillis: () => number }).toMillis()).toISOString();
          if (v && typeof v === 'object' && 'seconds' in v) return new Date((v as { seconds: number }).seconds * 1000).toISOString();
          return '';
        };
        settings = {
          theme: (data.theme as AppState['settings']['theme']) || 'system',
          startDate: toISO(data.startDate),
          userName: (data.userName as string) || '',
          updatedAt: toISO(data.updatedAt)
        };
      }
      dispatch({ type: 'CLOUD_SYNC_USER_DATA', data: settings });
    });

    // 2. Progress
    listen<QuerySnapshot>('Progress', getProgressCollection(user.uid), (snap) => {
      const progress = snap.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const updatedAtMillis = (data.updatedAt as { toMillis?: () => number })?.toMillis?.() || (data.lastReadAt ? new Date(data.lastReadAt as string).getTime() : 0);
        return { ...data, updatedAtMillis } as unknown as Progress;
      });
      dispatch({ type: 'CLOUD_SYNC_PROGRESS', progress });
    });

    // 3. Completed books
    listen<QuerySnapshot>('CompletedBooks', getCompletedBooksCollection(user.uid), (snap) => {
      const completed = snap.docs.map((doc) => {
        const d = doc.data();
        if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
        return d.key as string;
      }).filter((k: string): k is string => !!k);
      dispatch({ type: 'CLOUD_SYNC_COMPLETED', completed });
    });

    // 4. Journals
    listen<QuerySnapshot>('Journals', getJournalsCollection(user.uid), (snap) => {
      dispatch({ type: 'CLOUD_SYNC_JOURNALS', journals: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as ProverbJournal)) });
    });

    // 5. Devotionals
    listen<QuerySnapshot>('Devotionals', getDevotionalsCollection(user.uid), (snap) => {
      dispatch({ type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as Devotional)) });
    });

    // 6. History — unbounded for accurate streak calculation
    const historyQuery = query(getHistoryCollection(user.uid), orderBy('timestampMillis', 'desc'));
    listen<QuerySnapshot>('History', historyQuery, (snap) => {
      dispatch({ type: 'CLOUD_SYNC_HISTORY', history: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as HistoryEntry)) });
    });

    return () => {
      isActive = false;
      unsubs.forEach(u => u());
    };
  }, [user, dispatch, setSyncStatus, retryCount]);
}
