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

export interface FinishedBookTransition {
  categoryId: string;
  finishedBookIndex: number;
  finishedBookName: string;
  lastChapter: number;
  recommendedBookIndex: number | null;
  recommendedBookName: string | null;
}

export interface CalculatedProgress {
  progress: ProgressType;
  newlyCompletedKeys: string[];
  revertedCompletedKeys: string[];
  historySteps: HistoryStep[];
  finishedBook?: FinishedBookTransition;
}

/**
 * If a saved progress position ever points at a `dailyOnly` book (e.g. an older
 * app version wrote `bookIndex: 1` for Proverbs in Wisdom), normalize it to the
 * next sequential plan book (Ecclesiastes at `bookIndex: 2`, chapter 1 or its
 * saved partial chapter).
 */
export function normalizeProgressPosition(prog: ProgressType): ProgressType {
  const category = CATEGORIES_BY_ID.get(prog.categoryId);
  if (!category || category.books.length === 0) return prog;

  let bookIndex = Math.max(0, Math.min(category.books.length - 1, prog.bookIndex));
  let chapter = prog.chapter;

  if (category.books[bookIndex]?.dailyOnly) {
    // Advance to the first non-dailyOnly book after bookIndex (or from start)
    let targetIdx = -1;
    for (let i = bookIndex + 1; i < category.books.length; i++) {
      if (!category.books[i].dailyOnly) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx === -1) {
      for (let i = 0; i < bookIndex; i++) {
        if (!category.books[i].dailyOnly) {
          targetIdx = i;
          break;
        }
      }
    }
    if (targetIdx !== -1) {
      bookIndex = targetIdx;
      const targetBook = category.books[bookIndex];
      const saved = prog.partialChapters?.[targetBook.name];
      chapter = typeof saved === 'number' && saved >= 1
        ? Math.max(1, Math.min(targetBook.chapters, Math.floor(saved)))
        : 1;
    }
  }

  const book = category.books[bookIndex];
  const clampedChapter = book ? Math.max(1, Math.min(book.chapters, chapter)) : Math.max(1, chapter);

  if (bookIndex === prog.bookIndex && clampedChapter === prog.chapter) {
    return prog;
  }

  return {
    ...prog,
    bookIndex,
    chapter: clampedChapter,
  };
}

/**
 * True when every sequential plan book (`!book.dailyOnly`) in `categoryId` is
 * marked complete in `completedBooks`.
 */
export function isCategoryComplete(categoryId: string, completedBooks: Set<string>): boolean {
  const category = CATEGORIES_BY_ID.get(categoryId);
  if (!category) return false;
  const planBooks = category.books.filter((b) => !b.dailyOnly);
  if (planBooks.length === 0) return false;
  return planBooks.every((b) => completedBooks.has(`${categoryId}:${b.name}`));
}

/**
 * Find the recommended next unread book in `categoryId` after `afterBookIndex`:
 * 1. First unread non-`dailyOnly` book after `afterBookIndex` in plan order.
 * 2. If none, first unread non-`dailyOnly` book from the start of the category.
 * 3. If no unread books remain, returns `null`.
 */
export function findNextUnreadBookIndex(
  categoryId: string,
  afterBookIndex: number,
  completedBooks: Set<string>
): number | null {
  const category = CATEGORIES_BY_ID.get(categoryId);
  if (!category) return null;

  for (let i = afterBookIndex + 1; i < category.books.length; i++) {
    const book = category.books[i];
    if (!book.dailyOnly && !completedBooks.has(`${categoryId}:${book.name}`)) {
      return i;
    }
  }

  for (let i = 0; i <= afterBookIndex && i < category.books.length; i++) {
    const book = category.books[i];
    if (!book.dailyOnly && !completedBooks.has(`${categoryId}:${book.name}`)) {
      return i;
    }
  }

  return null;
}

/**
 * Resume chapter for an unread book: returns its saved partial chapter if > 1,
 * clamped to `1..maxChapters`, or `1` if not started.
 */
