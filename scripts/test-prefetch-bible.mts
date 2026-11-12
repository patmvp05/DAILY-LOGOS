/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit checks for prefetchBibleChapters: the look-ahead that warms the next 7
 * chapters per category in the selected version. Verifies that it preloads the
 * chapters the reading plan will actually reach (book boundaries, books already
 * finished, wrapping at the end of a part, saved places in half-read books),
 * version routing, and an out-of-range stored chapter. Network is stubbed; we
 * assert on the exact static-file URLs requested.
 *
 * Run with: npx tsx scripts/test-prefetch-bible.mts
 */
import { prefetchBibleChapters } from '../src/lib/prefetchBible';
import type { Progress } from '../src/types';

const NONE = new Set<string>();

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

type FetchResponse = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> };
const calls: string[] = [];

// Record /bible/CODE/bookId/chapter.json fetches and return valid chapter data.
function installFetch() {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<FetchResponse> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const m = url.match(/\/bible\/([A-Z]+)\/(\d+)\/(\d+)\.json(?:\?|$)/);
    if (m) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          reference: `Book ${m[2]} ${m[3]}`,
          translationId: m[1], translationName: m[1],
          verses: [{ verse: 1, text: 'sample verse text here.' }],
        }),
      };
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  }) as unknown as typeof fetch;
}

// Extract just the "bookId/chapter" tail of each static fetch, in call order.
function fetchedChapters() {
  return calls
    .map((u) => u.match(/\/bible\/[A-Z]+\/(\d+)\/(\d+)\.json(?:\?|$)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1]}/${m[2]}`);
}

async function run() {
  // 1. Forward walk that crosses a book boundary. Law: Genesis(id 1, 50 ch) →
  //    Exodus(id 2). Starting at Genesis 48, the 7-ahead window should be
  //    Gen 48,49,50 then Exodus 1,2,3,4 — in that exact order.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'law', bookIndex: 0, chapter: 48 }], NONE, 'niv');
  ok('crosses book boundary in correct order',
    fetchedChapters().join(',') === '1/48,1/49,1/50,2/1,2/2,2/3,2/4',
    fetchedChapters().join(','));
  ok('fetches exactly 7 chapters ahead', fetchedChapters().length === 7, String(fetchedChapters().length));
  ok('uses the selected version (NIV) path', calls.every((u) => u.includes('/bible/NIV/')), calls[0]);

  // 2. End of a part's last book. Wisdom's last book is Song of Solomon (id 22,
  //    8 chapters). With every other Wisdom book finished there is nothing
  //    after it: only that one chapter is warmed.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'wisdom', bookIndex: 3, chapter: 8 }],
    new Set(['wisdom:Job', 'wisdom:Ecclesiastes']), 'esv');
  ok('stops when the part has nothing left', fetchedChapters().join(',') === '22/8', fetchedChapters().join(','));

  //    With Job (id 18) still unread, the plan wraps round to it, so the
  //    look-ahead must too. It used to stop here and preload nothing further.
  installFetch();
  // (A different version from the case above: a chapter already loaded in
  //  this process is served from memory and makes no request.)
  await prefetchBibleChapters([{ categoryId: 'wisdom', bookIndex: 3, chapter: 8 }], NONE, 'bsb', 4);
  ok('wraps to the first unread book at the end of a part',
    fetchedChapters().join(',') === '22/8,18/1,18/2,18/3', fetchedChapters().join(','));

  //    A finished part has nothing to preload.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'psalms', bookIndex: 0, chapter: 150 }], new Set(['psalms:Psalms']), 'esv');
  ok('a finished part preloads nothing', fetchedChapters().length === 0, fetchedChapters().join(','));

  // 2a. THE REGRESSION: a later book already read. Epistles: Romans (id 45, 16
  //     ch) → 1 Corinthians (46) → 2 Corinthians (47). With 1 Corinthians
  //     finished, "+" goes from Romans 16 to 2 Corinthians 1; the old walk
  //     preloaded 1 Corinthians instead.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'epistles', bookIndex: 0, chapter: 15 }],
    new Set(['epistles:1 Corinthians']), 'niv', 5);
  ok('skips a book that is already finished',
    fetchedChapters().join(',') === '45/15,45/16,47/1,47/2,47/3', fetchedChapters().join(','));

  //     A half-read book is resumed at its saved chapter, not chapter 1.
  installFetch();
  await prefetchBibleChapters(
    [{ categoryId: 'law', bookIndex: 0, chapter: 50, partialChapters: { Exodus: 12 } }], NONE, 'esv', 3);
  ok('resumes the next book at its saved chapter',
    fetchedChapters().join(',') === '1/50,2/12,2/13', fetchedChapters().join(','));

  // 2b. Wisdom skips Proverbs (bookIndex 1, dailyOnly) when crossing out of Job
  //     (id 18, 42 ch) into Ecclesiastes (id 21, 12 ch), and when starting at a
  //     legacy Proverbs pointer.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'wisdom', bookIndex: 0, chapter: 41 }], NONE, 'ncv', 4);
  ok('wisdom skips Proverbs when crossing from Job 42 to Ecclesiastes 1',
    fetchedChapters().join(',') === '18/41,18/42,21/1,21/2',
    fetchedChapters().join(','));

  installFetch();
  await prefetchBibleChapters([{ categoryId: 'wisdom', bookIndex: 1, chapter: 10 }], NONE, 'csb', 2);
  ok('wisdom skips legacy Proverbs pointer and warms Ecclesiastes 1..2',
    fetchedChapters().join(',') === '21/1,21/2',
    fetchedChapters().join(','));

  // 3. An out-of-range stored chapter is read the way the app reads it: clamped
  //    to the book's last chapter (Matthew, id 40, has 28), then on into Mark.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'gospels', bookIndex: 0, chapter: 999 }], NONE, 'nkjv', 2);
  ok('out-of-range chapter is clamped like the app does', fetchedChapters().join(',') === '40/28,41/1', fetchedChapters().join(','));

  // 4. Unknown category id is skipped without error.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'nope', bookIndex: 0, chapter: 1 }], NONE, 'niv');
  ok('unknown category is skipped', fetchedChapters().length === 0, fetchedChapters().join(','));

  // 5. Custom chaptersAhead is honored. Gospels: Mark (id 41, 16 ch) at ch 2,
  //    ask for 3 ahead → Mark 2,3,4.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'gospels', bookIndex: 1, chapter: 2 }], NONE, 'nlt', 3);
  ok('honors a custom chaptersAhead', fetchedChapters().join(',') === '41/2,41/3,41/4', fetchedChapters().join(','));

  // 6. Multiple categories are each warmed independently.
  installFetch();
  const multi: Progress[] = [
    { categoryId: 'law', bookIndex: 0, chapter: 1 },      // Genesis 1.. (id 1)
    { categoryId: 'psalms', bookIndex: 0, chapter: 1 },   // Psalms 1.. (id 19)
  ];
  await prefetchBibleChapters(multi, NONE, 'niv', 2);
  const got = fetchedChapters();
  ok('warms each category (law)', got.includes('1/1') && got.includes('1/2'), got.join(','));
  ok('warms each category (psalms)', got.includes('19/1') && got.includes('19/2'), got.join(','));

  if (fail > 0) {
    console.error(failures.join('\n'));
    console.error(`\nPREFETCH-BIBLE FAIL ${pass} / ${pass + fail}`);
    process.exit(1);
  } else {
    console.log(`PREFETCH-BIBLE PASS ${pass} / ${pass + fail}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
