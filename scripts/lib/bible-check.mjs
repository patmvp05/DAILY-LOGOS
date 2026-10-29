/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared checks for the committed Bible text (public/bible/{CODE}/...).
 *
 * One definition of "a complete, clean chapter", used by the bolls scraper
 * (fetch-bible-static.mjs refuses to save a chapter that fails it), by
 * scripts/test-bible-integrity.mts (npm test fails if any committed chapter
 * fails it), and mirrored in Python by fetch-biblegateway.py.
 *
 * Why this exists: NCV Numbers 7 shipped with 17 of its 89 verses. The scraper
 * did not understand combined verses ("12-83") and nothing checked the result.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERSE_COUNTS = JSON.parse(readFileSync(join(HERE, 'verse-counts.json'), 'utf8'));
const JUNK_TEXT = /prohibited me from using|bolls\.life|biblegateway\.com|All rights reserved|Copyright ©/i;

/**
 * Problems with one chapter's verses (empty array = complete):
 * every verse 1..N is covered exactly once, in order, by {verse, verseEnd?}
 * entries with non-empty text. N may be one of the documented alternate
 * endings (3 John 14/15, 2 Cor 13 13/14, Rev 12 17/18); only the documented
 * footnoted verses (Matt 17:21 and friends) may be absent.
 */
export function checkChapter(verses, bookName, chapter) {
  const problems = [];
  const counts = VERSE_COUNTS.chapters[bookName];
  if (!counts || chapter < 1 || chapter > counts.length) return [`no verse count for ${bookName} ${chapter}`];
  const key = `${bookName} ${chapter}`;
  const allowedLast = [counts[chapter - 1], ...(VERSE_COUNTS.alternateLastVerse[key] || [])];
  const omittable = new Set(
    VERSE_COUNTS.omittable.verses
      .filter((r) => r.split(':')[0] === key)
      .map((r) => Number(r.split(':')[1]))
  );

  const have = new Set();
  let lastEnd = 0;
  for (const v of verses) {
    const start = v.verse;
    const end = v.verseEnd ?? v.verse;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      problems.push(`bad verse numbers ${start}-${end}`);
      continue;
    }
    if (start <= lastEnd) problems.push(`verse ${start} out of order or overlapping`);
    lastEnd = Math.max(lastEnd, end);
    if (!String(v.text || '').trim()) problems.push(`verse ${start} is empty`);
    for (let n = start; n <= end; n++) have.add(n);
  }

  // Text that is not scripture: a notice served in place of every verse (bolls
  // began answering NIV requests with a statement from its owner, Oct 2026,
  // while every verse number was still present), or one text repeated.
  const texts = verses.map((v) => String(v.text || ''));
  if (texts.some((t) => JUNK_TEXT.test(t))) problems.push('notice or page text instead of scripture');
  if (texts.length >= 5) {
    const counts = new Map();
    for (const t of texts) counts.set(t, (counts.get(t) || 0) + 1);
    const top = Math.max(...counts.values());
    if (top > texts.length / 2) problems.push(`${top} of ${texts.length} verses have identical text`);
  }

  let best = null;
  for (const n of allowedLast) {
    const missing = [];
    for (let i = 1; i <= n; i++) if (!have.has(i) && !omittable.has(i)) missing.push(i);
    const extra = [...have].filter((x) => x > n).sort((a, b) => a - b);
    if (!missing.length && !extra.length) { best = null; break; }
    if (!best || missing.length + extra.length < best.missing.length + best.extra.length) best = { missing, extra };
  }
  if (best?.missing.length) problems.push(`missing verses ${best.missing.join(',')}`);
  if (best?.extra.length) problems.push(`unexpected verses ${best.extra.join(',')}`);
  return problems;
}

/** The footnoted verses a chapter leaves out (for the per-translation record). */
export function omittedVerses(verses, bookName, chapter) {
  const key = `${bookName} ${chapter}`;
  const have = new Set();
  for (const v of verses) for (let n = v.verse; n <= (v.verseEnd ?? v.verse); n++) have.add(n);
  return VERSE_COUNTS.omittable.verses
    .filter((r) => r.split(':')[0] === key && !have.has(Number(r.split(':')[1])));
}

const SPACED_ELLIPSIS = /\.(?:\s\.){2,}/g;

/**
 * Remove spaces that markup boundaries inserted before closing punctuation
 * ("the Lord ." -> "the Lord."). Mirrors tidy() in fetch-biblegateway.py.
 * Spaced ellipses (". . .") and the space between two adjacent closing quotes
 * ("’ ”") are printed typography and are left alone.
 */
export function tidyVerseText(text) {
  const kept = [];
  let t = String(text).replace(/\s+/g, ' ').trim();
  t = t.replace(SPACED_ELLIPSIS, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  t = t
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/([“‘])\s+/g, '$1')
    .replace(/(?<=[\p{L}\p{N}_.,;:!?)\]—–-])\s+([”’])(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/(?<=[\p{L}\p{N}_])\s+(’s)\b/gu, '$1');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]).trim();
}

/** Text-level defects a clean verse must not contain. */
export const TEXT_DEFECTS = [
  { name: 'space before punctuation', re: /(?<![.\s])\s[.,;:!?](?!\s?\.)/ },
  { name: 'space after opening quote or bracket', re: /[“‘(\[]\s/ },
  { name: 'footnote or cross-reference marker', re: /\[\s?[a-z]{1,2}\s?\]|\(\s?[A-Z]{1,2}\s?\)/ },
  { name: 'combined-verse label left in text', re: /^\s*\[\d+\s*[-–]\s*\d+\]/ },
  { name: 'html', re: /<[a-z/][^>]*>|&[a-z]+;/i },
];
