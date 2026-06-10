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
  browserLocalPersistence
} from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  getFirestore,
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

// Initialize Firestore with persistent local cache for offline-first behavior
let db: Firestore;
if (isConfigValid) {
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
    // Safari and in-app browsers often block the popup; redirect is reliable
    // because authDomain matches the hosting origin.
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      return await signInWithRedirect(auth, googleProvider);
    }
    console.error('Error signing in with Google:', error);
    throw error;
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
