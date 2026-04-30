/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, Dispatch, useEffect } from 'react';
import { format } from 'date-fns';
import { AppState, HistoryEntry, ProverbJournal } from '../types';
import { AppAction } from '../state/appReducer';
import { CATEGORIES_BY_ID, CATEGORIES } from '../constants';
import { triggerHaptic } from '../lib/haptic';
import { calculateNextProgress } from '../lib/bible';
import { 
  writeActionBatch, 
  deleteCompletedBook, 
  writeCompletedBook, 
  writeJournal, 
  deleteJournal as deleteJournalFromCloud,
  resetUserData
} from '../lib/sync';
import { useUi } from '../state/UiContext';
import { type User } from 'firebase/auth';

export function useReadingActions(
  state: AppState, 
  dispatch: Dispatch<AppAction>, 
  user: User | null
) {
  const { showToast, setConfirmDialog, setJournalDraft, setShowProverbModal, setSelectingCategoryId } = useUi();
  
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
  const flushTimeouts = useRef<Record<string, any>>({});

  // Cleanup pending flushes on unmount
  useEffect(() => {
    return () => {
      Object.values(flushTimeouts.current).forEach(clearTimeout);
    };
  }, []);

  const flush = useCallback(async (categoryId: string) => {
    const amount = pendingTaps.current[categoryId] || 0;
    pendingTaps.current[categoryId] = 0;
    
    if (amount === 0) return;

    const currentState = stateRef.current;
    const currentDispatch = dispatchRef.current;
    const currentUser = userRef.current;

    const currentProgress = currentState.progress.find(p => p.categoryId === categoryId);
    if (!currentProgress) return;

    const { progress, newlyCompletedKeys, historySteps } = calculateNextProgress(
      categoryId, 
      amount, 
      currentProgress, 
      currentState.completedBooks
    );

    currentDispatch({ type: 'UPDATE_PROGRESS', categoryId, bookIndex: progress.bookIndex, chapter: progress.chapter });
    newlyCompletedKeys.forEach(key => currentDispatch({ type: 'TOGGLE_BOOK', key }));
    
    const category = CATEGORIES_BY_ID.get(categoryId)!;
    const historyEntries: HistoryEntry[] = historySteps.map((step, index) => ({
      id: `${Date.now()}_${index}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      timestampMillis: Date.now() + index,
      categoryId,
      categoryName: category.name,
      bookName: step.bookName,
      chapter: step.chapter,
    }));

    historyEntries.forEach(entry => currentDispatch({ type: 'LOG_HISTORY', entry }));
    
    if (currentUser) {
      writeActionBatch(currentUser.uid, {
        progress,
        history: historyEntries,
        completedBooks: newlyCompletedKeys.map(k => {
          const [catId, bookName] = k.split(':');
          return { categoryId: catId, bookName };
        })
      }).catch(e => console.error("Sync failed:", e));
    }
  }, []);

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
    const category = CATEGORIES_BY_ID.get(categoryId)!;
    const book = category.books[bookIndex];
    const currentProgress = state.progress.find(p => p.categoryId === categoryId);
    
    const performJump = () => {
      const key = `${categoryId}:${book.name}`;
      dispatch({ type: 'JUMP_TO_BOOK', categoryId, bookIndex, key });
      
      if (user) {
        writeActionBatch(user.uid, {
          progress: {
            categoryId,
            bookIndex,
            chapter: 1,
            lastReadAt: new Date().toISOString()
          },
          deletedBooks: [{ categoryId, bookName: book.name }]
        }).catch(e => console.error("Jump sync failed:", e));
      }
      setSelectingCategoryId(null);
    };

    if (currentProgress && currentProgress.bookIndex !== bookIndex) {
      setConfirmDialog({
        isOpen: true,
        title: "Change Progress",
        message: `This will move your reading progress to the start of ${book.name}. Are you sure?`,
        onConfirm: performJump
      });
    } else {
      performJump();
    }
  }, [state.progress, user, dispatch, setConfirmDialog, setSelectingCategoryId]);

  const toggleBookCompletion = useCallback((categoryId: string, bookName: string) => {
    const key = `${categoryId}:${bookName}`;
    const isCompleted = state.completedBooks.has(key);
    
    dispatch({ type: 'TOGGLE_BOOK', key });
    triggerHaptic(isCompleted ? 'light' : 'heavy');
    
    if (user) {
      if (isCompleted) {
        deleteCompletedBook(user.uid, categoryId, bookName);
      } else {
        writeCompletedBook(user.uid, categoryId, bookName);
      }
    }
  }, [state.completedBooks, user, dispatch]);

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
        const newState: AppState = {
          ...state,
          progress: CATEGORIES.map(cat => ({ categoryId: cat.id, bookIndex: 0, chapter: 1, lastReadAt: resetDate })),
          settings: { ...state.settings, startDate: resetDate },
          completedBooks: new Set<string>()
        };
        dispatch({ type: 'REPLACE_STATE', state: newState });
        if (user) {
          await resetUserData(user.uid).catch(e => console.error("Reset sync failed:", e));
        }
        showToast("Plan restarted!", "success");
      }
    });
  }, [state, user, dispatch, setConfirmDialog, showToast]);

  return {
    advanceChapter,
    jumpToBook,
    toggleBookCompletion,
    saveProverbJournal,
    deleteJournal,
    resetProgress
  };
}
