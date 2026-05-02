/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchWithProxy } from './api';

interface ProverbResponse {
  reference: string;
  verses: { verse: number; text: string }[];
  text: string;
  translation_id: string;
  translation_name: string;
  _cachedAt?: number;
}

const CACHE_PREFIX = 'proverb_cache_v11_';

// L1 Cache (In-Memory) to avoid repeated localStorage hits and re-parsing
const memoryCache = new Map<number, ProverbResponse>();
let hasPruned = false;

/**
 * Background task to prune old cache versions without blocking the main thread.
 */
const lazyPrune = () => {
  if (hasPruned) return;
  hasPruned = true;
  
  setTimeout(() => {
    try {
      // Use backward iteration for safe removal while looping
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('proverb_cache_') && !key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn("Background cache pruning failed");
    }
  }, 0);
};

export async function prefetchProverbs() {
  const day = new Date().getDate();
  const days = [
    day === 1 ? 31 : day - 1,
    day,
    day === 31 ? 1 : day + 1
  ];
  
  for (const d of days) {
    try {
      await getProverb(d);
    } catch (e) {
      // Ignore prefetch failures
    }
  }
}

export async function getProverb(chapter: number): Promise<ProverbResponse> {
  // 1. Check L1 Cache (Memory) - Fastest
  const memCached = memoryCache.get(chapter);
  if (memCached) return memCached;

  const translation = 'ESV'; 
  const cacheKey = `${CACHE_PREFIX}${translation}_${chapter}`;
  
  // 2. Check L2 Cache (localStorage) - Permanent key (no daily expiry)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      memoryCache.set(chapter, parsed);
      
      // Lazily prune on successful cache hit if not already done
      lazyPrune();
      return parsed;
    }
  } catch (e) {
    // Continue To Fetch
  }
  
  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    let data: any = null;
    
    // 1. Try Bolls.life API as primary source (ESV then KJV)
    for (const trans of ['ESV', 'KJV']) {
      if (data) break;
      const urls = [
        `https://bolls.life/get-chapter/${trans}/20/${chapter}/`,
        `https://bolls.life/get-chapter/${trans}/20/${chapter}`
      ];
      
      for (const url of urls) {
        try {
          const apiData = await fetchWithProxy(url, controller.signal);
          if (Array.isArray(apiData) && apiData.length > 0) {
            const map: Record<string, string> = {};
            apiData.forEach((v: any) => { map[v.verse.toString()] = v.text; });
            data = { map, trans };
            break; 
          }
        } catch (e) {
          console.warn(`Bolls.life fetch failed for ${url}`, e);
        }
      }
    }

    // 2. Fallback to bible-api.com (Very reliable, CORS-friendly)
    if (!data) {
      try {
        console.log("Falling back to bible-api.com for Proverbs", chapter);
        const response = await fetch(`https://bible-api.com/proverbs+${chapter}?translation=kjv`, { signal: controller.signal });
        if (response.ok) {
          const apiData = await response.json();
          if (apiData.verses && apiData.verses.length > 0) {
            const map: Record<string, string> = {};
            apiData.verses.forEach((v: any) => { map[v.verse.toString()] = v.text; });
            data = { map, trans: 'KJV (Fallback)' };
          }
        }
      } catch (e) {
        console.error("Bible-api.com fallback failed", e);
      }
    }

    if (!data) throw new Error(`Proverbs chapter ${chapter} could not be loaded from any source.`);

    const verses = Object.entries(data.map as Record<string, string>).map(([v, text]) => ({
      verse: parseInt(v),
      text: (text as string).trim()
    })).sort((a, b) => a.verse - b.verse);

    const result: ProverbResponse = {
      reference: `Proverbs ${chapter}`,
      verses,
      text: verses.map(v => v.text).join(' '),
      translation_id: data.trans.toLowerCase(),
      translation_name: data.trans.includes('ESV') ? 'English Standard Version' : 'King James Version',
      _cachedAt: Date.now()
    };

    // Update both caches
    memoryCache.set(chapter, result);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(result));
      // Trigger lazy pruning after a successful write
      lazyPrune();
    } catch (e) {
      console.warn("Failed to cache proverb likely due to Private Mode");
    }
    
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
