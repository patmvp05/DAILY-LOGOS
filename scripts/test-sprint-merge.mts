/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two-device merge test for sprint sync, against the Firestore emulator.
 *
 * The failure this guards against: device A ticks hour 3, device B (which has
 * not seen that yet) ticks hour 5. If the write sent the whole `hours` map,
 * B's write would erase hour 3. Per-hour writes with merge:true must keep both.
 *
 * Run via: npm run test:rules-merge
 */
import { readFileSync } from 'fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, type Firestore } from 'firebase/firestore';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
};

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [h, p] = host.split(':');
const env: RulesTestEnvironment = await initializeTestEnvironment({
  projectId: 'daily-logos-merge-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: h, port: Number(p) },
});

const UID = 'reader';
// Two independent clients = two devices signed in as the same user.
const deviceA = env.authenticatedContext(UID).firestore() as unknown as Firestore;
const deviceB = env.authenticatedContext(UID).firestore() as unknown as Firestore;
const DATE = '2026-08-06';
const ref = (db: Firestore) => doc(db, 'users', UID, 'sprints', DATE);

// Mirrors lib/sync.ts writeSprintHour exactly.
const writeHour = (db: Firestore, hour: number, done: boolean, reference = '') =>
  setDoc(ref(db), { date: DATE, hours: { [String(hour)]: { done, reference } } }, { merge: true });

// A ticks hour 3. B — without ever reading that — ticks hour 5.
await writeHour(deviceA, 3, true, 'Psalm 3');
await writeHour(deviceB, 5, true, 'Psalm 5');

{
  const snap = await getDoc(ref(deviceA));
  const hours = (snap.data() as { hours: Record<string, { done: boolean; reference: string }> }).hours;
  ok('device A hour 3 survives B write', hours['3']?.done === true, JSON.stringify(hours));
  ok('device B hour 5 present', hours['5']?.done === true);
  ok('references preserved per hour',
     hours['3']?.reference === 'Psalm 3' && hours['5']?.reference === 'Psalm 5');
  ok('exactly two hours recorded', Object.keys(hours).length === 2, JSON.stringify(Object.keys(hours)));
}

// Un-ticking on one device must propagate (not be treated as "missing").
await writeHour(deviceB, 3, false, 'Psalm 3');
{
  const hours = ((await getDoc(ref(deviceA))).data() as { hours: Record<string, { done: boolean }> }).hours;
  ok('un-tick propagates across devices', hours['3']?.done === false);
  ok('un-tick does not disturb the other hour', hours['5']?.done === true);
}

// Filling all 24 hours from alternating devices stays within the rules cap.
for (let i = 0; i < 24; i++) await writeHour(i % 2 ? deviceA : deviceB, i, true);
{
  const hours = ((await getDoc(ref(deviceA))).data() as { hours: Record<string, unknown> }).hours;
  ok('a full 24-hour day accumulates across both devices', Object.keys(hours).length === 24,
     `got ${Object.keys(hours).length}`);
}

// Clear removes it for everyone.
await deleteDoc(ref(deviceA));
ok('clear deletes the day for all devices', !(await getDoc(ref(deviceB))).exists());

// ── Full round trip through the real reducer: device A ticks, device B sees it.
// This is the symptom the user reported — a tick on the phone never appearing
// on the iPad. It failed when the write path re-read state to discover what to
// upload and got the pre-toggle value (done:false), so the cloud contradicted
// the screen and B received an un-ticked hour.
{
  const { appReducer, getSprintHour } = await import('../src/state/appReducer');
  const blank = () => ({
    progress: [], settings: { theme: 'system' as const, startDate: '' }, history: [],
    proverbJournals: [], customDevotionals: [], scriptureSprints: [],
    completedBooks: new Set<string>(),
  });
  const DAY = '2026-09-09';
  const dref = doc(deviceA, 'users', UID, 'sprints', DAY);

  // Device A: exactly what useReadingActions.toggleSprintHour does.
  let a = blank();
  const prev = getSprintHour(a.scriptureSprints, DAY, 8);
  const uploaded = { ...prev, done: !prev.done, reference: 'Isaiah 8' };
  a = appReducer(a, { type: 'SET_SPRINT_HOUR', date: DAY, hour: 8, slot: uploaded });
  await setDoc(dref, { date: DAY, hours: { '8': { done: uploaded.done, reference: uploaded.reference ?? '' } } }, { merge: true });

  ok('A shows the hour ticked', getSprintHour(a.scriptureSprints, DAY, 8).done === true);

  // Device B: read the cloud and run it through CLOUD_SYNC_SPRINTS.
  const snap = await getDoc(doc(deviceB, 'users', UID, 'sprints', DAY));
  const raw = snap.data() as { date: string; hours: Record<string, { done?: boolean; reference?: string }> };
  const hours: Record<string, { done: boolean; reference?: string }> = {};
  for (const [k, v] of Object.entries(raw.hours)) hours[k] = { done: !!v?.done, reference: v?.reference || undefined };
  let b = blank();
  b = appReducer(b, { type: 'CLOUD_SYNC_SPRINTS', sprints: [{ date: raw.date, hours }] });

  ok('B receives the tick from A', getSprintHour(b.scriptureSprints, DAY, 8).done === true,
     JSON.stringify(b.scriptureSprints));
  ok('B receives the reference too', getSprintHour(b.scriptureSprints, DAY, 8).reference === 'Isaiah 8');

  // And A must not be reverted when its own snapshot echoes back.
  a = appReducer(a, { type: 'CLOUD_SYNC_SPRINTS', sprints: [{ date: raw.date, hours }] });
  ok('A is not reverted by the echo of its own write',
     getSprintHour(a.scriptureSprints, DAY, 8).done === true);
}

await env.cleanup();
console.log('');
if (fail === 0) console.log(`SPRINT-MERGE PASS ${pass} / ${pass}`);
else { console.log(`SPRINT-MERGE FAIL ${fail} / ${pass + fail}`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
