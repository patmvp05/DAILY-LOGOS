/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { format, differenceInDays, parseISO, subDays } from 'date-fns';
import { AppState } from '../types';
import { CATEGORIES } from '../constants';

export function useAppStats(state: AppState) {
  const streak = useMemo(() => {
    if (state.history.length === 0) return 0;
    const dateSet = new Set<string>();
    for (const h of state.history) dateSet.add(h.timestamp.split('T')[0]);
    const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
    const today = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    if (dates[0] !== today && dates[0] !== yesterday) return 0;
    let currentStreak = 1;
    for (let i = 0; i < dates.length - 1; i++) {
        const d1 = parseISO(dates[i]);
        const d2 = parseISO(dates[i+1]);
        if (differenceInDays(d1, d2) === 1) currentStreak++;
        else break;
    }
    return currentStreak;
  }, [state.history]);

  const dayNumber = useMemo(() => 
    differenceInDays(new Date(), parseISO(state.settings.startDate)) + 1,
  [state.settings.startDate]);

  const totalChaptersCount = useMemo(() => CATEGORIES.reduce((acc, cat) => acc + cat.books.reduce((bAcc, b) => bAcc + b.chapters, 0), 0), []);

  const overallProgress = useMemo(() => {
    let totalRead = 0;
    
    // We count chapters read across all disjoint categories
    CATEGORIES.forEach(cat => {
      const p = state.progress.find(prog => prog.categoryId === cat.id);
      
      cat.books.forEach((book, idx) => {
        const isCompleted = state.completedBooks.has(`${cat.id}:${book.name}`);
        
        if (isCompleted) {
          totalRead += book.chapters;
        } else if (p && idx === p.bookIndex) {
          // If NOT completed, we add what's read so far in the current book
          totalRead += Math.max(0, p.chapter - 1);
        }
        // Note: we don't count books BEFORE bookIndex as "auto-completed" anymore
        // unless they are explicitly in completedBooks.
      });
    });

    return Math.min(100, Math.round((totalRead / totalChaptersCount) * 100));
  }, [state.progress, state.completedBooks, totalChaptersCount]);

  const lastReadProgress = useMemo(() => {
    return [...state.progress]
      .filter(p => p.lastReadAt && !isNaN(new Date(p.lastReadAt).getTime()))
      .sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime())[0];
  }, [state.progress]);

  return {
    streak,
    dayNumber,
    overallProgress,
    lastReadProgress
  };
}
