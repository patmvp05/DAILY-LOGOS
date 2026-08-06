/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, subDays } from 'date-fns';
import { CATEGORIES } from '../constants';
import { Progress } from '../types';

/**
 * Combines Tailwind classes with clsx and twMerge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The category the user most recently read — the "Resume Reading" card.
 *
 * Ranks by Firestore's server clock (serverMillis) when available. Each device
 * stamps lastReadAt from its OWN wall clock, so comparing those across an iPad
 * and a desktop lets a device whose clock runs fast make its older reading look
 * like the newest, and Resume Reading points at the wrong book. Server stamps
 * all come from one clock, so they order correctly no matter which device wrote
 * them. lastReadAt remains the fallback for guests and legacy docs, where every
 * entry comes from a single device and is therefore self-consistent.
 */
export function pickLastReadProgress(progress: Progress[]): Progress | undefined {
  const rank = (p: Progress) =>
    typeof p.serverMillis === 'number'
      ? p.serverMillis
      : (p.lastReadAt ? new Date(p.lastReadAt).getTime() : 0);

  return [...progress]
    .filter((p) => p.lastReadAt && !isNaN(new Date(p.lastReadAt).getTime()))
    .sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * "Last read" label for the Resume Reading card. A bare time ("7:42 PM") reads
 * as today, which is wrong and confusing when the last read actually happened
 * yesterday on another device — the common case when you read on an iPad and
 * later open the desktop app. Qualify anything that isn't today with its day.
 */
export function formatLastRead(lastReadAt: string, todayStr: string): string {
  const d = new Date(lastReadAt);
  if (isNaN(d.getTime())) return '';
  const time = format(d, 'h:mm a');
  const day = format(d, 'yyyy-MM-dd');
  if (day === todayStr) return time;
  if (day === format(subDays(parseISO(todayStr), 1), 'yyyy-MM-dd')) return `yesterday at ${time}`;
  return `${format(d, 'MMM d')} at ${time}`;
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
      const isCompleted = completedBooks.has(`${cat.id}:${book.name}`);

      // Count a book as read only if it's actually marked complete (sequential
      // reading records every finished book in completedBooks), plus the
      // partial chapters of the book currently in progress. We deliberately do
      // NOT count every book before the progress pointer: skipping ahead to a
      // later book must not silently mark the skipped-over books as read.
      if (isCompleted) {
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
