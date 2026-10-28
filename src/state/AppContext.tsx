/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { appReducer } from './appReducer';
import { saveState, loadState, loadStateAsync, saveStateSync, hasStoredStateSync } from '../lib/storage';
import { prefetchProverbs } from '../lib/proverbCache';
import { prefetchBibleChapters } from '../lib/prefetchBible';
import { prefetchDevotionals } from '../lib/devotionalContent';
import { AppContext } from './AppContextCore';

export function AppContextProvider({ children }: { children: ReactNode }) {
  // Initialize state synchronously with loadState() so the very first paint
  // already has the full persisted state from localStorage.
  const [state, dispatch] = React.useReducer(appReducer, undefined, loadState);
  const [hasHydrated, setHasHydrated] = React.useState(() => hasStoredStateSync());

  const hydrated = React.useRef(false);
  
  // Track the absolute newest state reference for immediate flush writes on exit/freeze
  const stateRef = React.useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist state to localStorage immediately when hydrated so a reload or
  // next launch never sees a stale pre-hydration snapshot on first paint.
  useEffect(() => {
    if (hasHydrated) {
      saveState(state);
    }
  }, [state, hasHydrated]);

  // Flush state synchronously on visibility hidden, pagehide, and beforeunload
  // (Prevents silent iOS/Safari state freezes and loss of progress)
  useEffect(() => {
    const handleExitFlush = () => {
      if (hasHydrated) {
        console.log("[AppContext] Synchronous exit flush: writing current state...");
        saveStateSync(stateRef.current);
      }
    };

    window.addEventListener('pagehide', handleExitFlush);
    window.addEventListener('beforeunload', handleExitFlush);

    const handleVisibilityExit = () => {
      if (document.visibilityState === 'hidden') {
        handleExitFlush();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityExit);

    return () => {
      window.removeEventListener('pagehide', handleExitFlush);
      window.removeEventListener('beforeunload', handleExitFlush);
      document.removeEventListener('visibilitychange', handleVisibilityExit);
    };
  }, [hasHydrated]);

  // Prefetch proverb content when online, in the selected Bible version.
  // Re-runs when the version changes so the warmed cache always matches.
  const bibleVersion = state.settings.bibleVersion;
  useEffect(() => {
    const triggerPrefetch = () => {
      if (navigator.onLine) prefetchProverbs(bibleVersion);
    };
    window.addEventListener('online', triggerPrefetch);
    triggerPrefetch();
    return () => window.removeEventListener('online', triggerPrefetch);
  }, [bibleVersion]);

  useEffect(() => {
    const triggerPrefetch = () => {
      if (navigator.onLine) prefetchDevotionals();
    };
    window.addEventListener('online', triggerPrefetch);
    triggerPrefetch();
    return () => window.removeEventListener('online', triggerPrefetch);
  }, []);

  // Warm the cache 7 chapters ahead of the user's position in every category,
  // in their selected version, so the reader opens instantly and works offline.
  // Waits for hydration (so we prefetch from real progress, not the initial
  // defaults), debounces rapid progress changes, and re-warms when coming back
  // online. prefetchBibleChapters is idempotent — cached chapters are no-ops.
  useEffect(() => {
    if (!hasHydrated) return;
    const triggerPrefetch = () => {
      if (navigator.onLine) prefetchBibleChapters(stateRef.current.progress, bibleVersion);
    };
    const timer = setTimeout(triggerPrefetch, 2000);
    window.addEventListener('online', triggerPrefetch);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', triggerPrefetch);
    };
  }, [hasHydrated, state.progress, bibleVersion]);

  // Async fallback hydration from IndexedDB (only needed when localStorage was empty)
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    if (hasStoredStateSync()) {
      return;
    }

    async function hydrate() {
      try {
        const idbState = await loadStateAsync();
        if (idbState) {
          dispatch({ type: 'HYDRATE_STATE', state: idbState });
        }
      } catch (e) {
        console.warn("Hydration failed:", e);
      } finally {
        setHasHydrated(true);
      }
    }
    hydrate();
  }, [dispatch]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
