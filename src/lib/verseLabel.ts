/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Combined verses.
 *
 * Some translations print two or more verses as one passage: the NCV has
 * Genesis 8:3-4 and Numbers 7:12-83 (the twelve leaders' identical gifts, listed
 * once), the NLT has Numbers 1:20-21. A chapter file stores such a passage once,
 * as { verse: 3, verseEnd: 4, text }. Everything that shows or counts verse
 * numbers goes through these helpers, so a combined passage reads "3–4" instead
 * of looking like verse 4 is missing.
 */
export interface NumberedVerse {
  verse: number;
  verseEnd?: number;
  text: string;
}

/** The last verse number an entry covers (its own number for a single verse). */
export function lastVerseOf(v: NumberedVerse): number {
  return v.verseEnd && v.verseEnd > v.verse ? v.verseEnd : v.verse;
}

/** "3" or, for a combined passage, "3–4" (en dash). */
export function verseLabel(v: NumberedVerse): string {
  const end = lastVerseOf(v);
  return end > v.verse ? `${v.verse}–${end}` : String(v.verse);
}

/** Same as verseLabel but with a hyphen, for copied references ("Gen 8:3-4"). */
export function verseLabelPlain(v: NumberedVerse): string {
  const end = lastVerseOf(v);
  return end > v.verse ? `${v.verse}-${end}` : String(v.verse);
}

/** Last verse number of a chapter, honouring a combined final passage. */
export function lastVerseInChapter(verses: NumberedVerse[]): number | null {
  return verses.length > 0 ? lastVerseOf(verses[verses.length - 1]) : null;
}

/**
 * The end of the next entry after verse `after`, i.e. how far one "expand"
 * step reaches. Null when there is nothing further in this chapter.
 */
export function nextEntryEnd(verses: NumberedVerse[], after: number): number | null {
  const next = verses.find((v) => v.verse > after);
  return next ? lastVerseOf(next) : null;
}

/**
 * The end of the entry before the one ending at `end`, i.e. how far one
 * "contract" step goes back. Null when there is no earlier entry.
 */
export function prevEntryEnd(verses: NumberedVerse[], end: number): number | null {
  let prev: NumberedVerse | undefined;
  for (const v of verses) {
    if (lastVerseOf(v) < end && v.verse < end) prev = v;
  }
  return prev ? lastVerseOf(prev) : null;
}
