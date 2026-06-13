/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone scenario harness for progress conflict resolution + the sync
 * reconciliation decision. Run with: npx tsx scripts/test-conflict.mts
 */
import { resolveProgressConflict, appReducer, HISTORY_CAP } from '../src/state/appReducer';
import { calculateNextProgress } from '../src/lib/bible';
import type { Progress, AppState, HistoryEntry, ProverbJournal } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function p(categoryId: string, bookIndex: number, chapter: number, atMillis: number): Progress {
  return { categoryId, bookIndex, chapter, updatedAtMillis: atMillis, lastReadAt: new Date(atMillis).toISOString() };
}

/** winner identity: 'local' | 'cloud' by reference */
function expectWinner(name: string, local: Progress, cloud: Progress, want: 'local' | 'cloud') {
  const w = resolveProgressConflict(local, cloud);
  const got = w === local ? 'local' : w === cloud ? 'cloud' : 'other';
  if (got === want) { pass++; }
  else { fail++; failures.push(`✗ ${name}: wanted ${want}, got ${got} (book ${w.bookIndex} ch ${w.chapter})`); }
}

/**
 * Mirrors the reconciliation rule in useFirestoreSync: should we re-push local?
 * We push when the conflict winner is NOT reflected by the cloud snapshot.
 */
function shouldRepush(local: Progress, cloud: Progress | undefined): boolean {
  const winner = cloud ? resolveProgressConflict(local, cloud) : local;
  const cloudReflectsWinner = cloud && winner.bookIndex === cloud.bookIndex && winner.chapter === cloud.chapter;
  return !cloudReflectsWinner;
}
function expectRepush(name: string, local: Progress, cloud: Progress | undefined, want: boolean) {
  const got = shouldRepush(local, cloud);
  if (got === want) { pass++; }
  else { fail++; failures.push(`✗ ${name}: wanted repush=${want}, got ${got}`); }
}

const T = 1_700_000_000_000; // arbitrary base time
const MIN = 60_000;

// ── Conflict resolution ────────────────────────────────────────────────
// 1. Same position, cloud newer → cloud (metadata alignment)
expectWinner('same-pos cloud newer', p('a', 2, 5, T), p('a', 2, 5, T + 1000), 'cloud');
// 2. Same position, local newer → local
expectWinner('same-pos local newer', p('a', 2, 5, T + 1000), p('a', 2, 5, T), 'local');
// 3. Local further, near-simultaneous (offline conflict) → local (forward wins)
expectWinner('local further, recent', p('a', 3, 1, T + 1000), p('a', 2, 8, T), 'local');
// 4. Cloud further, near-simultaneous → cloud
expectWinner('cloud further, recent', p('a', 2, 8, T), p('a', 3, 1, T + 1000), 'cloud');
// 5. RESET: local is far ahead but cloud is a deliberate reset 10min later → cloud wins
expectWinner('reset: cloud newer & behind', p('a', 30, 12, T), p('a', 0, 1, T + 10 * MIN), 'cloud');
// 6. JUMP BACKWARD on this device: local newer & behind → local wins
expectWinner('jump back: local newer & behind', p('a', 0, 1, T + 10 * MIN), p('a', 30, 12, T), 'local');
// 7. Stale device ahead, cloud only slightly newer (within 5min, drift) → furthest (local)
expectWinner('drift: local ahead, cloud +2min', p('a', 5, 3, T), p('a', 5, 1, T + 2 * MIN), 'local');
// 8. Reset boundary: gap exactly 5min is NOT > 5min → falls to furthest (local stays)
expectWinner('boundary: exactly 5min gap', p('a', 9, 9, T), p('a', 0, 1, T + 5 * MIN), 'local');
// 9. Reset boundary: gap 5min+1ms → cloud (reset) wins
expectWinner('boundary: 5min+1ms gap', p('a', 9, 9, T), p('a', 0, 1, T + 5 * MIN + 1), 'cloud');
// 10. Identical everything → local (no change)
expectWinner('identical', p('a', 4, 4, T), p('a', 4, 4, T), 'local');
// 11. Both zero timestamps, local further → local
expectWinner('no timestamps, local further', p('a', 6, 1, 0), p('a', 5, 9, 0), 'local');
// 12. Forward progress hours later (normal reading next day) local ahead+newer → local
expectWinner('next-day forward', p('a', 6, 1, T + 24 * 60 * MIN), p('a', 5, 9, T), 'local');

