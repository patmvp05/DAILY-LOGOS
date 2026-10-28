/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppState, Progress, UserSettings } from '../types';
import { CATEGORIES } from '../constants';
import { normalizeProgressPosition } from './bible';
import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'seven_seals_bible_progress';

export function hasStoredStateSync(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

const DEFAULT_PROGRESS: Progress[] = CATEGORIES.map((cat) => ({
  categoryId: cat.id,
  bookIndex: 0,
  chapter: 1,
}));

const DEFAULT_SETTINGS: UserSettings = {
  startDate: '',
  theme: 'system',
};

const DEFAULT_DEVOTIONALS = [
  { 
    id: 'insight', 
    name: 'Insight for Living', 
    url: 'https://insight.org/resources/daily-devotional',
    description: "Chuck Swindoll's daily Bible study"
  },
  { 
    id: 'utmost', 
    name: 'My Utmost for His Highest', 
    url: 'https://utmost.org/',
    description: "Oswald Chambers' classic daily meditation"
  },
  { 
    id: 'spurgeon', 
    name: 'Morning and Evening', 
    url: 'https://www.spurgeon.org/resource-library/morning-and-evening/',
    description: "Charles Spurgeon's daily readings"
  },
  { 
    id: 'streams', 
    name: 'Streams in the Desert', 
    url: 'https://www.crosswalk.com/devotionals/streams-in-the-desert/',
    description: "L.B. Cowman's encouraging daily devotions"
  },
  {
    id: 'daily-bread',
    name: 'Our Daily Bread',
    url: 'https://odb.org/',
    description: 'Encouraging stories and biblical reflections'
  }
];

export const loadState = (): AppState => {
  const defaultState: AppState = {
    progress: DEFAULT_PROGRESS,
    settings: DEFAULT_SETTINGS,
    history: [],
    proverbJournals: [],
    customDevotionals: DEFAULT_DEVOTIONALS,
    scriptureSprints: [],
    completedBooks: new Set<string>(),
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultState;
    const parsed = JSON.parse(stored);
    const rawProgress: Progress[] = Array.isArray(parsed.progress) ? parsed.progress : defaultState.progress;
    return {
      progress: rawProgress.map(p => normalizeProgressPosition(p)),
      settings: parsed.settings || defaultState.settings,
      history: parsed.history || defaultState.history,
      proverbJournals: parsed.proverbJournals || defaultState.proverbJournals,
      customDevotionals: parsed.customDevotionals || defaultState.customDevotionals,
      scriptureSprints: parsed.scriptureSprints || defaultState.scriptureSprints,
      completedBooks: parsed.completedBooks ? new Set(parsed.completedBooks) : defaultState.completedBooks,
      signedOutCompletedBooks: parsed.signedOutCompletedBooks ? new Set(parsed.signedOutCompletedBooks) : undefined,
    };
  } catch (error) {
    console.warn("Storage load failed:", error);
    return defaultState;
  }
};

export const loadStateAsync = async (): Promise<Partial<AppState> | null> => {
  try {
    const idbState = await get(STORAGE_KEY);
    if (idbState) {
      // Migration for planStartDate -> startDate
      if (idbState.settings && idbState.settings.planStartDate && !idbState.settings.startDate) {
        idbState.settings.startDate = idbState.settings.planStartDate;
        delete idbState.settings.planStartDate;
        // Trigger a save to persist the migration
        console.log("[Migration] Migrated planStartDate to startDate in IndexedDB.");
      }

      if (idbState.progress && Array.isArray(idbState.progress)) {
        idbState.progress = idbState.progress.map((p: Progress) => normalizeProgressPosition(p));
      }
      if (idbState.completedBooks && Array.isArray(idbState.completedBooks)) {
        idbState.completedBooks = new Set(idbState.completedBooks);
      }
      if (idbState.signedOutCompletedBooks && Array.isArray(idbState.signedOutCompletedBooks)) {
        idbState.signedOutCompletedBooks = new Set(idbState.signedOutCompletedBooks);
      }
      return idbState;
    }
  } catch (e) {
    console.warn("IndexedDB load failed:", e);
  }
  return null;
};

let lastSavedJson = '';

function serializeStateForStorage(state: AppState) {
  const { isCloudHydrated: _ignored, ...rest } = state;
  void _ignored;
  return {
    ...rest,
    completedBooks: Array.from(state.completedBooks),
    signedOutCompletedBooks: state.signedOutCompletedBooks
      ? Array.from(state.signedOutCompletedBooks)
      : undefined,
  };
}

export const saveStateSync = (state: AppState) => {
  try {
    const toSave = serializeStateForStorage(state);
    const json = JSON.stringify(toSave);

    if (json === lastSavedJson) {
      return;
    }
    lastSavedJson = json;

    localStorage.setItem(STORAGE_KEY, json);

    // Run IndexedDB writes in a non-blocking background task
    set(STORAGE_KEY, toSave).catch(e => console.warn("IDB write failed sync:", e));
  } catch (error) {
    console.warn("Storage saveStateSync failed:", error);
  }
};

export const saveState = async (state: AppState) => {
  // Persist synchronously to localStorage so first paint on next launch always
  // has the latest state, then mirror to IndexedDB asynchronously.
  saveStateSync(state);
};
