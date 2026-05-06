/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppState, Progress, UserSettings, HistoryEntry } from '../types';
import { CATEGORIES } from '../constants';
import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'seven_seals_bible_progress';
const SNAPSHOT_KEY = 'daily_logos_history_snapshot';

const DEFAULT_PROGRESS: Progress[] = CATEGORIES.map((cat) => ({
  categoryId: cat.id,
  bookIndex: 0,
  chapter: 1,
}));

const DEFAULT_SETTINGS: UserSettings = {
  startDate: new Date().toISOString(),
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
    completedBooks: new Set<string>(),
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultState;
    const parsed = JSON.parse(stored);
    return {
      progress: parsed.progress || defaultState.progress,
      settings: parsed.settings || defaultState.settings,
      history: parsed.history || defaultState.history,
      proverbJournals: parsed.proverbJournals || defaultState.proverbJournals,
      customDevotionals: parsed.customDevotionals || defaultState.customDevotionals,
      completedBooks: parsed.completedBooks ? new Set(parsed.completedBooks) : defaultState.completedBooks,
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
      if (idbState.completedBooks && Array.isArray(idbState.completedBooks)) {
        idbState.completedBooks = new Set(idbState.completedBooks);
      }
      return idbState;
    }
  } catch (e) {
    console.warn("IndexedDB load failed:", e);
  }
  return null;
};

let lastSavedJson = '';
let lastSnapshotLength = 0;

export const saveState = async (state: AppState) => {
  // Move processing off the immediate render cycle to avoid blocking the main thread
  return new Promise<void>((resolve) => {
    setTimeout(async () => {
      try {
        const toSave = {
          ...state,
          completedBooks: Array.from(state.completedBooks)
        };
        const json = JSON.stringify(toSave);
        
        // Skip write if nothing changed
        if (json === lastSavedJson) {
          resolve();
          return;
        }
        lastSavedJson = json;

        // Write to both
        localStorage.setItem(STORAGE_KEY, json);
        await set(STORAGE_KEY, toSave).catch(e => console.warn("IDB write failed:", e));

        // History snapshot safety net - skip if length hasn't changed
        if (state.history && state.history.length > 0 && state.history.length !== lastSnapshotLength) {
          lastSnapshotLength = state.history.length;
          const snapshot = {
            data: state.history,
            timestamp: Date.now()
          };
          await set(SNAPSHOT_KEY, snapshot).catch(() => {});
        }
        resolve();
      } catch (error) {
        console.error("Storage save failed:", error);
        resolve();
      }
    }, 0);
  });
};

export const loadHistorySnapshot = async (): Promise<{ data: HistoryEntry[], timestamp: number } | null> => {
  try {
    return (await get(SNAPSHOT_KEY)) || null;
  } catch {
    return null;
  }
};
