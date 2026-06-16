/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { appReducer } from './appReducer';
import { saveState, loadState, loadStateAsync, saveStateSync } from '../lib/storage';
import { prefetchProverbs } from '../lib/proverbCache';
import { AppContext } from './AppContextCore';

export function AppContextProvider({ children }: { children: ReactNode }) {
  // Initialize state synchronously with loadState() to provide robust defaults prior to IndexedDB/Cloud hydration
  const [state, dispatch] = React.useReducer(appReducer, loadState());
  const [debouncedState, setDebouncedState] = React.useState(state);
  const [hasHydrated, setHasHydrated] = React.useState(false);

  const hydrated = React.useRef(false);
  
  // Track the absolute newest state reference for immediate flush writes on exit/freeze
  const stateRef = React.useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Buffer state changes for storage
  useEffect(() => {
    if (!hasHydrated) return; // Prevent initial 'Today' state from overwriting saved state before it loads
    const handler = setTimeout(() => {
      setDebouncedState(state);
    }, 500);
    return () => clearTimeout(handler);
  }, [state, hasHydrated]);

  // Sync state to local storage
  useEffect(() => {
    if (hasHydrated) {
      saveState(debouncedState);
    }
  }, [debouncedState, hasHydrated]);

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

  // Async hydration from IndexedDB
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

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
