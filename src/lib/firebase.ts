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
  deleteDoc, 
  writeBatch, 
  onSnapshot 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  }, firebaseConfig.firestoreDatabaseId || '(default)');
} catch (e) {
  console.warn("Firestore persistent cache failed, falling back to memory:", e);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
}
export { db };

// Ensure persistence is set to local storage for better stability on Safari
setPersistence(auth, browserLocalPersistence).catch(err => console.error("Persistence failed:", err));

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Step 1: Firestore-safe ID helper
export const bookKeyToDocId = (key: string): string => {
  // Replace anything not a-z, A-Z, 0-9, _, - with _
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export const signInWithGoogle = async (useRedirect = false) => {
  try {
    if (useRedirect) {
      return await signInWithRedirect(auth, googleProvider);
    }
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
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