// ── Reconciliation (silent-write-loss recovery) ───────────────────────
// 13. Cloud missing this category entirely → push local
expectRepush('cloud missing category', p('a', 2, 5, T), undefined, true);
// 14. Local further & recent, cloud behind → push (silent write lost)
expectRepush('local further recent → push', p('a', 3, 1, T + 1000), p('a', 2, 8, T), true);
// 15. Cloud already reflects local exactly → no push
expectRepush('cloud == local → no push', p('a', 3, 1, T), p('a', 3, 1, T), false);
// 16. Cloud is further (other device synced ahead) → no push
expectRepush('cloud further → no push', p('a', 2, 8, T), p('a', 3, 1, T + 1000), false);
// 17. RESET propagated: cloud reset is newer; local stale ahead → NO push (don't undo reset!)
expectRepush('reset wins → no push of stale local', p('a', 30, 12, T), p('a', 0, 1, T + 10 * MIN), false);
// 18. Local jump-back is newer → cloud stale ahead → push our jump
expectRepush('local jump newer → push', p('a', 0, 1, T + 10 * MIN), p('a', 30, 12, T), true);

// ── Round 2: stress the silent-loss vs genuine-reset distinction ──────
// 19. Long-offline silent loss: device read forward 30min ago, write never
//     landed; cloud still holds the older synced position. local ahead & newer
//     by >5min → local wins & we re-push (recovery), reset is NOT mistaken.
expectWinner('long-offline ahead+newer', p('a', 7, 2, T + 30 * MIN), p('a', 5, 4, T), 'local');
expectRepush('long-offline → push recovery', p('a', 7, 2, T + 30 * MIN), p('a', 5, 4, T), true);
// 20. Genuine reset from another device, propagated long ago: cloud behind &
//     newer by >5min → cloud wins, local stale-ahead must NOT be re-pushed.
expectWinner('genuine reset wins over stale', p('a', 40, 3, T), p('a', 0, 1, T + 30 * MIN), 'cloud');
expectRepush('genuine reset → no stale push', p('a', 40, 3, T), p('a', 0, 1, T + 30 * MIN), false);
// 21. Same-position-but-local-newer should NOT churn a redundant write.
expectRepush('same pos, local newer → no churn', p('a', 5, 5, T + 1000), p('a', 5, 5, T), false);
// 22. Zero-timestamp local ahead vs cloud reset with real timestamp:
//     gap = (T+10min) - 0 is huge → cloud (the timestamped reset) wins.
expectWinner('no-ts local vs timestamped reset', p('a', 12, 1, 0), p('a', 0, 1, T), 'cloud');

// ── History reconciliation: push only ids the cloud is missing ────────
function historyMissing(localIds: string[], cloudIds: string[]): string[] {
  const cloud = new Set(cloudIds);
  return localIds.filter(id => !cloud.has(id));
}
function expectMissing(name: string, localIds: string[], cloudIds: string[], want: string[]) {
  const got = historyMissing(localIds, cloudIds);
  const ok = got.length === want.length && got.every((g, i) => g === want[i]);
  if (ok) { pass++; }
  else { fail++; failures.push(`✗ ${name}: wanted [${want}], got [${got}]`); }
}
// 23. Local has an entry the cloud lost → push just that one.
expectMissing('history: one missing', ['h1', 'h2', 'h3'], ['h1', 'h3'], ['h2']);
// 24. Cloud has everything local has (and more) → push nothing.
expectMissing('history: cloud superset', ['h1', 'h2'], ['h1', 'h2', 'h9'], []);
// 25. Fully diverged → push all local-only.
expectMissing('history: all missing', ['a', 'b'], [], ['a', 'b']);
// 26. Identical → push nothing.
expectMissing('history: identical', ['a', 'b'], ['b', 'a'], []);

