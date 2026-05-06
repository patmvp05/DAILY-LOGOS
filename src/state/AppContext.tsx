/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { appReducer } from './appReducer';
import { saveState, loadStateAsync, loadHistorySnapshot } from '../lib/storage';
import { processSyncQueue } from '../lib/sync';
import { prefetchProverbs } from '../lib/proverbCache';
import { AppContext } from './AppContextCore';

export function AppContextProvider({ children }: { children: ReactNode }) {
  console.log("[AppContextProvider] Rendering...");
  // Use a strictly static initial state first to rule out any issues with loadState
  const [state, dispatch] = React.useReducer(appReducer, {
    progress: [],
    history: [],
    completedBooks: new Set(),
    proverbJournals: [],
    customDevotionals: [],
    settings: {
      startDate: '',
      theme: 'system',
      userName: ''
    }
  });
  const [debouncedState, setDebouncedState] = React.useState(state);
  const [hasHydrated, setHasHydrated] = React.useState(false);

  const hydrated = React.useRef(false);

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

  // Network listener for sync
  useEffect(() => {
    const handleOnline = () => {
      console.log("[AppContext] Back online, triggering sync...");
      processSyncQueue();
    };

    window.addEventListener('online', handleOnline);
    // Initial check
    if (navigator.onLine) {
      processSyncQueue();
      prefetchProverbs();
    }

    return () => window.removeEventListener('online', handleOnline);
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
