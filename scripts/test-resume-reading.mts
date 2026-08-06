/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for the "Resume Reading" card across devices.
 *
 * The card must name the category the user genuinely read last, even when the
 * reads came from different devices whose wall clocks disagree, and it must not
 * present an older read as if it happened today.
 *
 * Run with: npx tsx scripts/test-resume-reading.mts
 */
import { pickLastReadProgress, formatLastRead } from '../src/lib/utils';
import type { Progress } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const iso = (ms: number) => new Date(ms).toISOString();
const T = Date.UTC(2026, 7, 5, 10, 0, 0); // 2026-08-05 10:00 UTC

// ── 1. The reported bug: desktop clock runs fast, iPad read is genuinely newer.
{
  const DESKTOP_FAST = 5 * 60 * 1000;
  // Gospels read on the desktop FIRST (real time T), stamped 5 min ahead.
  // Law read on the iPad 2 real minutes LATER, stamped accurately.
  // Server timestamps reflect true arrival order regardless of device clocks.
  const progress: Progress[] = [
    {
      categoryId: 'gospels', bookIndex: 0, chapter: 2,
      lastReadAt: iso(T + DESKTOP_FAST),
      serverMillis: T,
    },
    {
      categoryId: 'law', bookIndex: 0, chapter: 2,
      lastReadAt: iso(T + 2 * 60 * 1000),
      serverMillis: T + 2 * 60 * 1000,
    },
  ];
  const picked = pickLastReadProgress(progress);
  ok('server clock beats a fast device clock', picked?.categoryId === 'law',
     `picked ${picked?.categoryId}, expected law`);

  // Prove the old device-clock ordering really did get this wrong, so this test
  // fails loudly if anyone reverts to sorting on lastReadAt.
  const byDeviceClock = [...progress]
    .sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime())[0];
  ok('device-clock ordering is the broken behavior being guarded against',
     byDeviceClock.categoryId === 'gospels');
}

// ── 2. Guest / legacy docs (no serverMillis): fall back to lastReadAt.
{
  const progress: Progress[] = [
    { categoryId: 'gospels', bookIndex: 0, chapter: 2, lastReadAt: iso(T) },
    { categoryId: 'law', bookIndex: 0, chapter: 2, lastReadAt: iso(T + 60_000) },
  ];
  const picked = pickLastReadProgress(progress);
  ok('falls back to lastReadAt when no server stamps', picked?.categoryId === 'law',
     `picked ${picked?.categoryId}`);
}

// ── 3. Entries with no lastReadAt at all are never chosen.
{
  const progress: Progress[] = [
    { categoryId: 'law', bookIndex: 0, chapter: 1 },
    { categoryId: 'gospels', bookIndex: 0, chapter: 3, lastReadAt: iso(T) },
  ];
  ok('never picks an unread category', pickLastReadProgress(progress)?.categoryId === 'gospels');
  ok('returns undefined when nothing has been read',
     pickLastReadProgress([{ categoryId: 'law', bookIndex: 0, chapter: 1 }]) === undefined);
}

// ── 4. An invalid lastReadAt must not crash or win.
{
  const progress: Progress[] = [
    { categoryId: 'law', bookIndex: 0, chapter: 2, lastReadAt: 'not-a-date' },
    { categoryId: 'gospels', bookIndex: 0, chapter: 2, lastReadAt: iso(T) },
  ];
  ok('ignores malformed lastReadAt', pickLastReadProgress(progress)?.categoryId === 'gospels');
}

// ── 5. "Last read" label must not pass off an older read as today.
{
  const today = '2026-08-06';
  const at = (d: string, h: number, m: number) =>
    iso(new Date(`${d}T00:00:00`).getTime() + h * 3600_000 + m * 60_000);

  ok('today shows a bare time',
     formatLastRead(at('2026-08-06', 19, 42), today) === '7:42 PM',
     formatLastRead(at('2026-08-06', 19, 42), today));
  ok('yesterday is labelled yesterday',
     formatLastRead(at('2026-08-05', 19, 42), today) === 'yesterday at 7:42 PM',
     formatLastRead(at('2026-08-05', 19, 42), today));
  ok('older reads show the date',
     formatLastRead(at('2026-08-01', 19, 42), today) === 'Aug 1 at 7:42 PM',
     formatLastRead(at('2026-08-01', 19, 42), today));
  ok('malformed timestamp yields empty label',
     formatLastRead('not-a-date', today) === '');
  // Crossing a month boundary must still resolve "yesterday" correctly.
  ok('yesterday across a month boundary',
     formatLastRead(at('2026-07-31', 8, 5), '2026-08-01') === 'yesterday at 8:05 AM',
     formatLastRead(at('2026-07-31', 8, 5), '2026-08-01'));
}

console.log('');
if (fail === 0) {
  console.log(`RESUME-READING PASS ${pass} / ${pass}`);
} else {
  console.log(`RESUME-READING FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
