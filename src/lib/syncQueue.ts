/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';

const QUEUE_KEY = 'daily_logos_sync_queue';

export interface PendingAction {
  id: string;
  type: 'writeActionBatch' | 'writeCompletedBook' | 'deleteCompletedBook' | 'writeJournal' | 'deleteJournal' | 'setUserSettings' | 'resetUserData';
  payload: unknown[];
  path: string; // Used for deduplication
  timestamp: number;
}

export async function addToSyncQueue(action: Omit<PendingAction, 'id' | 'timestamp'>) {
  const queue = await getSyncQueue();
  
  // Deduplication: Remove older actions targeting the same entity
  const filtered = queue.filter(a => a.path !== action.path);
  
  const newAction: PendingAction = {
    ...action,
    id: Math.random().toString(36).substring(2, 11),
    timestamp: Date.now(),
  };
  
  filtered.push(newAction);
  await set(QUEUE_KEY, filtered);
  console.log(`[SyncQueue] Added action: ${action.type} for path: ${action.path}`);
}

export async function getSyncQueue(): Promise<PendingAction[]> {
  try {
    const queue = await get(QUEUE_KEY);
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

export async function clearSyncQueue() {
  await set(QUEUE_KEY, []);
}

export async function removeFromSyncQueue(id: string) {
  const queue = await getSyncQueue();
  const filtered = queue.filter(a => a.id !== id);
  await set(QUEUE_KEY, filtered);
}
