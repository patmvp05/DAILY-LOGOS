/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runs the real Firestore rules against the documents the app now writes for
 * the "My Devotionals" list. Needs the emulator (and Java):
 *   npm run test:rules-devotionals
 */
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { toDevotionalDoc, MAX_DEVOTIONAL_URL_LENGTH } from '../src/lib/devotionalSync';
import { DEFAULT_DEVOTIONALS } from '../src/lib/storage';

const env = await initializeTestEnvironment({
  projectId: 'daily-logos-devotionals-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
let pass = 0, fail = 0;
async function check(name: string, p: Promise<unknown>) {
  try { await p; pass++; } catch (e) { fail++; console.error(`✗ ${name}: ${(e as Error).message.split('\n')[0]}`); }
}

const me = env.authenticatedContext('u1').firestore();
const other = env.authenticatedContext('u2').firestore();
const col = (db: typeof me, id: string) => doc(db, 'users', 'u1', 'devotionals', id);

// The seed: every built-in in one batch, the way the first snapshot uploads them.
await check('the owner can seed all built-ins in one batch', assertSucceeds((async () => {
  const b = writeBatch(me);
  DEFAULT_DEVOTIONALS.forEach((d) => b.set(col(me, d.id), toDevotionalDoc(d)));
  await b.commit();
})()));
await check('a custom entry with a UUID id is accepted',
  assertSucceeds(setDoc(col(me, 'f47ac10b-58cc-4372-a567-0e02b2c3d479'), toDevotionalDoc({ id: 'x', name: 'N', description: '', url: 'https://x.test' }))));
await check('an empty description is accepted',
  assertSucceeds(setDoc(col(me, 'e1'), { name: 'N', description: '', url: 'https://x.test' })));
await check('the owner can delete one', assertSucceeds(deleteDoc(col(me, 'daily-bread'))));
await check('a URL of exactly the cap is accepted',
  assertSucceeds(setDoc(col(me, 'e2'), { name: 'N', description: 'd', url: 'h'.repeat(MAX_DEVOTIONAL_URL_LENGTH) })));
await check('a URL one over the cap is refused',
  assertFails(setDoc(col(me, 'e3'), { name: 'N', description: 'd', url: 'h'.repeat(MAX_DEVOTIONAL_URL_LENGTH + 1) })));
await check('an id written inside the document is refused (exactly 3 keys)',
  assertFails(setDoc(col(me, 'e4'), { id: 'e4', name: 'N', description: 'd', url: 'u' })));
await check('another user cannot write to it', assertFails(setDoc(col(other, 'e5'), { name: 'N', description: 'd', url: 'u' })));

await env.cleanup();
console.log(fail === 0 ? `RULES-DEVOTIONALS PASS ${pass} / ${pass}` : `RULES-DEVOTIONALS FAIL ${fail} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
