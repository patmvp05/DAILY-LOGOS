/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Monitor, Cloud } from 'lucide-react';
import { format } from 'date-fns';

// Libs
import { cn } from './lib/utils';
import { setUserSettings } from './lib/sync';
import { BOOK_READ_MINUTES, DEFAULT_BOOK_MINUTES } from './constants';

// State & Contexts
import { useApp } from './state/AppContext';
import { useUi } from './state/UiContext';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useScrollLock } from './hooks/useScrollLock';
import { useReadingActions } from './hooks/useReadingActions';
import { useAppStats } from './hooks/useAppStats';
import { useSyncState } from './hooks/useSyncState';
import { useProverb } from './hooks/useProverb';
import { usePrefersDark } from './hooks/usePrefersDark';

// Components
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { AppModals } from './components/AppModals';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function App() {
  const { state, dispatch } = useApp();
  const { 
    showSettings, setShowSettings, showHistory, setShowHistory, 
    activePlanCategory, setActivePlanCategory, 
    selectingCategoryId, setSelectingCategoryId, 
    activeDevotion, setActiveDevotion,
    showProverbModal, setShowProverbModal, isStartMenuOpen, setIsStartMenuOpen, confirmDialog, setConfirmDialog,
    closeConfirmDialog, toast, setToast, showToast, setJournalDraft
  } = useUi();

  const { user, loading: isAuthLoading, login, logout } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const dayOfMonth = new Date().getDate();

  const { syncStatus, lastSyncTime, showSyncCheck } = useSyncState(user, dispatch);
  const { proverbSnippet, proverbContent, isFetchingProverb } = useProverb(dayOfMonth);
  const { streak, dayNumber, overallProgress, lastReadProgress } = useAppStats(state);
  const { advanceChapter } = useReadingActions(state, dispatch, user);
  const prefersDark = usePrefersDark();

  const todayReadingStats = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const todayEntries = state.history.filter(
      h => h.timestamp.split('T')[0] === todayKey
    );
    const minutes = todayEntries.reduce((sum, h) => {
      const perCh = BOOK_READ_MINUTES[h.bookName] ?? DEFAULT_BOOK_MINUTES;
      return sum + perCh;
    }, 0);
    return { minutes, chapterCount: todayEntries.length, entries: todayEntries };
  }, [state.history]);

  useTheme(state.settings.theme);

  // PWA Support
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      showToast("A new version of Daily Logos is available!", "info", {
        label: "Update Now",
        onClick: () => {
          updateServiceWorker(true);
          setNeedRefresh(false);
        }
      });
    }
  }, [needRefresh, showToast, updateServiceWorker, setNeedRefresh]);

  const handleLoginLocal = useCallback(async function loginFn(useRedirect = false) {
    setIsSigningIn(true);
    try { await login(useRedirect); } 
    catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        showToast("Popup blocked! Try alternative login.", "error");
        setConfirmDialog({
          isOpen: true, title: "Alternative Login", message: "The sign-in window was blocked. Try redirect mode?",
          onConfirm: () => loginFn(true)
        });
      } else showToast(`Login failed: ${error.message || 'Check your connection'}`, "error");
    } finally { setIsSigningIn(false); }
  }, [login, showToast, setConfirmDialog]);

  useKeyboardShortcuts({
    onSearch: () => {},
    onNewJournal: () => { setJournalDraft({ id: null, content: '', verse: '' }); setShowProverbModal(true); },
    onClose: () => {
      setShowSettings(false); setShowHistory(false); setActivePlanCategory(null); setSelectingCategoryId(null);
      setActiveDevotion(null); setShowProverbModal(false); setIsStartMenuOpen(false);
    }
  });

  useScrollLock(showSettings || showHistory || !!activePlanCategory || !!selectingCategoryId || !!activeDevotion || showProverbModal || isStartMenuOpen);
  
  useEffect(() => {
    if (state.restoredFromSnapshot) {
      showToast("Restored your reading history from local backup.", "info");
      dispatch({ type: 'CLEAR_RESTORED_FLAG' });
    }
  }, [state.restoredFromSnapshot, showToast, dispatch]);

  const toggleTheme = useCallback(() => {
    const themes: ('light' | 'dark' | 'system' | 'xp' | 'audible')[] = ['light', 'dark', 'system', 'xp', 'audible'];
    const currentIndex = themes.indexOf(state.settings.theme);
    const newTheme = themes[(currentIndex + 1) % themes.length];
    dispatch({ type: 'SET_THEME', theme: newTheme });
    if (user) {
      setUserSettings(user.uid, { theme: newTheme, startDate: state.settings.startDate });
    }
  }, [state.settings.theme, state.settings.startDate, user, dispatch]);

  const handleShowProverbModal = useCallback((val: boolean) => {
    if (val) setJournalDraft({ id: null, content: '', verse: '' });
    setShowProverbModal(val);
  }, [setJournalDraft, setShowProverbModal]);

  return (
    <div className={cn("min-h-[100dvh] transition-colors duration-300", state.settings.theme === 'xp' ? "theme-xp" : "bg-[var(--audible-bg)] text-[var(--audible-text-primary)]", state.settings.theme === 'dark' && "dark", state.settings.theme === 'audible' && "audible", (state.settings.theme === 'audible' || state.settings.theme === 'system') && prefersDark && "dark")}>
      <Navbar user={user} syncStatus={syncStatus} lastSyncTime={lastSyncTime} showSyncCheck={showSyncCheck} handleLogin={handleLoginLocal} logout={logout} toggleTheme={toggleTheme} theme={state.settings.theme} setShowHistory={setShowHistory} setShowSettings={setShowSettings} startDate={state.settings.startDate} isDeveloper={user?.email === 'patmvp05@gmail.com'} isSigningIn={isSigningIn} isAuthLoading={isAuthLoading} />
      <main className="pt-20 pb-20">
        <Dashboard todayReadingStats={todayReadingStats} dayNumber={dayNumber} streak={streak} overallProgress={overallProgress} lastReadProgress={lastReadProgress} proverbSnippet={proverbSnippet} dayOfMonth={dayOfMonth} state={state} syncStatus={syncStatus} user={user} isAuthLoading={isAuthLoading} isSigningIn={isSigningIn} handleLogin={handleLoginLocal} advanceChapter={advanceChapter} setActivePlanCategory={setActivePlanCategory} setSelectingCategoryId={setSelectingCategoryId} setActiveDevotion={setActiveDevotion} setShowProverbModal={handleShowProverbModal} />
      </main>
      <AppModals syncStatus={syncStatus} lastSyncTime={lastSyncTime} showSyncCheck={showSyncCheck} isSigningIn={isSigningIn} proverbContent={proverbContent} isFetchingProverb={isFetchingProverb} dayOfMonth={dayOfMonth} />
      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onClose={closeConfirmDialog} />
      <Toast message={toast?.message || null} type={toast?.type} onClear={() => setToast(null)} />
      {state.settings.theme === 'xp' && (
        <div className="xp-taskbar"><button className="xp-start-button" onClick={() => setIsStartMenuOpen(!isStartMenuOpen)}><Monitor size={16} /> start</button><div className="ml-auto px-4 flex items-center gap-4 text-white text-[11px] font-bold"><div className="flex items-center gap-2"><Cloud size={12} className={syncStatus === 'synced' ? "text-green-400" : "text-amber-400"} />{syncStatus.toUpperCase()}</div><div className="border-l border-white/20 pl-4">{format(new Date(), 'h:mm a')}</div></div></div>
      )}
    </div>
  );
}
