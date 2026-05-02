/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOLLS_BIBLE_BOOK_IDS } from '../constants';
import { fetchWithProxy } from './api';

const CACHE_PREFIX = 'bible_chapter_cache_v7_';

interface ChapterInfo {
  firstVerse: string;
  readTime: number;
}

// L1 Cache (In-Memory) to avoid repeated localStorage hits and JSON parsing
const memoryCache = new Map<string, ChapterInfo>();

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
  } catch (e) {
    console.warn("localStorage access denied in bibleCache");
  }
  
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      memoryCache.set(cacheKey, parsed);
      return parsed;
    } catch (e) {
      try { localStorage.removeItem(cacheKey); } catch(_) {}
    }
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const bookId = BOLLS_BIBLE_BOOK_IDS[bookName] || 1;
    let data: any[] | null = null;

    if (bookName === 'Proverbs') {
      // Proverbs should try ESV first via API for consistent translation
      for (const trans of ['ESV', 'KJV']) {
        try {
          const apiData = await fetchWithProxy(`https://bolls.life/get-chapter/${trans}/20/${chapter}/`, controller.signal);
          if (Array.isArray(apiData)) {
            data = apiData;
            break;
          }
        } catch (e) {}
      }
    } else {
      try {
        data = await fetchWithProxy(`https://bolls.life/get-chapter/KJV/${bookId}/${chapter}/`, controller.signal);
      } catch (e) {
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
            data = apiData.verses;
          }
        }
      } catch (e) {}
    }
    
    if (!data || !Array.isArray(data)) throw new Error("Invalid response format or data not found");

    const firstVerse = data.length > 0 
      ? (data[0].text || "")
          .replace(/<S>[^<]*<\/S>/gi, '') // Remove Strong's tag AND its content
          .replace(/<[^>]*>/g, '')      // Remove any other tags
          .replace(/^\[\d+\]\s*/, '')   // Remove [1] at start
          .trim() 
      : "Text not available";
    
    const wordCount = data.reduce((acc: number, v: any) => {
      const cleanText = (v.text || "").replace(/<S>[^<]*<\/S>/gi, '').replace(/<[^>]*>/g, '').trim();
      return acc + cleanText.split(/\s+/).length;
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
    } catch (e) {
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
