/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit checks for the pure helpers behind the in-app chapter reader.
 * Run with: npx tsx scripts/test-chapter-text.mts
 */
import { cleanVerseText } from '../src/lib/chapterText';
import { resolveBibleVersion } from '../src/constants';

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

eq('collapses embedded newlines from bible-api.com',
  cleanVerseText('In the beginning\nGod created\nthe heavens'),
  'In the beginning God created the heavens');

// ── resolveBibleVersion ──────────────────────────────────────────────────────
eq('known lowercase code passes through', resolveBibleVersion('web'), 'web');
eq('legacy uppercase KJV normalizes to kjv', resolveBibleVersion('KJV'), 'kjv');
eq('mixed-case WEBBE normalizes', resolveBibleVersion('WEBBE'), 'webbe');
eq('incomplete OEB is rejected (not offered) → kjv', resolveBibleVersion('oeb-us'), 'kjv');
eq('unknown/copyrighted code falls back to default kjv', resolveBibleVersion('ESV'), 'kjv');
eq('undefined falls back to default kjv', resolveBibleVersion(undefined), 'kjv');
eq('empty string falls back to default kjv', resolveBibleVersion(''), 'kjv');

// ── report ──────────────────────────────────────────────────────────────────
if (fail > 0) {
  console.error(failures.join('\n'));
  console.error(`\nCHAPTER-TEXT FAIL ${pass} / ${pass + fail}`);
  process.exit(1);
} else {
  console.log(`CHAPTER-TEXT PASS ${pass} / ${pass + fail}`);
}
