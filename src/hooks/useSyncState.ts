/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { syncTracker } from '../lib/sync';
import { useFirestoreSync } from './useFirestoreSync';

import { type User } from 'firebase/auth';
import { type AppAction } from '../state/appReducer';

export function useSyncState(user: User | null, dispatch: React.Dispatch<AppAction>) {
  const [writeSyncStatus, setWriteSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle' | 'offline'>('idle');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [showSyncCheck, setShowSyncCheck] = useState(false);

  // Deriving global sync status
  const syncStatus = useMemo(() => {
    if (writeSyncStatus === 'offline') return 'offline';
    if (writeSyncStatus === 'syncing' || cloudSyncStatus === 'syncing') return 'syncing';
    if (writeSyncStatus === 'error' || cloudSyncStatus === 'error') return 'error';
    return (writeSyncStatus === 'synced' || cloudSyncStatus === 'synced') ? 'synced' : 'idle';
  }, [writeSyncStatus, cloudSyncStatus]);

  useEffect(() => {
    const unsub = syncTracker.subscribe((status) => {
      setWriteSyncStatus(status);
      if (status === 'synced') {
        setLastSyncTime(new Date());
        setShowSyncCheck(true);
        setTimeout(() => setShowSyncCheck(false), 3000);
      }
    });
    return unsub;
  }, []);

  const onFirestoreSyncStatusChange = useCallback((status: 'idle' | 'syncing' | 'synced' | 'error') => {
    setCloudSyncStatus(status);
    if (status === 'synced') {
      setLastSyncTime(new Date());
    }
  }, []);

  useFirestoreSync(user, dispatch, onFirestoreSyncStatusChange);

  return {
    syncStatus,
    lastSyncTime,
    showSyncCheck
  };
}
