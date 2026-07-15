/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addDays, subDays } from 'date-fns';
import { getChapterText } from './chapterText';
import { resolveBibleVersion } from '../constants';

export interface ProverbResponse {
  reference: string;
  verses: { verse: number; text: string }[];
  text: string;
  translation_id: string;
  translation_name: string;
  _cachedAt?: number;
}

// L1 cache, keyed by version + chapter so switching translations never serves
// the previous version's text. (The heavy lifting — network, IndexedDB cache,
// HTML cleaning, KJV fall-back — is all handled by getChapterText, the single
// source of truth for scripture text across the whole app.)
const memoryCache = new Map<string, ProverbResponse>();

/**
 * Fetch a chapter of Proverbs in the user's selected Bible version. Delegates
 * to getChapterText so the daily proverb, the in-app reader, and the card
 * previews always agree on the same text for a given version.
 */
export async function getProverb(chapter: number, version?: string): Promise<ProverbResponse> {
  const id = resolveBibleVersion(version);
  const memKey = `${id}_${chapter}`;

  const memCached = memoryCache.get(memKey);
  if (memCached) return memCached;

  const ct = await getChapterText('Proverbs', chapter, id);

  const result: ProverbResponse = {
    reference: ct.reference,
    verses: ct.verses,
    text: ct.verses.map((v) => v.text).join(' '),
    translation_id: ct.translationId,
    translation_name: ct.translationName,
    _cachedAt: ct._cachedAt,
  };

  memoryCache.set(memKey, result);
  return result;
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
