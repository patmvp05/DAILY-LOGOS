/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for stripping bolls' inline section headings.
 *
 * Every input below is a VERBATIM raw string captured from bolls.life on a
 * GitHub runner (see probe-translations.yml round 3). The danger this guards
 * against is over-reach: <br/> is bolls' poetry line break as well as its
 * heading separator, so a careless rule deletes scripture. The "must keep"
 * cases matter more than the "must strip" ones.
 *
 * Run with: npx tsx scripts/test-heading-strip.mts
 */
import { stripLeadingHeadings } from './fetch-bible-static.mjs';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const strip = (s: string) => stripLeadingHeadings(s) as { text: string; stripped: string[] };

// ── MUST STRIP: real headings observed in NIV
{
  const r = strip('Psalm 23<br/>A psalm of David.<br/>The Lord is my shepherd, I shall not be in want.');
  ok('drops the "Psalm 23" chapter label', !r.text.startsWith('Psalm 23'), r.text);
  ok('KEEPS the "A psalm of David." superscription',
     r.text.startsWith('A psalm of David.'), r.text);
  ok('keeps the verse body intact', r.text.endsWith('I shall not be in want.'), r.text);
  ok('reports exactly what it removed',
     r.stripped.join('|') === 'Psalm 23', r.stripped.join('|'));
}
{
  const r = strip('Jesus Teaches Nicodemus<br/>Now there was a man of the Pharisees named Nicodemus, a member of the Jewish ruling council.');
  ok('drops a mid-chapter section heading', r.text.startsWith('Now there was a man'), r.text);
  ok('audit lists the heading', r.stripped[0] === 'Jesus Teaches Nicodemus');
}
{
  const r = strip('The Beginning<br/>In the beginning God created the heavens and the earth.');
  ok('drops "The Beginning"',
     r.text === 'In the beginning God created the heavens and the earth.', r.text);
}

// ── MUST KEEP: poetry line breaks are not headings
{
  const r = strip('He makes me lie down in green pastures,<br/>he leads me beside quiet waters,');
  ok('keeps a poetry line ending in a comma',
     r.text === 'He makes me lie down in green pastures, he leads me beside quiet waters,', r.text);
  ok('strips nothing from poetry', r.stripped.length === 0);
}
{
  const r = strip('he restores my soul.<br/>He guides me in paths of righteousness<br/>for his name’s sake.');
  ok('keeps a lowercase-leading poetry verse',
     r.text.startsWith('he restores my soul.'), r.text);
  ok('keeps every poetry segment',
     r.text.endsWith('for his name’s sake.'), r.text);
  ok('strips nothing', r.stripped.length === 0);
}
{
  // The riskiest shape: capitalised, no trailing punctuation, but it IS prose —
  // protected by the 60-char limit.
  const long = 'And God said let there be a firmament in the midst of the waters and let it divide';
  const r = strip(`${long}<br/>the waters from the waters`);
  ok('a long unpunctuated leading line is NOT treated as a heading',
     r.stripped.length === 0 && r.text.startsWith('And God said'), JSON.stringify(r.stripped));
}
{
  const r = strip('darkness <i>was</i> on the face of the deep.');
  ok('NKJV italic supplied-words are unwrapped, not dropped',
     r.text === 'darkness was on the face of the deep.', r.text);
}

// ── Structural safety
{
  const r = strip('In the beginning God created the heavens and the earth.');
  ok('a verse with no <br/> is untouched',
     r.text === 'In the beginning God created the heavens and the earth.' && r.stripped.length === 0);
}
{
  const r = strip('Heading One<br/>Heading Two<br/>Heading Three<br/>Actual verse text here.');
  ok('never removes more than 2 leading segments', r.stripped.length === 2, String(r.stripped.length));
  ok('so a mis-hit can never consume the whole verse',
     r.text.includes('Actual verse text here.'), r.text);
}
{
  ok('empty input is safe', strip('').text === '');
  ok('only-a-heading input keeps the heading rather than emptying the verse',
     strip('Just A Heading').text === 'Just A Heading');
}
{
  const r = strip('A Heading<br/>');
  ok('a trailing-empty verse never becomes blank from stripping',
     r.text.length > 0 || r.stripped.length === 0, JSON.stringify(r));
}

console.log('');
if (fail === 0) {
  console.log(`HEADING-STRIP PASS ${pass} / ${pass}`);
} else {
  console.log(`HEADING-STRIP FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
