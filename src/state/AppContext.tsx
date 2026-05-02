/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useReducer, useEffect, useMemo } from 'react';
import type { ReactNode, Dispatch } from 'react';
import { AppState } from '../types';
import { appReducer, AppAction } from './appReducer';
import { loadState, saveState, loadStateAsync, loadHistorySnapshot } from '../lib/storage';
import { useDebounce } from '../hooks/useDebounce';
import { processSyncQueue } from '../lib/sync';
import { prefetchProverbs } from '../lib/proverbCache';

interface AppContextType {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, loadState);
  const debouncedState = useDebounce(state, 500);

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
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppContextProvider');
  }
  return context;
}
