/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Lightweight on-device diagnostics log. Captures device/browser info and key
// lifecycle events (auth, sync, service worker) so issues that only happen on
// a specific phone/browser can be reproduced and diagnosed remotely.
//
// Stored in localStorage as a ring buffer (works even when Firestore writes
// fail, e.g. during a network error during sign-in) and best-effort mirrored
// to Firestore's `clientLogs` collection for remote inspection.

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getLastSyncError, describeSyncError } from './sync';

const STORAGE_KEY = 'logos_diagnostics_v1';
const MAX_ENTRIES = 60;
const MAX_REMOTE_PER_SESSION = 20;

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  ts: string;
  level: DiagnosticLevel;
  category: string;
  message: string;
  detail?: string;
}

export function getDeviceInfo() {
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return {
    ua: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    standalone,
    online: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    cookiesEnabled: navigator.cookieEnabled,
  };
}

function readLog(): DiagnosticEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as DiagnosticEntry[] : [];
  } catch {
    return [];
  }
}

function writeLog(entries: DiagnosticEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // localStorage unavailable (e.g. private browsing) - in-memory only for this session
  }
}

function safeDetail(detail: unknown): string | undefined {
  if (detail === undefined) return undefined;
  try {
    if (detail instanceof Error) {
      const code = (detail as unknown as { code?: string }).code;
      return JSON.stringify({ name: detail.name, message: detail.message, code });
    }
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

let remoteCount = 0;

export function logDiagnostic(category: string, level: DiagnosticLevel, message: string, detail?: unknown) {
  const entry: DiagnosticEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message: String(message).slice(0, 500),
    detail: safeDetail(detail)?.slice(0, 1000),
  };

  writeLog([...readLog(), entry]);

  // Mirror to Firestore so issues can be diagnosed without needing the device
  // in hand. Best-effort: never throw, never block the caller, capped per session.
  if (remoteCount < MAX_REMOTE_PER_SESSION) {
    remoteCount++;
    addDoc(collection(db, 'clientLogs'), {
      ts: serverTimestamp(),
      clientTs: entry.ts,
      level: entry.level,
      category: entry.category,
      message: entry.message,
      ...(entry.detail ? { detail: entry.detail } : {}),
      uid: auth.currentUser?.uid || null,
      appVersion: __APP_VERSION__,
      device: getDeviceInfo(),
    }).catch(() => {});
  }
}

/** Human-readable report a user can copy/paste or share for support. */
export function getDiagnosticReport(): string {
  const entries = readLog();
  const lines = [
    'The Daily Logos — Diagnostic Report',
    `Generated: ${new Date().toISOString()}`,
    `App version: ${__APP_VERSION__}`,
    `Signed in: ${auth.currentUser ? `yes (${auth.currentUser.uid.slice(0, 6)}…)` : 'no'}`,
    `Last sync error: ${(() => {
      const f = getLastSyncError();
      return f ? `${describeSyncError(f)} [at ${f.at}] ${f.message}` : 'none';
    })()}`,
    `Device: ${JSON.stringify(getDeviceInfo())}`,
    '',
    '--- Recent events (oldest first) ---',
    ...(entries.length
      ? entries.map(e => `[${e.ts}] ${e.level.toUpperCase()} ${e.category}: ${e.message}${e.detail ? ' | ' + e.detail : ''}`)
      : ['(no events recorded yet)']),
  ];
  return lines.join('\n');
}

export function clearDiagnostics() {
  writeLog([]);
}
