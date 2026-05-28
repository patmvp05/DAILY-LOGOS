/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { appReducer } from './appReducer';
import { saveState, loadState, loadStateAsync, loadHistorySnapshot, saveStateSync } from '../lib/storage';
import { processSyncQueue } from '../lib/sync';
import { prefetchProverbs } from '../lib/proverbCache';
import { AppContext } from './AppContextCore';

export function AppContextProvider({ children }: { children: ReactNode }) {
  console.log("[AppContextProvider] Rendering...");
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

  // Network and Wake/Resume listener for sync
  useEffect(() => {
    const triggerSync = () => {
      if (navigator.onLine) {
        console.log("[AppContext] Resume or online trigger: processing sync...");
        processSyncQueue();
        prefetchProverbs();
      }
    };

    window.addEventListener('online', triggerSync);
    window.addEventListener('focus', triggerSync);
    
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Initial check
    triggerSync();

    return () => {
      window.removeEventListener('online', triggerSync);
      window.removeEventListener('focus', triggerSync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Async Hydration from IndexedDB + Snapshot check
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    async function hydrate() {
      try {
        const idbState = await loadStateAsync();
        if (idbState) {
          dispatch({ type: 'HYDRATE_STATE', state: idbState });
        }

        // Snapshot safety net check
        // We only restore from snapshot if the current history is empty
        // We check against the LATEST state by looking at what was loaded or initial
        if (!idbState || !idbState.history || idbState.history.length === 0) {
          const snapshot = await loadHistorySnapshot();
          if (snapshot && snapshot.data.length > 0) {
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            if (snapshot.timestamp > thirtyDaysAgo) {
              dispatch({ 
                type: 'HYDRATE_STATE', 
                state: { history: snapshot.data },
                restoredFromSnapshot: true 
              });
            }
          }
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
