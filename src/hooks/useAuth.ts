/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, signInWithGoogle, handleRedirectResult, logout as firebaseLogout } from '../lib/firebase';
import { logDiagnostic } from '../lib/diagnostics';

const AUTH_SESSION_HINT_KEY = 'dl_has_auth_session';

function readAuthSessionHint(): boolean {
  try {
    return localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAuthSessionHint(signedIn: boolean) {
  try {
    if (signedIn) {
      localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
    } else {
      localStorage.removeItem(AUTH_SESSION_HINT_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

type AuthSnapshot = {
  user: User | null;
  loading: boolean;
};

let sharedState: AuthSnapshot = {
  user: auth.currentUser,
  loading: auth.currentUser === null,
};

let initialized = false;
const listeners = new Set<(snap: AuthSnapshot) => void>();

function emitAuth(next: AuthSnapshot) {
  sharedState = next;
  listeners.forEach((l) => l(sharedState));
}

function ensureAuthInitialized() {
  if (initialized) return;
  initialized = true;

  // If a previous signed-in session is known to be restoring, wait longer so
  // the app never flashes the signed-out UI while IndexedDB auth is loading.
  const hasSessionHint = readAuthSessionHint();
  const timeoutMs = hasSessionHint ? 10000 : 2500;

  const safetyTimeout = setTimeout(() => {
    if (sharedState.loading) {
      logDiagnostic('auth', 'warn', `Auth init timed out after ${timeoutMs}ms, falling back to guest state`);
      emitAuth({ user: sharedState.user, loading: false });
    }
  }, timeoutMs);

  handleRedirectResult()
    .then((result) => {
      if (result) {
        clearTimeout(safetyTimeout);
        writeAuthSessionHint(true);
        logDiagnostic('auth', 'info', 'Redirect sign-in completed', { uid: result.uid.slice(0, 6) });
        emitAuth({ user: result, loading: false });
      }
    })
    .catch((err) => {
      console.error('Redirect error during init:', err);
      logDiagnostic('auth', 'error', 'Redirect sign-in failed', err);
    });

  onAuthStateChanged(auth, (currentUser) => {
    clearTimeout(safetyTimeout);
    writeAuthSessionHint(!!currentUser);
    logDiagnostic('auth', 'info', currentUser ? 'Auth state: signed in' : 'Auth state: signed out');
    emitAuth({ user: currentUser, loading: false });
  });
}

function subscribeAuth(listener: () => void) {
  ensureAuthInitialized();
  const wrapped = () => listener();
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

function getAuthSnapshot(): AuthSnapshot {
  ensureAuthInitialized();
  return sharedState;
}

export function useAuth() {
  const snap = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  const login = async (useRedirect = false) => {
    logDiagnostic('auth', 'info', `Sign-in attempt (${useRedirect ? 'redirect' : 'popup'})`);
    try {
      await signInWithGoogle(useRedirect);
    } catch (error) {
      console.error('Login failed:', error);
      logDiagnostic('auth', 'error', 'Sign-in failed', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      writeAuthSessionHint(false);
      await firebaseLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  };

  return { user: snap.user, loading: snap.loading, login, logout };
}
