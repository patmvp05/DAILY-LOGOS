/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration checks for getChapterText's backend dispatch + fallback, with the
 * network layer stubbed (the sandbox can't reach external Bible hosts). Verifies
 * that modern versions hit the bolls.life proxy, public-domain versions hit
 * bible-api.com, bolls HTML is cleaned, and a bolls failure falls back to KJV
 * with a correct label.
 *
 * Run with: npx tsx scripts/test-chapter-fetch.mts
 */
import { getChapterText } from '../src/lib/chapterText';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

type FetchResponse = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> };
const calls: string[] = [];

// Install a fake global fetch that recognizes the proxy (bolls) and bible-api.
function installFetch(opts: { bollsFails?: boolean } = {}) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<FetchResponse> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);

    // bolls.life through our Cloud Function proxy: /bibleProxy?path=<bolls url>
    if (url.includes('bibleProxy') && url.includes('bolls.life')) {
      if (opts.bollsFails) {
        return { ok: false, status: 502, statusText: 'Bad Gateway', json: async () => ({}) };
      }
      // bolls get-text returns an array of { verse, text(HTML), pk }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ([
          { pk: 1, verse: 1, text: 'For God so loved<S>25</S> the world,' },
          { pk: 2, verse: 2, text: '<i>that</i> he gave his only Son.' },
        ]),
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
  // 1. Modern version (NIV) routes through the bolls proxy and cleans HTML.
  installFetch();
  const niv = await getChapterText('John', 3, 'niv');
  ok('NIV uses the bolls proxy', calls.some((u) => u.includes('bibleProxy') && u.includes('bolls.life')),
    `calls=${JSON.stringify(calls)}`);
  ok('NIV requests the right slug + book id', calls.some((u) => u.includes(encodeURIComponent('get-text/NIV/43/3'))),
    `calls=${JSON.stringify(calls)}`);
  ok('NIV strips Strong\'s/markup', niv.verses[0].text === 'For God so loved the world,', niv.verses[0].text);
  ok('NIV labeled as New International Version', niv.translationName === 'New International Version', niv.translationName);
  ok('NIV returns all verses', niv.verses.length === 2, String(niv.verses.length));

  // 2. Public-domain version (WEB) goes straight to bible-api.com (no proxy).
  installFetch();
  const web = await getChapterText('Genesis', 1, 'web');
  ok('WEB uses bible-api.com directly', calls.every((u) => u.includes('bible-api.com')),
    `calls=${JSON.stringify(calls)}`);
  ok('WEB never touches the proxy', !calls.some((u) => u.includes('bibleProxy')));
  ok('WEB labeled correctly', web.translationName === 'World English Bible', web.translationName);

  // 3. Bolls failure for a modern version falls back to public-domain KJV,
  //    and is honestly labeled "King James Version" (never mislabeled as ESV).
  installFetch({ bollsFails: true });
  const esv = await getChapterText('Matthew', 5, 'esv');
  ok('ESV failure falls back to bible-api KJV', calls.some((u) => u.includes('bible-api.com') && u.includes('translation=kjv')),
    `calls=${JSON.stringify(calls)}`);
  ok('fallback is honestly labeled KJV (not ESV)', esv.translationName === 'King James Version', esv.translationName);

  // 4. Unknown/legacy id resolves to the default (web) and still loads.
  installFetch();
  const legacy = await getChapterText('John', 1, 'WEBBE'); // removed code → default web
  ok('legacy/removed code resolves to default and loads', legacy.verses.length > 0, String(legacy.verses.length));

  if (fail > 0) {
    console.error(failures.join('\n'));
    console.error(`\nCHAPTER-FETCH FAIL ${pass} / ${pass + fail}`);
    process.exit(1);
  } else {
    console.log(`CHAPTER-FETCH PASS ${pass} / ${pass + fail}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