// ── Round 3: end-to-end reducer vs reconciliation agreement ───────────
// The reducer (CLOUD_SYNC_PROGRESS) and the re-push decision both rely on
// resolveProgressConflict. They must never disagree: whatever position the
// reducer settles on for a category is the position that should end up in
// the cloud. Verify the resulting local state == the value we'd re-push
// (or == cloud when no push happens).
function baseState(progress: Progress[]): AppState {
  return {
    progress,
    settings: { theme: 'system', startDate: '', userName: '' },
    history: [],
    proverbJournals: [],
    customDevotionals: [],
    completedBooks: new Set<string>(),
  };
}
function expectAgreement(name: string, local: Progress, cloud: Progress) {
  const next = appReducer(baseState([local]), { type: 'CLOUD_SYNC_PROGRESS', progress: [cloud] });
  const reduced = next.progress.find(p => p.categoryId === local.categoryId)!;
  const winner = resolveProgressConflict(local, cloud);
  const repush = shouldRepush(local, cloud);

  // Reducer must land on the conflict winner's position.
  const reducerMatchesWinner = reduced.bookIndex === winner.bookIndex && reduced.chapter === winner.chapter;
  // If we re-push, we push the winner; cloud will then equal reduced. If we
  // don't push, cloud already equals reduced. Either way the system converges.
  const converges = repush
    ? (winner.bookIndex === reduced.bookIndex && winner.chapter === reduced.chapter)
    : (cloud.bookIndex === reduced.bookIndex && cloud.chapter === reduced.chapter);

  if (reducerMatchesWinner && converges) { pass++; }
  else { fail++; failures.push(`✗ ${name}: reduced(${reduced.bookIndex},${reduced.chapter}) winner(${winner.bookIndex},${winner.chapter}) repush=${repush}`); }
}
// 27. Normal forward read on this device, cloud behind.
expectAgreement('agree: local forward', p('a', 6, 2, T + 1000), p('a', 5, 9, T));
// 28. Reset propagated from cloud (newer, behind).
expectAgreement('agree: cloud reset', p('a', 30, 1, T), p('a', 0, 1, T + 10 * MIN));
// 29. Other device further (newer).
expectAgreement('agree: cloud further', p('a', 2, 3, T), p('a', 4, 1, T + 1000));
// 30. Local jump-back newer.
expectAgreement('agree: local jump back', p('a', 0, 1, T + 10 * MIN), p('a', 20, 5, T));
// 31. Identical state.
expectAgreement('agree: identical', p('a', 3, 3, T), p('a', 3, 3, T));

// ── Round 4: fuzz invariants over random pairs ────────────────────────
function rand(max: number) { return Math.floor(Math.random() * max); }
let fuzzRuns = 0;
for (let i = 0; i < 20000; i++) {
  const local = p('a', rand(40), 1 + rand(50), T + rand(60 * MIN) - 30 * MIN);
  const cloud = p('a', rand(40), 1 + rand(50), T + rand(60 * MIN) - 30 * MIN);
  const winner = resolveProgressConflict(local, cloud);
  const lt = local.updatedAtMillis!;
  const ct = cloud.updatedAtMillis!;

  // INV-1: winner is always one of the two inputs (no fabricated state).
  if (winner !== local && winner !== cloud) { fail++; failures.push(`fuzz INV-1 violated`); break; }

  // INV-2: reducer lands on the winner's position.
  const next = appReducer(baseState([local]), { type: 'CLOUD_SYNC_PROGRESS', progress: [cloud] });
  const reduced = next.progress[0];
  if (reduced.bookIndex !== winner.bookIndex || reduced.chapter !== winner.chapter) {
    fail++; failures.push(`fuzz INV-2: reduced≠winner`); break;
  }

  // INV-3: a clearly-newer write (>5min) always wins outright (reset respect).
  if (ct - lt > 5 * MIN && winner !== cloud) { fail++; failures.push(`fuzz INV-3: stale cloud-newer not honored`); break; }
  if (lt - ct > 5 * MIN && winner !== local) { fail++; failures.push(`fuzz INV-3: stale local-newer not honored`); break; }

  // INV-4: convergence — re-push winner ⇒ cloud==reduced; else cloud already==reduced.
  const repush = shouldRepush(local, cloud);
  const cloudEqReduced = cloud.bookIndex === reduced.bookIndex && cloud.chapter === reduced.chapter;
  if (!repush && !cloudEqReduced) { fail++; failures.push(`fuzz INV-4: no-push but cloud≠reduced`); break; }
  if (repush && (winner.bookIndex !== reduced.bookIndex || winner.chapter !== reduced.chapter)) {
    fail++; failures.push(`fuzz INV-4: push winner≠reduced`); break;
  }
  fuzzRuns++;
}
if (!failures.length) { pass++; console.log(`fuzz: ${fuzzRuns} random pairs upheld all invariants`); }

