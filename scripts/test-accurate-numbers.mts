/**
 * Comprehensive verification of Step 1, Step 2, and Step 4 accuracy guarantees:
 * - Plan totals: 65 books, 1,158 chapters (Law 187, History 249, Gospels 117,
 *   Wisdom 62, Epistles 121, Prophecy 272, Psalms 150)
 * - Proverbs stays at wisdom.books[1] with dailyOnly: true; saved bookIndex=1
 *   normalizes to Ecclesiastes ch 1; legacy wisdom:Proverbs completions do not
 *   inflate Wisdom or Overall Progress
 * - Per-part percentages, Overall Progress (x / 1,158 Chapters), partialChapters
 *   saved when switching books midway
 * - BOOK_READ_MINUTES verified against committed NCV text at 225 wpm
 * - Today's Reading chapter count and rounded minutes (including Daily Proverb
 *   with real readTime and categoryName: 'Daily Proverb')
 * - Streak, Day N, and "parts today" ("2 of 6 parts today" when 1 part is 100% complete)
 * - Book completion recommendation, never re-reading finished books, and Undo
 *
 * Run: npx tsx scripts/test-accurate-numbers.mts
 */

import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import {
  CATEGORIES,
  CATEGORIES_BY_ID,
  BOOK_READ_MINUTES,
  DEFAULT_BOOK_MINUTES,
  TOTAL_PLAN_BOOKS,
  TOTAL_PLAN_CHAPTERS,
  getPlanBooks,
  isPlanBook,
} from '../src/constants';
import { computeProgressStats, pickLastReadProgress } from '../src/lib/utils';
import {
  calculateNextProgress,
  isCategoryComplete,
  normalizeProgressPosition,
  switchBookInProgress,
} from '../src/lib/bible';
import { appReducer } from '../src/state/appReducer';
import type { AppState, HistoryEntry, Progress } from '../src/types';
import { computeBookReadMinutes, computeChapterReadTimeFromFile } from './compute-read-minutes.mts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    const msg = `✗ ${name}${detail ? ` — ${detail}` : ''}`;
    failures.push(msg);
    console.error(' ', msg);
  }
}

console.log('=== Step 1 & 4: Plan Book & Chapter Totals ===');
{
  check('TOTAL_PLAN_BOOKS === 65', TOTAL_PLAN_BOOKS === 65, `got ${TOTAL_PLAN_BOOKS}`);
  check('TOTAL_PLAN_CHAPTERS === 1158', TOTAL_PLAN_CHAPTERS === 1158, `got ${TOTAL_PLAN_CHAPTERS}`);

  const expectedByPart: Record<string, { books: number; chapters: number }> = {
    law: { books: 5, chapters: 187 },
    history: { books: 12, chapters: 249 },
    gospels: { books: 5, chapters: 117 },
    wisdom: { books: 3, chapters: 62 },
    epistles: { books: 21, chapters: 121 },
    prophecy: { books: 18, chapters: 272 },
    psalms: { books: 1, chapters: 150 },
  };

  for (const cat of CATEGORIES) {
    const planBooks = getPlanBooks(cat);
    const chapters = planBooks.reduce((sum, b) => sum + b.chapters, 0);
    const exp = expectedByPart[cat.id];
    check(`${cat.id} plan books === ${exp.books}`, planBooks.length === exp.books, `got ${planBooks.length}`);
    check(`${cat.id} plan chapters === ${exp.chapters}`, chapters === exp.chapters, `got ${chapters}`);
  }

  const wisdom = CATEGORIES_BY_ID.get('wisdom')!;
  check('Proverbs preserved at wisdom.books[1]', wisdom.books[1]?.name === 'Proverbs');
  check('Proverbs flagged dailyOnly: true', wisdom.books[1]?.dailyOnly === true && !isPlanBook(wisdom.books[1]));
  check('Ecclesiastes stays at wisdom.books[2]', wisdom.books[2]?.name === 'Ecclesiastes');
  check('Song of Solomon stays at wisdom.books[3]', wisdom.books[3]?.name === 'Song of Solomon');

  // Saved Wisdom pointer on Proverbs (bookIndex 1) normalizes to Ecclesiastes ch 1
  const norm = normalizeProgressPosition({ categoryId: 'wisdom', bookIndex: 1, chapter: 14 });
  check('saved wisdom bookIndex=1 normalizes to Ecclesiastes (2) ch 1', norm.bookIndex === 2 && norm.chapter === 1);
}

