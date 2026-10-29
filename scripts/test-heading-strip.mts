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
import { stripLeadingHeadings, splitRangeLabel } from './fetch-bible-static.mjs';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const strip = (s: string, chapter?: number) => stripLeadingHeadings(s, chapter) as { text: string; stripped: string[] };

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

// ── MUST KEEP: a poetry verse whose first line has no punctuation (Oct 2026).
// The old rule called any short, capitalised, unpunctuated leading line a
// heading, and these first lines were deleted from the committed NIV/NLT.
for (const [raw, first] of [
  ['I will send fire on the house of Hazael<br/>that will consume the fortresses of Ben-Hadad.', 'I will send fire'],
  ['Woe to those who are wise in their own eyes<br/>and clever in their own sight.', 'Woe to those'],
  ['But everyone who calls on the name of the LORD<br/>will be saved.’', 'But everyone who calls'],
  ['Your towns and your fields<br/>will be blessed.', 'Your towns and your fields'],
  ['He has made my skin and my flesh grow old<br/>and has broken my bones.', 'He has made my skin'],
] as const) {
  const r = strip(raw);
  ok(`keeps the unpunctuated first poetry line "${first}"`, r.text.startsWith(first) && r.stripped.length === 0, r.text);
}

// ── MUST STRIP: a heading in the middle of a verse, and stray chapter numbers
{
  const r = strip('13<br/>And the dragon stood on the shore of the sea.<br/>The Beast out of the Sea<br/>And I saw a beast coming out of the sea.', 13);
  ok('drops the chapter number and the mid-verse heading (NIV Rev 13:1)',
     r.text === 'And the dragon stood on the shore of the sea. And I saw a beast coming out of the sea.', r.text);
  ok('reports both removals', r.stripped.join('|') === '13|The Beast out of the Sea', r.stripped.join('|'));
}
{
  const r = strip('8 Then the Lord said to Moses, “Go to Pharaoh.', 8);
  ok('drops an inline chapter number before verse 1 (NIV Exod 8:1)', r.text === 'Then the Lord said to Moses, “Go to Pharaoh.', r.text);
}
{
  const r = strip('435 camels and 6,720 donkeys.', 2);
  ok('a number that is not the chapter number is scripture (Ezra 2:67)', r.text === '435 camels and 6,720 donkeys.', r.text);
}
{
  const r = strip('Eliphaz<br/>Then Eliphaz the Temanite replied:');
  ok('drops a one-word speaker heading (NIV Job)', r.text === 'Then Eliphaz the Temanite replied:', r.text);
}

// ── Combined-verse labels (NLT Numbers 1: "[20-21] …")
{
  const r = splitRangeLabel('[20-21] This is the number of men', 20) as { text: string; verseEnd?: number };
  ok('a "[20-21]" label becomes verseEnd 21', r.verseEnd === 21 && r.text === 'This is the number of men', JSON.stringify(r));
  const n = splitRangeLabel('[3] not a range', 3) as { text: string; verseEnd?: number };
  ok('anything else is left alone', n.verseEnd === undefined && n.text === '[3] not a range', JSON.stringify(n));
}

// ── Structural safety
{
  const r = strip('In the beginning God created the heavens and the earth.');
  ok('a verse with no <br/> is untouched',
     r.text === 'In the beginning God created the heavens and the earth.' && r.stripped.length === 0);
}
{
  const r = strip('Heading One<br/>Heading Two<br/>Heading Three<br/>Heading Four<br/>Actual verse text here.');
  ok('never removes more than 3 segments', r.stripped.length === 3, String(r.stripped.length));
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
