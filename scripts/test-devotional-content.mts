/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the devotional content layer: local-date selection, cache
 * behavior, Feb 29 fallback, URL interpolation, and catalog lookups.
 *
 * Run with: npx tsx scripts/test-devotional-content.mts
 */
import { getDevotional, type DevotionalContent } from '../src/lib/devotionalContent';
import {
  getLocalMonthDay,
  getAdjacentMonthDays,
  resolveDevotionalKind,
  getDevotionalSlug,
  getDevotionalAuthor,
  interpolateDevotionalUrl,
  INTERNAL_DEVOTIONAL_SLUGS,
} from '../src/lib/devotionalCatalog';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const fetchCalls: string[] = [];

const SAMPLE_DEVOTIONAL: DevotionalContent = {
  slug: 'morning-evening',
  date: '06-18',
  title: 'June 18',
  entries: [
    {
      period: 'morning',
      scripture: 'The Lord is my shepherd',
      reference: 'Psalm 23:1',
      body: ['First paragraph of morning reading.', 'Second paragraph.'],
    },
    {
      period: 'evening',
      scripture: 'Be still and know',
      reference: 'Psalm 46:10',
      body: ['Evening reflection paragraph.'],
    },
  ],
  author: 'Charles H. Spurgeon',
  source: 'CCEL',
};

const SAMPLE_SINGLE: DevotionalContent = {
  slug: 'my-utmost',
  date: '06-18',
  title: 'June 18',
  entries: [
    {
      scripture: 'I am the vine',
      reference: 'John 15:5',
      body: ['Oswald Chambers writes about abiding.', 'Another paragraph.'],
    },
  ],
  author: 'Oswald Chambers',
  source: 'CCEL',
};

function installFetch(opts: { fail404?: string } = {}) {
  fetchCalls.length = 0;

  (globalThis as any).fetch = async (url: string, _init?: any) => {
    fetchCalls.push(url);

    if (opts.fail404 && url.includes(opts.fail404)) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    }

    if (url.includes('/devotionals/morning-evening/')) {
      return { ok: true, status: 200, json: async () => ({ ...SAMPLE_DEVOTIONAL }) };
    }
    if (url.includes('/devotionals/my-utmost/')) {
      return { ok: true, status: 200, json: async () => ({ ...SAMPLE_SINGLE }) };
    }
    if (url.includes('/devotionals/streams-in-the-desert/')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          slug: 'streams-in-the-desert',
          date: '06-18',
          title: 'June 18',
          entries: [{ body: ['Stream flows on.'] }],
          author: 'L.B. Cowman',
          source: 'CCEL',
        }),
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// ── Catalog tests ──

ok('catalog: spurgeon is internal', resolveDevotionalKind('spurgeon') === 'internal');
ok('catalog: daily-bread is external', resolveDevotionalKind('daily-bread') === 'external');
ok('catalog: insight is external', resolveDevotionalKind('insight') === 'external');
ok('catalog: random id is external', resolveDevotionalKind('some-custom-id') === 'external');

// Only Spurgeon (morning-evening) is internal; My Utmost / Streams are external
// (not on CCEL) until their text is sourced — see devotionalCatalog.ts.
ok('catalog: utmost is external', resolveDevotionalKind('utmost') === 'external');
ok('catalog: streams is external', resolveDevotionalKind('streams') === 'external');

ok('slug: spurgeon → morning-evening', getDevotionalSlug('spurgeon') === 'morning-evening');
ok('slug: utmost (external) returns null', getDevotionalSlug('utmost') === null);
ok('slug: streams (external) returns null', getDevotionalSlug('streams') === null);
ok('slug: external returns null', getDevotionalSlug('daily-bread') === null);

ok('author: spurgeon', getDevotionalAuthor('spurgeon') === 'Charles H. Spurgeon');
ok('author: utmost (external) returns null', getDevotionalAuthor('utmost') === null);
ok('author: external returns null', getDevotionalAuthor('daily-bread') === null);

ok('INTERNAL_SLUGS has 1 entry', INTERNAL_DEVOTIONAL_SLUGS.length === 1);
ok('INTERNAL_SLUGS contains morning-evening', INTERNAL_DEVOTIONAL_SLUGS.includes('morning-evening'));

// ── Date helpers ──

