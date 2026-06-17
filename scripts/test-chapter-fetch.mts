/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration checks for getChapterText's backend dispatch + fallback, with the
 * network layer stubbed (the sandbox can't reach external Bible hosts). Verifies
 * that modern versions load from same-origin static files (/bible/...),
 * public-domain versions hit bible-api.com, the legacy raw-bolls shape is still
 * cleaned, and a missing static file falls back to KJV with a correct label.
 *
 * Run with: npx tsx scripts/test-chapter-fetch.mts
 */
import { getChapterText } from '../src/lib/chapterText';
import { getProverb } from '../src/lib/proverbCache';
import { getChapterInfo } from '../src/lib/bibleCache';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

type FetchResponse = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> };
const calls: string[] = [];

// Parse "/bible/NIV/43/3.json" → { code, bookId, chapter }.
function parseStaticUrl(url: string) {
  const m = url.match(/\/bible\/([A-Z]+)\/(\d+)\/(\d+)\.json$/);
  return m ? { code: m[1], bookId: Number(m[2]), chapter: Number(m[3]) } : null;
}

// Install a fake global fetch that serves same-origin static Bible files and
// bible-api.com. `staticFails` simulates a missing static file (→ KJV fallback);
// `staticRaw` serves the legacy raw-bolls array shape (to exercise runtime
// cleaning/reshaping) instead of the preferred final ChapterTextResponse shape.
function installFetch(opts: { staticFails?: boolean; staticRaw?: boolean } = {}) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<FetchResponse> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);

    const stat = parseStaticUrl(url);
    if (stat) {
      if (opts.staticFails) {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
      }
      if (opts.staticRaw) {
        // Legacy raw-bolls shape: array of { verse, text(HTML) }.
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ([
            { pk: 1, verse: 1, text: 'For God so loved<S>25</S> the world,' },
            { pk: 2, verse: 2, text: '<i>that</i> he gave his only Son.' },
          ]),
        };
      }
      // Preferred final shape: already-cleaned ChapterTextResponse.
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          reference: `Book ${stat.bookId} ${stat.chapter}`,
          translationId: stat.code,
          translationName: stat.code,
          verses: [
            { verse: 1, text: 'For God so loved the world,' },
            { verse: 2, text: 'that he gave his only Son.' },
          ],
        }),
      };
    }

    // bible-api.com (public-domain path + KJV fallback)
    if (url.includes('bible-api.com')) {
      const isKjv = url.includes('translation=kjv');
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          translation_id: isKjv ? 'kjv' : 'web',
          translation_name: isKjv ? 'King James Version' : 'World English Bible',
          verses: [
            { verse: 1, text: isKjv ? 'In the beginning God created' : 'In the beginning, God created' },
          ],
        }),
      };
    }

    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  }) as unknown as typeof fetch;
}

async function run() {
  // 1. Modern version (NIV) loads from the same-origin static file.
  installFetch();
  const niv = await getChapterText('John', 3, 'niv');
  ok('NIV loads from /bible static file', calls.some((u) => u.includes('/bible/NIV/43/3.json')),
    `calls=${JSON.stringify(calls)}`);
  ok('NIV never touches bolls.life at runtime', !calls.some((u) => u.includes('bolls.life')));
  ok('NIV labeled as New International Version', niv.translationName === 'New International Version', niv.translationName);
  ok('NIV returns all verses', niv.verses.length === 2, String(niv.verses.length));

  // 1b. Legacy raw-bolls shape is still cleaned + reshaped at runtime.
  installFetch({ staticRaw: true });
  const nivRaw = await getChapterText('John', 3, 'niv');
  ok('legacy raw static file strips Strong\'s/markup', nivRaw.verses[0].text === 'For God so loved the world,', nivRaw.verses[0].text);
  ok('legacy raw static file still labeled NIV', nivRaw.translationName === 'New International Version', nivRaw.translationName);

  // 2. Public-domain version (WEB) goes straight to bible-api.com.
  installFetch();
  const web = await getChapterText('Genesis', 1, 'web');
  ok('WEB uses bible-api.com directly', calls.every((u) => u.includes('bible-api.com')),
    `calls=${JSON.stringify(calls)}`);
  ok('WEB never touches /bible static files', !calls.some((u) => u.includes('/bible/')));
  ok('WEB labeled correctly', web.translationName === 'World English Bible', web.translationName);

  // 3. A missing static file for a modern version falls back to public-domain
  //    KJV, honestly labeled "King James Version" (never mislabeled as ESV).
  installFetch({ staticFails: true });
  const esv = await getChapterText('Matthew', 5, 'esv');
  ok('ESV (missing file) falls back to bible-api KJV', calls.some((u) => u.includes('bible-api.com') && u.includes('translation=kjv')),
    `calls=${JSON.stringify(calls)}`);
  ok('fallback is honestly labeled KJV (not ESV)', esv.translationName === 'King James Version', esv.translationName);

  // 4. Unknown/legacy id resolves to the default (web) and still loads.
  installFetch();
  const legacy = await getChapterText('John', 1, 'WEBBE'); // removed code → default web
  ok('legacy/removed code resolves to default and loads', legacy.verses.length > 0, String(legacy.verses.length));

  // 5. The DAILY PROVERB respects the selected version (was hard-coded to ESV/KJV
  //    before). A modern pick must load the static file, not KJV.
  installFetch();
  const provNiv = await getProverb(10, 'niv');
  ok('proverb (NIV) loads from /bible static file', calls.some((u) => u.includes('/bible/NIV/20/10.json')),
    `calls=${JSON.stringify(calls)}`);
  ok('proverb (NIV) labeled New International Version', provNiv.translation_name === 'New International Version', provNiv.translation_name);
  ok('proverb (NIV) has joined text', provNiv.text.length > 0 && provNiv.verses.length > 0);

  installFetch();
  const provWeb = await getProverb(11, 'web');
  ok('proverb (WEB) uses bible-api, not static files', calls.some((u) => u.includes('bible-api.com')) && !calls.some((u) => u.includes('/bible/')),
    `calls=${JSON.stringify(calls)}`);

  // 6. The CARD PREVIEW (first verse + read time) respects the selected version
  //    (was hard-coded to KJV before).
  installFetch();
  const infoNkjv = await getChapterInfo('Mark', 9, 'nkjv');
  ok('card preview (NKJV) loads from /bible static file', calls.some((u) => u.includes('/bible/NKJV/41/9.json')),
    `calls=${JSON.stringify(calls)}`);
  ok('card preview returns a first verse', infoNkjv.firstVerse.length > 0 && infoNkjv.firstVerse !== 'Could not load preview.', infoNkjv.firstVerse);
  ok('card preview computes a positive read time', infoNkjv.readTime > 0, String(infoNkjv.readTime));

  // 7. NCV (New Century Version) loads from its static file.
  installFetch();
  const ncv = await getChapterText('Psalms', 23, 'ncv');
  ok('NCV loads from /bible static file', calls.some((u) => u.includes('/bible/NCV/19/23.json')),
    `calls=${JSON.stringify(calls)}`);
  ok('NCV labeled New Century Version', ncv.translationName === 'New Century Version', ncv.translationName);
  ok('NCV returns verses', ncv.verses.length > 0, String(ncv.verses.length));

  if (fail > 0) {
    console.error(failures.join('\n'));
    console.error(`\nCHAPTER-FETCH FAIL ${pass} / ${pass + fail}`);
    process.exit(1);
  } else {
    console.log(`CHAPTER-FETCH PASS ${pass} / ${pass + fail}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