export function getResumeChapterForBook(
  prog: ProgressType | undefined,
  bookName: string,
  maxChapters: number
): number {
  const saved = prog?.partialChapters?.[bookName];
  if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 1) {
    return Math.max(1, Math.min(maxChapters, Math.floor(saved)));
  }
  return 1;
}

/**
 * Switch a category's progress to `targetBookIndex`:
 * - Picking the current book does nothing (never resets to chapter 1).
 * - Picking a `dailyOnly` or already-completed book does nothing.
 * - Switching away from a book partway through (`chapter > 1`) saves that
 *   chapter in `partialChapters[currentBook.name]` so its read chapters still
 *   count and it resumes there when returned to later.
 * - Target book resumes at its saved `partialChapters[targetBook.name]` or 1.
 */
export function switchBookInProgress(
  currentProgress: ProgressType,
  targetBookIndex: number,
  completedBooks: Set<string>
): ProgressType {
  const normalized = normalizeProgressPosition(currentProgress);
  const category = CATEGORIES_BY_ID.get(normalized.categoryId);
  if (!category) return normalized;

  if (targetBookIndex === normalized.bookIndex) {
    return normalized;
  }

  const targetBook = category.books[targetBookIndex];
  if (!targetBook || targetBook.dailyOnly) {
    return normalized;
  }
  if (completedBooks.has(`${normalized.categoryId}:${targetBook.name}`)) {
    return normalized;
  }

  const partialChapters: Record<string, number> = { ...(normalized.partialChapters || {}) };
  const currentBook = category.books[normalized.bookIndex];
  if (
    currentBook &&
    !currentBook.dailyOnly &&
    !completedBooks.has(`${normalized.categoryId}:${currentBook.name}`)
  ) {
    if (normalized.chapter > 1) {
      partialChapters[currentBook.name] = normalized.chapter;
    } else {
      delete partialChapters[currentBook.name];
    }
  }

  const targetChapter = getResumeChapterForBook(
    { ...normalized, partialChapters },
    targetBook.name,
    targetBook.chapters
  );
  delete partialChapters[targetBook.name];

  return {
    ...normalized,
    bookIndex: targetBookIndex,
    chapter: targetChapter,
    partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
  };
}

/**
 * Legacy helper retained for compatibility.
 */
