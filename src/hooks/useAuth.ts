/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, signInWithGoogle, handleRedirectResult, logout as firebaseLogout } from '../lib/firebase';
import { initializeUser } from '../lib/sync';
import { logDiagnostic } from '../lib/diagnostics';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribed = false;

    // Safety timeout: If Firebase Auth takes longer than 2500ms to resolve (typical on iPad Safari or standalone PWAs with restricted ITP),
    // trigger a fallback to the non-blocking local state so the user is not locked out of the application.
    const safetyTimeout = setTimeout(() => {
      if (!unsubscribed) {
        console.warn("[useAuth] Firebase Auth initialization timed out. Defaulting to local/guest state.");
        logDiagnostic('auth', 'warn', 'Auth init timed out after 2500ms, falling back to guest state');
        setLoading(false);
      }
    }, 2500);

    const initAuth = async () => {
      try {
        // Check redirect result on mount
        const result = await handleRedirectResult();
        if (result && !unsubscribed) {
          logDiagnostic('auth', 'info', 'Redirect sign-in completed', { uid: result.uid.slice(0, 6) });
          await initializeUser(result);
          setUser(result);
        }
      } catch (err) {
        console.error("Redirect error during init:", err);
        logDiagnostic('auth', 'error', 'Redirect sign-in failed', err);
      } finally {
        // Stop loading handled by onAuthStateChanged
      }
    };

    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!unsubscribed) {
        clearTimeout(safetyTimeout);
        if (currentUser) {
          try {
            await initializeUser(currentUser);
          } catch (e) {
            console.error("Failed to initialize user document:", e);
            logDiagnostic('auth', 'error', 'initializeUser failed', e);
          }
        }
        logDiagnostic('auth', 'info', currentUser ? 'Auth state: signed in' : 'Auth state: signed out');
        setUser(currentUser);
        setLoading(false);
      }
    });

    return () => {
      unsubscribed = true;
      clearTimeout(safetyTimeout);
      unsubscribeAuth();
    };
  }, []);

  const login = async (useRedirect = false) => {
    logDiagnostic('auth', 'info', `Sign-in attempt (${useRedirect ? 'redirect' : 'popup'})`);
    try {
      await signInWithGoogle(useRedirect);
    } catch (error) {
      console.error("Login failed:", error);
      logDiagnostic('auth', 'error', 'Sign-in failed', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await firebaseLogout();
    } catch (error) {
      console.error("Logout failed:", error);
      throw error;
    }
  };

  return { user, loading, login, logout };
}
