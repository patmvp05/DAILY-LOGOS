/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOLLS_BIBLE_BOOK_IDS } from '../constants';
import { fetchWithProxy } from './api';

const CACHE_PREFIX = 'bible_chapter_cache_v8_';

interface ChapterInfo {
  firstVerse: string;
  readTime: number;
}

// L1 Cache (In-Memory) to avoid repeated localStorage hits and JSON parsing
const memoryCache = new Map<string, ChapterInfo>();

export function getCachedReadTime(bookName: string, chapter: number): number | null {
  const translation = 'KJV';
  const cacheKey = `${CACHE_PREFIX}${translation}_${bookName}_${chapter}`;
  
  const memCached = memoryCache.get(cacheKey);
  if (memCached) return memCached.readTime;
  
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ChapterInfo;
      if (parsed && typeof parsed.readTime === 'number') {
        memoryCache.set(cacheKey, parsed);
        return parsed.readTime;
      }
    }
  } catch {
    // ignored
  }
  return null;
}

export async function getChapterInfo(bookName: string, chapter: number): Promise<ChapterInfo> {
  const translation = 'KJV';
  const cacheKey = `${CACHE_PREFIX}${translation}_${bookName}_${chapter}`;
  
  // 1. Check L1 Cache first (Memory)
  const memCached = memoryCache.get(cacheKey);
  if (memCached) return memCached;

  // 2. Check L2 Cache (localStorage)
  let cached = null;
  try {
    cached = localStorage.getItem(cacheKey);
  } catch {
    console.warn("localStorage access denied in bibleCache");
  }
  
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      memoryCache.set(cacheKey, parsed);
      return parsed;
    } catch {
      try { localStorage.removeItem(cacheKey); } catch { /* ignored */ }
    }
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const bookId = BOLLS_BIBLE_BOOK_IDS[bookName] || 1;
    let data: { text?: string; content?: string }[] | string[] | null = null;

    if (bookName === 'Proverbs') {
      // Proverbs should try ESV first via API for consistent translation
      for (const trans of ['ESV', 'KJV']) {
        try {
          const apiData = await fetchWithProxy(`https://bolls.life/get-chapter/${trans}/20/${chapter}/`, controller.signal);
          if (Array.isArray(apiData) && apiData.length > 0) {
            // Validate: Is it a list of cross-references instead of actual scripture?
            const sampleVerses = apiData.slice(0, 5);
            let totalWords = 0;
            let referenceLikeCount = 0;
            
            sampleVerses.forEach((v: unknown) => {
              const item = v as Record<string, string> | null;
              const txt = (item && typeof item === 'object') ? (item.text || item.content || "") : String(v);
              const cleantxt = txt.replace(/<[^>]*>/g, '').trim();
              const words = cleantxt.split(/\s+/).filter((w: string) => w.length > 0);
              totalWords += words.length;
              
              if (/^[1-2]?\s*[A-Za-z.]+\s*\d+:\d+/.test(cleantxt) || /^[0-9]+:[0-9]+/.test(cleantxt) || txt.includes('bolls.life') || txt.includes('http')) {
                referenceLikeCount++;
              }
            });
            
            const avgWords = totalWords / sampleVerses.length;
            if (avgWords < 5 || referenceLikeCount > sampleVerses.length / 2) {
              console.warn(`Bolls.life bibleCache returned references instead of text for Proverbs ${chapter} in ${trans}. Skipping.`);
            } else {
              data = apiData as { text?: string; content?: string }[];
              break;
            }
          }
        } catch { /* ignored */ }
      }
    } else {
      try {
        data = await fetchWithProxy(`https://bolls.life/get-chapter/KJV/${bookId}/${chapter}/`, controller.signal) as { text?: string; content?: string }[];
      } catch {
        data = null;
      }
    }

    // Fallback if Bolls.life failed
    if (!data || !Array.isArray(data)) {
      try {
        const response = await fetch(`https://bible-api.com/${bookName}+${chapter}?translation=kjv`, { signal: controller.signal });
        if (response.ok) {
          const apiData = await response.json();
          if (apiData.verses && apiData.verses.length > 0) {
            data = apiData.verses as { text?: string; content?: string }[];
          }
        }
      } catch { /* ignored */ }
    }
    
    if (!data || !Array.isArray(data)) throw new Error("Invalid response format or data not found");

    // Robust extraction of first verse
    let firstVerseRaw = "";
    if (data.length > 0) {
      // Find the first verse (usually index 0, but handle it safely)
      const firstVal = data[0];
      firstVerseRaw = typeof firstVal === 'string' ? firstVal : (firstVal.text || firstVal.content || "");
    }

    const firstVerse = firstVerseRaw
      ? firstVerseRaw
          .replace(/<S>[^<]*<\/S>/gi, '') // Remove Strong's tags
          .replace(/<[^>]*>/g, '')      // Remove any other tags
          .replace(/^\[\d+\]\s*/, '')   // Remove [1] at start
          .trim() 
      : "Text not available";
    
    const wordCount = data.reduce((acc: number, v: string | { text?: string; content?: string }) => {
      const textVal = typeof v === 'string' ? v : (v.text || v.content || "");
      const cleanText = textVal.replace(/<S>[^<]*<\/S>/gi, '').replace(/<[^>]*>/g, '').trim();
      return acc + (cleanText ? cleanText.split(/\s+/).length : 0);
    }, 0);
    
    const readTime = Math.max(1, Math.round(wordCount / 225));

    const result: ChapterInfo = {
      firstVerse,
      readTime
    };

    // 3. Update both caches
    memoryCache.set(cacheKey, result);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(result));
    } catch {
      console.warn("Failed to cache bible chapter info");
    }
    
    return result;
  } catch (err) {
    console.error(`Failed to fetch chapter info for ${bookName} ${chapter}:`, err);
    return {
      firstVerse: "Could not load preview.",
      readTime: 0
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
