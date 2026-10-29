/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';

/**
 * The results of the on-phone chapter checks (src/lib/chapterCheck.ts), so the
 * dashboard can say "next 49 chapters checked today" and name any chapter that
 * failed. Kept in localStorage per device; losing it only means the summary
 * re-fills as chapters are checked again on the next launch.
 */
export interface TextCheckEntry {
  ok: boolean;
  at: number; // epoch ms of the most recent check
  problems?: string[];
}

const STORAGE_KEY = 'dl_text_checks_v1';
const MAX_ENTRIES = 600;

let entries: Record<string, TextCheckEntry> = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): Record<string, TextCheckEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TextCheckEntry>) : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => entries[a].at - entries[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete entries[k]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable: the in-memory log still serves this session
  }
}

// A launch re-checks ~50 chapters in a burst: write storage once afterwards.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 1000);
}

export function textCheckKey(versionId: string, bookName: string, chapter: number): string {
  return `${versionId}|${bookName}|${chapter}`;
}

export function recordTextCheck(key: string, ok: boolean, problems: string[] = []) {
  entries = { ...entries, [key]: ok ? { ok, at: Date.now() } : { ok, at: Date.now(), problems } };
  schedulePersist();
  version++;
  listeners.forEach((l) => l());
}

export function getTextCheck(key: string): TextCheckEntry | undefined {
  return entries[key];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders the caller whenever a new check result is recorded. */
export function useTextCheckVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Test seam. */
export function _resetTextChecks() {
  entries = {};
  version++;
}