console.log('=== Step 4: BOOK_READ_MINUTES vs Committed NCV Bible Text (225 WPM) ===');
{
  const report = computeBookReadMinutes('NCV');
  check('NCV 1-decimal avg Genesis === 3.2', report.averages['Genesis'] === 3.2, `got ${report.averages['Genesis']}`);
  check('NCV 1-decimal avg 1 Chronicles === 2.9', report.averages['1 Chronicles'] === 2.9, `got ${report.averages['1 Chronicles']}`);
  check('NCV 1-decimal avg Isaiah === 2.6', report.averages['Isaiah'] === 2.6, `got ${report.averages['Isaiah']}`);
  check('NCV 1-decimal avg Job === 1.9', report.averages['Job'] === 1.9, `got ${report.averages['Job']}`);
  check('NCV 1-decimal avg Proverbs === 2.0', report.averages['Proverbs'] === 2.0, `got ${report.averages['Proverbs']}`);
  check('NCV 1-decimal avg Jude === 3.0', report.averages['Jude'] === 3.0, `got ${report.averages['Jude']}`);

  const allBooks = CATEGORIES.flatMap((c) => c.books);
  check('all 66 books exist in CATEGORIES', allBooks.length === 66);

  for (const book of allBooks) {
    const expected = report.rounded[book.name];
    check(
      `BOOK_READ_MINUTES[${book.name}] === ${expected}`,
      BOOK_READ_MINUTES[book.name] === expected,
      `got ${BOOK_READ_MINUTES[book.name]}`,
    );
  }

  // Real chapter readTime for Daily Proverb (e.g., Proverbs 28)
  const prov28Min = computeChapterReadTimeFromFile('NCV', 'Proverbs', 28);
  check('Proverbs 28 real readTime > 0', prov28Min >= 1, `got ${prov28Min}`);
}