ok('getLocalMonthDay format', /^\d{2}-\d{2}$/.test(getLocalMonthDay()));
ok('getLocalMonthDay specific date', getLocalMonthDay(new Date(2024, 0, 15)) === '01-15');
ok('getLocalMonthDay Dec 31', getLocalMonthDay(new Date(2024, 11, 31)) === '12-31');
ok('getLocalMonthDay Feb 29 leap', getLocalMonthDay(new Date(2024, 1, 29)) === '02-29');

const adjacent = getAdjacentMonthDays(new Date(2024, 0, 1));
ok('adjacent days count', adjacent.length === 3);
ok('adjacent yesterday wraps to Dec', adjacent[0] === '12-31');
ok('adjacent today', adjacent[1] === '01-01');
ok('adjacent tomorrow', adjacent[2] === '01-02');

const adjacentMid = getAdjacentMonthDays(new Date(2024, 5, 15));
ok('adjacent mid-month yesterday', adjacentMid[0] === '06-14');
ok('adjacent mid-month today', adjacentMid[1] === '06-15');
ok('adjacent mid-month tomorrow', adjacentMid[2] === '06-16');

// ── URL interpolation ──

const testDate = new Date(2024, 5, 18); // June 18
ok('interpolate {{date}}', interpolateDevotionalUrl('https://site.com/{{date}}', testDate) === 'https://site.com/2024-06-18');
ok('interpolate {{YYYY}}', interpolateDevotionalUrl('https://site.com/{{YYYY}}', testDate) === 'https://site.com/2024');
ok('interpolate {{MM}}', interpolateDevotionalUrl('https://site.com/{{MM}}', testDate) === 'https://site.com/06');
ok('interpolate {{DD}}', interpolateDevotionalUrl('https://site.com/{{DD}}', testDate) === 'https://site.com/18');
ok('interpolate combined', interpolateDevotionalUrl('https://odb.org/{{YYYY}}/{{MM}}/{{DD}}/', testDate) === 'https://odb.org/2024/06/18/');
ok('interpolate no tokens', interpolateDevotionalUrl('https://utmost.org/', testDate) === 'https://utmost.org/');
ok('interpolate multiple same token', interpolateDevotionalUrl('{{date}}/{{date}}', testDate) === '2024-06-18/2024-06-18');

// ── Content fetch tests ──
// Use unique month-day keys per test section so the module-level memory cache
// doesn't cause cross-test interference.

installFetch();

const result1 = await getDevotional('morning-evening', '06-18');
ok('fetch: returns content', result1 !== null);
ok('fetch: correct slug', result1.slug === 'morning-evening');
ok('fetch: has 2 entries (Spurgeon)', result1.entries.length === 2);
ok('fetch: morning entry', result1.entries[0].period === 'morning');
ok('fetch: evening entry', result1.entries[1].period === 'evening');
ok('fetch: has scripture', result1.entries[0].scripture === 'The Lord is my shepherd');
ok('fetch: has reference', result1.entries[0].reference === 'Psalm 23:1');
ok('fetch: has body paragraphs', result1.entries[0].body.length === 2);
ok('fetch: _cachedAt set', typeof result1._cachedAt === 'number');

const callCount1 = fetchCalls.length;
const result2 = await getDevotional('morning-evening', '06-18');
ok('cache: second call no new fetch (memory)', fetchCalls.length === callCount1);
ok('cache: same content returned', result2.slug === result1.slug);

const utmost = await getDevotional('my-utmost', '03-15');
ok('utmost: single entry', utmost.entries.length === 1);
ok('utmost: no period field', utmost.entries[0].period === undefined);

const streams = await getDevotional('streams-in-the-desert', '04-20');
ok('streams: single entry', streams.entries.length === 1);
ok('streams: has body', streams.entries[0].body[0] === 'Stream flows on.');

// ── Feb 29 fallback ──

installFetch({ fail404: '02-29' });

const feb29 = await getDevotional('morning-evening', '02-29');
ok('feb29 fallback: returns content', feb29 !== null);
ok('feb29 fallback: fetched 02-28 after 404', fetchCalls.some(u => u.includes('02-28')));

// ── 404 throws ──
// Use a slug+day combo not yet in the memory cache

installFetch({ fail404: 'my-utmost' });

let threw = false;
try {
  await getDevotional('my-utmost', '11-30');
} catch {
  threw = true;
}
ok('404: throws on missing content', threw);

// ── Report ──

if (failures.length > 0) {
  console.error('\nFailed assertions:');
  for (const f of failures) console.error(f);
}

console.log(`\nDEVOTIONAL-CONTENT ${fail === 0 ? 'PASS' : 'FAIL'} ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
