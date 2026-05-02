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
}

const CACHE_PREFIX = 'proverb_cache_v9_';

export async function getProverb(chapter: number): Promise<ProverbResponse> {
  const translation = 'ESV'; // ALWAYS use ESV for Daily Proverbs (local JSON)
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${CACHE_PREFIX}${translation}_${chapter}_${today}`;
  
  // Check cache
  let cached = null;
  try {
    cached = localStorage.getItem(cacheKey);
  } catch (e) {
    console.warn("localStorage access denied in proverbCache");
  }
  
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      try { localStorage.removeItem(cacheKey); } catch(_) {}
    }
  }

  // Prune old caches
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX) && !key.includes(`_${today}`)) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("localStorage pruning failed");
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
      translation_name: data.trans.includes('ESV') ? 'English Standard Version' : 'King James Version'
    };

    try {
      localStorage.setItem(cacheKey, JSON.stringify(result));
    } catch (e) {
      console.warn("Failed to cache proverb likely due to Private Mode");
    }
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
