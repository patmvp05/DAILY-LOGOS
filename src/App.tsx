/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect } from 'react';
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

  const sync = useSyncState(user, dispatch, state);
  const isHydrated = state.isCloudHydrated || (!user && !isAuthLoading);

  const prefersDark = usePrefersDark();

  useTheme(state.settings.theme);

  // Apply the typography preference as a data attribute on <html>; the CSS in
  // index.css swaps the body/heading font stacks when it's "editorial".
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.typography === 'editorial') {
      root.setAttribute('data-typography', 'editorial');
    } else {
      root.removeAttribute('data-typography');
    }
  }, [state.settings.typography]);

  useEffect(() => {
    setSyncStatus(sync.syncStatus);
    setLastSyncTime(sync.lastSyncTime);
    setShowSyncCheck(sync.showSyncCheck);
  }, [sync.syncStatus, sync.lastSyncTime, sync.showSyncCheck, setSyncStatus, setLastSyncTime, setShowSyncCheck]);

  // Handle lack of startDate (Onboarding) — applies to guests too, since
  // dayNumber/"Day N" tracking needs a startDate regardless of sign-in state.
  const needsOnboarding = isHydrated && !state.settings.startDate;

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


  const handleLoginLocal = useCallback(async function loginFn(useRedirect = false) {
    setIsSigningIn(true);
    try { 
      await login(useRedirect);
    } 
    catch (err) {
      const error = err as { code?: string; message?: string };
      const errStr = JSON.stringify(error).toLowerCase() + ' ' + String(error.message).toLowerCase() + ' ' + String(error.code).toLowerCase();
      
      const isUnauthorizedDomain = error.code === 'auth/unauthorized-domain' || errStr.includes('unauthorized-domain');
      const isPopupBlocked = error.code === 'auth/popup-blocked' || errStr.includes('popup');

      if (isUnauthorizedDomain) {
        setConfirmDialog({
          isOpen: true,
          title: "Firebase Domain Setup Required",
          message: `Google Sign-In is blocked from this preview URL. To fix:\n1. Open Firebase Console\n2. Go to Authentication -> Settings -> Authorized domains\n3. Add: ${window.location.hostname}`,
          confirmLabel: "Open Firebase Console",
          cancelLabel: "Close",
          type: "info",
          confirmHref: "https://console.firebase.google.com/project/_/authentication/settings",
          onConfirm: () => {}
        });
      } else if (isPopupBlocked || window.self !== window.top) {
        setConfirmDialog({
          isOpen: true,
          title: "Login Restricted in Preview",
          message: "Google login cannot open from inside this preview window. Please open the app in a completely new tab to login.",
          confirmLabel: "Open New Tab",
          cancelLabel: "Cancel",
          type: "info",
          confirmHref: window.location.href,
          onConfirm: () => {}
        });
      } else {
        showToast(`Login failed: ${error.message || errStr}`, "error");
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
  
  const toggleTheme = useCallback(() => {
    // Only the three themes that produce a distinct, defined appearance are in
    // the cycle. The legacy 'xp'/'audible'/'textbook' values all resolve to the
    // same OS-driven look as 'system' (see useTheme), so cycling through them
    // looked broken (four clicks with no visible change). The type still allows
    // them so any previously stored/synced value renders fine; a toggle just
    // moves the user into this 3-state cycle (indexOf === -1 → 'light').
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(state.settings.theme as 'light' | 'dark' | 'system');
    const newTheme = themes[(currentIndex + 1) % themes.length];
    dispatch({ type: 'SET_THEME', theme: newTheme });
    if (user) {
      setUserSettings(user.uid, { theme: newTheme });
    }
  }, [state.settings.theme, user, dispatch]);

  return (
    <div className={cn("min-h-[100dvh] transition-colors duration-300", "bg-[var(--bg-secondary)] text-[var(--text-primary)]", state.settings.theme === 'dark' && "dark", state.settings.theme === 'system' && prefersDark && "dark")}>
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
        <AppModals isSigningIn={isSigningIn} handleLogin={handleLoginLocal} />
      </React.Suspense>
      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onClose={closeConfirmDialog} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} type={confirmDialog.type} confirmHref={confirmDialog.confirmHref} />
      <Toast message={toast?.message || null} type={toast?.type} onClear={() => setToast(null)} />
    </div>
  );
}
