/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the BSB (bereanbible.com) bulk-file parser.
 *
 * The dev sandbox cannot reach bereanbible.com, so the fixtures below reproduce
 * the real file's exact quirks as measured on a GitHub runner:
 *   - a 3-line preamble (BOM on line 1) before any verse record
 *   - exactly two tab-separated fields per record
 *   - books named "Psalm" (singular), which the app calls "Psalms"
 *   - single-chapter books written as `Obadiah 1:1`
 *   - 16 intentionally empty verses (Matthew 17:21, Mark 7:16, …)
 *
 * Run with: npx tsx scripts/test-bsb-parser.mts
 */
import { parseBsbText, parseReference, cleanVerseText, toChapterResponse, validate } from './fetch-bsb-berean.mjs';

type Verse = { verse: number; text: string };
type ChapterRec = { bookId: number; bookName: string; chapter: number; verses: Verse[] };
type Stats = { lines: number; verses: number; skippedEmpty: number; unparsed: number };

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const PREAMBLE = [
  '﻿The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub… \t',
  "This text of God's Word has been dedicated to the public domain.\t",
  'Verse\tBerean Standard Bible',
].join('\n');

const FIXTURE = [
  PREAMBLE,
  'Genesis 1:1\tIn the beginning God created the heavens and the earth.',
  'Genesis 1:2\tNow the earth was formless and void.',
  'Genesis 2:1\tThus the heavens and the earth were completed.',
  // "Psalm" singular in the source; the app uses "Psalms"
  'Psalm 23:1\tA Psalm of David. The LORD is my shepherd; I shall not want.',
  'Psalm 23:2\tHe makes me lie down in green pastures.',
  // single-chapter books
  'Obadiah 1:1\tThis is the vision of Obadiah.',
  '3 John 1:1\tThe elder, To the beloved Gaius.',
  'Jude 1:1\tJude, a servant of Jesus Christ.',
  // an intentionally-omitted verse: empty second field
  'Matthew 17:21\t',
  'Matthew 17:22\tWhen they gathered together in Galilee.',
  // out-of-order to prove sorting
  'Revelation 22:21\tThe grace of the Lord Jesus be with all the saints. Amen.',
  'Revelation 22:20\tHe who testifies to these things says…',
].join('\n');

const { chapters, stats } = parseBsbText(FIXTURE) as { chapters: Map<string, ChapterRec>; stats: Stats };
/** Fixture lookups are known-present; throw loudly rather than litter with `!`. */
const get = (bookId: number, ch: number): ChapterRec => {
  const rec = chapters.get(`${bookId}:${ch}`);
  if (!rec) throw new Error(`fixture missing chapter ${bookId}:${ch}`);
  return rec;
};
const has = (bookId: number, ch: number) => chapters.has(`${bookId}:${ch}`);

// ── Reference parsing
{
  ok('parses a plain reference',
     JSON.stringify(parseReference('Genesis 1:1')?.book.id) === '1');
  ok('maps "Psalm" (source) to Psalms id 19', parseReference('Psalm 23:1')?.book.id === 19);
  ok('accepts "Psalms" too', parseReference('Psalms 23:1')?.book.id === 19);
  ok('handles a numbered book', parseReference('3 John 1:1')?.book.id === 64);
  ok('handles a multi-word book', parseReference('Song of Solomon 1:1')?.book.id === 22);
  ok('maps the "Song of Songs" alias', parseReference('Song of Songs 1:1')?.book.id === 22);
  ok('extracts chapter and verse', (() => {
    const r = parseReference('1 Corinthians 13:4');
    return r?.chapter === 13 && r?.verse === 4 && r?.book.id === 46;
  })());
  ok('rejects the header row', parseReference('Verse') === null);
  ok('rejects an unknown book', parseReference('Enoch 1:1') === null);
  ok('rejects a chapter-only reference', parseReference('Genesis 1') === null);
}

// ── Whole-file parsing
{
  ok('preamble lines are not treated as verses', has(1, 1) && get(1, 1).verses.length === 2);
  ok('splits chapters within a book', has(1, 2) && get(1, 2).verses.length === 1);
  ok('Psalms lands under book id 19', has(19, 23));
  ok('Psalms chapter uses the app book name', get(19, 23).bookName === 'Psalms');
  ok('single-chapter Obadiah parsed', has(31, 1) && get(31, 1).verses[0].text.includes('Obadiah'));
  ok('3 John parsed', has(64, 1));
  ok('Jude parsed', has(65, 1));
}

// ── Omitted verses
{
  const mt17 = get(40, 17);
  ok('empty verse is skipped entirely', mt17.verses.length === 1, JSON.stringify(mt17.verses));
  ok('the skipped verse is not 17:21', mt17.verses.every((v) => v.verse !== 21));
  ok('the following verse survives', mt17.verses[0].verse === 22);
  ok('empty verses are counted', stats.skippedEmpty === 1, String(stats.skippedEmpty));
}

// ── Ordering
{
  const rev = get(66, 22);
  ok('verses are sorted ascending',
     rev.verses.map((v) => v.verse).join(',') === '20,21',
     rev.verses.map((v) => v.verse).join(','));
}

// ── Output shape must match ChapterTextResponse
{
  const out = toChapterResponse(get(19, 23));
  ok('reference uses the app book name', out.reference === 'Psalms 23', out.reference);
  ok('translationId is BSB', out.translationId === 'BSB');
  ok('translationName is the full name', out.translationName === 'Berean Standard Bible');
  ok('verses are {verse,text} only',
     Object.keys(out.verses[0]).sort().join(',') === 'text,verse');
  ok('shape has exactly the 4 expected keys',
     Object.keys(out).sort().join(',') === 'reference,translationId,translationName,verses');
}

// ── Text cleaning
{
  ok('collapses whitespace', cleanVerseText('a   b\n c') === 'a b c');
  ok('strips stray markup', cleanVerseText('<i>Selah</i> rest') === 'Selah rest');
  ok('trims', cleanVerseText('  hi  ') === 'hi');
  ok('curly quotes are preserved',
     cleanVerseText('God said, “Let there be light.”') ===
       'God said, “Let there be light.”');
}

// ── The completeness gate must reject a truncated download
{
  const problems = validate(chapters, stats);
  ok('a partial file is rejected', problems.length > 0);
  ok('it reports the chapter shortfall',
     problems.some((p: string) => p.includes('chapters, expected 1189')),
     problems.slice(0, 2).join(' | '));
  ok('it names a specific missing chapter',
     problems.some((p: string) => p.startsWith('missing ')));
}

console.log('');
if (fail === 0) {
  console.log(`BSB-PARSER PASS ${pass} / ${pass}`);
} else {
  console.log(`BSB-PARSER FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
