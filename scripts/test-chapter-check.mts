/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The on-phone text check (src/lib/chapterCheck.ts) and how getChapterText uses
 * it. The phone check is the second, independent line after the server's
 * integrity test, so:
 *   - on every stored chapter of every translation it must agree exactly with
 *     the server's check (scripts/lib/bible-check.mjs), footnoted verses too;
 *   - it must catch the real failures: NCV Numbers 7 with 17 of its 89 verses,
 *     a dropped verse, a repeated verse, empty text, bolls' notice in place of
 *     scripture, verses past the end;
 *   - getChapterText must record each result for the dashboard, flag a KJV
 *     fallback as a failed check, and "Download again" must replace a bad copy.
 *
 * Run with: npx tsx scripts/test-chapter-check.mts
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIBLE_VERSIONS, BOLLS_BIBLE_BOOK_IDS } from '../src/constants';
import { checkChapterVerses, describeVerses } from '../src/lib/chapterCheck';
import { getChapterText, refetchChapterText } from '../src/lib/chapterText';
import { getTextCheck, textCheckKey } from '../src/lib/textCheckLog';
import { VERSE_COUNTS, checkChapter, omittedVerses } from './lib/bible-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'bible');

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; if (failures.length < 40) failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

interface Verse { verse: number; verseEnd?: number; text: string }
const load = (code: string, book: string, ch: number): Verse[] =>
  JSON.parse(readFileSync(join(ROOT, code, String(BOLLS_BIBLE_BOOK_IDS[book]), `${ch}.json`), 'utf8')).verses;

// 1. Same verdict as the server on all 8,323 stored chapters.
let agreed = 0;
for (const ver of BIBLE_VERSIONS.filter((v) => v.source === 'bolls')) {
  for (const [book, counts] of Object.entries(VERSE_COUNTS.chapters as Record<string, number[]>)) {
    for (let ch = 1; ch <= counts.length; ch++) {
      const verses = load(ver.code, book, ch);
      const phone = checkChapterVerses(verses, book, ch);
      const server = checkChapter(verses, book, ch);
      const serverFootnoted = omittedVerses(verses, book, ch).map((r: string) => Number(r.split(':')[1]));
      const same = phone.ok === (server.length === 0)
        && JSON.stringify(phone.footnoted) === JSON.stringify(serverFootnoted.sort((a: number, b: number) => a - b));
      if (same) agreed++;
      else ok(`${ver.code} ${book} ${ch}: phone and server agree`, false, `${phone.problems.join('; ')} | ${server.join('; ')}`);
    }
  }
}
ok('phone check agrees with the server check on every stored chapter', agreed === 8323, String(agreed));

// 2. The failures it exists for.
const n7 = load('NCV', 'Numbers', 7);
{
  const r = checkChapterVerses(n7, 'Numbers', 7);
  ok('complete NCV Numbers 7 passes', r.ok && r.lastVerse === 89, r.problems.join('; '));
  const broken = n7.filter((v) => v.verse !== 12); // the Oct 2026 bug: combined 12-83 dropped
  const b = checkChapterVerses(broken, 'Numbers', 7);
  ok('NCV Numbers 7 without 12-83 fails', !b.ok);
  ok('... and names verses 12-83', b.problems.includes('Missing verses 12–83'), b.problems.join('; '));
  ok('... missing lists 72 verses', b.missing.length === 72, String(b.missing.length));
}
const john3 = load('NCV', 'John', 3);
{
  const drop = checkChapterVerses(john3.filter((v) => v.verse !== 16), 'John', 3);
  ok('a dropped verse fails', !drop.ok && drop.problems.includes('Missing verse 16'), drop.problems.join('; '));
  const dup = checkChapterVerses([...john3.slice(0, 5), john3[4], ...john3.slice(5)], 'John', 3);
  ok('a repeated verse fails', !dup.ok && dup.problems.some((p) => p.includes('out of order or repeated')), dup.problems.join('; '));
  const empty = checkChapterVerses(john3.map((v) => (v.verse === 5 ? { ...v, text: ' ' } : v)), 'John', 3);
  ok('an empty verse fails', !empty.ok && empty.problems.includes('Verse 5 is empty'), empty.problems.join('; '));
  const notice = 'The owner of NIV prohibited me from using it on bolls.life.';
  const junk = checkChapterVerses(john3.map((v) => ({ ...v, text: notice })), 'John', 3);
  ok('a notice in place of scripture fails, every verse number present', !junk.ok
    && junk.problems.includes('Contains a notice instead of scripture')
    && junk.problems.some((p) => p.includes('identical text')), junk.problems.join('; '));
  const extra = checkChapterVerses([...john3, { verse: 37, text: 'Extra.' }], 'John', 3);
  ok('a verse past the end fails', !extra.ok && extra.problems.includes('Unexpected verse 37'), extra.problems.join('; '));
  const unknown = checkChapterVerses(john3, 'John', 99);
  ok('a chapter with no verse count fails', !unknown.ok);
}
{
  const m17 = checkChapterVerses(load('NIV', 'Matthew', 17), 'Matthew', 17);
  ok('NIV Matthew 17 passes with verse 21 as a footnote', m17.ok && JSON.stringify(m17.footnoted) === '[21]', JSON.stringify(m17));
  const nkjv = checkChapterVerses(load('NKJV', 'Matthew', 17), 'Matthew', 17);
  ok('NKJV Matthew 17 prints verse 21', nkjv.ok && nkjv.footnoted.length === 0);
  const j3 = checkChapterVerses(load('NIV', '3 John', 1), '3 John', 1);
  const e3 = checkChapterVerses(load('ESV', '3 John', 1), '3 John', 1);
  ok('3 John may end at 14 or 15', j3.ok && e3.ok && [14, 15].includes(j3.lastVerse) && [14, 15].includes(e3.lastVerse),
    `${j3.lastVerse} ${e3.lastVerse}`);
}
ok('describeVerses one', describeVerses([4]) === 'verse 4');
ok('describeVerses run', describeVerses([3, 4]) === 'verses 3–4');
ok('describeVerses runs', describeVerses([85, 12, 13, 14]) === 'verses 12–14 and 85', describeVerses([85, 12, 13, 14]));

