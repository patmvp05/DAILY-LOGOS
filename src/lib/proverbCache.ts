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
    try {
      const response = await fetch('/proverbs.json', { // Local ESV File
        signal: controller.signal
      });

      if (response.ok) {
        const fullData = await response.json();
        data = fullData[chapter.toString()];
      }
    } catch (e) {
      console.warn("Local proverbs.json missing or failed, trying Bolls.life ESV API");
    }

    if (!data) {
      // Fallback to Bolls.life ESV API as per updated instructions
      const response = await fetch(`https://bolls.life/get-chapter/ESV/20/${chapter}/`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Proverbs API fetch error: ${response.status}`);
      const apiData = await response.json();
      if (!Array.isArray(apiData)) throw new Error("Invalid API response format");
      
      // Convert Bolls format [{ verse: 1, text: "..." }] to map for consistent processing
      const map: Record<string, string> = {};
      apiData.forEach((v: any) => { map[v.verse.toString()] = v.text; });
      data = map;
    }

    if (!data) throw new Error(`Chapter ${chapter} not found`);

    const verses = Object.entries(data as Record<string, string>).map(([v, text]) => ({
      verse: parseInt(v),
      text: (text as string).trim()
    })).sort((a, b) => a.verse - b.verse);

    const result: ProverbResponse = {
      reference: `Proverbs ${chapter}`,
      verses,
      text: verses.map(v => v.text).join(' '),
      translation_id: 'esv',
      translation_name: 'English Standard Version'
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
