/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppState, Progress as ProgressType, HistoryEntry, ProverbJournal, Devotional } from '../types';

export type AppAction = 
  | { type: 'REPLACE_STATE', state: AppState }
  | { type: 'HYDRATE_STATE', state: Partial<AppState>, restoredFromSnapshot?: boolean }
  | { type: 'CLOUD_SYNC_PROGRESS', progress: ProgressType[] }
  | { type: 'CLOUD_SYNC_COMPLETED', completed: string[] }
  | { type: 'CLOUD_SYNC_JOURNALS', journals: ProverbJournal[] }
  | { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: Devotional[] }
  | { type: 'CLOUD_SYNC_HISTORY', history: HistoryEntry[] }
  | { type: 'CLOUD_SYNC_USER_DATA', data: any }
  | { type: 'UPDATE_PROGRESS', categoryId: string, bookIndex: number, chapter: number }
  | { type: 'TOGGLE_BOOK', key: string }
  | { type: 'JUMP_TO_BOOK', categoryId: string, bookIndex: number, key: string }
  | { type: 'UPSERT_JOURNAL', journal: ProverbJournal }
  | { type: 'DELETE_JOURNAL', id: string }
  | { type: 'SET_THEME', theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' }
  | { type: 'ADD_DEVOTIONAL', devotional: Devotional }
  | { type: 'DELETE_DEVOTIONAL', id: string }
  | { type: 'LOG_HISTORY', entry: HistoryEntry }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_START_DATE', date: string }
  | { type: 'CLEAR_RESTORED_FLAG' };

const HISTORY_CAP = 50; // User requested cap at 50 during cleanup

/**
 * Checks if two lists of objects are likely identical using a fast fingerprint.
 * (Same length + same first/last IDs)
 */
function isFingerprintMatch(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[0].id === b[0].id && a[a.length - 1].id === b[b.length - 1].id;
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
        .sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0))
        .slice(0, HISTORY_CAP);
    }
  }

  // Progress: newer wins per category
  if (incoming.progress && Array.isArray(incoming.progress)) {
    if (incoming.progress.length === 0 && current.progress.length > 0) {
      // Don't overwrite with empty
    } else {
      const cloudMap = new Map(incoming.progress.map(p => [p.categoryId, p]));
      next.progress = current.progress.map(localp => {
        const cloudp = cloudMap.get(localp.categoryId);
        if (!cloudp) return localp;
        const localTime = localp.updatedAtMillis || (localp.lastReadAt ? new Date(localp.lastReadAt).getTime() : 0);
        const cloudTime = cloudp.updatedAtMillis || (cloudp.lastReadAt ? new Date(cloudp.lastReadAt).getTime() : 0);
        return cloudTime > localTime ? cloudp : localp;
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
      : new Set(incoming.completedBooks as any);
    
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
    next.settings = {
      ...current.settings,
      startDate: incoming.settings.startDate || current.settings.startDate,
      theme: incoming.settings.theme || current.settings.theme,
      userName: incoming.settings.userName || current.settings.userName,
    };
  }

  return next;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'REPLACE_STATE': {
      return mergeAppState(state, action.state);
    }
    case 'HYDRATE_STATE': {
      const merged = mergeAppState(state, action.state);
      if (action.restoredFromSnapshot) {
        return { ...merged, restoredFromSnapshot: true };
      }
      return merged;
    }
    case 'CLEAR_RESTORED_FLAG': {
      return { ...state, restoredFromSnapshot: false };
    }
    case 'CLOUD_SYNC_USER_DATA': {
      const newStartDate = action.data.startDate || state.settings.startDate;
      const newTheme = action.data.theme || state.settings.theme;
      if (state.settings.startDate === newStartDate && 
          state.settings.theme === newTheme) return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          startDate: newStartDate,
          theme: newTheme,
        }
      };
    }
    case 'CLOUD_SYNC_PROGRESS': {
      let changed = false;
      const cloudMap = new Map(action.progress.map(p => [p.categoryId, p]));
      
      const updatedProgress = state.progress.map(localProg => {
        const cloudProg = cloudMap.get(localProg.categoryId);
        if (cloudProg) {
          const cloudTime = cloudProg.updatedAtMillis || (cloudProg.lastReadAt ? new Date(cloudProg.lastReadAt).getTime() : 0);
          const localTime = localProg.updatedAtMillis || (localProg.lastReadAt ? new Date(localProg.lastReadAt).getTime() : 0);
          
          // Prefer Cloud ONLY if it's strictly newer
          if (cloudTime > localTime) {
            if (cloudProg.bookIndex !== localProg.bookIndex || cloudProg.chapter !== localProg.chapter) {
              changed = true;
              return cloudProg;
            }
          }
        }
        return localProg;
      });
      return changed ? { ...state, progress: updatedProgress } : state;
    }
    case 'CLOUD_SYNC_COMPLETED': {
      if (state.completedBooks.size === action.completed.length && 
          action.completed.every(k => state.completedBooks.has(k))) return state;
      return { ...state, completedBooks: new Set(action.completed) };
    }
    case 'CLOUD_SYNC_JOURNALS': {
      if (isFingerprintMatch(state.proverbJournals, action.journals)) return state;
      return { ...state, proverbJournals: action.journals };
    }
    case 'CLOUD_SYNC_DEVOTIONALS': {
      if (isFingerprintMatch(state.customDevotionals, action.devotionals)) return state;
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
      const sliced = merged.slice(0, HISTORY_CAP);
      
      // Precise check to avoid unnecessary re-renders
      if (state.history.length === sliced.length && 
          state.history.every((h, i) => h.id === sliced[i].id)) {
        return state;
      }
      
      return { ...state, history: sliced };
    }
    case 'UPDATE_PROGRESS': {
      const now = new Date().toISOString();
      const nowMillis = Date.now();
      const updatedProgress = state.progress.map(p => 
        p.categoryId === action.categoryId 
          ? { ...p, bookIndex: action.bookIndex, chapter: action.chapter, lastReadAt: now, updatedAtMillis: nowMillis } 
          : p
      );
      return {
        ...state,
        progress: updatedProgress
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
      const newCompleted = new Set(state.completedBooks);
      newCompleted.delete(action.key);
      return {
        ...state,
        completedBooks: newCompleted,
        progress: state.progress.map(p => 
          p.categoryId === action.categoryId ? { ...p, bookIndex: action.bookIndex, chapter: 1, lastReadAt: now, updatedAtMillis: nowMillis } : p
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
      return { ...state, settings: { ...state.settings, theme: action.theme } };
    }
    case 'SET_START_DATE': {
      if (state.settings.startDate === action.date) return state;
      return { ...state, settings: { ...state.settings, startDate: action.date } };
    }
    case 'ADD_DEVOTIONAL': {
      return { ...state, customDevotionals: [...state.customDevotionals, action.devotional] };
    }
    case 'DELETE_DEVOTIONAL': {
      return { ...state, customDevotionals: state.customDevotionals.filter(d => d.id !== action.id) };
    }
    case 'LOG_HISTORY': {
      // History is usually chronological, so we can unshift and slice most of the time
      // Only sort if we detect out-of-order insertion
      const updatedHistory = [action.entry, ...state.history].slice(0, HISTORY_CAP);
      
      const isOutOfOrder = updatedHistory.length > 1 && 
        (updatedHistory[0].timestampMillis || 0) < (updatedHistory[1].timestampMillis || 0);

      if (isOutOfOrder) {
        updatedHistory.sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
      }
      
      return { ...state, history: updatedHistory };
    }
    case 'CLEAR_HISTORY': {
      return { ...state, history: [] };
    }
    default:
      return state;
  }
}
