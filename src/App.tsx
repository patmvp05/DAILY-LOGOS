/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect } from 'react';
import { Monitor, Cloud } from 'lucide-react';
import { format } from 'date-fns';

// Libs
import { cn } from './lib/utils';
import { setUserSettings } from './lib/sync';

// State & Contexts
import { useApp } from './state/AppContextCore';
import { useUi } from './state/UiContextCore';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useScrollLock } from './hooks/useScrollLock';
import { useSyncState } from './hooks/useSyncState';
import { usePrefersDark } from './hooks/usePrefersDark';

// Components
import { Navbar } from './components/Navbar';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { Onboarding } from './components/Onboarding';

const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const AppModals = React.lazy(() => import('./components/AppModals').then(m => ({ default: m.AppModals })));

export default function App() {
  console.log("[App] Rendering...");
  const { state, dispatch } = useApp();
  const { 
    showSettings, setShowSettings, showHistory, setShowHistory, 
    activePlanCategory, setActivePlanCategory, 
    selectingCategoryId, setSelectingCategoryId, 
    activeDevotion, setActiveDevotion,
    showProverbModal, setShowProverbModal, isStartMenuOpen, setIsStartMenuOpen, confirmDialog, setConfirmDialog,
    closeConfirmDialog, toast, setToast, showToast, setJournalDraft,
    setSyncStatus, setLastSyncTime, setShowSyncCheck,
    syncStatus, lastSyncTime, showSyncCheck
  } = useUi();

  const { user, loading: isAuthLoading, login, logout } = useAuth();
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [bypassCloudSync, setBypassCloudSync] = React.useState(false);
  const [showOfflineBypassOption, setShowOfflineBypassOption] = React.useState(false);

  const sync = useSyncState(user, dispatch);
  const isHydrated = state.isCloudHydrated || (!user && !isAuthLoading);

  const prefersDark = usePrefersDark();
  
  useTheme(state.settings.theme);

  useEffect(() => {
    if (user && sync.syncStatus === 'synced') {
      setBypassCloudSync(false);
    }
  }, [user, sync.syncStatus]);

  useEffect(() => {
    const isActuallyLoading = isAuthLoading || (user && sync.syncStatus === 'syncing' && !state.isCloudHydrated);
    if (isActuallyLoading && !bypassCloudSync) {
      const timer = setTimeout(() => {
        setShowOfflineBypassOption(true);
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      setShowOfflineBypassOption(false);
    }
  }, [isAuthLoading, user, sync.syncStatus, state.isCloudHydrated, bypassCloudSync]);

  useEffect(() => {
    setSyncStatus(sync.syncStatus);
    setLastSyncTime(sync.lastSyncTime);
    setShowSyncCheck(sync.showSyncCheck);
  }, [sync.syncStatus, sync.lastSyncTime, sync.showSyncCheck, setSyncStatus, setLastSyncTime, setShowSyncCheck]);

  // Handle lack of startDate (Onboarding)
  const needsOnboarding = user && isHydrated && !state.settings.startDate;

  const handleSetInitialDate = useCallback((date: string) => {
    dispatch({ type: 'SET_START_DATE', date });
    if (user) {
      // CRITICAL: We must send a complete UserSettings object (theme + startDate) 
      // for the initial document creation to pass Firestore rules.
      setUserSettings(user.uid, { 
        startDate: date,
        theme: state.settings.theme || 'system'
      });
    }
  }, [user, dispatch, state.settings.theme]);

  const isLoadingCloud = !bypassCloudSync && (isAuthLoading || (user && syncStatus === 'syncing' && !state.isCloudHydrated));

  const handleLoginLocal = useCallback(async function loginFn(useRedirect = false) {
    setIsSigningIn(true);
    try { await login(useRedirect); } 
    catch (err) {
      const error = err as { code?: string; message?: string };
      const errStr = JSON.stringify(error).toLowerCase() + ' ' + String(error.message).toLowerCase() + ' ' + String(error.code).toLowerCase();
      
      const isPopupOrIFrameIssue = 
        error.code === 'auth/popup-blocked' || 
        error.code === 'auth/internal-error' || 
        error.code === 'auth/iframe-start-failed' || 
        error.code === 'auth/cancelled-popup-request' ||
        errStr.includes('popup') || 
        errStr.includes('internal-error') || 
        errStr.includes('iframe');

      if (isPopupOrIFrameIssue && !useRedirect) {
        showToast("Popup blocked or failed! Try redirect.", "info");
        setConfirmDialog({
          isOpen: true,
          title: "Alternative Sign-In Required",
          message: "iPad and Safari block popups & third-party state by default. To log in successfully:\n\n1. Make sure you opened the app in its own tab (use the Shared or Dev link).\n2. Select YES to use standard Redirect Sign-in.",
          onConfirm: () => {
            // Delay slightly to let dialog close, then run redirect auth
            setTimeout(() => {
              loginFn(true);
            }, 300);
          }
        });
      } else {
        showToast(`Login failed: ${error.message || 'Check your connection'}`, "error");
        if (isPopupOrIFrameIssue) {
          setConfirmDialog({
            isOpen: true,
            title: "Sign-In Troubleshooting",
            message: "Authentication is failing. Due to iPad security guidelines, please open this app in an independent tab (not in an iframe), and ensure Safari's 'Prevent Cross-Site Tracking' under iPad Settings -> Safari is toggled off if problems persist.",
            onConfirm: () => {}
          });
        }
      }
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
    if (state.isCloudHydrated) {
      showToast("Reading history synced from cloud.", "success");
      dispatch({ type: 'CLEAR_SYNC_FLAGS' });
    } else if (state.restoredFromSnapshot) {
      showToast("Restored your reading history from local backup.", "info");
      dispatch({ type: 'CLEAR_SYNC_FLAGS' });
    }
  }, [state.isCloudHydrated, state.restoredFromSnapshot, showToast, dispatch]);

  const toggleTheme = useCallback(() => {
    const themes: ('light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook')[] = ['light', 'dark', 'system', 'xp', 'audible', 'textbook'];
    const currentIndex = themes.indexOf(state.settings.theme);
    const newTheme = themes[(currentIndex + 1) % themes.length];
    dispatch({ type: 'SET_THEME', theme: newTheme });
    if (user && state.isCloudHydrated) {
      setUserSettings(user.uid, { theme: newTheme });
    }
  }, [state.settings.theme, state.isCloudHydrated, user, dispatch]);

  if (isLoadingCloud) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--audible-bg)] p-6 text-center">
        <div className="w-12 h-12 border-4 border-evernote border-t-transparent rounded-full animate-spin mb-4 animate-in duration-300" />
        {syncStatus === 'error' ? (
          <div className="text-center animate-in fade-in duration-500 max-w-sm">
            <p className="text-sm font-black uppercase tracking-widest text-red-500 mb-2 font-sans md:text-base">
              Connection timeout
            </p>
            <p className="text-xs text-[var(--audible-text-secondary)] font-bold mb-6 leading-relaxed tracking-tight">
              Due to iPad/Safari restrictions or offline network conditions, cloud sync could not be completed immediately. You can retry, or continue offline using your local cached data.
            </p>
            <div className="flex flex-col gap-3 justify-center items-center w-full px-4">
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-evernote text-white px-6 py-2.5 rounded-lg font-black uppercase tracking-wider text-[10px] hover:scale-105 active:scale-95 transition-transform shadow-md cursor-pointer outline-none"
              >
                Retry Connection
              </button>
              <button 
                onClick={() => setBypassCloudSync(true)}
                className="w-full border border-[var(--audible-border)] bg-[var(--audible-card)] text-[var(--audible-text-primary)] px-6 py-2.5 rounded-lg font-black uppercase tracking-wider text-[10px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer outline-none"
              >
                Continue Offline
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center animate-in fade-in duration-500 max-w-sm flex flex-col items-center px-4">
            <p className="text-[10px] uppercase tracking-[0.25em] font-black text-[var(--audible-text-secondary)] animate-pulse mb-2">
              Connecting to Cloud...
            </p>
            {showOfflineBypassOption && (
              <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <button 
                  onClick={() => setBypassCloudSync(true)}
                  className="border border-[var(--audible-border)] bg-[var(--audible-card)] text-[var(--audible-text-primary)] px-5 py-2.5 rounded-lg font-black uppercase tracking-wider text-[10px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer outline-none"
                >
                  Continue Offline
                </button>
                <p className="text-[9px] text-[var(--audible-text-secondary)] mt-2 font-bold max-w-xs leading-relaxed mx-auto">
                  Take too long? Sync will continue safely in the background while you read.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("min-h-[100dvh] transition-colors duration-300", state.settings.theme === 'xp' ? "theme-xp" : state.settings.theme === 'textbook' ? "theme-textbook" : "bg-[var(--audible-bg)] text-[var(--audible-text-primary)]", state.settings.theme === 'dark' && "dark", state.settings.theme === 'audible' && "audible", (state.settings.theme === 'audible' || state.settings.theme === 'system') && prefersDark && "dark")}>
      <Navbar user={user} syncStatus={syncStatus} lastSyncTime={lastSyncTime} showSyncCheck={showSyncCheck} handleLogin={handleLoginLocal} logout={logout} toggleTheme={toggleTheme} theme={state.settings.theme} setShowHistory={setShowHistory} setShowSettings={setShowSettings} startDate={state.settings.startDate} isSigningIn={isSigningIn} isAuthLoading={isAuthLoading} />
      <main className="pt-20 pb-20">
        {needsOnboarding ? (
          <Onboarding onComplete={handleSetInitialDate} />
        ) : (
          <React.Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-4 border-evernote border-t-transparent rounded-full animate-spin" /></div>}>
            <Dashboard handleLogin={handleLoginLocal} isSigningIn={isSigningIn} user={user} isAuthLoading={isAuthLoading} />
          </React.Suspense>
        )}
      </main>
      <React.Suspense fallback={null}>
        <AppModals isSigningIn={isSigningIn} />
      </React.Suspense>
      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onClose={closeConfirmDialog} />
      <Toast message={toast?.message || null} type={toast?.type} onClear={() => setToast(null)} />
      {state.settings.theme === 'xp' && (
        <div className="xp-taskbar"><button className="xp-start-button" onClick={() => setIsStartMenuOpen(!isStartMenuOpen)}><Monitor size={16} /> start</button><div className="ml-auto px-4 flex items-center gap-4 text-white text-[11px] font-bold"><div className="flex items-center gap-2"><Cloud size={12} className={syncStatus === 'synced' ? "text-green-400" : "text-amber-400"} />{syncStatus.toUpperCase()}</div><div className="border-l border-white/20 pl-4">{format(new Date(), 'h:mm a')}</div></div></div>
      )}
    </div>
  );
}
