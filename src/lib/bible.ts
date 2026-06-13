/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CATEGORIES_BY_ID } from '../constants';
import { Progress as ProgressType } from '../types';

export interface HistoryStep {
  bookIndex: number;
  chapter: number;
  bookName: string;
}

export interface CalculatedProgress {
  progress: ProgressType;
  newlyCompletedKeys: string[];
  revertedCompletedKeys: string[];
  historySteps: HistoryStep[];
}

/**
 * Pure function to calculate Bible reading progress advancement.
 * Optimized to run without side effects.
 */
export function calculateNextProgress(
  categoryId: string, 
  amount: number, 
  currentProgress: ProgressType,
  completedBooks: Set<string>
): CalculatedProgress {
  const category = CATEGORIES_BY_ID.get(categoryId)!;
  let chaptersToMove = amount;
  let currentBookIndex = currentProgress.bookIndex;
  let currentChapter = currentProgress.chapter;
  const newlyCompletedKeys: string[] = [];
  const revertedCompletedKeys: string[] = [];
  const historySteps: HistoryStep[] = [];

  if (chaptersToMove > 0) {
    while (chaptersToMove > 0) {
      const book = category.books[currentBookIndex];
      const bookKey = `${categoryId}:${book.name}`;
      const atLastBook = currentBookIndex >= category.books.length - 1;

      // Terminal position (last chapter of the final book): there's nowhere
      // further to advance. Log the final chapter and complete the book exactly
      // once; any further taps here must NOT re-log the same chapter.
      if (currentChapter >= book.chapters && atLastBook) {
        if (!completedBooks.has(bookKey) && !newlyCompletedKeys.includes(bookKey)) {
          historySteps.push({ bookIndex: currentBookIndex, chapter: currentChapter, bookName: book.name });
          newlyCompletedKeys.push(bookKey);
        }
        break;
      }

      // Record the chapter we're reading now, then advance.
      historySteps.push({
        bookIndex: currentBookIndex,
        chapter: currentChapter,
        bookName: book.name
      });

      if (currentChapter < book.chapters) {
        currentChapter++;
      } else {
        // Last chapter of a non-final book → mark complete and roll forward.
        if (!completedBooks.has(bookKey)) {
          newlyCompletedKeys.push(bookKey);
        }
        currentBookIndex++;
        currentChapter = 1;
      }

      chaptersToMove--;
    }
  } else if (chaptersToMove < 0) {
    let backSteps = Math.abs(chaptersToMove);
    while (backSteps > 0) {
      if (currentChapter > 1) {
        currentChapter--;
      } else if (currentBookIndex > 0) {
        currentBookIndex--;
        currentChapter = category.books[currentBookIndex].chapters;

        // Moving back into a previously-completed book un-completes it, so
        // re-advancing past it doesn't log its last chapter a second time.
        const bookKey = `${categoryId}:${category.books[currentBookIndex].name}`;
        if (completedBooks.has(bookKey) && !revertedCompletedKeys.includes(bookKey)) {
          revertedCompletedKeys.push(bookKey);
        }
      } else {
        currentChapter = 1;
        break;
      }
      backSteps--;
    }
  }

  return {
    progress: {
      categoryId,
      bookIndex: currentBookIndex,
      chapter: currentChapter,
      lastReadAt: new Date().toISOString(),
      localDate: new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    },
    newlyCompletedKeys,
    revertedCompletedKeys,
    historySteps
  };
}
