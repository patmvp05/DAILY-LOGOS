/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Firebase web app configuration.
//
// These values are PUBLIC client identifiers, not secrets — they ship inside
// every browser bundle and are safe in version control. Data access is
// enforced by Firestore security rules, never by hiding this config.
// See https://firebase.google.com/docs/projects/api-keys
//
// DO NOT move this back into firebase-applet-config.json: automated tooling
// repeatedly deletes that file as "sensitive", which breaks the app's entire
// Firebase connection (no auth, no sync, data appears lost).
export const firebaseConfig = {
  apiKey: 'AIzaSyDGGSap5c9rkxlTT3NUPy9KvBjWYJSckXI',
  authDomain: 'gen-lang-client-0538747272.firebaseapp.com',
  projectId: 'gen-lang-client-0538747272',
  storageBucket: 'gen-lang-client-0538747272.firebasestorage.app',
  messagingSenderId: '886059962409',
  appId: '1:886059962409:web:18454a9d8709713eb9cc38',
  measurementId: '',
  // CRITICAL: all user data lives in this named Firestore database.
  // Omitting this makes the app target '(default)', which does not exist
  // in this project — sync fails and user data appears lost.
  firestoreDatabaseId: 'ai-studio-a46f4fd8-5659-438f-bae6-32f259d36ce9',
};

export default firebaseConfig;
