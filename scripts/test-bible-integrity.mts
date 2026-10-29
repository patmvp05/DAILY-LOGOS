/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every committed chapter of every stored translation is complete and clean.
 *
 * NCV Numbers 7 shipped with 17 of its 89 verses (the scraper dropped combined
 * passages like "12-83"), NIV/NLT had lost the first line of many poetry verses,
 * and ~5,000 verses read "the Lord ." Nothing checked the files, so it went live
 * and stayed live. This test reads all 1,189 chapters of each stored translation
 * and fails on any of:
 *   - a missing, unreadable or mislabelled file;
 *   - a verse missing, duplicated or out of order (combined passages count for
 *     every verse they cover; only the documented footnoted verses may be
 *     absent, and each translation must leave out exactly the ones recorded
 *     below, so a lost verse that happens to be on that list still fails);
 *   - empty text, a leftover footnote marker, "[20-21]" label, chapter number,
 *     HTML, or a space before punctuation;
 *   - a translation whose text is not the one its label says (signature verses);
 *   - a verse far shorter or longer than the same verse in the other six
 *     translations, unless it is in scripts/lib/verse-length-exceptions.json
 *     (a cut-short verse keeps its number, so only its length gives it away).
 *
 * The deploy workflows run this before building, so a broken chapter can't ship.
 * Run with: npx tsx scripts/test-bible-integrity.mts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIBLE_VERSIONS, BOLLS_BIBLE_BOOK_IDS } from '../src/constants';
import { VERSE_COUNTS, checkChapter, omittedVerses, TEXT_DEFECTS } from './lib/bible-check.mjs';
import LENGTH_EXCEPTIONS from './lib/verse-length-exceptions.json';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'bible');

interface Verse { verse: number; verseEnd?: number; text: string }
interface ChapterFile { reference: string; verses: Verse[]; translationId: string; translationName: string }

// Footnoted verses each translation leaves out of its main text (Matthew 17:21
// and friends). Recorded from the repaired text, Oct 2026. NKJV and NCV print
// all of them; the others print them only as footnotes.
const CRITICAL_TEXT_OMISSIONS = [
  'Matthew 17:21', 'Matthew 18:11', 'Matthew 23:14', 'Mark 7:16', 'Mark 9:44', 'Mark 9:46',
  'Mark 11:26', 'Mark 15:28', 'Luke 17:36', 'Luke 23:17', 'John 5:4', 'Acts 8:37',
  'Acts 15:34', 'Acts 24:7', 'Acts 28:29', 'Romans 16:24',
];
const EXPECTED_OMISSIONS: Record<string, string[]> = {
  NIV: CRITICAL_TEXT_OMISSIONS,
  NLT: CRITICAL_TEXT_OMISSIONS,
  ESV: ['Matthew 12:47', ...CRITICAL_TEXT_OMISSIONS],
  NKJV: [],
  NCV: [],
  CSB: CRITICAL_TEXT_OMISSIONS,
  BSB: CRITICAL_TEXT_OMISSIONS,
};

// A few words each translation words in its own way. If a folder ever held a
// different translation's text (a mislabelled scrape), these fail.
const SIGNATURES: Record<string, [string, number, number, string][]> = {
  NCV: [['John', 3, 16, 'may not be lost'], ['Psalms', 23, 1, 'I have everything I need'], ['Genesis', 1, 1, 'the sky and the earth']],
  NIV: [['John', 3, 16, 'one and only Son'], ['Psalms', 23, 1, 'I lack nothing'], ['Genesis', 1, 1, 'the heavens and the earth']],
  NLT: [['John', 3, 16, 'this is how God loved the world'], ['Psalms', 23, 1, 'I have all that I need'], ['Genesis', 1, 1, 'the heavens and the earth']],
  ESV: [['John', 3, 16, 'he gave his only Son'], ['Psalms', 23, 1, 'I shall not want'], ['Genesis', 1, 1, 'the heavens and the earth']],
  NKJV: [['John', 3, 16, 'only begotten Son'], ['Psalms', 23, 1, 'I shall not want'], ['Genesis', 1, 1, 'the heavens and the earth']],
  CSB: [['John', 3, 16, 'God loved the world in this way'], ['Psalms', 23, 1, 'I have what I need'], ['Genesis', 1, 1, 'the heavens and the earth']],
  BSB: [['John', 3, 16, 'He gave His one and only Son'], ['Psalms', 23, 1, 'I shall not want'], ['Genesis', 1, 1, 'the heavens and the earth']],
};

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; if (failures.length < 60) failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const stored = BIBLE_VERSIONS.filter((v) => v.source === 'bolls');
ok('every stored translation has a recorded omission list',
  stored.every((v) => v.code in EXPECTED_OMISSIONS), stored.map((v) => v.code).join(','));

