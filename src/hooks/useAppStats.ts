/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { format, differenceInCalendarDays, parseISO, subDays } from 'date-fns';
import { AppState } from '../types';
import { computeProgressStats, pickLastReadProgress } from '../lib/utils';
import { useToday } from './useToday';

export function useAppStats(state: AppState) {
  // Fresh across midnight/background-resume so streak and day number don't
  // freeze on yesterday while the PWA stays open.
  const todayStr = useToday();

  const streak = useMemo(() => {
    if (state.history.length === 0) return 0;
    
    // We use a Set of local YYYY-MM-DD strings for O(1) daily lookup
    const uniqueDays = new Set<string>();
    
    for (const h of state.history) {
      if (h.categoryId === 'devotional') continue;
      if (h.localDate) {
        uniqueDays.add(h.localDate);
      } else if (h.timestamp) {
        try {
          // If localDate is missing (old entries), we try to derive it.
          // IMPORTANT: we must parse and then format to local string to match new entries
          const d = parseISO(h.timestamp);
          const dateStr = format(d, 'yyyy-MM-dd');
          uniqueDays.add(dateStr);
        } catch {
          const date = h.timestamp.split('T')[0];
          if (date) uniqueDays.add(date);
        }
      }
    }
    
    if (uniqueDays.size === 0) return 0;
    
    const sortedDays = Array.from(uniqueDays).sort((a, b) => b.localeCompare(a));
    const yesterdayStr = format(subDays(parseISO(todayStr), 1), 'yyyy-MM-dd');

    const newestDay = sortedDays[0];
    
    // A streak is active if the newest reading is TODAY or YESTERDAY.
    if (newestDay !== todayStr && newestDay !== yesterdayStr) {
      console.log("[Streak] Broken. Newest reading was:", newestDay, "Today is:", todayStr);
      return 0;
    }

    // Walk back from newestDay
    let currentStreak = 0;
    let checkDate = parseISO(newestDay);
    
    while (uniqueDays.has(format(checkDate, 'yyyy-MM-dd'))) {
      currentStreak++;
      checkDate = subDays(checkDate, 1);
      if (currentStreak > 10000) break;
    }
    
    return currentStreak;
  }, [state.history, todayStr]);

  const dayNumber = useMemo(() => {
    if (!state.settings.startDate) return 0;
    try {
      // Normalize today and start to the same time of day (noon) to avoid timezone-edge switches
      const startRaw = parseISO(state.settings.startDate);
      const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate(), 12, 0, 0);
      const now = parseISO(todayStr);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      
      const num = differenceInCalendarDays(today, start) + 1;
      
      // Console log for verification as requested
      console.log(`startDate loaded: ${state.settings.startDate}, calculated day: ${num}`);
      console.log(`Normalization detail - Start: ${format(start, 'yyyy-MM-dd HH:mm')}, Today: ${format(today, 'yyyy-MM-dd HH:mm')}`);
      
      return num;
    } catch (e) {
      console.error("Day calculation error", e);
      return 1;
    }
  }, [state.settings.startDate, todayStr]);

  const { overallProgress, totalRead, totalChaptersCount } = useMemo(() => 
    computeProgressStats(state.progress, state.completedBooks),
  [state.progress, state.completedBooks]);

  const lastReadProgress = useMemo(
    () => pickLastReadProgress(state.progress),
    [state.progress]
  );

  return {
    streak,
    dayNumber,
    overallProgress,
    totalRead,
    totalChaptersCount,
    lastReadProgress
  };
}
