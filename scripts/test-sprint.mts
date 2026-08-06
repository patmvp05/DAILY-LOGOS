/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the 24-Hour Scripture Sprint reducer logic.
 *
 * The sprint is an occasional discipline tracked separately from the reading
 * plan: ticking hours must never touch progress, history, or completedBooks.
 *
 * Run with: npx tsx scripts/test-sprint.mts
 */
import { appReducer, SPRINT_CAP } from '../src/state/appReducer';
import type { AppState } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const base = (): AppState => ({
  progress: [{ categoryId: 'law', bookIndex: 0, chapter: 5, lastReadAt: '2026-08-06T10:00:00.000Z' }],
  settings: { theme: 'system', startDate: '2026-01-01T00:00:00.000Z' },
  history: [{
    id: 'h1', timestamp: '2026-08-06T10:00:00.000Z', timestampMillis: 1,
    localDate: '2026-08-06', categoryId: 'law', categoryName: 'The Law',
    bookName: 'Genesis', chapter: 4,
  }],
  proverbJournals: [],
  customDevotionals: [],
  scriptureSprints: [],
  completedBooks: new Set(['law:Genesis']),
});

const D = '2026-08-06';
const done = (s: AppState, date = D) =>
  Object.values(s.scriptureSprints.find(x => x.date === date)?.hours ?? {})
    .filter(h => h.done).length;

// ── Toggling hours
{
  let s = base();
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 0 });
  ok('first tick creates the sprint', s.scriptureSprints.length === 1);
  ok('first tick counts one hour', done(s) === 1);

  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 5 });
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 23 });
  ok('three distinct hours counted', done(s) === 3, `got ${done(s)}`);

  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 5 });
  ok('toggling the same hour unticks it', done(s) === 2, `got ${done(s)}`);
  ok('still a single sprint for the day', s.scriptureSprints.length === 1);

  // Hour 0 and hour 23 must not collide (string-keyed map).
  const hours = s.scriptureSprints[0].hours;
  ok('hour 0 stored independently', hours['0']?.done === true);
  ok('hour 23 stored independently', hours['23']?.done === true);
}

// ── The sprint must never leak into plan progress or reading stats
{
  const before = base();
  let s = before;
  for (const h of [0, 1, 2, 3]) s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: h });
  ok('progress untouched', JSON.stringify(s.progress) === JSON.stringify(before.progress));
  ok('history untouched', s.history.length === before.history.length);
  ok('completedBooks untouched',
     s.completedBooks.size === before.completedBooks.size &&
     [...before.completedBooks].every(k => s.completedBooks.has(k)));
}

// ── References
{
  let s = base();
  s = appReducer(s, { type: 'SET_SPRINT_REFERENCE', date: D, hour: 9, reference: 'John 3' });
  ok('reference saved without ticking done',
     s.scriptureSprints[0].hours['9']?.reference === 'John 3' &&
     s.scriptureSprints[0].hours['9']?.done === false);

  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 9 });
  ok('ticking preserves the reference',
     s.scriptureSprints[0].hours['9']?.reference === 'John 3' &&
     s.scriptureSprints[0].hours['9']?.done === true);

  s = appReducer(s, { type: 'SET_SPRINT_REFERENCE', date: D, hour: 9, reference: 'x'.repeat(500) });
  ok('reference length is bounded',
     (s.scriptureSprints[0].hours['9']?.reference?.length ?? 0) <= 120);
}

// ── Separate days are separate sprints
{
  let s = base();
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 1 });
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: '2026-05-01', hour: 2 });
  ok('two days -> two sprints', s.scriptureSprints.length === 2);
  ok('each day keeps its own count', done(s, D) === 1 && done(s, '2026-05-01') === 1);
  ok('most recently touched day is first', s.scriptureSprints[0].date === '2026-05-01');
}

// ── Clearing
{
  let s = base();
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: D, hour: 1 });
  s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: '2026-05-01', hour: 2 });
  s = appReducer(s, { type: 'CLEAR_SPRINT', date: D });
  ok('clear removes only that day', s.scriptureSprints.length === 1 && s.scriptureSprints[0].date === '2026-05-01');

  const same = appReducer(s, { type: 'CLEAR_SPRINT', date: '1999-01-01' });
  ok('clearing a non-existent day is a no-op (same reference)', same === s);
}

// ── Growth is capped
{
  let s = base();
  for (let i = 0; i < SPRINT_CAP + 8; i++) {
    const d = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
    s = appReducer(s, { type: 'TOGGLE_SPRINT_HOUR', date: d, hour: 0 });
  }
  ok('sprint history is capped', s.scriptureSprints.length <= SPRINT_CAP,
     `got ${s.scriptureSprints.length}`);
  const dates = s.scriptureSprints.map(x => x.date);
  ok('no duplicate dates after capping', new Set(dates).size === dates.length);
}

console.log('');
if (fail === 0) {
  console.log(`SPRINT PASS ${pass} / ${pass}`);
} else {
  console.log(`SPRINT FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
