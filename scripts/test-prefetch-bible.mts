/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit checks for prefetchBibleChapters: the look-ahead that warms the next 7
 * chapters per category in the selected version. Verifies forward walking,
 * book-boundary crossing, end-of-category stop, version routing, and graceful
 * handling of an out-of-range stored chapter. Network is stubbed; we assert on
 * the exact static-file URLs requested.
 *
 * Run with: npx tsx scripts/test-prefetch-bible.mts
 */
import { prefetchBibleChapters } from '../src/lib/prefetchBible';
import type { Progress } from '../src/types';

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
  await prefetchBibleChapters([{ categoryId: 'law', bookIndex: 0, chapter: 48 }], 'niv');
  ok('crosses book boundary in correct order',
    fetchedChapters().join(',') === '1/48,1/49,1/50,2/1,2/2,2/3,2/4',
    fetchedChapters().join(','));
  ok('fetches exactly 7 chapters ahead', fetchedChapters().length === 7, String(fetchedChapters().length));
  ok('uses the selected version (NIV) path', calls.every((u) => u.includes('/bible/NIV/')), calls[0]);

  // 2. Stops cleanly at the end of a category. Wisdom's last book is Song of
  //    Solomon (id 22, 8 chapters). Starting at its final chapter, only that one
  //    chapter is warmed — no wrap-around, no overrun.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'wisdom', bookIndex: 3, chapter: 8 }], 'esv');
  ok('stops at end of category (single chapter)', fetchedChapters().join(',') === '22/8', fetchedChapters().join(','));

  // 3. Out-of-range stored chapter is handled gracefully (no throw, no fetch).
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'gospels', bookIndex: 0, chapter: 999 }], 'nkjv');
  ok('out-of-range chapter fetches nothing', fetchedChapters().length === 0, fetchedChapters().join(','));

  // 4. Unknown category id is skipped without error.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'nope', bookIndex: 0, chapter: 1 }], 'niv');
  ok('unknown category is skipped', fetchedChapters().length === 0, fetchedChapters().join(','));

  // 5. Custom chaptersAhead is honored. Gospels: Mark (id 41, 16 ch) at ch 2,
  //    ask for 3 ahead → Mark 2,3,4.
  installFetch();
  await prefetchBibleChapters([{ categoryId: 'gospels', bookIndex: 1, chapter: 2 }], 'nlt', 3);
  ok('honors a custom chaptersAhead', fetchedChapters().join(',') === '41/2,41/3,41/4', fetchedChapters().join(','));

  // 6. Multiple categories are each warmed independently.
  installFetch();
  const multi: Progress[] = [
    { categoryId: 'law', bookIndex: 0, chapter: 1 },      // Genesis 1.. (id 1)
    { categoryId: 'psalms', bookIndex: 0, chapter: 1 },   // Psalms 1.. (id 19)
  ];
  await prefetchBibleChapters(multi, 'niv', 2);
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
