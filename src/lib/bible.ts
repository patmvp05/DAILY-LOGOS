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
  let newlyCompletedKeys: string[] = [];
  let historySteps: HistoryStep[] = [];

  if (chaptersToMove > 0) {
    while (chaptersToMove > 0) {
      const book = category.books[currentBookIndex];
      // Record current state before advancing
      historySteps.push({
        bookIndex: currentBookIndex,
        chapter: currentChapter,
        bookName: book.name
      });

      // We are moving one chapter forward.
      // If we are at the last chapter of the book, we move to the next book.
      if (currentChapter < book.chapters) {
        currentChapter++;
      } else {
        const bookKey = `${categoryId}:${book.name}`;
        if (!completedBooks.has(bookKey)) {
          newlyCompletedKeys.push(bookKey);
        }
        if (currentBookIndex < category.books.length - 1) {
          currentBookIndex++;
          currentChapter = 1;
        } else {
          // Stay at last chapter of last book
          // We already recorded the last chapter as read
          chaptersToMove = 0;
          break;
        }
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
        
        // Remove book from completed if we move back into it
        const bookKey = `${categoryId}:${category.books[currentBookIndex].name}`;
        if (completedBooks.has(bookKey)) {
          // Note: newlyCompletedKeys doesn't track removals usually, 
          // but we can't easily undo in this pure function without changing signature.
        }
      } else {
        currentChapter = 1;
        backSteps = 0;
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
      lastReadAt: new Date().toISOString()
    },
    newlyCompletedKeys,
    historySteps
  };
}
