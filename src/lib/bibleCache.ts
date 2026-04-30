/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOLLS_BIBLE_BOOK_IDS } from '../constants';

const CACHE_PREFIX = 'bible_chapter_cache_v7_';

interface ChapterInfo {
  firstVerse: string;
  readTime: number;
}

export async function getChapterInfo(bookName: string, chapter: number): Promise<ChapterInfo> {
  const translation = 'KJV';
  const cacheKey = `${CACHE_PREFIX}${translation}_${bookName}_${chapter}`;
  
  // Check cache
  let cached = null;
  try {
    cached = localStorage.getItem(cacheKey);
  } catch (e) {
    console.warn("localStorage access denied in bibleCache");
  }
  
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      try { localStorage.removeItem(cacheKey); } catch(_) {}
    }
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const bookId = BOLLS_BIBLE_BOOK_IDS[bookName] || 1;
    let data: any[];

    if (bookName === 'Proverbs') {
      const response = await fetch('/proverbs.json', {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Proverbs JSON fetch error: ${response.status}`);
      const fullData = await response.json();
      const chapterData = fullData[chapter.toString()];
      if (!chapterData) throw new Error(`Chapter ${chapter} not found in local proverbs.json`);
      
      data = Object.entries(chapterData).map(([v, text]) => ({
        verse: parseInt(v),
        text: text as string
      })).sort((a, b) => a.verse - b.verse);
    } else {
      const response = await fetch(`https://bolls.life/get-chapter/KJV/${bookId}/${chapter}/`, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Bolls Life error: ${response.status}`);
      }
      
      data = await response.json();
    }
    
    if (!Array.isArray(data)) throw new Error("Invalid response format");

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
