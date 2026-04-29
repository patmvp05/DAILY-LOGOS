/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { syncTracker } from '../lib/sync';
import { useFirestoreSync } from './useFirestoreSync';

export function useSyncState(user: any, dispatch: any) {
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle'>('idle');
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

  useFirestoreSync(user, dispatch, (status) => {
    setSyncStatus(prev => prev === 'idle' ? status : prev);
    if (status === 'synced' && syncStatus === 'idle') {
      setLastSyncTime(new Date());
    }
  });

  return {
    syncStatus,
    lastSyncTime,
    showSyncCheck
  };
}