export function isBackwardJump(
  currentProgress: ProgressType | undefined,
  targetBookIndex: number
): boolean {
  if (!currentProgress) return false;
  if (targetBookIndex < currentProgress.bookIndex) return true;
  if (targetBookIndex === currentProgress.bookIndex && currentProgress.chapter > 1) return true;
  return false;
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
  const normalized = normalizeProgressPosition(currentProgress);
  let chaptersToMove = amount;
  let currentBookIndex = normalized.bookIndex;
  let currentChapter = normalized.chapter;
  const newlyCompletedKeys: string[] = [];
  const revertedCompletedKeys: string[] = [];
  const historySteps: HistoryStep[] = [];
  const effectiveCompleted = new Set(completedBooks);
  const partialChapters: Record<string, number> = { ...(normalized.partialChapters || {}) };
  let finishedBook: FinishedBookTransition | undefined;

  if (chaptersToMove > 0) {
    while (chaptersToMove > 0) {
      let book = category.books[currentBookIndex];
      let bookKey = `${categoryId}:${book.name}`;

      // If current book is already completed (or dailyOnly), jump to the first
      // unread book in the category; if none remain, stop without logging.
      if (book.dailyOnly || effectiveCompleted.has(bookKey)) {
        const nextUnreadIdx = findNextUnreadBookIndex(categoryId, currentBookIndex, effectiveCompleted);
        if (nextUnreadIdx === null) {
          break;
        }
        currentBookIndex = nextUnreadIdx;
        book = category.books[currentBookIndex];
        bookKey = `${categoryId}:${book.name}`;
        currentChapter = getResumeChapterForBook(
          { ...normalized, partialChapters },
          book.name,
          book.chapters
        );
        delete partialChapters[book.name];
      }

      // Record the chapter we're reading now, then advance.
      historySteps.push({
        bookIndex: currentBookIndex,
        chapter: currentChapter,
        bookName: book.name,
      });

      if (currentChapter < book.chapters) {
        currentChapter++;
      } else {
        // Finishing the last chapter of `book` -> mark complete exactly once
        // and advance to the recommended next unread book (or stay if part is done).
        if (!effectiveCompleted.has(bookKey) && !newlyCompletedKeys.includes(bookKey)) {
          newlyCompletedKeys.push(bookKey);
          effectiveCompleted.add(bookKey);
        }
        delete partialChapters[book.name];

        const nextUnreadIdx = findNextUnreadBookIndex(categoryId, currentBookIndex, effectiveCompleted);
        finishedBook = {
          categoryId,
          finishedBookIndex: currentBookIndex,
          finishedBookName: book.name,
          lastChapter: book.chapters,
          recommendedBookIndex: nextUnreadIdx,
          recommendedBookName: nextUnreadIdx !== null ? category.books[nextUnreadIdx].name : null,
        };

        if (nextUnreadIdx !== null) {
          currentBookIndex = nextUnreadIdx;
          const nextBook = category.books[currentBookIndex];
          currentChapter = getResumeChapterForBook(
            { ...normalized, partialChapters },
            nextBook.name,
            nextBook.chapters
          );
          delete partialChapters[nextBook.name];
        } else {
          // Entire category is now complete; stay at the final chapter and stop.
          currentChapter = book.chapters;
          break;
        }
      }

      chaptersToMove--;
    }
  } else if (chaptersToMove < 0) {
    // Minus button stays inside the current book (never crosses back into an
    // earlier book; undoing a finished book goes through Undo or Full Plan).
    const book = category.books[currentBookIndex];
    const bookKey = `${categoryId}:${book.name}`;
    if (!book.dailyOnly && !effectiveCompleted.has(bookKey)) {
      currentChapter = Math.max(1, currentChapter + chaptersToMove);
    }
  }

  return {
    progress: {
      ...normalized,
      categoryId,
      bookIndex: currentBookIndex,
      chapter: currentChapter,
      partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
      lastReadAt: new Date().toISOString(),
    },
    newlyCompletedKeys,
    revertedCompletedKeys,
    historySteps,
    finishedBook,
  };
}

/**
 * Returns true when a history entry refers to a plan chapter that is currently
 * unread (at or ahead of the book's resume chapter while the book is not
 * marked completed). Used during cloud history reconciliation so a chapter log
 * that was deleted on another device via Undo is not resurrected from a stale
 * local history array.
 */
export function isChapterUnreadInPlan(
  entry: { categoryId: string; bookName: string; chapter: number },
  progressList: Progress[],
  completedBooks: Set<string>
): boolean {
  if (entry.categoryId === 'devotional' || entry.bookName === 'Proverbs') {
    return false;
  }
  const category = CATEGORIES_BY_ID.get(entry.categoryId);
  if (!category) return false;
  const bookIndex = category.books.findIndex((b) => b.name === entry.bookName);
  if (bookIndex < 0) return false;
  const book = category.books[bookIndex];
  if (book.dailyOnly) return false;
  if (completedBooks.has(`${entry.categoryId}:${entry.bookName}`)) {
    return false;
  }
  const rawProg = progressList.find((p) => p.categoryId === entry.categoryId);
  if (!rawProg) return false;
  // Only drop local-only entries when the progress doc has been through revision
  // tracking (e.g. Undo or modern book transitions), so legacy unversioned tests
  // and synthetic histories are unaffected.
  if (typeof rawProg.revision !== 'number') return false;
  const prog = normalizeProgressPosition(rawProg);
  if (prog.bookIndex === bookIndex) {
    return entry.chapter >= prog.chapter;
  }
  const resumeCh = getResumeChapterForBook(prog, entry.bookName, book.chapters);
  return entry.chapter >= resumeCh;
}
