/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Progress {
  categoryId: string;
  bookIndex: number;
  chapter: number;
  lastReadAt?: string; // ISO string
  localDate?: string; // YYYY-MM-DD in local time
  updatedAtMillis?: number; // Server-side or precise local timestamp
  // Firestore serverTimestamp() for this doc, in millis. Read-only: derived
  // from the cloud snapshot, never written by a device. Unlike lastReadAt /
  // updatedAtMillis (each device's own wall clock), every device's value comes
  // from ONE clock, so it is the only sound way to compare "which category did
  // I read most recently" across an iPad and a desktop. Undefined for guests
  // and for legacy docs written before this field existed.
  serverMillis?: number;
  /**
   * Monotonic revision counter per category progress doc. Every intentional
   * progress change sets revision = highestRevisionSeen + 1 so backward book
   * choices and Undos win over stale positions on other devices without
   * trusting device clocks.
   */
  revision?: number;
  /**
   * Saved chapter positions (1-indexed next chapter to read, >= 2) for books
   * the user switched away from partway through, keyed by book name.
   */
  partialChapters?: Record<string, number>;
}

export interface UserSettings {
  startDate: string; // ISO string
  userName?: string;
  theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook';
  // Device-local preferences (not synced to Firestore — the user-doc rules
  // restrict writes to theme/startDate/updatedAt, and these are sensibly
  // per-device anyway: e.g. KJV on one device, ESV on another). They persist
  // through the local IndexedDB/localStorage state.
  bibleVersion?: string; // BIBLE_VERSIONS id (e.g. 'niv', 'web'); default 'web'
  typography?: 'default' | 'editorial';
  updatedAt?: string; // ISO string or similar for LWW guard
}

export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string for display
  timestampMillis: number; // For precision sorting
  localDate: string; // YYYY-MM-DD in local time for streak
  categoryId: string;
  categoryName: string;
  bookName: string;
  chapter: number;
  readTime?: number;
}

export interface ProverbJournal {
  id: string;
  date: string;
  chapter: number;
  content: string;
  verse?: string;
}

export interface Devotional {
  id: string;
  name: string;
  description: string;
  url: string;
}

/** One hour slot of a 24-hour sprint. */
export interface SprintHour {
  done: boolean;
  reference?: string; // what was read that hour, e.g. "John 3"
}

/**
 * A "24-Hour Scripture Sprint": one chapter every hour for a full day.
 * An occasional discipline (a few times a year), not part of the daily plan —
 * so it is tracked separately and never touches plan progress or reading stats.
 * Keyed by calendar date; `hours` is keyed by hour-of-day '0'..'23'.
 */
export interface ScriptureSprint {
  date: string; // yyyy-MM-dd
  hours: Record<string, SprintHour>;
}

export interface AppState {
  progress: Progress[];
  settings: UserSettings;
  history: HistoryEntry[];
  proverbJournals: ProverbJournal[];
  customDevotionals: Devotional[];
  scriptureSprints: ScriptureSprint[]; // newest first; local-only, capped
  completedBooks: Set<string>; // "categoryId:bookName"
  /**
   * Book keys ("categoryId:bookName") marked completed while signed out.
   * Only these are uploaded on the first CompletedBooks snapshot after sign-in,
   * so an Undo made on another device is never resurrected from stale local
   * completedBooks on launch.
   */
  signedOutCompletedBooks?: Set<string>;
  isCloudHydrated?: boolean; // UI flag for cloud sync completion
}
