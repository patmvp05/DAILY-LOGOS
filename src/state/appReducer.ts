/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from 'date-fns';
import { AppState, Progress as ProgressType, HistoryEntry, ProverbJournal, Devotional, UserSettings } from '../types';

export type AppAction = 
  | { type: 'REPLACE_STATE', state: AppState }
  | { type: 'HYDRATE_STATE', state: Partial<AppState> }
  | { type: 'CLOUD_SYNC_PROGRESS', progress: ProgressType[] }
  | { type: 'CLOUD_SYNC_COMPLETED', completed: string[] }
  | { type: 'CLOUD_SYNC_JOURNALS', journals: ProverbJournal[] }
  | { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: Devotional[] }
  | { type: 'CLOUD_SYNC_HISTORY', history: HistoryEntry[] }
  | { type: 'CLOUD_SYNC_USER_DATA', data: { startDate?: string; theme?: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook'; updatedAt?: string } }
  | { type: 'UPDATE_PROGRESS', categoryId: string, bookIndex: number, chapter: number, localDate?: string }
  | { type: 'TOGGLE_BOOK', key: string }
  | { type: 'JUMP_TO_BOOK', categoryId: string, bookIndex: number, key: string }
  | { type: 'UPSERT_JOURNAL', journal: ProverbJournal }
  | { type: 'DELETE_JOURNAL', id: string }
  | { type: 'SET_THEME', theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook' }
  | { type: 'ADD_DEVOTIONAL', devotional: Devotional }
  | { type: 'DELETE_DEVOTIONAL', id: string }
  | { type: 'LOG_HISTORY', entry: HistoryEntry }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_START_DATE', date: string };

export const HISTORY_CAP = 2000; // Increased from 50 to ensure year-long streak accuracy

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
 * Robust conflict resolver for linear reading plan progress.
 * Self-heals clock drifts by prioritizing actual forward progress in readings,
 * but defers to a clearly newer write (e.g. a manual reset or jump-to-book,
 * which intentionally move progress backward) once the gap is large enough
 * to rule out clock drift / near-simultaneous edits.
 */
const CONFLICT_TIMESTAMP_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

export function resolveProgressConflict(localp: ProgressType, cloudp: ProgressType): ProgressType {
  const localTime = localp.updatedAtMillis || (localp.lastReadAt ? new Date(localp.lastReadAt).getTime() : 0);
  const cloudTime = cloudp.updatedAtMillis || (cloudp.lastReadAt ? new Date(cloudp.lastReadAt).getTime() : 0);

  // 1. Same stage: align timestamps/metadata
  if (localp.bookIndex === cloudp.bookIndex && localp.chapter === cloudp.chapter) {
    return cloudTime > localTime ? cloudp : localp;
  }

  // 2. If one side is clearly newer, trust it even if it moves progress
  // backward (a deliberate reset/jump should win over a stale device).
  if (Math.abs(cloudTime - localTime) > CONFLICT_TIMESTAMP_GAP_MS) {
    return cloudTime > localTime ? cloudp : localp;
  }

  // 3. Near-simultaneous edits on two devices: self-heal by keeping
  // whichever device progressed furthest in the reading plan.
  const isCloudFurther = (cloudp.bookIndex > localp.bookIndex) ||
                         (cloudp.bookIndex === localp.bookIndex && cloudp.chapter > localp.chapter);
  if (isCloudFurther) return cloudp;

  const isLocalFurther = (localp.bookIndex > cloudp.bookIndex) ||
                         (localp.bookIndex === cloudp.bookIndex && localp.chapter > cloudp.chapter);
  if (isLocalFurther) return localp;

  return cloudTime > localTime ? cloudp : localp;
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

  // CompletedBooks: union
  if (incoming.completedBooks) {
    const incomingSet = incoming.completedBooks instanceof Set 
      ? incoming.completedBooks 
      : new Set(incoming.completedBooks as string[]);
    
    if (incomingSet.size === 0 && current.completedBooks.size > 0) {
      // Don't overwrite
    } else {
      next.completedBooks = new Set([...current.completedBooks, ...(incomingSet as Set<string>)]);
    }
  }

  // Collections: don't overwrite non-empty with empty
  if (incoming.proverbJournals && !(incoming.proverbJournals.length === 0 && current.proverbJournals.length > 0)) {
    next.proverbJournals = incoming.proverbJournals;
  }
  if (incoming.customDevotionals && !(incoming.customDevotionals.length === 0 && current.customDevotionals.length > 0)) {
    next.customDevotionals = incoming.customDevotionals;
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
          const resolved = resolveProgressConflict(localProg, cloudProg);
          if (resolved.bookIndex !== localProg.bookIndex || 
              resolved.chapter !== localProg.chapter || 
              resolved.updatedAtMillis !== localProg.updatedAtMillis) {
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
          newFromCloud.push(cloudProg);
          changed = true;
        }
      });

      const finalProgress = newFromCloud.length > 0 ? [...updatedProgress, ...newFromCloud] : updatedProgress;
      return changed ? { ...state, progress: finalProgress } : state;
    }
    case 'CLOUD_SYNC_COMPLETED': {
      // Never let an empty cloud cache wipe local non-empty data
      if (action.completed.length === 0 && state.completedBooks.size > 0) return state;
      if (state.completedBooks.size === action.completed.length &&
          action.completed.every(k => state.completedBooks.has(k))) return state;
      return { ...state, completedBooks: new Set(action.completed) };
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
      
      // Preserve local entries that haven't reached cloud yet
      state.history.forEach(h => {
        if (!mergedMap.has(h.id)) {
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
      const updatedProgress = state.progress.map(p => 
        p.categoryId === action.categoryId 
          ? { ...p, bookIndex: action.bookIndex, chapter: action.chapter, lastReadAt: now, localDate, updatedAtMillis: nowMillis } 
          : p
      );
      
      return {
        ...state,
        progress: updatedProgress,
      };
    }
    case 'TOGGLE_BOOK': {
      const newCompleted = new Set(state.completedBooks);
      if (newCompleted.has(action.key)) {
        newCompleted.delete(action.key);
      } else {
        newCompleted.add(action.key);
      }
      return {
        ...state,
        completedBooks: newCompleted
      };
    }
    case 'JUMP_TO_BOOK': {
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const newCompleted = new Set(state.completedBooks);
      newCompleted.delete(action.key);
      return {
        ...state,
        completedBooks: newCompleted,
        progress: state.progress.map(p => 
          p.categoryId === action.categoryId ? { ...p, bookIndex: action.bookIndex, chapter: 1, lastReadAt: now, localDate, updatedAtMillis: nowMillis } : p
        )
      };
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
    case 'CLEAR_HISTORY': {
      return { ...state, history: [] };
    }
    default:
      return state;
  }
}
