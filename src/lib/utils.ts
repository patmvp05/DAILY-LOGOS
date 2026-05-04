/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CATEGORIES } from '../constants';
import { Progress } from '../types';

/**
 * Combines Tailwind classes with clsx and twMerge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Calculates both per-category and overall reading progress in a single pass.
 */
export function computeProgressStats(progress: Progress[], completedBooks: Set<string>) {
  const catProgress: Record<string, { pct: number; chaptersRead: number; totalChapters: number }> = {};
  let overallTotalRead = 0;
  let overallTotalChapters = 0;

  CATEGORIES.forEach((cat) => {
    const prog = progress.find((p) => p.categoryId === cat.id);
    const totalChapters = cat.books.reduce((sum, b) => sum + b.chapters, 0);
    overallTotalChapters += totalChapters;

    if (!prog) {
      catProgress[cat.id] = { pct: 0, chaptersRead: 0, totalChapters };
      return;
    }

    let chaptersRead = 0;
    for (let i = 0; i < cat.books.length; i++) {
      const book = cat.books[i];
      const isCompletedManually = completedBooks.has(`${cat.id}:${book.name}`);
      const isPastBook = i < prog.bookIndex;

      if (isCompletedManually || isPastBook) {
        chaptersRead += book.chapters;
      } else if (i === prog.bookIndex) {
        chaptersRead += Math.max(0, prog.chapter - 1);
      }
    }

    overallTotalRead += Math.min(chaptersRead, totalChapters);
    const pct = totalChapters > 0 ? Math.min((chaptersRead / totalChapters) * 100, 100) : 0;
    catProgress[cat.id] = { 
      pct: Math.round(pct * 10) / 10, 
      chaptersRead: Math.min(chaptersRead, totalChapters), 
      totalChapters 
    };
  });

  const overallPct = overallTotalChapters > 0 ? (overallTotalRead / overallTotalChapters) * 100 : 0;
  const overallProgress = Math.min(100, Math.round(overallPct * 10) / 10);

  return {
    catProgress,
    overallProgress,
    totalRead: overallTotalRead,
    totalChaptersCount: overallTotalChapters,
  };
}
