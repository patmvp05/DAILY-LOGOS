/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "X of 6 parts today": which parts count as read today (partsReadToday).
 * A part counts when a chapter was actually READ in it today (an entry in
 * today's history), not when its place merely moved. The daily proverb counts
 * as the Wisdom part, because Proverbs is Wisdom's daily book (Patrick reads it
 * every day instead of as a plan book). Finished parts never count.
 *
 * Run with: npx tsx scripts/test-parts-today.mts
 */
import { DAILY_PROVERB_PART_ID, partsReadToday } from '../src/lib/bible';
import type { HistoryEntry, Progress } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const TODAY = '2026-11-03';
const YESTERDAY = '2026-11-02';
const PARTS = ['law', 'history', 'gospels', 'wisdom', 'epistles', 'prophecy', 'psalms'];
// A part's pointer is stamped with the day it LAST CHANGED, which is not the
// same as the day a chapter was read there (see `moved`).
const progress = (moved: string[] = []): Progress[] =>
  PARTS.map((id) => ({
    categoryId: id, bookIndex: id === 'wisdom' ? 2 : 0, chapter: 3,
    lastReadAt: `${YESTERDAY}T00:05:00.000Z`, localDate: moved.includes(id) ? TODAY : YESTERDAY,
  } as Progress));
const read = (categoryId: string, localDate: string, bookName = 'Genesis', categoryName = 'Part'): HistoryEntry => ({
  id: `${categoryId}${localDate}`, timestamp: `${localDate}T01:00:00.000Z`, timestampMillis: 0, localDate,
  categoryId, categoryName, bookName, chapter: 3, readTime: 3,
});
const proverb = (localDate: string): HistoryEntry => read('wisdom', localDate, 'Proverbs', 'Daily Proverb');
const none = new Set<string>();
const show = (s: Set<string>) => JSON.stringify([...s].sort());

ok('the daily proverb belongs to Wisdom', DAILY_PROVERB_PART_ID === 'wisdom', String(DAILY_PROVERB_PART_ID));

ok('nothing read today: 0 parts', partsReadToday(progress(), [], none, TODAY).size === 0);

ok('a chapter read today counts for its part',
  show(partsReadToday(progress(), [read('law', TODAY)], none, TODAY)) === '["law"]');

ok('a chapter read yesterday does not',
  partsReadToday(progress(), [read('law', YESTERDAY)], none, TODAY).size === 0);

// THE POINT: moving a part's place is not reading. The reducer stamps the
// part's localDate on minus, on switching books, on finishing or undoing a
// book; none of that read anything, and the card showed 0 chapters and 0 minutes.
ok('a part whose place merely moved today (minus, switch, undo) does NOT count',
  partsReadToday(progress(['law', 'gospels']), [], none, TODAY).size === 0);

ok('moved AND read: counts once, for the part that was read',
  show(partsReadToday(progress(['law', 'gospels']), [read('law', TODAY)], none, TODAY)) === '["law"]');

ok("today's proverb counts as the Wisdom part",
  show(partsReadToday(progress(), [proverb(TODAY)], none, TODAY)) === '["wisdom"]');

ok("yesterday's proverb does not count today",
  partsReadToday(progress(), [proverb(YESTERDAY)], none, TODAY).size === 0);

ok('an older Proverbs entry filed under another category still counts for Wisdom',
  show(partsReadToday(progress(), [read('devotional', TODAY, 'Proverbs')], none, TODAY)) === '["wisdom"]');

ok('proverb plus a Law chapter: 2 parts',
  show(partsReadToday(progress(), [read('law', TODAY), proverb(TODAY)], none, TODAY)) === '["law","wisdom"]');

ok('proverb plus an Ecclesiastes chapter: Wisdom counts once',
  show(partsReadToday(progress(), [read('wisdom', TODAY, 'Ecclesiastes'), proverb(TODAY)], none, TODAY)) === '["wisdom"]');

ok('a devotional read today is not a Bible part',
  partsReadToday(progress(), [read('devotional', TODAY, 'Morning and Evening')], none, TODAY).size === 0);

const wisdomFinished = new Set(['wisdom:Job', 'wisdom:Ecclesiastes', 'wisdom:Song of Solomon']);
ok('a finished Wisdom part is not counted (it is not in the "of N")',
  partsReadToday(progress(), [proverb(TODAY)], wisdomFinished, TODAY).size === 0);

const gospelsFinished = new Set(['gospels:Matthew', 'gospels:Mark', 'gospels:Luke', 'gospels:John', 'gospels:Acts']);
ok('a finished part is not counted even if it was read today',
  partsReadToday(progress(), [read('gospels', TODAY, 'Acts')], gospelsFinished, TODAY).size === 0);

if (fail === 0) {
  console.log(`PARTS-TODAY PASS ${pass} / ${pass}`);
} else {
  console.log(`PARTS-TODAY FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
