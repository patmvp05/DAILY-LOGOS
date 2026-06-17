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
export async function prefetchBibleChapters(
  progress: Progress[],
  version?: string,
  chaptersAhead = DEFAULT_CHAPTERS_AHEAD
): Promise<void> {
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

      try {
        await getChapterText(book.name, chapter, version);
      } catch {
        // best-effort — live read will retry on demand
      }
      remaining--;

      // Advance to the next chapter, rolling into the next book at a boundary.
      if (chapter < book.chapters) {
        chapter++;
      } else if (bookIdx < category.books.length - 1) {
        bookIdx++;
        chapter = 1;
      } else {
        break; // end of the category — nothing more to warm
      }
    }
  }
}
