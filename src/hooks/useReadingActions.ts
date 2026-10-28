/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, Dispatch, useEffect } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { AppState, HistoryEntry, ProverbJournal, SprintHour } from '../types';
import { AppAction, getSprintHour } from '../state/appReducer';
import { CATEGORIES_BY_ID, CATEGORIES, BOOK_READ_MINUTES, DEFAULT_BOOK_MINUTES } from '../constants';
import { triggerHaptic } from '../lib/haptic';
import {
  calculateNextProgress,
  switchBookInProgress,
  normalizeProgressPosition,
  findNextUnreadBookIndex,
  getResumeChapterForBook,
} from '../lib/bible';
import { getCachedReadTime } from '../lib/bibleCache';
import { 
  writeActionBatch, 
  deleteCompletedBook, 
  writeCompletedBook, 
  writeJournal, 
  deleteJournal as deleteJournalFromCloud,
  resetUserData,
  writeSprintHour,
  deleteSprint
} from '../lib/sync';
import { useUi, BookFinishedPromptState } from '../state/UiContextCore';

import { type User } from 'firebase/auth';

export function useReadingActions(
  state: AppState, 
  dispatch: Dispatch<AppAction>, 
  user: User | null
) {
  const {
    showToast,
    setConfirmDialog,
    setJournalDraft,
    setShowProverbModal,
    setSelectingCategoryId,
    setBookFinishedPrompt,
  } = useUi();
  
  // Latest refs to ensure flush always has access to current state/deps without callback churn
  const stateRef = useRef(state);
  const dispatchRef = useRef(dispatch);
  const userRef = useRef(user);

  useEffect(() => {
    stateRef.current = state;
    dispatchRef.current = dispatch;
    userRef.current = user;
  }, [state, dispatch, user]);

  const pendingTaps = useRef<Record<string, number>>({});
  const flushTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flush = useCallback(async (categoryId: string) => {
    const amount = pendingTaps.current[categoryId] || 0;
    pendingTaps.current[categoryId] = 0;
    
    if (amount === 0) return;

    const currentState = stateRef.current;
    const currentDispatch = dispatchRef.current;
    const currentUser = userRef.current;

    const currentProgress = currentState.progress.find(p => p.categoryId === categoryId);
    if (!currentProgress) return;

    const { progress, newlyCompletedKeys, revertedCompletedKeys, historySteps, finishedBook } = calculateNextProgress(
      categoryId,
      amount,
      currentProgress,
      currentState.completedBooks
    );

    const now = new Date();
    const localDate = format(now, 'yyyy-MM-dd');
    const normalizedCurrent = normalizeProgressPosition(currentProgress);
    const posChanged =
      progress.bookIndex !== normalizedCurrent.bookIndex ||
      progress.chapter !== normalizedCurrent.chapter ||
      JSON.stringify(progress.partialChapters || {}) !== JSON.stringify(normalizedCurrent.partialChapters || {});
    const revisionDelta = Math.max(1, historySteps.length);
    const nextRevision = posChanged
      ? (normalizedCurrent.revision ?? 0) + revisionDelta
      : normalizedCurrent.revision;

    currentDispatch({
      type: 'UPDATE_PROGRESS',
      categoryId,
      bookIndex: progress.bookIndex,
      chapter: progress.chapter,
      partialChapters: progress.partialChapters,
      revisionDelta,
      localDate
    });
    newlyCompletedKeys.forEach(key => currentDispatch({ type: 'TOGGLE_BOOK', key, signedOut: !currentUser }));
    revertedCompletedKeys.forEach(key => currentDispatch({ type: 'TOGGLE_BOOK', key, signedOut: !currentUser }));
    
    const category = CATEGORIES_BY_ID.get(categoryId)!;
    const historyEntries: HistoryEntry[] = historySteps.map((step, index) => {
      const cached = getCachedReadTime(step.bookName, step.chapter, currentState.settings.bibleVersion);
      return {
        id: `${Date.now()}_${index}_${Math.random().toString(36).substring(7)}`,
        timestamp: new Date().toISOString(),
        timestampMillis: Date.now() + index,
        localDate: format(new Date(), 'yyyy-MM-dd'),
        categoryId,
        categoryName: category.name,
        bookName: step.bookName,
        chapter: step.chapter,
        readTime: cached || BOOK_READ_MINUTES[step.bookName] || DEFAULT_BOOK_MINUTES,
      };
    });

    historyEntries.forEach(entry => currentDispatch({ type: 'LOG_HISTORY', entry }));

    if (finishedBook) {
      const finishedEntry = [...historyEntries]
        .reverse()
        .find(h => h.bookName === finishedBook.finishedBookName && h.chapter === finishedBook.lastChapter);
      setBookFinishedPrompt({
        ...finishedBook,
        loggedHistoryId: finishedEntry?.id,
        previousPartialChapters: normalizedCurrent.partialChapters,
      });
    }
    
    if (currentUser) {
      writeActionBatch(currentUser.uid, {
        progress: {
          ...progress,
          revision: nextRevision,
          localDate,
          updatedAtMillis: Date.now(),
        },
        history: historyEntries,
        completedBooks: newlyCompletedKeys.map(k => {
          const [catId, bookName] = k.split(':');
          return { categoryId: catId, bookName };
        })
      }).catch(err => console.error("Sync failed:", err));
    }
  }, [setBookFinishedPrompt]);

  // Cleanup pending flushes on unmount & flush immediately if needed
  useEffect(() => {
    const currentTimeouts = flushTimeouts.current;
    const currentTaps = pendingTaps.current;
    return () => {
      Object.keys(currentTimeouts).forEach((catId) => {
        if (currentTimeouts[catId]) {
          clearTimeout(currentTimeouts[catId]);
        }
        if (currentTaps[catId] && currentTaps[catId] !== 0) {
          console.log(`[Unmount Flush] Flushing pending taps for ${catId}:`, currentTaps[catId]);
          flush(catId);
        }
      });
    };
  }, [flush]);

  // Robust Safari/iOS background-freeze guards
  useEffect(() => {
    const forceFlushAll = () => {
      Object.keys(pendingTaps.current).forEach((catId) => {
        if (pendingTaps.current[catId] && pendingTaps.current[catId] !== 0) {
          console.log(`[Visibility/PageHide Flush] Flushing pending taps for ${catId}:`, pendingTaps.current[catId]);
          if (flushTimeouts.current[catId]) {
            clearTimeout(flushTimeouts.current[catId]);
          }
          flush(catId);
        }
      });
    };

    window.addEventListener('pagehide', forceFlushAll);
    window.addEventListener('beforeunload', forceFlushAll);
    
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        forceFlushAll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pagehide', forceFlushAll);
      window.removeEventListener('beforeunload', forceFlushAll);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flush]);

  const advanceChapter = useCallback((categoryId: string, amount: number) => {
    // Immediate haptic feedback for every tap per requirements
    triggerHaptic(amount > 0 ? 'medium' : 'light');
    
    // Accumulate taps (net results if + and - are mixed)
    pendingTaps.current[categoryId] = (pendingTaps.current[categoryId] || 0) + amount;
    
    // Clear existing flush timeout and schedule a new one (trailing edge)
    if (flushTimeouts.current[categoryId]) {
      clearTimeout(flushTimeouts.current[categoryId]);
    }
    
    flushTimeouts.current[categoryId] = setTimeout(() => {
      flush(categoryId);
    }, 200);
  }, [flush]);

  const jumpToBook = useCallback((categoryId: string, bookIndex: number) => {
    const currentProgress = stateRef.current.progress.find(p => p.categoryId === categoryId);
    if (!currentProgress) {
      setSelectingCategoryId(null);
      return;
    }

    const switched = switchBookInProgress(currentProgress, bookIndex, stateRef.current.completedBooks);
    const normalized = normalizeProgressPosition(currentProgress);
    if (
      switched.bookIndex === normalized.bookIndex &&
      switched.chapter === normalized.chapter &&
      JSON.stringify(switched.partialChapters || {}) === JSON.stringify(normalized.partialChapters || {})
    ) {
      // Picking the book we're already in is a no-op (never resets to chapter 1).
      setSelectingCategoryId(null);
      return;
    }

    const now = new Date().toISOString();
    const localDate = format(new Date(), 'yyyy-MM-dd');
    const nextRevision = (normalized.revision ?? 0) + 1;

    dispatch({ type: 'JUMP_TO_BOOK', categoryId, bookIndex });
    triggerHaptic('light');

    if (userRef.current) {
      writeActionBatch(userRef.current.uid, {
        progress: {
          ...switched,
          revision: nextRevision,
          lastReadAt: now,
          localDate,
          updatedAtMillis: Date.now(),
        },
      }).catch(e => console.error("Jump sync failed:", e));
    }
    setSelectingCategoryId(null);
  }, [dispatch, setSelectingCategoryId]);

  const undoFinishBook = useCallback((prompt: BookFinishedPromptState) => {
    const currentProgress = stateRef.current.progress.find(p => p.categoryId === prompt.categoryId);
    const nextRevision = (currentProgress?.revision ?? 0) + 1;
    const partialChapters = prompt.previousPartialChapters
      ? { ...prompt.previousPartialChapters }
      : { ...(currentProgress?.partialChapters || {}) };
    delete partialChapters[prompt.finishedBookName];
    const finalPartials = Object.keys(partialChapters).length > 0 ? partialChapters : undefined;

    dispatch({
      type: 'UNDO_FINISH_BOOK',
      categoryId: prompt.categoryId,
      bookIndex: prompt.finishedBookIndex,
      chapter: prompt.lastChapter,
      bookName: prompt.finishedBookName,
      historyId: prompt.loggedHistoryId,
      previousPartialChapters: finalPartials,
    });

    if (userRef.current) {
      writeActionBatch(userRef.current.uid, {
        progress: {
          categoryId: prompt.categoryId,
          bookIndex: prompt.finishedBookIndex,
          chapter: prompt.lastChapter,
          partialChapters: finalPartials,
          revision: nextRevision,
          lastReadAt: new Date().toISOString(),
          localDate: format(new Date(), 'yyyy-MM-dd'),
          updatedAtMillis: Date.now(),
        },
        deletedBooks: [{ categoryId: prompt.categoryId, bookName: prompt.finishedBookName }],
        deletedHistoryIds: prompt.loggedHistoryId ? [prompt.loggedHistoryId] : undefined,
      }).catch(e => console.error("Undo finish book sync failed:", e));
    }
    setBookFinishedPrompt(null);
    triggerHaptic('light');
  }, [dispatch, setBookFinishedPrompt]);

  const toggleBookCompletion = useCallback((categoryId: string, bookName: string) => {
    const key = `${categoryId}:${bookName}`;
    const isCompleted = stateRef.current.completedBooks.has(key);
    
    dispatch({ type: 'TOGGLE_BOOK', key, signedOut: !userRef.current });
    triggerHaptic(isCompleted ? 'light' : 'heavy');
    
    if (userRef.current) {
      if (isCompleted) {
        deleteCompletedBook(userRef.current.uid, categoryId, bookName);
      } else {
        const currentProgress = stateRef.current.progress.find(p => p.categoryId === categoryId);
        const category = CATEGORIES_BY_ID.get(categoryId);
        const normalized = currentProgress ? normalizeProgressPosition(currentProgress) : undefined;
        const currentBook = normalized && category ? category.books[normalized.bookIndex] : undefined;
        const nextCompleted = new Set(stateRef.current.completedBooks);
        nextCompleted.add(key);

        if (normalized && category && currentBook?.name === bookName) {
          const nextUnreadIdx = findNextUnreadBookIndex(categoryId, normalized.bookIndex, nextCompleted);
          const partialChapters = { ...(normalized.partialChapters || {}) };
          delete partialChapters[bookName];
          if (nextUnreadIdx !== null && nextUnreadIdx !== normalized.bookIndex) {
            const nextBook = category.books[nextUnreadIdx];
            const nextChapter = getResumeChapterForBook(
              { ...normalized, partialChapters },
              nextBook.name,
              nextBook.chapters
            );
            delete partialChapters[nextBook.name];
            writeActionBatch(userRef.current.uid, {
              progress: {
                ...normalized,
                bookIndex: nextUnreadIdx,
                chapter: nextChapter,
                partialChapters: Object.keys(partialChapters).length > 0 ? partialChapters : undefined,
                revision: (normalized.revision ?? 0) + 1,
                lastReadAt: new Date().toISOString(),
                localDate: format(new Date(), 'yyyy-MM-dd'),
                updatedAtMillis: Date.now(),
              },
              completedBooks: [{ categoryId, bookName }],
            }).catch(e => console.error("Toggle completion batch failed:", e));
            return;
          }
        }
        writeCompletedBook(userRef.current.uid, categoryId, bookName);
      }
    }
  }, [dispatch]);

  const requestToggleBookCompletion = useCallback((categoryId: string, bookName: string) => {
    const key = `${categoryId}:${bookName}`;
    const isCompleted = stateRef.current.completedBooks.has(key);
    setConfirmDialog({
      isOpen: true,
      title: isCompleted ? `Mark ${bookName} Unread?` : `Mark ${bookName} Finished?`,
      message: isCompleted
        ? `This will un-mark ${bookName} as finished and remove its chapters from your completed total.`
        : `This will mark all chapters of ${bookName} as finished in your reading plan.`,
      confirmLabel: isCompleted ? 'Mark Unread' : 'Mark Finished',
      type: isCompleted ? 'danger' : 'info',
      onConfirm: () => toggleBookCompletion(categoryId, bookName),
    });
  }, [setConfirmDialog, toggleBookCompletion]);

  const saveProverbJournal = useCallback(async (content: string, verse: string, id: string | null) => {
    if (!content.trim()) return;
    
    const journalId = id || (
      (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) 
        ? window.crypto.randomUUID() 
        : Math.random().toString(36).substring(2, 11)
    );
    const today = format(new Date(), 'yyyy-MM-dd');
    const dayOfMonth = new Date().getDate();
    
    const newJournal: ProverbJournal = {
      id: journalId,
      date: id ? state.proverbJournals.find(j => j.id === id)!.date : today,
      chapter: id ? state.proverbJournals.find(j => j.id === id)!.chapter : dayOfMonth,
      content,
      verse
    };

    dispatch({ type: 'UPSERT_JOURNAL', journal: newJournal });
    if (user) {
      writeJournal(user.uid, newJournal);
    }

    setJournalDraft({ id: null, content: '', verse: '' });
    setShowProverbModal(false);
    triggerHaptic('heavy');
    showToast(id ? 'Journal updated!' : 'Journal entry saved!');
  }, [state.proverbJournals, user, dispatch, setJournalDraft, setShowProverbModal, showToast]);

  const deleteJournal = useCallback((id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Journal",
      message: "Are you sure you want to delete this journal entry? This action cannot be undone.",
      onConfirm: () => {
        dispatch({ type: 'DELETE_JOURNAL', id });
        if (user) deleteJournalFromCloud(user.uid, id);
        showToast("Journal deleted", "info");
      }
    });
  }, [user, dispatch, setConfirmDialog, showToast]);

  const resetProgress = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: "Reset Progress",
      message: "This will reset all chapter markers to the beginning. Your journal history will be kept. Continue?",
      onConfirm: async () => {
        const resetDate = new Date().toISOString();
        const localDate = format(new Date(), 'yyyy-MM-dd');
        const newState: AppState = {
          ...state,
          progress: CATEGORIES.map(cat => ({ 
            categoryId: cat.id, 
            bookIndex: 0, 
            chapter: 1, 
            lastReadAt: resetDate,
            localDate: localDate
          })),
          settings: { 
            ...state.settings, 
            startDate: resetDate,
            updatedAt: new Date().toISOString()
          },
          completedBooks: new Set<string>()
        };
        dispatch({ type: 'REPLACE_STATE', state: newState });
        if (user) {
          await resetUserData(user.uid).catch(err => console.error("Reset sync failed:", err));
        }
        showToast("Plan restarted!", "success");
      }
    });
  }, [state, user, dispatch, setConfirmDialog, showToast]);

  const logProverbRead = useCallback((chapter: number, explicitReadTime?: number) => {
    // Check if already logged today
    const alreadyLogged = state.history.some(h => 
      h.bookName === 'Proverbs' && 
      h.chapter === chapter && 
      (() => {
        try {
          return isToday(parseISO(h.timestamp));
        } catch {
          return false;
        }
      })()
    );

    if (alreadyLogged) return;

    const cached = getCachedReadTime('Proverbs', chapter, state.settings.bibleVersion);
    const readTime = explicitReadTime || cached || BOOK_READ_MINUTES['Proverbs'] || DEFAULT_BOOK_MINUTES;

    const entry: HistoryEntry = {
      id: `proverb_${Date.now()}`,
      timestamp: new Date().toISOString(),
      timestampMillis: Date.now(),
      localDate: format(new Date(), 'yyyy-MM-dd'),
      categoryId: 'wisdom',
      categoryName: 'Daily Proverb',
      bookName: 'Proverbs',
      chapter,
      readTime,
    };

    dispatch({ type: 'LOG_HISTORY', entry });
    if (user) {
      writeActionBatch(user.uid, {
        history: [entry]
      }).catch(err => console.error("Proverb sync failed:", err));
    }
    triggerHaptic('medium');
  }, [state.history, state.settings.bibleVersion, user, dispatch]);

  const logDevotionalRead = useCallback((slug: string, name: string) => {
    const alreadyLogged = state.history.some(h =>
      h.categoryId === 'devotional' &&
      h.bookName === name &&
      (() => {
        try {
          return isToday(parseISO(h.timestamp));
        } catch {
          return false;
        }
      })()
    );

    if (alreadyLogged) return;

    const entry: HistoryEntry = {
      id: `devotional_${slug}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      timestampMillis: Date.now(),
      localDate: format(new Date(), 'yyyy-MM-dd'),
      categoryId: 'devotional',
      categoryName: 'Devotional',
      bookName: name,
      chapter: 0,
    };

    dispatch({ type: 'LOG_HISTORY', entry });
    if (user) {
      writeActionBatch(user.uid, {
        history: [entry]
      }).catch(err => console.error("Devotional sync failed:", err));
    }
    triggerHaptic('medium');
  }, [state.history, user, dispatch]);

  // ── 24-hour sprint ────────────────────────────────────────────────────
  // Each hour is written on its own with a field-level merge, so two devices
  // ticking different hours of the same day never clobber one another.
  // Pending debounced reference writes, holding the exact slot to upload so the
  // flush never has to re-read state.
  const sprintPending = useRef<Record<string, {
    date: string; hour: number; slot: SprintHour; timer: ReturnType<typeof setTimeout>;
  }>>({});

  const pushSprintHour = useCallback((date: string, hour: number, slot: SprintHour) => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    writeSprintHour(currentUser.uid, date, hour, slot)
      .catch(err => console.error('Sprint sync failed:', err));
  }, []);

  /**
   * Apply one hour of the sprint.
   *
   * The resulting slot is computed ONCE here and handed to both the reducer and
   * Firestore, so local state and the cloud are identical by construction.
   * (Previously the write path re-read state on a setTimeout to discover what
   * the reducer had done. stateRef is refreshed in an effect, so that read
   * could land first and upload the PRE-toggle value — the cloud then said
   * done:false, the listener treats the cloud as authoritative for a key it
   * already has, and the tick silently reverted and never reached other
   * devices.)
   */
  const applySprintHour = useCallback((date: string, hour: number, slot: SprintHour) => {
    dispatch({ type: 'SET_SPRINT_HOUR', date, hour, slot });
    return slot;
  }, [dispatch]);

  const toggleSprintHour = useCallback((date: string, hour: number) => {
    const prev = getSprintHour(stateRef.current.scriptureSprints, date, hour);
    const next: SprintHour = { ...prev, done: !prev.done };
    applySprintHour(date, hour, next);
    triggerHaptic('medium');
    pushSprintHour(date, hour, next);
  }, [applySprintHour, pushSprintHour]);

  const setSprintReference = useCallback((date: string, hour: number, reference: string) => {
    const prev = getSprintHour(stateRef.current.scriptureSprints, date, hour);
    const next: SprintHour = { ...prev, reference };
    applySprintHour(date, hour, next);

    // Debounced: typing shouldn't fire a write per keystroke. The pending entry
    // carries the value, so the flush never re-reads state.
    const key = `${date}:${hour}`;
    const existing = sprintPending.current[key];
    if (existing) clearTimeout(existing.timer);
    sprintPending.current[key] = {
      date, hour, slot: next,
      timer: setTimeout(() => {
        const pending = sprintPending.current[key];
        delete sprintPending.current[key];
        if (pending) pushSprintHour(pending.date, pending.hour, pending.slot);
      }, 700),
    };
  }, [applySprintHour, pushSprintHour]);

  const clearSprint = useCallback((date: string) => {
    dispatch({ type: 'CLEAR_SPRINT', date });
    const currentUser = userRef.current;
    if (currentUser) {
      deleteSprint(currentUser.uid, date)
        .catch(err => console.error('Sprint delete failed:', err));
    }
  }, [dispatch]);

  // Flush any pending reference write on unmount so closing the modal (or the
  // tab) mid-keystroke doesn't drop the last edit.
  useEffect(() => {
    const pending = sprintPending.current;
    return () => {
      Object.values(pending).forEach(({ date, hour, slot, timer }) => {
        clearTimeout(timer);
        pushSprintHour(date, hour, slot);
      });
    };
  }, [pushSprintHour]);

  return {
    advanceChapter,
    jumpToBook,
    undoFinishBook,
    toggleSprintHour,
    setSprintReference,
    clearSprint,
    toggleBookCompletion,
    requestToggleBookCompletion,
    saveProverbJournal,
    deleteJournal,
    resetProgress,
    logProverbRead,
    logDevotionalRead
  };
}
