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
}

export interface UserSettings {
  startDate: string; // ISO string
  userName?: string;
  theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook';
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

export interface AppState {
  progress: Progress[];
  settings: UserSettings;
  history: HistoryEntry[];
  proverbJournals: ProverbJournal[];
  customDevotionals: Devotional[];
  completedBooks: Set<string>; // "categoryId:bookName"
  isCloudHydrated?: boolean; // UI flag for cloud sync completion
}
