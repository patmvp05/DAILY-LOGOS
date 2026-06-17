/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveBibleVersion } from '../constants';
import { getChapterText } from './chapterText';

// v10: direct browser fetch to bolls.life; NCV added. Bump discards v9 stale entries.
const CACHE_PREFIX = 'bible_chapter_cache_v10_';

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

    memoryCache.set(key, result);
    try {
      localStorage.setItem(key, JSON.stringify(result));
    } catch {
      console.warn('Failed to cache bible chapter info');
    }

    return result;
  } catch (err) {
    console.error(`Failed to fetch chapter info for ${bookName} ${chapter}:`, err);
    return { firstVerse: 'Could not load preview.', readTime: 0 };
  }
}
