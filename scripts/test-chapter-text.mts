/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit checks for the pure helpers behind the in-app chapter reader.
 * Run with: npx tsx scripts/test-chapter-text.mts
 */
import { cleanVerseText, looksLikeReferenceList } from '../src/lib/chapterText';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; }
  else { fail++; failures.push(`✗ ${name}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
}

// ── cleanVerseText ──────────────────────────────────────────────────────────
eq('strips Strong\'s tags',
  cleanVerseText('In the beginning<S>7225</S> God<S>430</S> created'),
  'In the beginning God created');

eq('strips arbitrary HTML tags',
  cleanVerseText('<i>And</i> the <b>earth</b> was without form'),
  'And the earth was without form');

eq('converts <br> to space and collapses whitespace',
  cleanVerseText('Line one<br/>Line two   with    gaps'),
  'Line one Line two with gaps');

eq('strips superscripts and trims',
  cleanVerseText('  <sup>1</sup>The text  '),
  'The text');

eq('leaves clean text untouched',
  cleanVerseText('For God so loved the world'),
  'For God so loved the world');

// ── looksLikeReferenceList ──────────────────────────────────────────────────
const realScripture = [
  { verse: 1, text: 'In the beginning God created the heaven and the earth.' },
  { verse: 2, text: 'And the earth was without form, and void; and darkness was upon the face of the deep.' },
  { verse: 3, text: 'And God said, Let there be light: and there was light.' },
];
eq('real scripture is NOT a reference list', looksLikeReferenceList(realScripture), false);

const crossRefs = [
  { verse: 1, text: 'John 1:1' },
  { verse: 2, text: '1 Cor 2:3' },
  { verse: 3, text: 'Gen 1:1' },
];
eq('cross-reference list IS detected', looksLikeReferenceList(crossRefs), true);

eq('empty array is treated as non-scripture', looksLikeReferenceList([]), true);

const linkSpam = [
  { verse: 1, text: 'see https://bolls.life/x' },
  { verse: 2, text: 'http://example.com' },
  { verse: 3, text: 'http://example.org' },
];
eq('link spam IS detected', looksLikeReferenceList(linkSpam), true);

// ── report ──────────────────────────────────────────────────────────────────
if (fail > 0) {
  console.error(failures.join('\n'));
  console.error(`\nCHAPTER-TEXT FAIL ${pass} / ${pass + fail}`);
  process.exit(1);
} else {
  console.log(`CHAPTER-TEXT PASS ${pass} / ${pass + fail}`);
}
