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
      startDate: new Date().toISOString(),
      theme: 'system',
      userName: ''
    }
  });
  const [debouncedState, setDebouncedState] = React.useState(state);

  const hydrated = React.useRef(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedState(state);
    }, 500);
    return () => clearTimeout(handler);
  }, [state]);

  // Sync state to local storage
  useEffect(() => {
    saveState(debouncedState);
  }, [debouncedState]);

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
        // We only restore from snapshot if the current state is empty
        if (state.history.length === 0) {
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
      }
    }
    hydrate();
  }, [dispatch, state.history.length]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
