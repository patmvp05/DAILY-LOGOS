/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, signInWithGoogle, handleRedirectResult, logout as firebaseLogout } from '../lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribed = false;

    const initAuth = async () => {
      try {
        // Check redirect result on mount
        const result = await handleRedirectResult();
        if (result && !unsubscribed) {
          setUser(result);
        }
      } catch (err) {
        console.error("Redirect error during init:", err);
      } finally {
        // Only stop loading once onAuthStateChanged also fires
      }
    };

    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (!unsubscribed) {
        setUser(currentUser);
        setLoading(false);
      }
    });

    return () => {
      unsubscribed = true;
      unsubscribeAuth();
    };
  }, []);

  const login = async (useRedirect = false) => {
    try {
      await signInWithGoogle(useRedirect);
    } catch (error) {
      console.error("Login failed:", error);
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