console.log('=== Step 1, 2 & 4: Realistic Progress, Percentages, Overall Progress & Parts Today ===');
{
  // Realistic snapshot:
  // - law: Genesis completed (50), currently on Exodus ch 11 (10 read) => 60 / 187 (32%)
  // - history: Joshua completed (24), switched away from Judges at ch 8 (7 read in partialChapters),
  //   currently on Ruth ch 3 (2 read) => 24 + 7 + 2 = 33 / 249 (13%)
  // - gospels: Matthew completed (28), currently on Mark ch 5 (4 read) => 32 / 117 (27%)
  // - wisdom: Job (42), Ecclesiastes (12), Song of Solomon (8) all completed, plus legacy
  //   wisdom:Proverbs in completedBooks => 62 / 62 (100%)
  // - epistles: Romans ch 9 (8 read) => 8 / 121 (7%)
  // - prophecy: Isaiah ch 15 (14 read) => 14 / 272 (5%)
  // - psalms: Psalms ch 41 (40 read) => 40 / 150 (27%)
  const progress: Progress[] = [
    { categoryId: 'law', bookIndex: 1, chapter: 11, localDate: '2026-10-28', lastReadAt: '2026-10-28T08:00:00.000Z' },
    {
      categoryId: 'history',
      bookIndex: 2,
      chapter: 3,
      partialChapters: { Judges: 8 },
      localDate: '2026-10-27',
      lastReadAt: '2026-10-27T08:00:00.000Z',
    },
    { categoryId: 'gospels', bookIndex: 1, chapter: 5, localDate: '2026-10-28', lastReadAt: '2026-10-28T08:15:00.000Z' },
    { categoryId: 'wisdom', bookIndex: 3, chapter: 8, localDate: '2026-10-28', lastReadAt: '2026-10-28T09:00:00.000Z' },
    { categoryId: 'epistles', bookIndex: 0, chapter: 9, localDate: '2026-10-26', lastReadAt: '2026-10-26T08:00:00.000Z' },
    { categoryId: 'prophecy', bookIndex: 0, chapter: 15, localDate: '2026-10-25', lastReadAt: '2026-10-25T08:00:00.000Z' },
    { categoryId: 'psalms', bookIndex: 0, chapter: 41, localDate: '2026-10-27', lastReadAt: '2026-10-27T09:00:00.000Z' },
  ];

  const completedBooks = new Set<string>([
    'law:Genesis',
    'history:Joshua',
    'gospels:Matthew',
    'wisdom:Job',
    'wisdom:Proverbs', // Legacy completion must not add 31 chapters to Wisdom
    'wisdom:Ecclesiastes',
    'wisdom:Song of Solomon',
  ]);

  const stats = computeProgressStats(progress, completedBooks);
  check('totalChaptersCount === 1158', stats.totalChaptersCount === 1158, `got ${stats.totalChaptersCount}`);
  // 60 + 33 + 32 + 62 + 8 + 14 + 40 = 249
  check('totalRead === 249', stats.totalRead === 249, `got ${stats.totalRead}`);
  check('overallProgress === round(249/1158*1000)/10 === 21.5', stats.overallProgress === 21.5, `got ${stats.overallProgress}`);

  check('law: 60/187 (32.1%)', stats.catProgress.law.chaptersRead === 60 && stats.catProgress.law.pct === 32.1);
  check('history (with partialChapters Judges=8): 33/249 (13.3%)', stats.catProgress.history.chaptersRead === 33 && stats.catProgress.history.pct === 13.3);
  check('gospels: 32/117 (27.4%)', stats.catProgress.gospels.chaptersRead === 32 && stats.catProgress.gospels.pct === 27.4);
  check('wisdom (all 3 plan books done, Proverbs ignored): 62/62 (100%)', stats.catProgress.wisdom.chaptersRead === 62 && stats.catProgress.wisdom.totalChapters === 62 && stats.catProgress.wisdom.pct === 100);
  check('epistles: 8/121 (6.6%)', stats.catProgress.epistles.chaptersRead === 8 && stats.catProgress.epistles.pct === 6.6);
  check('prophecy: 14/272 (5.1%)', stats.catProgress.prophecy.chaptersRead === 14 && stats.catProgress.prophecy.pct === 5.1);
  check('psalms: 40/150 (26.7%)', stats.catProgress.psalms.chaptersRead === 40 && stats.catProgress.psalms.pct === 26.7);

  // Active vs completed parts & "parts today"
  const activeCategories = CATEGORIES.filter((c) => !isCategoryComplete(c.id, completedBooks));
  check('activeCategories has 6 parts (Wisdom complete)', activeCategories.length === 6);
  const todayStr = '2026-10-28';
  const activeIds = new Set(activeCategories.map((c) => c.id));
  const partsDoneToday = new Set<string>();
  for (const p of progress) {
    if (p.localDate === todayStr && activeIds.has(p.categoryId)) {
      partsDoneToday.add(p.categoryId);
    }
  }
  check('parts today === "2 of 6 parts today"', `${partsDoneToday.size} of ${activeCategories.length} parts today` === '2 of 6 parts today');

  // pickLastReadProgress skips completed Wisdom so Next Up highlights an active part
  const lastRead = pickLastReadProgress(progress, completedBooks);
  check('pickLastReadProgress skips completed Wisdom and picks gospels', lastRead?.categoryId === 'gospels');
}

