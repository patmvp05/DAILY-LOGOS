/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';
import { HistoryEntry } from '../types';

const QUEUE_KEY = 'daily_logos_sync_queue';

export interface PendingAction {
  id: string;
  type: 'writeActionBatch' | 'writeCompletedBook' | 'deleteCompletedBook' | 'writeJournal' | 'deleteJournal' | 'setUserSettings' | 'resetUserData' | 'writeDevotional' | 'deleteDevotional';
  payload: unknown[];
  path: string; // Used for deduplication
  timestamp: number;
}

export async function addToSyncQueue(action: Omit<PendingAction, 'id' | 'timestamp'>) {
  const queue = await getSyncQueue();
  
  // Find duplicate action targeting the same entity / path
  const duplicate = queue.find(a => a.path === action.path && a.type === action.type);
  
  if (duplicate && action.type === 'writeActionBatch') {
    // Merge the duplicate's actions payload into the incoming action payload to maintain a lossless history log
    const oldPayloadActions = duplicate.payload[1] as {
      progress?: unknown;
      history?: HistoryEntry | HistoryEntry[];
      completedBooks?: { categoryId: string; bookName: string }[];
      deletedBooks?: { categoryId: string; bookName: string }[];
    } | undefined;

    const newPayloadActions = action.payload[1] as {
      progress?: unknown;
      history?: HistoryEntry | HistoryEntry[];
      completedBooks?: { categoryId: string; bookName: string }[];
      deletedBooks?: { categoryId: string; bookName: string }[];
    } | undefined;

    if (newPayloadActions) {
      // 1. Merge and deduplicate History Entries
      const oldHistory = oldPayloadActions?.history 
        ? (Array.isArray(oldPayloadActions.history) ? oldPayloadActions.history : [oldPayloadActions.history])
        : [];
      const newHistory = newPayloadActions.history
        ? (Array.isArray(newPayloadActions.history) ? newPayloadActions.history : [newPayloadActions.history])
        : [];
      const combinedHistory = [...oldHistory, ...newHistory];
      
      const finalHistoryMap = new Map<string, HistoryEntry>();
      combinedHistory.forEach((h) => {
        if (h && h.id) {
          finalHistoryMap.set(h.id, h);
        }
      });
      newPayloadActions.history = Array.from(finalHistoryMap.values());

      // 2. Merge and deduplicate completedBooks
      const oldCompleted = oldPayloadActions?.completedBooks || [];
      const newCompleted = newPayloadActions.completedBooks || [];
      const combinedCompleted = [...oldCompleted, ...newCompleted];
      
      const finalCompletedMap = new Map<string, { categoryId: string; bookName: string }>();
      combinedCompleted.forEach((b) => {
        if (b && b.categoryId && b.bookName) {
          finalCompletedMap.set(`${b.categoryId}:${b.bookName}`, b);
        }
      });
      newPayloadActions.completedBooks = Array.from(finalCompletedMap.values());

      // 3. Merge and deduplicate deletedBooks
      const oldDeleted = oldPayloadActions?.deletedBooks || [];
      const newDeleted = newPayloadActions.deletedBooks || [];
      const combinedDeleted = [...oldDeleted, ...newDeleted];
      
      const finalDeletedMap = new Map<string, { categoryId: string; bookName: string }>();
      combinedDeleted.forEach((b) => {
        if (b && b.categoryId && b.bookName) {
          finalDeletedMap.set(`${b.categoryId}:${b.bookName}`, b);
        }
      });
      newPayloadActions.deletedBooks = Array.from(finalDeletedMap.values());
    }
  }

  // Deduplication: Remove older actions targeting the same entity
  const filtered = queue.filter(a => a.path !== action.path);
  
  const newAction: PendingAction = {
    ...action,
    id: Math.random().toString(36).substring(2, 11),
    timestamp: Date.now(),
  };
  
  filtered.push(newAction);
  await set(QUEUE_KEY, filtered);
  console.log(`[SyncQueue] Added action: ${action.type} for path: ${action.path} (merged history logs successfully)`);
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
