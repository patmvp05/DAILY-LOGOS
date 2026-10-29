/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CATEGORIES_BY_ID } from '../constants';
import { getChapterText } from './chapterText';
import type { Progress } from '../types';

const DEFAULT_CHAPTERS_AHEAD = 7;

/**
 * Warm the cache for the chapters the user is about to read.
 *
 * For each of the seven reading categories, this walks forward from the user's
 * current position (bookIndex + chapter), crossing book boundaries, and fetches
 * the next `chaptersAhead` chapters in their selected version. getChapterText
 * caches each result to memory + IndexedDB, so once warmed a chapter opens
 * instantly and works offline — exactly the "always a week ahead" behavior we
 * want without ever downloading the whole Bible to the device.
 *
 * Fetches run sequentially (not Promise.all) to avoid flooding the network, and
 * every failure is swallowed: prefetch is best-effort, and the live read will
 * retry on demand. Already-cached chapters return from L1/L2 with no network
 * hit, so re-running on every progress change is cheap and idempotent.
 */
export interface UpcomingChapter {
  categoryId: string;
  bookName: string;
  chapter: number;
}

/**
 * The next `chaptersAhead` chapters in every reading part, starting at the
 * current position and rolling into the next book at a boundary (skipping
 * books read outside the plan, e.g. the Daily Proverb). This is the set the
 * app preloads, and the set the dashboard reports as checked each day.
 */
export function upcomingChapters(
  progress: Progress[],
  chaptersAhead = DEFAULT_CHAPTERS_AHEAD
): UpcomingChapter[] {
  const out: UpcomingChapter[] = [];
  for (const prog of progress) {
    const category = CATEGORIES_BY_ID.get(prog.categoryId);
    if (!category) continue;

    let bookIdx = prog.bookIndex;
    let chapter = prog.chapter;
    let remaining = chaptersAhead;

    while (remaining > 0 && bookIdx >= 0 && bookIdx < category.books.length) {
      const book = category.books[bookIdx];
      if (!book) break;

      // Guard against an out-of-range stored chapter.
      if (chapter < 1 || chapter > book.chapters) break;

      // Skip books read outside the category plan (e.g. Daily Proverb).
      if (book.dailyOnly) {
        bookIdx++;
        chapter = 1;
        continue;
      }

      out.push({ categoryId: prog.categoryId, bookName: book.name, chapter });
      remaining--;

      // Advance to the next chapter, rolling into the next book at a boundary.
      if (chapter < book.chapters) {
        chapter++;
      } else if (bookIdx < category.books.length - 1) {
        bookIdx++;
        while (bookIdx < category.books.length && category.books[bookIdx]?.dailyOnly) {
          bookIdx++;
        }
        chapter = 1;
      } else {
        break; // end of the category — nothing more to warm
      }
    }
  }
  return out;
}

export async function prefetchBibleChapters(
  progress: Progress[],
  version?: string,
  chaptersAhead = DEFAULT_CHAPTERS_AHEAD
): Promise<void> {
  // Each load also runs the completeness check (getChapterText), so this is
  // the daily check of exactly the chapters about to be read.
  for (const { bookName, chapter } of upcomingChapters(progress, chaptersAhead)) {
    try {
      await getChapterText(bookName, chapter, version);
    } catch {
      // best-effort — live read will retry on demand
    }
  }
}