console.log('=== Step 4: Today\'s Reading Minutes, Chapters, Streak & Day N ===');
{
  const todayStr = '2026-10-28';
  const history: HistoryEntry[] = [
    // Today: Exodus 10 (4 min), Mark 4 (2 min), Daily Proverb 28 (2 min real time), plus a Devotional (excluded from chapter count)
    {
      id: 'h1',
      timestamp: '2026-10-28T08:00:00.000Z',
      timestampMillis: 1793174400000,
      localDate: todayStr,
      categoryId: 'law',
      categoryName: 'The Law',
      bookName: 'Exodus',
      chapter: 10,
      readTime: 4,
    },
    {
      id: 'h2',
      timestamp: '2026-10-28T08:15:00.000Z',
      timestampMillis: 1793175300000,
      localDate: todayStr,
      categoryId: 'gospels',
      categoryName: 'Gospels and Acts',
      bookName: 'Mark',
      chapter: 4,
      readTime: 2,
    },
    {
      id: 'h3',
      timestamp: '2026-10-28T08:25:00.000Z',
      timestampMillis: 1793175900000,
      localDate: todayStr,
      categoryId: 'wisdom',
      categoryName: 'Daily Proverb',
      bookName: 'Proverbs',
      chapter: 28,
      readTime: 2,
    },
    {
      id: 'h-dev',
      timestamp: '2026-10-28T08:30:00.000Z',
      timestampMillis: 1793176200000,
      localDate: todayStr,
      categoryId: 'devotional',
      categoryName: 'Daily Devotional',
      bookName: 'Morning Reflection',
      chapter: 1,
      readTime: 3,
    },
    // Yesterday & 2 days ago for 3-day streak
    {
      id: 'h4',
      timestamp: '2026-10-27T08:00:00.000Z',
      timestampMillis: 1793088000000,
      localDate: '2026-10-27',
      categoryId: 'psalms',
      categoryName: 'Psalms',
      bookName: 'Psalms',
      chapter: 40,
      readTime: 1,
    },
    {
      id: 'h5',
      timestamp: '2026-10-26T08:00:00.000Z',
      timestampMillis: 1793001600000,
      localDate: '2026-10-26',
      categoryId: 'epistles',
      categoryName: 'Epistles',
      bookName: 'Romans',
      chapter: 8,
      readTime: 2,
    },
  ];

  const todayEntries = history.filter((h) => h.localDate === todayStr && h.categoryId !== 'devotional');
  const rawMinutes = todayEntries.reduce(
    (acc, curr) => acc + (curr.readTime || BOOK_READ_MINUTES[curr.bookName] || DEFAULT_BOOK_MINUTES),
    0,
  );
  const roundedMinutes = Math.round(rawMinutes);
  check('Today\'s Reading chapters === 3 (excludes devotional, includes Daily Proverb)', todayEntries.length === 3);
  check('Today\'s Reading minutes === round(4 + 2 + 2) === 8', roundedMinutes === 8, `got ${roundedMinutes}`);
  check('Daily Proverb entry has categoryName === "Daily Proverb" and bookName === "Proverbs"', todayEntries[2].categoryName === 'Daily Proverb' && todayEntries[2].bookName === 'Proverbs');

  // Streak calculation (same logic as useAppStats)
  const uniqueDays = new Set<string>();
  for (const h of history) {
    if (h.categoryId === 'devotional') continue;
    if (h.localDate) uniqueDays.add(h.localDate);
  }
  const sortedDays = Array.from(uniqueDays).sort((a, b) => b.localeCompare(a));
  const newestDay = sortedDays[0];
  let streak = 0;
  let checkDate = parseISO(newestDay);
  while (uniqueDays.has(format(checkDate, 'yyyy-MM-dd'))) {
    streak++;
    checkDate = subDays(checkDate, 1);
  }
  check('streak === 3', streak === 3, `got ${streak}`);

  const startDate = '2026-10-01';
  const dayNumber = Math.max(1, differenceInCalendarDays(parseISO(todayStr), parseISO(startDate)) + 1);
  check('Day N === 28 (from 2026-10-01 to 2026-10-28)', dayNumber === 28, `got ${dayNumber}`);
}

