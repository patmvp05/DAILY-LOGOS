/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { format, differenceInDays, parseISO, subDays, isToday, isSameDay } from 'date-fns';
import { AppState } from '../types';
import { CATEGORIES } from '../constants';
import { computeProgressStats } from '../lib/utils';

export function useAppStats(state: AppState) {
  const streak = useMemo(() => {
    if (state.history.length === 0) return 0;
    
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(now, 1), 'yyyy-MM-dd');

    // We use a Set of local YYYY-MM-DD strings for O(1) daily lookup
    const uniqueDays = new Set<string>();
    
    for (const h of state.history) {
      try {
        // Convert ISO timestamp to local YYYY-MM-DD string
        const dateStr = format(parseISO(h.timestamp), 'yyyy-MM-dd');
        uniqueDays.add(dateStr);
      } catch (e) {
        // Fallback for potentially malformed data
        const date = h.timestamp.split('T')[0];
        if (date) uniqueDays.add(date);
      }
    }

    if (uniqueDays.size === 0) return 0;
    
    // Streak is active only if they read today or yesterday (local time)
    if (!uniqueDays.has(todayStr) && !uniqueDays.has(yesterdayStr)) return 0;

    let currentStreak = 0;
    let checkDate = uniqueDays.has(todayStr) ? now : subDays(now, 1);
    
    // Iteratively count backwards from the most recent reading day
    while (uniqueDays.has(format(checkDate, 'yyyy-MM-dd'))) {
      currentStreak++;
      checkDate = subDays(checkDate, 1);
      // Safety break to prevent infinite loops with system clock edge cases
      if (currentStreak > 10000) break;
    }
    
    return currentStreak;
  }, [state.history]);

  const dayNumber = useMemo(() => 
    differenceInDays(new Date(), parseISO(state.settings.startDate)) + 1,
  [state.settings.startDate]);

  const { overallProgress, totalRead, totalChaptersCount } = useMemo(() => 
    computeProgressStats(state.progress, state.completedBooks),
  [state.progress, state.completedBooks]);

  const lastReadProgress = useMemo(() => {
    return [...state.progress]
      .filter(p => p.lastReadAt && !isNaN(new Date(p.lastReadAt).getTime()))
      .sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime())[0];
  }, [state.progress]);

  return {
    streak,
    dayNumber,
    overallProgress,
    totalRead,
    totalChaptersCount,
    lastReadProgress
  };
}
