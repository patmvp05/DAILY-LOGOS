/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Security-rules tests for the sprints collection, run against the real
 * Firestore emulator so the deployed ruleset is proven, not assumed.
 *
 * A sprint doc is written per-hour with merge:true, so these also confirm that
 * an incremental hour write passes validation (rules see the MERGED document,
 * not just the delta).
 *
 * Requires Java. Run with:
 *   npx firebase emulators:exec --only firestore "npx tsx scripts/test-rules-sprints.mts"
 */
import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function check(name: string, run: () => Promise<unknown>) {
  try { await run(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}: ${(e as Error).message.split('\n')[0]}`); }
}

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [emuHost, emuPort] = host.split(':');

const env: RulesTestEnvironment = await initializeTestEnvironment({
  projectId: 'daily-logos-rules-test',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: emuHost,
    port: Number(emuPort),
  },
});

const ME = 'user_me';
const OTHER = 'user_other';
const mine = env.authenticatedContext(ME).firestore();
const theirs = env.authenticatedContext(OTHER).firestore();
const anon = env.unauthenticatedContext().firestore();

const sprintRef = (db: ReturnType<typeof env.authenticatedContext>['firestore'] extends () => infer R ? R : never, uid: string, date: string) =>
  doc(db as never, 'users', uid, 'sprints', date);

const DATE = '2026-08-06';

// ── Owner can create and incrementally update their own sprint
await check('owner creates a sprint (single hour, merge)', () =>
  assertSucceeds(setDoc(sprintRef(mine, ME, DATE), {
    date: DATE,
    hours: { '0': { done: true, reference: 'John 1' } },
  }, { merge: true })));

await check('owner merges a second hour without resending the first', () =>
  assertSucceeds(setDoc(sprintRef(mine, ME, DATE), {
    date: DATE,
    hours: { '5': { done: true, reference: '' } },
  }, { merge: true })));

await check('merge really preserved the first hour', async () => {
  const snap = await getDoc(sprintRef(mine, ME, DATE));
  const hours = (snap.data() as { hours: Record<string, { done: boolean }> }).hours;
  if (!hours['0']?.done || !hours['5']?.done) {
    throw new Error('expected both hours 0 and 5, got ' + JSON.stringify(hours));
  }
});

await check('owner can read their sprint', () =>
  assertSucceeds(getDoc(sprintRef(mine, ME, DATE))));

await check('owner can delete (clear) their sprint', () =>
  assertSucceeds(deleteDoc(sprintRef(mine, ME, DATE))));

// ── Isolation
await check('another signed-in user cannot write my sprint', () =>
  assertFails(setDoc(sprintRef(theirs, ME, DATE), {
    date: DATE, hours: { '1': { done: true } },
  })));

await check('another signed-in user cannot read my sprint', () =>
  assertFails(getDoc(sprintRef(theirs, ME, DATE))));

await check('anonymous cannot write a sprint', () =>
  assertFails(setDoc(sprintRef(anon, ME, DATE), {
    date: DATE, hours: { '1': { done: true } },
  })));

// ── Shape validation
await check('rejects a doc with no hours field', () =>
  assertFails(setDoc(sprintRef(mine, ME, '2026-08-07'), { date: '2026-08-07' })));

await check('rejects a doc with no date field', () =>
  assertFails(setDoc(sprintRef(mine, ME, '2026-08-08'), { hours: { '1': { done: true } } })));

await check('rejects hours that is not a map', () =>
  assertFails(setDoc(sprintRef(mine, ME, '2026-08-09'), { date: '2026-08-09', hours: 'nope' })));

await check('rejects more than 24 hour entries', () => {
  const hours: Record<string, { done: boolean }> = {};
  for (let i = 0; i < 30; i++) hours[String(i)] = { done: true };
  return assertFails(setDoc(sprintRef(mine, ME, '2026-08-10'), { date: '2026-08-10', hours }));
});

await check('accepts a full 24-hour day', () => {
  const hours: Record<string, { done: boolean }> = {};
  for (let i = 0; i < 24; i++) hours[String(i)] = { done: true };
  return assertSucceeds(setDoc(sprintRef(mine, ME, '2026-08-11'), { date: '2026-08-11', hours }));
});

await env.cleanup();

console.log('');
if (fail === 0) {
  console.log(`RULES-SPRINTS PASS ${pass} / ${pass}`);
} else {
  console.log(`RULES-SPRINTS FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