// ── Round 5: reading-plan advancement (terminal log dedup) ────────────
// 'wisdom' = [Job(42), Proverbs(31), Ecclesiastes(12), Song of Solomon(8)].
function expect(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; failures.push(`✗ ${name}`); }
}
// Normal advance: log exactly the chapter being read, move forward one.
{
  const r = calculateNextProgress('wisdom', 1, { categoryId: 'wisdom', bookIndex: 0, chapter: 1 }, new Set());
  expect('advance: 1 step logged', r.historySteps.length === 1 && r.historySteps[0].chapter === 1);
  expect('advance: progress → ch2', r.progress.bookIndex === 0 && r.progress.chapter === 2);
  expect('advance: nothing completed', r.newlyCompletedKeys.length === 0);
}
// Cross a book boundary: log Job 42, complete Job, roll to Proverbs 1.
{
  const r = calculateNextProgress('wisdom', 1, { categoryId: 'wisdom', bookIndex: 0, chapter: 42 }, new Set());
  expect('boundary: logs Job 42', r.historySteps.length === 1 && r.historySteps[0].chapter === 42);
  expect('boundary: Job completed', r.newlyCompletedKeys.includes('wisdom:Job'));
  expect('boundary: → Proverbs 1', r.progress.bookIndex === 1 && r.progress.chapter === 1);
}
// Terminal first tap: at Song of Solomon (idx3) ch8 → log once, complete once.
{
  const r = calculateNextProgress('wisdom', 1, { categoryId: 'wisdom', bookIndex: 3, chapter: 8 }, new Set());
  expect('terminal first: logs ch8 once', r.historySteps.length === 1 && r.historySteps[0].chapter === 8);
  expect('terminal first: completes Song', r.newlyCompletedKeys.includes('wisdom:Song of Solomon'));
  expect('terminal first: stays at ch8', r.progress.bookIndex === 3 && r.progress.chapter === 8);
}
// Terminal repeat tap (book already complete): NO new history, NO re-complete.
{
  const done = new Set(['wisdom:Song of Solomon']);
  const r = calculateNextProgress('wisdom', 1, { categoryId: 'wisdom', bookIndex: 3, chapter: 8 }, done);
  expect('terminal repeat: no re-log', r.historySteps.length === 0);
  expect('terminal repeat: no re-complete', r.newlyCompletedKeys.length === 0);
}
// Multi-tap overshoot at terminal: amount=5 from Song ch6 logs 6,7,8 then stops.
{
  const r = calculateNextProgress('wisdom', 5, { categoryId: 'wisdom', bookIndex: 3, chapter: 6 }, new Set());
  expect('overshoot: logs 6,7,8 only', r.historySteps.map(s => s.chapter).join(',') === '6,7,8');
  expect('overshoot: completes Song once', r.newlyCompletedKeys.filter(k => k === 'wisdom:Song of Solomon').length === 1);
}

// ── Round 6: HISTORY_CAP enforcement ──────────────────────────────────
function hist(id: string, ms: number): HistoryEntry {
  return { id, timestamp: new Date(ms).toISOString(), timestampMillis: ms, localDate: '2026-01-01', categoryId: 'wisdom', categoryName: 'Wisdom', bookName: 'Job', chapter: 1, readTime: 1 };
}
{
  const full: HistoryEntry[] = Array.from({ length: HISTORY_CAP }, (_, i) => hist('h' + i, 1_000_000 - i));
  const s = baseState([]); s.history = full;
  const next = appReducer(s, { type: 'LOG_HISTORY', entry: hist('newest', 2_000_000) });
  expect('cap: LOG_HISTORY stays at cap', next.history.length === HISTORY_CAP);
  expect('cap: newest kept at head', next.history[0].id === 'newest');
  expect('cap: oldest dropped', !next.history.some(h => h.id === 'h' + (HISTORY_CAP - 1)));
}
{
  const cloud: HistoryEntry[] = Array.from({ length: HISTORY_CAP + 50 }, (_, i) => hist('c' + i, 5_000_000 - i));
  const next = appReducer(baseState([]), { type: 'CLOUD_SYNC_HISTORY', history: cloud });
  expect('cap: CLOUD_SYNC truncates', next.history.length === HISTORY_CAP);
}

// ── Round 7: journal/devotional edit sync (content-aware compare) ──────
function jr(id: string, content: string): ProverbJournal {
  return { id, date: '2026-01-01', chapter: 1, content, verse: 'v' };
}
{
  const local = [jr('j1', 'original'), jr('j2', 'two')];
  const s = baseState([]); s.proverbJournals = local;
  // Edit j1's content on another device (same id, same count).
  const edited = [jr('j1', 'EDITED'), jr('j2', 'two')];
  const next = appReducer(s, { type: 'CLOUD_SYNC_JOURNALS', journals: edited });
  expect('journal edit: propagates', next.proverbJournals.find(j => j.id === 'j1')!.content === 'EDITED');
}
{
  const local = [jr('j1', 'same'), jr('j2', 'two')];
  const s = baseState([]); s.proverbJournals = local;
  // Identical content (different array order) → no change, same reference.
  const same = [jr('j2', 'two'), jr('j1', 'same')];
  const next = appReducer(s, { type: 'CLOUD_SYNC_JOURNALS', journals: same });
  expect('journal identical: no re-render', next === s);
}

console.log(`\nPASS ${pass} / ${pass + fail}`);
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('All scenarios green.');
