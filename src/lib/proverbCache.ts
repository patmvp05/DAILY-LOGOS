/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addDays, subDays } from 'date-fns';
import { getChapterText, refetchChapterText } from './chapterText';
import type { ChapterCheck } from './chapterCheck';
import { seedChapterInfoFromText } from './bibleCache';
import { resolveBibleVersion } from '../constants';

export interface ProverbResponse {
  reference: string;
  verses: { verse: number; text: string; verseEnd?: number }[];
  translation_id: string;
  translation_name: string;
  /** Text check of this copy (src/lib/chapterCheck.ts). */
  check?: ChapterCheck;
}

/**
 * Fetch a chapter of Proverbs in the user's selected Bible version. Delegates
 * to getChapterText so the daily proverb, the in-app reader, and the card
 * previews always agree on the same text for a given version.
 *
 * Keeps no cache of its own. getChapterText already holds the chapter in memory
 * and IndexedDB; a second copy here went stale whenever the chapter was
 * downloaded again by anything other than refetchProverb (the dashboard's
 * "Download again" calls refetchChapterText directly).
 */
export async function getProverb(chapter: number, version?: string): Promise<ProverbResponse> {
  const id = resolveBibleVersion(version);
  const ct = await getChapterText('Proverbs', chapter, id);
  // The reading time of a KJV stand-in or of a copy that failed its check is
  // good for this session only: never written to storage.
  seedChapterInfoFromText('Proverbs', chapter, id, ct.verses, ct._fallback || ct._check?.ok === false);

  return {
    reference: ct.reference,
    verses: ct.verses,
    translation_id: ct.translationId,
    translation_name: ct.translationName,
    check: ct._check,
  };
}

/**
 * Forget the saved copies of a proverb chapter and download it again (the
 * "Download again" button when it fails its text check).
 */
export async function refetchProverb(chapter: number, version?: string): Promise<ProverbResponse> {
  const id = resolveBibleVersion(version);
  await refetchChapterText('Proverbs', chapter, id);
  return getProverb(chapter, id);
}

/**
 * Warm the cache for yesterday/today/tomorrow's proverb in the selected
 * version, so opening the proverb modal is instant and works offline.
 */
export async function prefetchProverbs(version?: string) {
  // Real calendar math, not ±1 clamped to 31: after a 30-day month, "yesterday"
  // on the 1st is chapter 30 (not 31), and "tomorrow" on the 30th is chapter 1.
  const now = new Date();
  const days = Array.from(
    new Set([subDays(now, 1).getDate(), now.getDate(), addDays(now, 1).getDate()])
  );

  for (const d of days) {
    try {
      await getProverb(d, version);
    } catch {
      // Ignore prefetch failures — the live fetch will retry on demand.
    }
  }
}
