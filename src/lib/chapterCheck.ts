/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import VERSE_COUNTS from '../../scripts/lib/verse-counts.json';

/**
 * Is this chapter's text complete? Checked on the phone every time a chapter
 * is loaded, and so every day for the seven chapters per part the app
 * preloads.
 *
 * NCV Numbers 7 once reached this screen with 17 of its 89 verses and nobody
 * could tell. The server now refuses to publish an incomplete chapter
 * (scripts/test-bible-integrity.mts); this is the second, independent check on
 * the copy actually shown, including copies saved on the phone. Same verse
 * table and same rules as scripts/lib/bible-check.mjs; a test asserts the two
 * agree on every stored chapter.
 */
export interface ChapterCheck {
  ok: boolean;
  /** Last verse number of the chapter in this translation (3 John: 14 or 15). */
  lastVerse: number;
  /** Verses printed only as footnotes in this translation (e.g. Matt 17:21). */
  footnoted: number[];
  /** Verse numbers that should be here and are not. */
  missing: number[];
  /** Plain-language reasons when ok is false. */
  problems: string[];
}

interface NumberedVerse {
  verse: number;
  verseEnd?: number;
  text: string;
}

const counts = VERSE_COUNTS.chapters as Record<string, number[]>;
const alternates = VERSE_COUNTS.alternateLastVerse as unknown as Record<string, number[] | string>;
const omittable = VERSE_COUNTS.omittable.verses as string[];
const JUNK_TEXT = /prohibited me from using|bolls\.life|biblegateway\.com|All rights reserved|Copyright ©/i;

export function checkChapterVerses(verses: NumberedVerse[], bookName: string, chapter: number): ChapterCheck {
  const fail = (problems: string[], lastVerse = 0, missing: number[] = []): ChapterCheck =>
    ({ ok: false, lastVerse, footnoted: [], missing, problems });

  const chapterCounts = counts[bookName];
  if (!chapterCounts || chapter < 1 || chapter > chapterCounts.length) {
    return fail([`No verse count for ${bookName} ${chapter}`]);
  }
  const key = `${bookName} ${chapter}`;
  const alt = alternates[key];
  const allowedLast = [chapterCounts[chapter - 1], ...(Array.isArray(alt) ? alt : [])];
  const mayOmit = new Set(
    omittable.filter((r) => r.split(':')[0] === key).map((r) => Number(r.split(':')[1]))
  );

  const problems: string[] = [];
  const have = new Set<number>();
  let lastEnd = 0;
  for (const v of verses) {
    const start = v.verse;
    const end = v.verseEnd ?? v.verse;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      problems.push(`Bad verse number ${start}`);
      continue;
    }
    if (start <= lastEnd) problems.push(`Verse ${start} is out of order or repeated`);
    lastEnd = Math.max(lastEnd, end);
    if (!String(v.text || '').trim()) problems.push(`Verse ${start} is empty`);
    for (let n = start; n <= end; n++) have.add(n);
  }

  const texts = verses.map((v) => String(v.text || ''));
  if (texts.some((t) => JUNK_TEXT.test(t))) problems.push('Contains a notice instead of scripture');
  if (texts.length >= 5) {
    const freq = new Map<string, number>();
    for (const t of texts) freq.set(t, (freq.get(t) ?? 0) + 1);
    const top = Math.max(...freq.values());
    if (top > texts.length / 2) problems.push(`${top} of ${texts.length} verses have identical text`);
  }

  let best: { last: number; missing: number[]; extra: number[] } | null = null;
  for (const n of allowedLast) {
    const missing: number[] = [];
    for (let i = 1; i <= n; i++) if (!have.has(i) && !mayOmit.has(i)) missing.push(i);
    const extra = [...have].filter((x) => x > n).sort((a, b) => a - b);
    if (!missing.length && !extra.length) { best = { last: n, missing, extra }; break; }
    if (!best || missing.length + extra.length < best.missing.length + best.extra.length) {
      best = { last: n, missing, extra };
    }
  }
  const last = best?.last ?? allowedLast[0];
  if (best?.missing.length) problems.push(`Missing ${describeVerses(best.missing)}`);
  if (best?.extra.length) problems.push(`Unexpected ${describeVerses(best.extra)}`);
  const footnoted = [...mayOmit].filter((n) => n <= last && !have.has(n)).sort((a, b) => a - b);

  return { ok: problems.length === 0, lastVerse: last, footnoted, missing: best?.missing ?? [], problems };
}

/** "verse 4", "verses 3–4", "verses 12–83 and 85". */
export function describeVerses(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    runs.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  const label = sorted.length === 1 ? 'verse' : 'verses';
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}` : runs[0];
  return `${label} ${list}`;
}
