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

const CACHE_PREFIX = 'proverb_cache_v10_';
const PROVERBS_BOOK_ID = 20;
// WEB = World English Bible. Public domain, modern language, no API key.
// DO NOT change to KJV or switch back to local proverbs.json — there is no local file.
const TRANSLATION = 'WEB';

export async function getProverb(chapter: number): Promise<ProverbResponse> {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${CACHE_PREFIX}${TRANSLATION}_${chapter}_${today}`;

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

  // Prune old cache entries
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('proverb_cache_') && !key.includes(`_${today}`)) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("localStorage pruning failed");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://bolls.life/get-chapter/${TRANSLATION}/${PROVERBS_BOOK_ID}/${chapter}/`,
      { signal: controller.signal }
    );

    if (!response.ok) throw new Error(`Bolls.life fetch error: ${response.status}`);

    const data: { verse: number; text: string }[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`No verses returned for Proverbs ${chapter}`);
    }

    const verses = data.map(v => ({
      verse: v.verse,
      text: v.text.replace(/<[^>]*>/g, '').trim()
    }));

    const result: ProverbResponse = {
      reference: `Proverbs ${chapter}`,
      verses,
      text: verses.map(v => v.text).join(' '),
      translation_id: 'web',
      translation_name: 'World English Bible'
    };

    try {
      localStorage.setItem(cacheKey, JSON.stringify(result));
    } catch (e) {
      console.warn("Failed to cache proverb");
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
