/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { syncTracker } from '../lib/sync';
import { useFirestoreSync } from './useFirestoreSync';

export function useSyncState(user: any, dispatch: any) {
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle' | 'offline'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [showSyncCheck, setShowSyncCheck] = useState(false);

  useEffect(() => {
    const unsub = syncTracker.subscribe((status) => {
      setSyncStatus(status);
      if (status === 'synced') {
        setLastSyncTime(new Date());
        setShowSyncCheck(true);
        setTimeout(() => setShowSyncCheck(false), 3000);
      }
    });
    return unsub;
  }, []);

  const onFirestoreSyncStatusChange = useCallback((status: 'idle' | 'syncing' | 'synced' | 'error') => {
    setSyncStatus(prev => prev === 'idle' ? status : prev);
    // Note: lastSyncTime is handled in syncTracker subscription above for logic consistency
  }, []);

  useFirestoreSync(user, dispatch, onFirestoreSyncStatusChange);

  return {
    syncStatus,
    lastSyncTime,
    showSyncCheck
  };
}
