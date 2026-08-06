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
import { appReducer, SPRINT_CAP, getSprintHour } from '../src/state/appReducer';
import type { AppState, SprintHour } from '../src/types';

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

/**
 * Exactly what useReadingActions.toggleSprintHour does: read the current slot,
 * compute the next one, dispatch it, and upload that same object. Returns both
 * so tests can assert local and cloud can never disagree.
 */
function toggle(s: AppState, date: string, hour: number) {
  const prev = getSprintHour(s.scriptureSprints, date, hour);
  const uploaded: SprintHour = { ...prev, done: !prev.done };
  const next = appReducer(s, { type: 'SET_SPRINT_HOUR', date, hour, slot: uploaded });
  return { next, uploaded };
}

// ── THE REGRESSION: what we upload must equal what the reducer stored.
// The first tick used to upload done:false (the pre-toggle value, read back on
// a setTimeout before React had committed), so the cloud disagreed with the
// screen and the listener then reverted the tick — it never reached the iPad.
{
  let s = base();
  for (const hour of [0, 6, 23]) {
    const { next, uploaded } = toggle(s, D, hour);
    const stored = getSprintHour(next.scriptureSprints, D, hour);
    ok(`hour ${hour}: uploaded value matches stored value`,
       JSON.stringify(stored) === JSON.stringify(uploaded),
       `stored ${JSON.stringify(stored)} vs uploaded ${JSON.stringify(uploaded)}`);
    ok(`hour ${hour}: first tick uploads done:true (not the pre-toggle value)`,
       uploaded.done === true, JSON.stringify(uploaded));
    s = next;
  }
  ok('three ticks counted', done(s) === 3, `got ${done(s)}`);

  // Un-tick must upload done:false, again matching what was stored.
  const { next, uploaded } = toggle(s, D, 6);
  ok('un-tick uploads done:false', uploaded.done === false);
  ok('un-tick matches stored',
     getSprintHour(next.scriptureSprints, D, 6).done === false);
  ok('un-tick leaves the others alone', done(next) === 2, `got ${done(next)}`);
}

// ── Toggling hours
{
  let s = base();
  s = toggle(s, D, 0).next;
  ok('first tick creates the sprint', s.scriptureSprints.length === 1);
  s = toggle(s, D, 5).next;
  s = toggle(s, D, 23).next;
  ok('hour 0 and hour 23 do not collide',
     getSprintHour(s.scriptureSprints, D, 0).done === true &&
     getSprintHour(s.scriptureSprints, D, 23).done === true);
  ok('still a single sprint for the day', s.scriptureSprints.length === 1);
}

// ── The sprint must never leak into plan progress or reading stats
{
  const before = base();
  let s = before;
  for (const h of [0, 1, 2, 3]) s = toggle(s, D, h).next;
  ok('progress untouched', JSON.stringify(s.progress) === JSON.stringify(before.progress));
  ok('history untouched', s.history.length === before.history.length);
  ok('completedBooks untouched',
     s.completedBooks.size === before.completedBooks.size &&
     [...before.completedBooks].every(k => s.completedBooks.has(k)));
}

// ── References
{
  let s = base();
  const withRef = (st: AppState, hour: number, reference: string) => {
    const prev = getSprintHour(st.scriptureSprints, D, hour);
    const slot: SprintHour = { ...prev, reference };
    return { next: appReducer(st, { type: 'SET_SPRINT_HOUR', date: D, hour, slot }), slot };
  };

  const r1 = withRef(s, 9, 'John 3');
  s = r1.next;
  ok('reference saved without ticking done',
     getSprintHour(s.scriptureSprints, D, 9).reference === 'John 3' &&
     getSprintHour(s.scriptureSprints, D, 9).done === false);

  s = toggle(s, D, 9).next;
  ok('ticking preserves the reference',
     getSprintHour(s.scriptureSprints, D, 9).reference === 'John 3' &&
     getSprintHour(s.scriptureSprints, D, 9).done === true);

  s = withRef(s, 9, 'x'.repeat(500)).next;
  ok('reference length is bounded',
     (getSprintHour(s.scriptureSprints, D, 9).reference?.length ?? 0) <= 120);
}

// ── Separate days are separate sprints
{
  let s = base();
  s = toggle(s, D, 1).next;
  s = toggle(s, '2026-05-01', 2).next;
  ok('two days -> two sprints', s.scriptureSprints.length === 2);
  ok('each day keeps its own count', done(s, D) === 1 && done(s, '2026-05-01') === 1);
  ok('most recently touched day is first', s.scriptureSprints[0].date === '2026-05-01');
}

// ── Clearing
{
  let s = base();
  s = toggle(s, D, 1).next;
  s = toggle(s, '2026-05-01', 2).next;
  s = appReducer(s, { type: 'CLEAR_SPRINT', date: D });
  ok('clear removes only that day', s.scriptureSprints.length === 1 && s.scriptureSprints[0].date === '2026-05-01');
  const same = appReducer(s, { type: 'CLEAR_SPRINT', date: '1999-01-01' });
  ok('clearing a non-existent day is a no-op (same reference)', same === s);
}

// ── Cloud merge
{
  let s = base();
  s = toggle(s, D, 4).next; // local-only tick, not yet uploaded

  // Cloud has a different hour for the same day, plus an older day.
  s = appReducer(s, {
    type: 'CLOUD_SYNC_SPRINTS',
    sprints: [
      { date: D, hours: { '7': { done: true, reference: 'Acts 7' } } },
      { date: '2026-04-01', hours: { '0': { done: true } } },
    ],
  });
  ok('cloud hour merged in', getSprintHour(s.scriptureSprints, D, 7).done === true);
  ok('local-only hour preserved (pending upload)',
     getSprintHour(s.scriptureSprints, D, 4).done === true);
  ok('cloud-only day added', s.scriptureSprints.some(x => x.date === '2026-04-01'));

  // A key present in BOTH sides takes the cloud value, so an un-tick made on
  // another device propagates rather than being resurrected locally.
  s = appReducer(s, {
    type: 'CLOUD_SYNC_SPRINTS',
    sprints: [{ date: D, hours: { '4': { done: false }, '7': { done: true } } }],
  });
  ok('another device un-ticking wins over the local copy',
     getSprintHour(s.scriptureSprints, D, 4).done === false);
}

// ── Growth is capped
{
  let s = base();
  for (let i = 0; i < SPRINT_CAP + 8; i++) {
    const d = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
    s = toggle(s, d, 0).next;
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
