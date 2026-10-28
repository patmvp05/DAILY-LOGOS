/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from 'date-fns';
import { AppState, Progress as ProgressType, HistoryEntry, ProverbJournal, Devotional, UserSettings, ScriptureSprint, SprintHour } from '../types';
import { CATEGORIES_BY_ID } from '../constants';
import {
  normalizeProgressPosition,
  switchBookInProgress,
  findNextUnreadBookIndex,
  getResumeChapterForBook,
  isChapterUnreadInPlan,
} from '../lib/bible';

export type AppAction = 
  | { type: 'REPLACE_STATE', state: AppState }
  | { type: 'HYDRATE_STATE', state: Partial<AppState> }
  | { type: 'CLOUD_HYDRATED' }
  | { type: 'CLOUD_SYNC_PROGRESS', progress: ProgressType[] }
  | { type: 'CLOUD_SYNC_COMPLETED', completed: string[] }
  | { type: 'CLOUD_SYNC_JOURNALS', journals: ProverbJournal[] }
  | { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: Devotional[] }
  | { type: 'CLOUD_SYNC_HISTORY', history: HistoryEntry[] }
  | { type: 'CLOUD_SYNC_USER_DATA', data: { startDate?: string; theme?: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook'; updatedAt?: string } }
  | {
      type: 'UPDATE_PROGRESS';
      categoryId: string;
      bookIndex: number;
      chapter: number;
      localDate?: string;
      partialChapters?: Record<string, number>;
      revisionDelta?: number;
    }
  | { type: 'TOGGLE_BOOK', key: string, signedOut?: boolean }
  | { type: 'JUMP_TO_BOOK', categoryId: string, bookIndex: number, key?: string }
  | {
      type: 'UNDO_FINISH_BOOK';
      categoryId: string;
      bookIndex: number;
      chapter: number;
      bookName: string;
      historyId?: string;
      previousPartialChapters?: Record<string, number>;
    }
  | { type: 'UPSERT_JOURNAL', journal: ProverbJournal }
  | { type: 'DELETE_JOURNAL', id: string }
  | { type: 'SET_THEME', theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook' }
  | { type: 'SET_BIBLE_VERSION', version: string }
  | { type: 'SET_TYPOGRAPHY', typography: 'default' | 'editorial' }
  | { type: 'ADD_DEVOTIONAL', devotional: Devotional }
  | { type: 'DELETE_DEVOTIONAL', id: string }
  | { type: 'LOG_HISTORY', entry: HistoryEntry }
  | { type: 'DELETE_HISTORY_ENTRY', id: string }
  | { type: 'CLEAR_HISTORY' }
  // Carries the FULL resulting slot rather than a "toggle" instruction, so the
  // caller can write the identical object to Firestore. Deriving the new value
  // separately in the write path let a stale read upload the pre-toggle value.
  | { type: 'SET_SPRINT_HOUR', date: string, hour: number, slot: SprintHour }
  | { type: 'CLEAR_SPRINT', date: string }
  | { type: 'CLOUD_SYNC_SPRINTS', sprints: ScriptureSprint[] }
  | { type: 'SET_START_DATE', date: string };

export const HISTORY_CAP = 2000; // Increased from 50 to ensure year-long streak accuracy
// A sprint is an occasional discipline (a few times a year); keeping the last
// dozen is plenty of history and keeps the locally-persisted state small.
export const SPRINT_CAP = 12;

/**
 * The current value of one hour of a sprint (a blank slot if untouched).
 * Callers use this to compute the NEXT value, then hand that exact object to
 * both the reducer and the Firestore write so the two can never disagree.
 */
export function getSprintHour(
  sprints: ScriptureSprint[] | undefined,
  date: string,
  hour: number
): SprintHour {
  return sprints?.find((s) => s.date === date)?.hours[String(hour)] ?? { done: false };
}

/**
 * Set one hour of the sprint for `date`, creating the sprint if this is the
 * first tick of the day. Sprints are newest-first and capped.
 */
function setSprintHour(
  sprints: ScriptureSprint[],
  date: string,
  hour: number,
  slot: SprintHour
): ScriptureSprint[] {
  const existing = sprints.find((s) => s.date === date);
  const nextSprint: ScriptureSprint = {
    date,
    hours: { ...(existing?.hours ?? {}), [String(hour)]: slot },
  };
  const rest = sprints.filter((s) => s.date !== date);
  return [nextSprint, ...rest].slice(0, SPRINT_CAP);
}

/**
 * Order-insensitive deep equality for id-keyed lists. Unlike a length +
 * first/last-id fingerprint, this detects edits to an *existing* item
 * (same id, same count) so e.g. a journal whose text changed on another
 * device actually propagates instead of being silently discarded.
 */
function listContentEqual<T extends { id: string }>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  // JSON with sorted top-level keys canonicalizes field order so that two
  // equivalent flat objects compare equal regardless of key ordering.
  const norm = (o: T) => JSON.stringify(o, Object.keys(o as object).sort());
  const byId = new Map(a.map((x) => [x.id, norm(x)]));
  for (const item of b) {
    if (byId.get(item.id) !== norm(item)) return false;
  }
  return true;
}

/**
 * Conflict resolver for linear reading-plan progress.
 *
 * Reading a plan only ever moves forward through an ordered sequence of
 * (bookIndex, chapter) positions, so the FURTHEST position is the truth.
 * This is deliberately clock-free. Comparing wall-clock timestamps across
 * devices was the root cause of cross-device reverts: a device's local
 * `updatedAtMillis` (Date.now()) and the value the sync layer reads back
 * from Firestore's `serverTimestamp()` live in two different clock domains,
 * so any skew between a phone, iPad, or Mac and Google's servers could flip
 * the winner — and the reconciliation push-back would then re-upload the
 * stale "winner" with a fresh server timestamp, making the revert sticky and
 * propagating it to every device. Position ordering cannot be corrupted by
 * clock skew, so it removes that entire failure class.
 *
 * Tradeoff (intentional, documented): an explicit *backward* move on one
 * device — a backward jump-to-book, or a reset — does not win over another
 * device that is further ahead and online. Reset is handled on its own path
 * (it clears the cloud collections), and cross-device backward-jump is a
 * rare, separately-tracked case. We never trade away a chapter the user
 * actually read in order to support it.
 */
export function resolveProgressConflict(rawLocal: ProgressType, rawCloud: ProgressType): ProgressType {
  const localp = normalizeProgressPosition(rawLocal);
  const cloudp = normalizeProgressPosition(rawCloud);

  let cloudWins: boolean;

  // Higher revision wins when both sides carry a revision and they differ.
  // On a tie, or when either side has no revision (old docs, older app versions),
  // fall back to the furthest-position rule.
  if (
    typeof localp.revision === 'number' &&
    typeof cloudp.revision === 'number' &&
    localp.revision !== cloudp.revision
  ) {
    cloudWins = cloudp.revision > localp.revision;
  } else if (localp.bookIndex !== cloudp.bookIndex) {
    // Different book → the later book wins.
    cloudWins = cloudp.bookIndex > localp.bookIndex;
  } else if (localp.chapter !== cloudp.chapter) {
    // Same book, different chapter → the later chapter wins.
    cloudWins = cloudp.chapter > localp.chapter;
  } else {
    // Identical position → keep whichever carries the fresher read metadata
    // (lastReadAt / localDate) so the displayed "last read" stays accurate.
    // The position is identical either way, so this branch can never revert.
    const localTime = localp.updatedAtMillis || (localp.lastReadAt ? new Date(localp.lastReadAt).getTime() : 0);
    const cloudTime = cloudp.updatedAtMillis || (cloudp.lastReadAt ? new Date(cloudp.lastReadAt).getTime() : 0);
    cloudWins = cloudTime > localTime;
  }

  const rawWinner = cloudWins ? rawCloud : rawLocal;
  const winner = cloudWins ? cloudp : localp;
  const loser = cloudWins ? localp : cloudp;

  const hasRevision = typeof localp.revision === 'number' || typeof cloudp.revision === 'number';
  const maxRevision = hasRevision
    ? Math.max(localp.revision ?? 0, cloudp.revision ?? 0)
    : undefined;

  // Older app versions rewrite the whole progress doc without partialChapters,
  // so a write arriving without that field must not erase saved partial progress.
  const mergedPartials: Record<string, number> = {
    ...(loser.partialChapters || {}),
    ...(winner.partialChapters || {}),
  };
  const category = CATEGORIES_BY_ID.get(winner.categoryId);
  const winnerBookName = category?.books[winner.bookIndex]?.name;
  if (winnerBookName && winnerBookName in mergedPartials) {
    delete mergedPartials[winnerBookName];
  }
  const finalPartials = Object.keys(mergedPartials).length > 0 ? mergedPartials : undefined;

  // Preserve reference identity when no normalization, revision bump, or
  // partialChapters merge changes the winning input.
  if (
    winner === rawWinner &&
    rawWinner.revision === maxRevision &&
    JSON.stringify(rawWinner.partialChapters ?? null) === JSON.stringify(finalPartials ?? null)
  ) {
    return rawWinner;
  }

  return {
    ...winner,
    ...(maxRevision !== undefined ? { revision: maxRevision } : {}),
    ...(finalPartials !== undefined ? { partialChapters: finalPartials } : {}),
  };
}

/**
 * Merges state non-destructively.
 * Ensures cloud-empty never overwrites local-non-empty.
 */
function mergeAppState(current: AppState, incoming: Partial<AppState>): AppState {
  const next = { ...current };

  // History: merge unique, sort, slice
  if (incoming.history) {
    if (incoming.history.length === 0 && current.history.length > 0) {
      // Don't overwrite with empty
    } else {
      const historyMap = new Map<string, HistoryEntry>();
      current.history.forEach(h => historyMap.set(h.id, h));
      incoming.history.forEach(h => historyMap.set(h.id, h));
      next.history = Array.from(historyMap.values())
        .sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
    }
  }

  // Progress: linear resolution per category
  if (incoming.progress && Array.isArray(incoming.progress)) {
    if (incoming.progress.length === 0 && current.progress.length > 0) {
      // Don't overwrite with empty
    } else {
      const cloudMap = new Map(incoming.progress.map(p => [p.categoryId, p]));
      next.progress = current.progress.map(localp => {
        const cloudp = cloudMap.get(localp.categoryId);
        if (!cloudp) return localp;
        return resolveProgressConflict(localp, cloudp);
      });
      
      // Add any category IDs that exist in cloud but not locally
      const localIds = new Set(current.progress.map(p => p.categoryId));
      incoming.progress.forEach(cloudp => {
        if (!localIds.has(cloudp.categoryId)) {
          next.progress.push(cloudp);
        }
      });
    }
  }

  // CompletedBooks: only adopt from IndexedDB if cloud hasn't already settled
  // and localStorage was empty, so an async IDB read can't resurrect a book
  // that was just un-completed.
  if (incoming.completedBooks && !current.isCloudHydrated) {
    const incomingSet = incoming.completedBooks instanceof Set 
      ? incoming.completedBooks 
      : new Set(incoming.completedBooks as string[]);
    
    if (incomingSet.size === 0 && current.completedBooks.size > 0) {
      // Don't overwrite
    } else if (current.completedBooks.size === 0) {
      next.completedBooks = new Set(incomingSet as Set<string>);
    }
  }
  if (incoming.signedOutCompletedBooks) {
    const incomingSignedOut = incoming.signedOutCompletedBooks instanceof Set
      ? incoming.signedOutCompletedBooks
      : new Set(incoming.signedOutCompletedBooks as string[]);
    next.signedOutCompletedBooks = new Set([
      ...(current.signedOutCompletedBooks ?? []),
      ...incomingSignedOut,
    ]);
  }

  // Collections: don't overwrite non-empty with empty
  if (incoming.proverbJournals && !(incoming.proverbJournals.length === 0 && current.proverbJournals.length > 0)) {
    next.proverbJournals = incoming.proverbJournals;
  }
  if (incoming.customDevotionals && !(incoming.customDevotionals.length === 0 && current.customDevotionals.length > 0)) {
    next.customDevotionals = incoming.customDevotionals;
  }
  // Sprints are local-only (never synced), so the stored copy is authoritative
  // unless we already have unsaved ones in memory.
  if (incoming.scriptureSprints &&
      !(incoming.scriptureSprints.length === 0 && (current.scriptureSprints?.length ?? 0) > 0)) {
    next.scriptureSprints = incoming.scriptureSprints;
  }

  // Settings
  if (incoming.settings) {
    const inc = incoming.settings as Partial<UserSettings> & { planStartDate?: string };
    
    // Check if cloud data is actually newer than our local state.
    // If we have a local 'updatedAt', we compare it.
    let shouldUpdate = true;
    if (current.settings.updatedAt && inc.updatedAt) {
      const curTime = new Date(current.settings.updatedAt).getTime();
      const incTime = new Date(inc.updatedAt).getTime();
      if (incTime < curTime) {
        shouldUpdate = false;
        console.log("[Sync] Ignoring older cloud settings to prevent revert.", { 
          cloud: inc.updatedAt, 
          local: current.settings.updatedAt 
        });
      }
    }

    if (shouldUpdate) {
      const newStartDate = inc.startDate || current.settings.startDate || '';
      
      next.settings = {
        ...current.settings,
        startDate: newStartDate,
        theme: inc.theme || current.settings.theme,
        userName: inc.userName || current.settings.userName,
        // Device-local prefs: keep whatever the incoming (saved) state carries,
        // else preserve the current value.
        bibleVersion: inc.bibleVersion ?? current.settings.bibleVersion,
        typography: inc.typography ?? current.settings.typography,
        updatedAt: inc.updatedAt || current.settings.updatedAt
      };
    }
  }
  
  return next;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'REPLACE_STATE': {
      return action.state;
    }
    case 'HYDRATE_STATE': {
      return mergeAppState(state, action.state);
    }
    case 'CLOUD_HYDRATED': {
      return state.isCloudHydrated ? state : { ...state, isCloudHydrated: true };
    }
    case 'CLOUD_SYNC_USER_DATA': {
      const inc = action.data as Partial<UserSettings>;
      const newUpdatedAt = inc.updatedAt || '';
      
      // If we have a local update that is newer than this cloud snapshot, ignore it.
      if (state.settings.updatedAt && newUpdatedAt) {
        if (new Date(newUpdatedAt).getTime() < new Date(state.settings.updatedAt).getTime()) {
          console.log("[Sync] Ignoring stale user-data from cloud to protect local mutation.");
          return state.isCloudHydrated ? state : { ...state, isCloudHydrated: true };
        }
      }

      const newStartDate = inc.startDate || state.settings.startDate;
      const newTheme = inc.theme || state.settings.theme;

      if (state.settings.startDate === newStartDate &&
          state.settings.theme === newTheme &&
          state.settings.updatedAt === newUpdatedAt) {
        return state.isCloudHydrated ? state : { ...state, isCloudHydrated: true };
      }

      return {
        ...state,
        settings: {
          ...state.settings,
          startDate: newStartDate,
          theme: newTheme,
          updatedAt: newUpdatedAt
        },
        isCloudHydrated: true
      };
    }
    case 'CLOUD_SYNC_PROGRESS': {
      let changed = false;
      const cloudMap = new Map(action.progress.map(p => [p.categoryId, p]));
      
      const updatedProgress = state.progress.map(localProg => {
        const cloudProg = cloudMap.get(localProg.categoryId);
        if (cloudProg) {
          const base = resolveProgressConflict(localProg, cloudProg);
          // serverMillis is a cloud-derived annotation, not part of the
          // position conflict — always take the cloud's copy so the field stays
          // populated even when the local side wins the position.
          const resolved = cloudProg.serverMillis !== undefined && cloudProg.serverMillis !== base.serverMillis
            ? { ...base, serverMillis: cloudProg.serverMillis }
            : base;
          if (resolved.bookIndex !== localProg.bookIndex ||
              resolved.chapter !== localProg.chapter ||
              resolved.revision !== localProg.revision ||
              JSON.stringify(resolved.partialChapters || {}) !== JSON.stringify(localProg.partialChapters || {}) ||
              resolved.updatedAtMillis !== localProg.updatedAtMillis ||
              resolved.serverMillis !== localProg.serverMillis) {
            changed = true;
            return resolved;
          }
        }
        return localProg;
      });

      // Look for any categories in the cloud that don't exist locally
      const localCatIds = new Set(state.progress.map(p => p.categoryId));
      const newFromCloud: ProgressType[] = [];
      action.progress.forEach(cloudProg => {
        if (!localCatIds.has(cloudProg.categoryId)) {
          newFromCloud.push(normalizeProgressPosition(cloudProg));
          changed = true;
        }
      });

      const finalProgress = newFromCloud.length > 0 ? [...updatedProgress, ...newFromCloud] : updatedProgress;
      return changed ? { ...state, progress: finalProgress } : state;
    }
    case 'CLOUD_SYNC_COMPLETED': {
      // The cloud completed-books collection is authoritative, including the
      // empty set: adopting it is how un-completing a book — e.g. Undoing a
      // finished book, or un-marking one in the Full Plan — gets propagated to
      // other devices. Guest/offline completions are migrated up by the
      // listener's first-fire push-back in useFirestoreSync.
      const cloudSet = new Set(action.completed);
      const nextSignedOut = state.signedOutCompletedBooks
        ? new Set([...state.signedOutCompletedBooks].filter(k => !cloudSet.has(k)))
        : undefined;
      const sameCompleted =
        state.completedBooks.size === action.completed.length &&
        action.completed.every(k => state.completedBooks.has(k));
      const sameSignedOut =
        (state.signedOutCompletedBooks?.size ?? 0) === (nextSignedOut?.size ?? 0);
      if (sameCompleted && sameSignedOut) return state;
      return {
        ...state,
        completedBooks: cloudSet,
        signedOutCompletedBooks: nextSignedOut,
      };
    }
    case 'CLOUD_SYNC_JOURNALS': {
      if (action.journals.length === 0 && state.proverbJournals.length > 0) return state;
      if (listContentEqual(state.proverbJournals, action.journals)) return state;
      return { ...state, proverbJournals: action.journals };
    }
    case 'CLOUD_SYNC_DEVOTIONALS': {
      if (action.devotionals.length === 0 && state.customDevotionals.length > 0) return state;
      if (listContentEqual(state.customDevotionals, action.devotionals)) return state;
      return { ...state, customDevotionals: action.devotionals };
    }
    case 'CLOUD_SYNC_HISTORY': {
      // Use a Map for O(1) deduplication by ID
      const mergedMap = new Map<string, HistoryEntry>();
      
      // Cloud entries are authoritative for their IDs
      action.history.forEach(h => mergedMap.set(h.id, h));
      
      // Preserve local entries that haven't reached cloud yet, except any
      // entry whose chapter was explicitly undone in the cloud.
      state.history.forEach(h => {
        if (!mergedMap.has(h.id) && !isChapterUnreadInPlan(h, state.progress, state.completedBooks)) {
          mergedMap.set(h.id, h);
        }
      });
      
      const merged = Array.from(mergedMap.values());
      merged.sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
      // Bound growth so memory/storage stays sane over years of reading.
      if (merged.length > HISTORY_CAP) merged.length = HISTORY_CAP;

      // Precise check to avoid unnecessary re-renders
      if (state.history.length === merged.length &&
          state.history.every((h, i) => h.id === merged[i].id)) {
        return state;
      }

      return { ...state, history: merged };
    }
    case 'UPDATE_PROGRESS': {
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const localDate = action.localDate || format(new Date(), 'yyyy-MM-dd');
      const updatedProgress = state.progress.map(p => {
        if (p.categoryId !== action.categoryId) return p;
        const nextCandidate = normalizeProgressPosition({
          ...p,
          bookIndex: action.bookIndex,
          chapter: action.chapter,
          partialChapters: action.partialChapters !== undefined ? action.partialChapters : p.partialChapters,
        });
        const posChanged =
          nextCandidate.bookIndex !== p.bookIndex ||
          nextCandidate.chapter !== p.chapter ||
          JSON.stringify(nextCandidate.partialChapters || {}) !== JSON.stringify(p.partialChapters || {});
        const nextRevision = posChanged
          ? (p.revision ?? 0) + Math.max(1, action.revisionDelta ?? 1)
          : p.revision;
        return {
          ...nextCandidate,
          revision: nextRevision,
          lastReadAt: now,
          localDate,
          updatedAtMillis: nowMillis,
        };
      });
      
      return {
        ...state,
        progress: updatedProgress,
      };
    }
    case 'TOGGLE_BOOK': {
      const newCompleted = new Set(state.completedBooks);
      const nextSignedOut = new Set(state.signedOutCompletedBooks ?? []);
      if (newCompleted.has(action.key)) {
        newCompleted.delete(action.key);
        nextSignedOut.delete(action.key);
      } else {
        newCompleted.add(action.key);
        if (action.signedOut) {
          nextSignedOut.add(action.key);
        }
      }

      const [catId, toggledBookName] = action.key.split(':');
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const localDate = format(new Date(), 'yyyy-MM-dd');

      const updatedProgress = state.progress.map(p => {
        if (p.categoryId !== catId) return p;
        const category = CATEGORIES_BY_ID.get(catId);
        if (!category) return p;

        const normalized = normalizeProgressPosition(p);
        const partialChapters = { ...(normalized.partialChapters || {}) };
        let partialsChanged = false;
        if (newCompleted.has(action.key) && toggledBookName in partialChapters) {
          delete partialChapters[toggledBookName];
          partialsChanged = true;
        }

        const currentBook = category.books[normalized.bookIndex];
        if (newCompleted.has(action.key) && currentBook?.name === toggledBookName) {
          const nextUnreadIdx = findNextUnreadBookIndex(catId, normalized.bookIndex, newCompleted);
          if (nextUnreadIdx !== null && nextUnreadIdx !== normalized.bookIndex) {
            const nextBook = category.books[nextUnreadIdx];
            const nextChapter = getResumeChapterForBook(
              { ...normalized, partialChapters },
              nextBook.name,
              nextBook.chapters
            );
            delete partialChapters[nextBook.name];
            return {
              ...normalized,
              bookIndex: nextUnreadIdx,
              chapter: nextChapter,
              partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
              revision: (normalized.revision ?? 0) + 1,
              lastReadAt: now,
              localDate,
              updatedAtMillis: nowMillis,
            };
          }
        }

        if (partialsChanged) {
          return {
            ...normalized,
            partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
            revision: (normalized.revision ?? 0) + 1,
          };
        }
        return p;
      });

      return {
        ...state,
        completedBooks: newCompleted,
        signedOutCompletedBooks: nextSignedOut.size > 0 ? nextSignedOut : undefined,
        progress: updatedProgress,
      };
    }
    case 'JUMP_TO_BOOK': {
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const localDate = format(new Date(), 'yyyy-MM-dd');
      let changed = false;
      const updatedProgress = state.progress.map(p => {
        if (p.categoryId !== action.categoryId) return p;
        const switched = switchBookInProgress(p, action.bookIndex, state.completedBooks);
        if (
          switched.bookIndex === p.bookIndex &&
          switched.chapter === p.chapter &&
          JSON.stringify(switched.partialChapters || {}) === JSON.stringify(p.partialChapters || {})
        ) {
          return p;
        }
        changed = true;
        return {
          ...switched,
          revision: (p.revision ?? 0) + 1,
          lastReadAt: now,
          localDate,
          updatedAtMillis: nowMillis,
        };
      });
      if (!changed) return state;
      return {
        ...state,
        progress: updatedProgress,
      };
    }
    case 'UNDO_FINISH_BOOK': {
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const key = `${action.categoryId}:${action.bookName}`;
      const newCompleted = new Set(state.completedBooks);
      newCompleted.delete(key);
      const nextSignedOut = new Set(state.signedOutCompletedBooks ?? []);
      nextSignedOut.delete(key);

      const updatedProgress = state.progress.map(p => {
        if (p.categoryId !== action.categoryId) return p;
        const partialChapters = action.previousPartialChapters
          ? { ...action.previousPartialChapters }
          : { ...(p.partialChapters || {}) };
        delete partialChapters[action.bookName];
        return {
          ...p,
          bookIndex: action.bookIndex,
          chapter: action.chapter,
          partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
          revision: (p.revision ?? 0) + 1,
          lastReadAt: now,
          localDate,
          updatedAtMillis: nowMillis,
        };
      });

      const updatedHistory = action.historyId
        ? state.history.filter(h => h.id !== action.historyId)
        : state.history;

      return {
        ...state,
        completedBooks: newCompleted,
        signedOutCompletedBooks: nextSignedOut.size > 0 ? nextSignedOut : undefined,
        progress: updatedProgress,
        history: updatedHistory,
      };
    }
    case 'SET_SPRINT_HOUR': {
      const sprints = state.scriptureSprints ?? [];
      const slot: SprintHour = {
        done: action.slot.done,
        reference: action.slot.reference?.slice(0, 120),
      };
      return {
        ...state,
        scriptureSprints: setSprintHour(sprints, action.date, action.hour, slot),
      };
    }
    case 'CLEAR_SPRINT': {
      const sprints = state.scriptureSprints ?? [];
      if (!sprints.some(s => s.date === action.date)) return state;
      return { ...state, scriptureSprints: sprints.filter(s => s.date !== action.date) };
    }
    case 'CLOUD_SYNC_SPRINTS': {
      // The cloud doc is already the union of every device's hours (writes are
      // field-merged per hour), so it is the base. Local hours the cloud has
      // not seen yet are kept on top — they are un-uploaded ticks, and the
      // listener pushes them up. A key present in BOTH sides takes the cloud's
      // value, so un-ticking an hour on another device propagates here.
      const local = state.scriptureSprints ?? [];
      const localByDate = new Map(local.map(s => [s.date, s]));
      const merged: ScriptureSprint[] = action.sprints.map(cloud => {
        const mine = localByDate.get(cloud.date);
        localByDate.delete(cloud.date);
        if (!mine) return cloud;
        const hours: Record<string, SprintHour> = { ...cloud.hours };
        for (const [k, v] of Object.entries(mine.hours)) {
          if (!(k in hours)) hours[k] = v;
        }
        return { date: cloud.date, hours };
      });
      // Dates that exist only locally (never uploaded) survive.
      for (const leftover of localByDate.values()) merged.push(leftover);
      merged.sort((a, b) => b.date.localeCompare(a.date));
      const capped = merged.slice(0, SPRINT_CAP);

      if (JSON.stringify(capped) === JSON.stringify(local)) return state;
      return { ...state, scriptureSprints: capped };
    }
    case 'UPSERT_JOURNAL': {
      const existingJournal = state.proverbJournals.find(j => j.id === action.journal.id);
      return {
        ...state,
        proverbJournals: existingJournal
          ? state.proverbJournals.map(j => j.id === action.journal.id ? action.journal : j)
          : [...state.proverbJournals, action.journal]
      };
    }
    case 'DELETE_JOURNAL': {
      return { ...state, proverbJournals: state.proverbJournals.filter(j => j.id !== action.id) };
    }
    case 'SET_THEME': {
      if (state.settings.theme === action.theme) return state;
      return { 
        ...state, 
        settings: { 
          ...state.settings, 
          theme: action.theme,
          updatedAt: new Date().toISOString() // Local stamp to prevent cloud-revert
        } 
      };
    }
    case 'SET_START_DATE': {
      if (state.settings.startDate === action.date) return state;
      console.warn("[startDate write] Local update triggered.", {
        from: state.settings.startDate,
        to: action.date
      });
      return { 
        ...state, 
        settings: { 
          ...state.settings, 
          startDate: action.date,
          updatedAt: new Date().toISOString() // Local stamp to prevent cloud-revert
        } 
      };
    }
    case 'SET_BIBLE_VERSION': {
      if (state.settings.bibleVersion === action.version) return state;
      // Device-local preference — intentionally does NOT bump `updatedAt`, so
      // it never interferes with the cloud settings last-write-wins guard.
      return { ...state, settings: { ...state.settings, bibleVersion: action.version } };
    }
    case 'SET_TYPOGRAPHY': {
      if (state.settings.typography === action.typography) return state;
      return { ...state, settings: { ...state.settings, typography: action.typography } };
    }
    case 'ADD_DEVOTIONAL': {
      return { ...state, customDevotionals: [...state.customDevotionals, action.devotional] };
    }
    case 'DELETE_DEVOTIONAL': {
      return { ...state, customDevotionals: state.customDevotionals.filter(d => d.id !== action.id) };
    }
    case 'LOG_HISTORY': {
      // History is keep chronological
      const updatedHistory = [action.entry, ...state.history];
      
      const isOutOfOrder = updatedHistory.length > 1 && 
        (updatedHistory[0].timestampMillis || 0) < (updatedHistory[1].timestampMillis || 0);

      if (isOutOfOrder) {
        updatedHistory.sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
      }
      if (updatedHistory.length > HISTORY_CAP) updatedHistory.length = HISTORY_CAP;

      return { ...state, history: updatedHistory };
    }
    case 'DELETE_HISTORY_ENTRY': {
      return { ...state, history: state.history.filter(h => h.id !== action.id) };
    }
    case 'CLEAR_HISTORY': {
      return { ...state, history: [] };
    }
    default:
      return state;
  }
}
