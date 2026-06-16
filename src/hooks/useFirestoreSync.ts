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
import { AppAction, resolveProgressConflict } from '../state/appReducer';
import { Progress, HistoryEntry, ProverbJournal, Devotional, AppState, UserSettings } from '../types';
import { logDiagnostic } from '../lib/diagnostics';
import { writeActionBatch } from '../lib/sync';

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

export function useFirestoreSync(user: User | null, dispatch: React.Dispatch<AppAction>, setSyncStatus: (status: 'synced' | 'syncing' | 'error' | 'idle') => void, state: AppState) {
  const [retryCount, setRetryCount] = React.useState(0);

  // Mirrors the latest local state so listener callbacks (set up once per
  // sign-in/retry) can compare against it without re-subscribing.
  const stateRef = React.useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
        const cloudUpdatedAt = (data.updatedAt as { toMillis?: () => number })?.toMillis?.();
        const fallbackLastRead = data.lastReadAt ? new Date(data.lastReadAt as string).getTime() : 0;
        const updatedAtMillis = (data.updatedAtMillis as number) || cloudUpdatedAt || fallbackLastRead;
        return { ...data, updatedAtMillis } as unknown as Progress;
      });
      dispatch({ type: 'CLOUD_SYNC_PROGRESS', progress });

      // A local write can silently fail to reach Firestore (e.g. a transient
      // permission/network error that the SDK doesn't retry). Re-run the same
      // conflict resolution used by the reducer; if it picks the local side
      // over what's in this cloud snapshot, the cloud is missing that write
      // and other devices won't catch up — push it back up.
      const cloudMap = new Map(progress.map(p => [p.categoryId, p]));
      stateRef.current.progress.forEach((localProg) => {
        const cloudProg = cloudMap.get(localProg.categoryId);
        const winner = cloudProg ? resolveProgressConflict(localProg, cloudProg) : localProg;
        const cloudReflectsWinner = cloudProg &&
          winner.bookIndex === cloudProg.bookIndex &&
          winner.chapter === cloudProg.chapter;

        if (!cloudReflectsWinner) {
          writeActionBatch(user.uid, { progress: winner }).catch((err) => {
            logDiagnostic('sync', 'error', 'Progress reconciliation write failed', err);
          });
        }
      });
    });

    // 3. Completed books
    listen<QuerySnapshot>('CompletedBooks', getCompletedBooksCollection(user.uid), (snap) => {
      const completed = snap.docs.map((doc) => {
        const d = doc.data();
        if (d.categoryId && d.bookName) return `${d.categoryId}:${d.bookName}`;
        return d.key as string;
      }).filter((k: string): k is string => !!k);

      // The reducer now treats the cloud set as authoritative (so un-completions
      // propagate). On the FIRST snapshot only, migrate any local guest/offline
      // completions the cloud doesn't yet have, so making it authoritative can't
      // silently drop a completion that simply hadn't been uploaded. After the
      // first fire the cloud is trusted as-is.
      let effective = completed;
      if (!firstFire.has('CompletedBooks')) {
        const cloudSet = new Set(completed);
        const missing = [...stateRef.current.completedBooks].filter((k) => !cloudSet.has(k));
        if (missing.length) {
          effective = [...completed, ...missing];
          writeActionBatch(user.uid, {
            completedBooks: missing.map((k) => {
              const [categoryId, bookName] = k.split(':');
              return { categoryId, bookName };
            }),
          }).catch((err) => logDiagnostic('sync', 'error', 'Completed-books migration write failed', err));
        }
      }
      dispatch({ type: 'CLOUD_SYNC_COMPLETED', completed: effective });
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
      const history = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as HistoryEntry));
      dispatch({ type: 'CLOUD_SYNC_HISTORY', history });

      // Same recovery as Progress: push any local entries that never made it
      // to Firestore (e.g. a write that silently failed) back up.
      const cloudIds = new Set(history.map(h => h.id));
      const missing = stateRef.current.history.filter(h => !cloudIds.has(h.id));
      if (missing.length > 0) {
        writeActionBatch(user.uid, { history: missing }).catch((err) => {
          logDiagnostic('sync', 'error', 'History reconciliation write failed', err);
        });
      }
    });

    return () => {
      isActive = false;
      unsubs.forEach(u => u());
    };
  }, [user, dispatch, setSyncStatus, retryCount]);
}
