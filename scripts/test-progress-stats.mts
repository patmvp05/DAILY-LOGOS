/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for computeProgressStats — specifically that skipping ahead to a
 * later book does NOT count the skipped-over books as read (they must be
 * counted only when actually completed), while sequential reading still works.
 *
 * Run with: npx tsx scripts/test-progress-stats.mts
 */
import { computeProgressStats } from '../src/lib/utils';
import { CATEGORIES } from '../src/constants';
import type { Progress } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

// The "history" category: Joshua(24), Judges(21), Ruth(4), 1 Samuel(31), ...
const HIST = CATEGORIES.find((c) => c.id === 'history')!;
const joshua = HIST.books[0]; // 24
const judges = HIST.books[1]; // 21
const ruth = HIST.books[2];   // 4
const firstSam = HIST.books[3]; // 31

// Every other category is untouched → contributes 0 read. We only assert on the
// history category's chaptersRead, so the rest can stay empty.
function statsFor(progress: Progress[], completed: string[]) {
  return computeProgressStats(progress, new Set(completed));
}

function histRead(progress: Progress[], completed: string[]): number {
  return statsFor(progress, completed).catProgress['history'].chaptersRead;
}

// --- Scenario 1: skip ahead after finishing Joshua ---
// Finished Joshua (in completedBooks), rolled to Judges ch1, then jumped ahead
// to 1 Samuel (bookIndex 3, chapter 1). Judges + Ruth were SKIPPED, not read.
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 3, chapter: 1 },
  ];
  const completed = ['history:Joshua'];
  const read = histRead(progress, completed);
  // Only Joshua's 24 chapters count. Judges(21) + Ruth(4) must NOT be counted.
  ok('skip-ahead counts only completed Joshua', read === joshua.chapters,
     `expected ${joshua.chapters}, got ${read}`);
  ok('skip-ahead does NOT count skipped Judges+Ruth',
     read !== joshua.chapters + judges.chapters + ruth.chapters,
     `got ${read}`);
}

// --- Scenario 2: sequential reading is unaffected ---
// Read Joshua + Judges fully (both completed), now on Ruth chapter 3.
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 2, chapter: 3 },
  ];
  const completed = ['history:Joshua', 'history:Judges'];
  const read = histRead(progress, completed);
  const expected = joshua.chapters + judges.chapters + (3 - 1); // Ruth ch1-2 read
  ok('sequential reading counts completed + partial current', read === expected,
     `expected ${expected}, got ${read}`);
}

// --- Scenario 3: partial current book, nothing completed ---
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 0, chapter: 5 },
  ];
  const read = histRead(progress, []);
  ok('fresh reader: only chapters before current pointer', read === 4,
     `expected 4, got ${read}`);
}

// --- Scenario 4: skip ahead then manually mark a skipped book complete ---
// After jumping to 1 Samuel, user goes back and ticks Ruth complete in the plan.
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 3, chapter: 1 },
  ];
  const completed = ['history:Joshua', 'history:Ruth'];
  const read = histRead(progress, completed);
  const expected = joshua.chapters + ruth.chapters; // Judges still not counted
  ok('manually-completed skipped book counts, others still do not',
     read === expected, `expected ${expected}, got ${read}`);
}

// --- Scenario 5: overall percentage never exceeds 100 and reflects the fix ---
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 3, chapter: 1 },
  ];
  const completed = ['history:Joshua'];
  const stats = statsFor(progress, completed);
  ok('history pct matches Joshua-only fraction',
     stats.catProgress['history'].chaptersRead === joshua.chapters);
  ok('overall progress within [0,100]',
     stats.overallProgress >= 0 && stats.overallProgress <= 100,
     `got ${stats.overallProgress}`);
}

// --- Scenario 6: Wisdom excludes Proverbs (62 chapters) and normalizes legacy Proverbs pointer ---
{
  const stats = statsFor(
    [{ categoryId: 'wisdom', bookIndex: 1, chapter: 18 }], // legacy Proverbs pointer -> Ecclesiastes 1
    ['wisdom:Job', 'wisdom:Proverbs']
  );
  ok('Wisdom totalChapters is 62 (Job 42 + Ecclesiastes 12 + Song of Solomon 8)',
     stats.catProgress['wisdom'].totalChapters === 62,
     `got ${stats.catProgress['wisdom'].totalChapters}`);
  ok('legacy Proverbs pointer normalizes to Ecclesiastes 1 and old wisdom:Proverbs doc is ignored',
     stats.catProgress['wisdom'].chaptersRead === 42,
     `got ${stats.catProgress['wisdom'].chaptersRead}`);
  ok('total plan chapters is 1,158',
     stats.totalChaptersCount === 1158,
     `got ${stats.totalChaptersCount}`);
}

// --- Scenario 7: switching away from a book partway preserves its read chapters via partialChapters ---
{
  const progress: Progress[] = [
    { categoryId: 'history', bookIndex: 1, chapter: 3, partialChapters: { '1 Samuel': 10 } },
  ];
  const read = histRead(progress, ['history:Joshua']);
  const expected = joshua.chapters + (3 - 1) + (10 - 1); // 24 + 2 + 9 = 35
  ok('partialChapters on non-current unread book counts toward chaptersRead',
     read === expected, `expected ${expected}, got ${read}`);
}

console.log('');
if (fail === 0) {
  console.log(`PROGRESS-STATS PASS ${pass} / ${pass}`);
} else {
  console.log(`PROGRESS-STATS FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
