/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "X of 6 parts today": which parts count as read today (partsReadToday).
 * A plan chapter read today counts for its part, and reading the daily proverb
 * counts as the Wisdom part, because Proverbs is Wisdom's daily book (Patrick
 * reads it every day instead of as a plan book). Finished parts never count.
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
const progress = (overrides: Partial<Record<string, string>> = {}): Progress[] =>
  ['law', 'history', 'gospels', 'wisdom', 'epistles', 'prophecy', 'psalms'].map((id) => ({
    categoryId: id, bookIndex: id === 'wisdom' ? 2 : 0, chapter: 3,
    lastReadAt: `${YESTERDAY}T00:05:00.000Z`, localDate: overrides[id] ?? YESTERDAY,
  } as Progress));
const proverb = (localDate: string, chapter = 3): HistoryEntry => ({
  id: `p${localDate}`, timestamp: `${localDate}T01:00:00.000Z`, timestampMillis: 0, localDate,
  categoryId: 'wisdom', categoryName: 'Daily Proverb', bookName: 'Proverbs', chapter, readTime: 3,
});
const none = new Set<string>();
const show = (s: Set<string>) => JSON.stringify([...s].sort());

ok('the daily proverb belongs to Wisdom', DAILY_PROVERB_PART_ID === 'wisdom', String(DAILY_PROVERB_PART_ID));

ok('nothing read today: 0 parts', partsReadToday(progress(), [], none, TODAY).size === 0);

ok('a plan chapter read today counts for its part',
  show(partsReadToday(progress({ law: TODAY }), [], none, TODAY)) === '["law"]');

ok("today's proverb counts as the Wisdom part",
  show(partsReadToday(progress(), [proverb(TODAY)], none, TODAY)) === '["wisdom"]');

ok("yesterday's proverb does not count today",
  partsReadToday(progress(), [proverb(YESTERDAY)], none, TODAY).size === 0);

ok('proverb plus a Law chapter: 2 parts',
  show(partsReadToday(progress({ law: TODAY }), [proverb(TODAY)], none, TODAY)) === '["law","wisdom"]');

ok('proverb plus an Ecclesiastes chapter: Wisdom counts once',
  show(partsReadToday(progress({ wisdom: TODAY }), [proverb(TODAY)], none, TODAY)) === '["wisdom"]');

const wisdomFinished = new Set(['wisdom:Job', 'wisdom:Ecclesiastes', 'wisdom:Song of Solomon']);
ok('a finished Wisdom part is not counted (it is not in the "of N")',
  partsReadToday(progress(), [proverb(TODAY)], wisdomFinished, TODAY).size === 0);

const gospelsFinished = new Set(['gospels:Matthew', 'gospels:Mark', 'gospels:Luke', 'gospels:John', 'gospels:Acts']);
ok('a finished part is not counted even if its pointer moved today',
  partsReadToday(progress({ gospels: TODAY }), [], gospelsFinished, TODAY).size === 0);

if (fail === 0) {
  console.log(`PARTS-TODAY PASS ${pass} / ${pass}`);
} else {
  console.log(`PARTS-TODAY FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
