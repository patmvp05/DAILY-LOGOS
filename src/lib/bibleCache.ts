/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveBibleVersion } from '../constants';
import { getChapterText } from './chapterText';

// v13 (Oct 29 2026): NIV psalm titles restored, so verse 1 and the reading
// time of 116 NIV psalms changed.
// v12 (Oct 2026): the committed text was repaired (see CACHE_PREFIX in
// chapterText.ts). A preview cached from the broken text kept its reading time
// forever: NCV Numbers 7 showed "~2 MIN" for a chapter that is about 4.
// (v11 discarded KJV-fallback previews cached under a modern version's key.)
const CACHE_PREFIX = 'bible_chapter_cache_v13_';
const STALE_PREFIX = /^bible_chapter_cache_v\d+_/;

/** Remove previews cached under an older prefix. Best effort, synchronous. */
export function purgeStalePreviewCache(): number {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && STALE_PREFIX.test(k) && !k.startsWith(CACHE_PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
    return stale.length;
  } catch {
    return 0;
  }
}

interface ChapterInfo {
  firstVerse: string;
  readTime: number;
}

// L1 Cache (In-Memory) to avoid repeated localStorage hits and JSON parsing.
const memoryCache = new Map<string, ChapterInfo>();

function cacheKey(version: string, bookName: string, chapter: number): string {
  return `${CACHE_PREFIX}${resolveBibleVersion(version)}_${bookName}_${chapter}`;
}

/**
 * Synchronous best-effort read-time lookup (no network). Returns null if the
 * chapter hasn't been fetched yet in this version, in which case callers fall
 * back to a per-book estimate.
 */
export function getCachedReadTime(bookName: string, chapter: number, version?: string): number | null {
  const key = cacheKey(version || '', bookName, chapter);

  const memCached = memoryCache.get(key);
  if (memCached) return memCached.readTime;

  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as ChapterInfo;
      if (parsed && typeof parsed.readTime === 'number') {
        memoryCache.set(key, parsed);
        return parsed.readTime;
      }
    }
  } catch {
    // ignored
  }
  return null;
}

/**
 * Seed the chapter info cache from already-fetched verses so synchronous
 * `getCachedReadTime` callers (e.g. Daily Proverb logging) have the real
 * 225-wpm reading time without an extra fetch.
 */
export function seedChapterInfoFromText(
  bookName: string,
  chapter: number,
  version: string | undefined,
  verses: Array<{ text: string }>,
  isFallback?: boolean
): number {
  const id = resolveBibleVersion(version);
  const key = cacheKey(id, bookName, chapter);
  const firstVerse = verses[0]?.text?.trim() || 'Text not available';
  const wordCount = verses.reduce((acc, v) => acc + (v.text ? v.text.trim().split(/\s+/).filter(Boolean).length : 0), 0);
  const readTime = Math.max(1, Math.round(wordCount / 225));
  const result: ChapterInfo = { firstVerse, readTime };
  memoryCache.set(key, result);
  if (!isFallback) {
    try {
      localStorage.setItem(key, JSON.stringify(result));
    } catch {
      // ignore storage errors
    }
  }
  return readTime;
}

/**
 * Fetch the first-verse preview + estimated read time for a chapter in the
 * user's selected version. Delegates to getChapterText (the single source of
 * truth) so the card preview always matches the version shown in the reader.
 */
export async function getChapterInfo(
  bookName: string,
  chapter: number,
  version?: string
): Promise<ChapterInfo> {
  const id = resolveBibleVersion(version);
  const key = cacheKey(id, bookName, chapter);

  // 1. L1 (memory)
  const memCached = memoryCache.get(key);
  if (memCached) return memCached;

  // 2. L2 (localStorage)
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as ChapterInfo;
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // fall through to fetch
  }

  try {
    const ct = await getChapterText(bookName, chapter, id);

    const firstVerse = ct.verses[0]?.text?.trim() || 'Text not available';
    const wordCount = ct.verses.reduce((acc, v) => acc + (v.text ? v.text.split(/\s+/).length : 0), 0);
    const readTime = Math.max(1, Math.round(wordCount / 225));

    const result: ChapterInfo = { firstVerse, readTime };

    // Memory-cache always; only persist a preview built from the genuinely
    // requested translation — never a KJV fallback (ct._fallback), so a missing
    // modern version's card preview self-heals once its static files deploy.
    memoryCache.set(key, result);
    if (!ct._fallback) {
      try {
        localStorage.setItem(key, JSON.stringify(result));
      } catch {
        console.warn('Failed to cache bible chapter info');
      }
    }

    return result;
  } catch (err) {
    console.error(`Failed to fetch chapter info for ${bookName} ${chapter}:`, err);
    return { firstVerse: 'Could not load preview.', readTime: 0 };
  }
}
