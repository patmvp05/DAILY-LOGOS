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
  getCompletedBooksCollection,
  getSprintsCollection
} from '../lib/firebase';
import { AppAction, resolveProgressConflict } from '../state/appReducer';
import { Progress, HistoryEntry, ProverbJournal, Devotional, AppState, UserSettings, ScriptureSprint, SprintHour } from '../types';
import { logDiagnostic } from '../lib/diagnostics';
import { writeActionBatch, writeSprintHour, recordSyncError, syncTracker } from '../lib/sync';

const COLLECTION_COUNT = 7;

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

    const markFired = (name: string) => {
      firstFire.add(name);
      if (firstFire.size >= COLLECTION_COUNT) {
        setSyncStatus('synced');
        logDiagnostic('sync', 'info', 'Cloud sync established');
      }
    };

    const listen = <S extends DocumentSnapshot | QuerySnapshot>(
      name: string,
      ref: DocumentReference | CollectionReference | Query,
      onSnap: (snap: S) => void,
      // `optional` collections carry secondary features. If one fails (e.g. its
      // security rules haven't rolled out yet) we log it and move on rather
      // than flipping the whole app to "Sync Error" and re-subscribing every
      // listener on a loop — the core reading data is unaffected.
      opts: { optional?: boolean } = {}
    ) => {
      unsubs.push(onSnapshot(ref as Query, (snap) => {
        if (!isActive) return;
        // A snapshot proves the connection is healthy, so a lingering
        // transient write error can stop showing as a red badge.
        syncTracker.noteHealthyTraffic();
        onSnap(snap as S);
        markFired(name);
      }, (err: Error) => {
        if (!isActive) return;
        console.error(`${name} sync error:`, err);
        recordSyncError(`${name} listener`, err);
        logDiagnostic('sync', 'error', `${name} listener error`, err);
        if (opts.optional) {
          // Still counts as settled so the badge can reach "synced".
          markFired(name);
          return;
        }
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
        // 'estimate' resolves a still-pending serverTimestamp() to a local
        // estimate instead of null, so this device's own un-acked write sorts
        // as the most recent instead of dropping out of the ordering.
        const data = doc.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
        const cloudUpdatedAt = (data.updatedAt as { toMillis?: () => number })?.toMillis?.();
        const fallbackLastRead = data.lastReadAt ? new Date(data.lastReadAt as string).getTime() : 0;
        const updatedAtMillis = (data.updatedAtMillis as number) || cloudUpdatedAt || fallbackLastRead;
        return { ...data, updatedAtMillis, serverMillis: cloudUpdatedAt } as unknown as Progress;
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

    // 7. 24-hour sprints (one doc per calendar date)
    listen<QuerySnapshot>('Sprints', getSprintsCollection(user.uid), (snap) => {
      const sprints: ScriptureSprint[] = snap.docs.map((d) => {
        const data = d.data() as { date?: string; hours?: Record<string, { done?: boolean; reference?: string }> };
        const hours: Record<string, SprintHour> = {};
        for (const [k, v] of Object.entries(data.hours ?? {})) {
          hours[k] = { done: !!v?.done, reference: v?.reference || undefined };
        }
        return { date: data.date || d.id, hours };
      });
      dispatch({ type: 'CLOUD_SYNC_SPRINTS', sprints });

      // Same recovery as Progress/History: re-push any locally-ticked hour the
      // cloud is missing, so a write that silently failed isn't lost. Writes are
      // per-hour and field-merged, so this can never clobber another device.
      const cloudByDate = new Map(sprints.map(s => [s.date, s]));
      stateRef.current.scriptureSprints?.forEach((localSprint) => {
        const cloudSprint = cloudByDate.get(localSprint.date);
        for (const [hourKey, slot] of Object.entries(localSprint.hours)) {
          if (cloudSprint && hourKey in cloudSprint.hours) continue;
          // An untouched, empty slot is not worth a write.
          if (!slot.done && !slot.reference) continue;
          writeSprintHour(user.uid, localSprint.date, Number(hourKey), slot).catch((err) => {
            logDiagnostic('sync', 'error', 'Sprint reconciliation write failed', err);
          });
        }
      });
    }, { optional: true });

    return () => {
      isActive = false;
      unsubs.forEach(u => u());
    };
  }, [user, dispatch, setSyncStatus, retryCount]);
}