console.log('=== Step 2: Book Completion, Recommendation, Partial Book Resume & Undo ===');
{
  // 1. Finishing Job 42 when Ecclesiastes is already complete wraps to Song of Solomon (index 3)
  const doneEcc = new Set<string>(['wisdom:Ecclesiastes']);
  const finishJob = calculateNextProgress(
    'wisdom',
    1,
    { categoryId: 'wisdom', bookIndex: 0, chapter: 42 },
    doneEcc,
  );
  check('finish Job (with Ecclesiastes done): logs Job 42 once', finishJob.historySteps.length === 1 && finishJob.historySteps[0].bookName === 'Job' && finishJob.historySteps[0].chapter === 42);
  check('finish Job: recommends Song of Solomon (index 3)', finishJob.finishedBook?.recommendedBookIndex === 3 && finishJob.finishedBook?.recommendedBookName === 'Song of Solomon');
  check('finish Job: advances progress to Song of Solomon ch 1', finishJob.progress.bookIndex === 3 && finishJob.progress.chapter === 1);

  // 2. Switching away from a book partway saves partialChapters, and finishing another book resumes it
  const startHistory: Progress = { categoryId: 'history', bookIndex: 1, chapter: 9 }; // Judges ch 9
  const switchedToRuth = switchBookInProgress(startHistory, 2, new Set(['history:Joshua'])); // Ruth (index 2)
  check('switch away from Judges ch 9 saves partialChapters.Judges === 9', switchedToRuth.partialChapters?.Judges === 9);
  check('switch to Ruth starts at ch 1', switchedToRuth.bookIndex === 2 && switchedToRuth.chapter === 1);

  // Now finish Ruth ch 4 when 1 Samuel..Esther are done -> wraps back to Judges and resumes at ch 9!
  const doneRestOfHistory = new Set<string>([
    'history:Joshua',
    'history:1 Samuel',
    'history:2 Samuel',
    'history:1 Kings',
    'history:2 Kings',
    'history:1 Chronicles',
    'history:2 Chronicles',
    'history:Ezra',
    'history:Nehemiah',
    'history:Esther',
  ]);
  const atRuth4: Progress = { ...switchedToRuth, chapter: 4 };
  const finishRuth = calculateNextProgress('history', 1, atRuth4, doneRestOfHistory);
  check('finish Ruth 4: wraps to unread Judges (index 1) at saved ch 9', finishRuth.progress.bookIndex === 1 && finishRuth.progress.chapter === 9);
  check('finish Ruth 4: clears Judges from partialChapters once resumed', !finishRuth.progress.partialChapters?.Judges);

  // 3. Undo finishing a book restores last chapter, un-marks completion, and removes the history log
  const initState: AppState = {
    progress: [finishJob.progress],
    completedBooks: new Set(['wisdom:Ecclesiastes', 'wisdom:Job']),
    proverbJournals: [],
    customDevotionals: [],
    history: [
      {
        id: 'log-job-42',
        timestamp: '2026-10-28T09:00:00.000Z',
        timestampMillis: 1793178000000,
        localDate: '2026-10-28',
        categoryId: 'wisdom',
        categoryName: 'Wisdom',
        bookName: 'Job',
        chapter: 42,
      },
    ],
    settings: { startDate: '2026-01-01', theme: 'dark', bibleVersion: 'NCV', typography: 'default' },
    scriptureSprints: [],
  };
  const afterUndo = appReducer(initState, {
    type: 'UNDO_FINISH_BOOK',
    categoryId: 'wisdom',
    bookIndex: 0,
    chapter: 42,
    bookName: 'Job',
    historyId: 'log-job-42',
  });
  check('Undo finish Job: back on Job 42', afterUndo.progress[0].bookIndex === 0 && afterUndo.progress[0].chapter === 42);
  check('Undo finish Job: wisdom:Job removed from completedBooks', !afterUndo.completedBooks.has('wisdom:Job'));
  check('Undo finish Job: log-job-42 removed from history', afterUndo.history.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
