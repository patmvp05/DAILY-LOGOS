/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CATEGORIES_BY_ID } from '../constants';
import { calculateNextProgress } from './bible';
import { getChapterText } from './chapterText';
import type { Progress } from '../types';

const DEFAULT_CHAPTERS_AHEAD = 7;

export interface UpcomingChapter {
  categoryId: string;
  bookName: string;
  chapter: number;
}

/**
 * The next `chaptersAhead` chapters the reader will actually reach in every
 * part. This is the set the app preloads, and the set the dashboard reports as
 * checked each day.
 *
 * It asks the reading plan itself: these are exactly the chapters pressing "+"
 * `chaptersAhead` times would log (calculateNextProgress). An earlier version
 * walked the book list on its own (next book in the list, stop at the end of
 * the part) and so disagreed with the plan whenever books are read out of
 * order: with 1 Corinthians already finished it preloaded 1 Corinthians after
 * Romans while the app moved on to 2 Corinthians, and at the end of a part's
 * last book it preloaded nothing while the app wrapped round to the first
 * unread book. The chapters kept ready for offline reading, and reported as
 * "checked", were then not the ones about to be read.
 */
export function upcomingChapters(
  progress: Progress[],
  completedBooks: Set<string>,
  chaptersAhead = DEFAULT_CHAPTERS_AHEAD
): UpcomingChapter[] {
  const out: UpcomingChapter[] = [];
  for (const prog of progress) {
    if (!CATEGORIES_BY_ID.has(prog.categoryId)) continue;
    const { historySteps } = calculateNextProgress(prog.categoryId, chaptersAhead, prog, completedBooks);
    for (const step of historySteps) {
      out.push({ categoryId: prog.categoryId, bookName: step.bookName, chapter: step.chapter });
    }
  }
  return out;
}

/**
 * Warm the cache for the chapters the user is about to read, in their selected
 * version. getChapterText caches each result to memory + IndexedDB, so once
 * warmed a chapter opens instantly and works offline — "always a week ahead"
 * without ever downloading the whole Bible to the device.
 *
 * Fetches run sequentially (not Promise.all) to avoid flooding the network, and
 * every failure is swallowed: prefetch is best-effort, and the live read will
 * retry on demand. Already-cached chapters return from memory or IndexedDB with
 * no network hit, so re-running on every progress change is cheap.
 */
export async function prefetchBibleChapters(
  progress: Progress[],
  completedBooks: Set<string>,
  version?: string,
  chaptersAhead = DEFAULT_CHAPTERS_AHEAD
): Promise<void> {
  // Each load also runs the completeness check (getChapterText), so this is
  // the daily check of exactly the chapters about to be read.
  for (const { bookName, chapter } of upcomingChapters(progress, completedBooks, chaptersAhead)) {
    try {
      await getChapterText(bookName, chapter, version);
    } catch {
      // best-effort — live read will retry on demand
    }
  }
}