// 3. getChapterText records results and replaces bad copies. Static files are
//    served from public/bible, except that `brokenNumbers7` serves the 17-verse
//    copy and `static404` makes every static file missing (KJV fallback).
let brokenNumbers7 = true;
let static404 = false;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  const m = url.match(/\/bible\/([A-Z]+)\/(\d+)\/(\d+)\.json/);
  if (m) {
    if (static404) return { ok: false, status: 404, json: async () => ({}) };
    const data = JSON.parse(readFileSync(join(ROOT, m[1], m[2], `${m[3]}.json`), 'utf8'));
    if (brokenNumbers7 && m[1] === 'NCV' && m[2] === '4' && m[3] === '7') {
      data.verses = data.verses.filter((v: Verse) => v.verse !== 12);
    }
    return { ok: true, status: 200, json: async () => data };
  }
  if (url.includes('bible-api.com')) {
    return {
      ok: true, status: 200,
      json: async () => ({ translation_id: 'kjv', translation_name: 'King James Version', verses: [{ verse: 1, text: 'In the beginning.' }] }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

{
  const key = textCheckKey('ncv', 'Numbers', 7);
  const bad = await getChapterText('Numbers', 7, 'ncv');
  ok('a broken download is flagged on screen', bad._check?.ok === false, JSON.stringify(bad._check?.problems));
  ok('... and recorded for the dashboard', getTextCheck(key)?.ok === false && !!getTextCheck(key)?.problems?.length);
  brokenNumbers7 = false;
  const again = await refetchChapterText('Numbers', 7, 'ncv');
  ok('"Download again" replaces it with the complete copy', again._check?.ok === true && again.verses.some((v) => v.verseEnd === 83));
  ok('... and the dashboard record turns to passed', getTextCheck(key)?.ok === true);
  const cached = await getChapterText('Numbers', 7, 'ncv');
  ok('the good copy is what opens next time', cached._check?.ok === true);

  const good = await getChapterText('Genesis', 1, 'niv');
  ok('a complete chapter passes', good._check?.ok === true && good._check.lastVerse === 31);
  ok('... and is recorded as passed', getTextCheck(textCheckKey('niv', 'Genesis', 1))?.ok === true);

  static404 = true;
  const fb = await getChapterText('Genesis', 2, 'ncv');
  ok('a KJV fallback is shown as a failed check of the NCV', fb._fallback === true && fb._check?.ok === false
    && fb._check.problems[0].startsWith('Showing the King James Version: the New Century Version copy'),
    JSON.stringify(fb._check?.problems));
}

if (fail === 0) {
  console.log(`CHAPTER-CHECK PASS ${pass} / ${pass}`);
} else {
  console.log(`CHAPTER-CHECK FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
