/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  getDocsFromCache,
  getDocs,
  CollectionReference,
  Query,
  Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Simple check to see if we have valid config
const isConfigValid = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'placeholder';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Local dev/testing against the Firebase emulator suite (see firebase.json).
// Enable with VITE_USE_FIREBASE_EMULATOR=true (e.g. in .env.local).
const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// Initialize Firestore with persistent local cache for offline-first behavior.
// The emulator skips the persistent cache (it conflicts with connectFirestoreEmulator,
// which must run before any other Firestore call) and uses a plain in-memory instance.
let db: Firestore;
if (useEmulator) {
  db = getFirestore(app);
} else if (isConfigValid) {
  try {
    // If we're using the placeholder, this might fail or be useless, but it prevents the build error
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    }, (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)');
  } catch (e) {
    console.warn("Firestore persistent cache failed, falling back to basic init:", e);
    db = getFirestore(app, (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)');
  }
} else {
  // Graceful fallback for demo/no-config mode
  console.warn("Firebase config is placeholder or missing. Firestore features disabled.");
  db = getFirestore(app);
}
export { db };

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  console.info('[firebase] Connected to local emulator suite (auth:9099, firestore:8080)');
}

/**
 * Cache-first collection/query fetcher.
 */
export async function getDocsCacheFirst<T>(colOrQuery: CollectionReference<T> | Query<T>) {
  try {
    const snap = await getDocsFromCache(colOrQuery);
    // If we got metadata that says it's from cache and we have docs, we are good
    if (!snap.empty) return snap;
    throw new Error("Cache empty");
  } catch {
    return await getDocs(colOrQuery);
  }
}

// Ensure persistence is set to local storage for better stability on Safari
setPersistence(auth, browserLocalPersistence).catch(err => console.error("Persistence failed:", err));

const googleProvider = new GoogleAuthProvider();

// Step 1: Firestore-safe ID helper
export const bookKeyToDocId = (key: string): string => {
  // Replace anything not a-z, A-Z, 0-9, _, - with _
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export const signInWithGoogle = async (useRedirect = false) => {
  // Installed (Home Screen) PWAs can't host popups reliably; use redirect there.
  const isStandalonePWA = window.matchMedia?.('(display-mode: standalone)')?.matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (useRedirect || isStandalonePWA) {
    return await signInWithRedirect(auth, googleProvider);
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    // The user deliberately closed the popup or it never opened due to a duplicate
    // request - don't mask that with a redirect, just surface it.
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw error;
    }
    // Safari (especially iOS) frequently fails popup-based auth with errors like
    // auth/popup-blocked or auth/internal-error due to storage partitioning.
    // Redirect is reliable because authDomain matches the hosting origin.
    console.warn('Popup sign-in failed, falling back to redirect:', error);
    return await signInWithRedirect(auth, googleProvider);
  }
};

export const handleRedirectResult = async () => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error) {
    console.error('Error getting redirect result:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};

// Global helpers for Firestore structure based on firebase-blueprint.json
export const getUserRef = (userId: string) => doc(db, 'users', userId);
export const getProgressCollection = (userId: string) => collection(db, 'users', userId, 'progress');
export const getHistoryCollection = (userId: string) => collection(db, 'users', userId, 'history');
export const getJournalsCollection = (userId: string) => collection(db, 'users', userId, 'journals');
export const getDevotionalsCollection = (userId: string) => collection(db, 'users', userId, 'devotionals');
export const getCompletedBooksCollection = (userId: string) => collection(db, 'users', userId, 'completedBooks');
// 24-hour sprints, one doc per calendar date (doc id = 'yyyy-MM-dd').
export const getSprintsCollection = (userId: string) => collection(db, 'users', userId, 'sprints');
