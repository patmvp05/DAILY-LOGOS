/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface ProverbResponse {
  reference: string;
  verses: { verse: number; text: string }[];
  text: string;
  translation_id: string;
  translation_name: string;
}

const CACHE_PREFIX = 'proverb_cache_v9_';

export async function getProverb(chapter: number): Promise<ProverbResponse> {
  const translation = 'KJV';
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
    const response = await fetch(`https://bolls.life/get-chapter/KJV/20/${chapter}/`, {
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Bolls Life error: ${response.status}`);
    const data = await response.json();
    
    if (!Array.isArray(data)) throw new Error("Invalid response from Bolls Life");

    const result: ProverbResponse = {
      reference: `Proverbs ${chapter}`,
      verses: data.map((v: any) => ({
        verse: v.verse,
        text: (v.text || "")
          .replace(/<S>[^<]*<\/S>/gi, '') // Remove Strong's numbers and their tags
          .replace(/<[^>]*>/g, '')      // Remove any other residual tags
          .replace(/^\[\d+\]\s*/, '')   // Remove [1] at start
          .trim()
      })),
      text: data.map((v: any) => (v.text || "")
        .replace(/<S>[^<]*<\/S>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim()
      ).join(' '),
      translation_id: 'kjv',
      translation_name: 'King James Version'
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