let chapters = 0;
let versesCovered = 0;
const allText = new Map<string, Map<string, Verse[]>>();
for (const ver of stored) {
  const omitted: string[] = [];
  const byRef = new Map<string, Verse[]>();
  for (const [book, counts] of Object.entries(VERSE_COUNTS.chapters as Record<string, number[]>)) {
    const id = BOLLS_BIBLE_BOOK_IDS[book];
    ok(`${book} has a book id`, !!id);
    for (let ch = 1; ch <= counts.length; ch++) {
      const where = `${ver.code} ${book} ${ch}`;
      const file = join(ROOT, ver.code, String(id), `${ch}.json`);
      if (!existsSync(file)) { ok(`${where} exists`, false); continue; }
      let data: ChapterFile;
      try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { ok(`${where} parses`, false, String(e)); continue; }
      chapters++;
      ok(`${where} reference`, data.reference === `${book} ${ch}`, data.reference);
      ok(`${where} translationId`, data.translationId === ver.code, data.translationId);
      const problems = checkChapter(data.verses, book, ch);
      ok(`${where} complete`, problems.length === 0, problems.join('; '));
      omitted.push(...omittedVerses(data.verses, book, ch));
      byRef.set(`${book} ${ch}`, data.verses);
      for (const v of data.verses) {
        versesCovered += (v.verseEnd ?? v.verse) - v.verse + 1;
        for (const d of TEXT_DEFECTS) {
          ok(`${where}:${v.verse} has no ${d.name}`, !d.re.test(v.text), v.text.slice(0, 90));
        }
      }
      const first = data.verses[0];
      if (first && ch > 1) {
        ok(`${where}:1 does not start with the chapter number`,
          !new RegExp(`^${ch}\\s+\\p{L}`, 'u').test(first.text), first.text.slice(0, 60));
      }
    }
  }
  const expected = EXPECTED_OMISSIONS[ver.code] ?? [];
  ok(`${ver.code} leaves out exactly its recorded footnoted verses`,
    JSON.stringify([...omitted].sort()) === JSON.stringify([...expected].sort()),
    `omits [${omitted.join(', ')}], expected [${expected.join(', ')}]`);
  for (const [book, ch, verse, phrase] of SIGNATURES[ver.code] ?? []) {
    const vs = byRef.get(`${book} ${ch}`) ?? [];
    const hit = vs.find((v) => verse >= v.verse && verse <= (v.verseEnd ?? v.verse));
    ok(`${ver.code} ${book} ${ch}:${verse} reads like the ${ver.name}`,
      !!hit && hit.text.includes(phrase), hit?.text.slice(0, 80) ?? 'missing');
  }
  ok(`${ver.code} has signature checks`, (SIGNATURES[ver.code] ?? []).length > 0);
  allText.set(ver.code, byRef);
}

// Cut-short or swollen verses. Each verse's word count is compared with the
// median of the other translations over the same verse numbers (a combined
// passage against the sum of the verses it covers). Rule and reviewed
// exceptions: scripts/lib/verse-length-exceptions.json.
{
  const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const entries = new Map<string, Map<string, { end: number; words: number }>>();
  for (const [code, byRef] of allText) {
    const m = new Map<string, { end: number; words: number }>();
    for (const [ref, verses] of byRef) {
      for (const v of verses) m.set(`${ref}:${v.verse}`, { end: v.verseEnd ?? v.verse, words: wordCount(v.text) });
    }
    entries.set(code, m);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const allowed = new Set(LENGTH_EXCEPTIONS.groups.flatMap((g) => g.verses));
  const outliers: string[] = [];
  let compared = 0;
  for (const [code, m] of entries) {
    for (const [key, { end, words }] of m) {
      const [ref, first] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
      const others: number[] = [];
      for (const [other, om] of entries) {
        if (other === code) continue;
        let sum = 0;
        let usable = true;
        for (let n = first; n <= end && usable; n++) {
          const e = om.get(`${ref}:${n}`);
          if (!e || e.end !== n) usable = false; // missing here, or combined differently
          else sum += e.words;
        }
        if (usable) others.push(sum);
      }
      if (others.length < 3) continue;
      compared++;
      const med = median(others);
      const short = med >= 10 && words < 0.4 * med;
      const long = med >= 6 && words > 2.6 * med && words - med > 15;
      if (short || long) outliers.push(`${code} ${key}`);
      if ((short || long) && !allowed.has(`${code} ${key}`)) {
        ok(`${code} ${key} is about as long as in other translations`, false,
          `${words} words, others ~${med} (${short ? 'cut short?' : 'extra text?'})`);
      }
    }
  }
  ok('verse lengths were compared across translations', compared > 200000, String(compared));
  const stale = [...allowed].filter((k) => !outliers.includes(k));
  if (stale.length) console.log(`  (verse-length exceptions no longer needed: ${stale.join(', ')})`);
  console.log(`  ${compared} verses compared across translations, ${outliers.length} reviewed outliers`);
}

// The combined passages that started this: NCV Numbers 7 is complete again.
{
  const n7 = JSON.parse(readFileSync(join(ROOT, 'NCV', '4', '7.json'), 'utf8')) as ChapterFile;
  const combined = n7.verses.find((v) => v.verse === 12);
  ok('NCV Numbers 7:12-83 is present as one combined passage', combined?.verseEnd === 83,
    JSON.stringify(n7.verses.map((v) => v.verseEnd ? `${v.verse}-${v.verseEnd}` : v.verse)));
  const words = n7.verses.reduce((a, v) => a + v.text.split(/\s+/).length, 0);
  ok('NCV Numbers 7 is a ~4 minute chapter, not 2', Math.round(words / 225) >= 3, String(words));
}

console.log(`\n${stored.length} translations, ${chapters} chapter files, ${versesCovered} verses covered`);
if (fail === 0) {
  console.log(`BIBLE-INTEGRITY PASS ${pass} / ${pass}`);
} else {
  console.log(`BIBLE-INTEGRITY FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
