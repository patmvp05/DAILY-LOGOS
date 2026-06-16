/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchWithProxy } from './api';
import { get, set } from 'idb-keyval';
import { BOLLS_BIBLE_BOOK_IDS, BIBLE_VERSION_NAMES, DEFAULT_BIBLE_VERSION } from '../constants';

export interface ChapterVerse {
  verse: number;
  text: string;
}

export interface ChapterTextResponse {
  reference: string; // e.g. "Genesis 15"
  verses: ChapterVerse[];
  translationId: string;
  translationName: string;
  _cachedAt?: number;
}

const CACHE_PREFIX = 'chapter_text_v1_';
const FETCH_TIMEOUT_MS = 12000;

// L1 in-memory cache to avoid repeated IndexedDB reads / re-parsing.
const memoryCache = new Map<string, ChapterTextResponse>();

/**
 * Strip the HTML that bolls.life (and occasionally bible-api.com) embed in
 * verse text — Strong's number tags, superscripts, line breaks — down to clean
 * readable prose. Pure: safe to unit test.
 */
export function cleanVerseText(raw: string): string {
  return raw
    .replace(/<S>[^<]*<\/S>/gi, '')   // Strong's concordance numbers
    .replace(/<sup>[^<]*<\/sup>/gi, '') // verse superscripts
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')            // any remaining tags
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * bolls.life sometimes returns a list of cross-references instead of the
 * actual scripture for a given translation. Detect that so we can skip it and
 * fall back. Mirrors the heuristic proven out in proverbCache. Pure.
 */
export function looksLikeReferenceList(
  arr: Array<{ text?: string; content?: string } | unknown>
): boolean {
  const sample = arr.slice(0, 5);
  if (sample.length === 0) return true;

  let totalWords = 0;
  let referenceLike = 0;

  for (const item of sample) {
    const obj = item as { text?: string; content?: string } | null;
    const raw = obj && typeof obj === 'object' ? (obj.text || obj.content || '') : String(item);
    const clean = raw.replace(/<[^>]*>/g, '').trim();
    const words = clean.split(/\s+/).filter((w) => w.length > 0);
    totalWords += words.length;

    if (
      /^[1-2]?\s*[A-Za-z.]+\s*\d+:\d+/.test(clean) ||
      /^[0-9]+:[0-9]+/.test(clean) ||
      raw.includes('bolls.life') ||
      raw.includes('http')
    ) {
      referenceLike++;
    }
  }

  const avgWords = totalWords / sample.length;
  return avgWords < 5 || referenceLike > sample.length / 2;
}

function parseBollsVerses(data: unknown): ChapterVerse[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (looksLikeReferenceList(data)) return null;
  const verses = (data as Array<{ verse: number; text?: string; content?: string }>)
    .map((v) => ({ verse: v.verse, text: cleanVerseText(v.text || v.content || '') }))
    .filter((v) => Number.isFinite(v.verse) && v.text.length > 0)
    .sort((a, b) => a.verse - b.verse);
  return verses.length > 0 ? verses : null;
}

/**
 * Fetch a full chapter's text for a given translation. Two-tier cache
 * (memory + IndexedDB); once read, a chapter is cached permanently and works
 * offline. Primary source is bolls.life in the requested version; on any
 * failure (incl. an unavailable version code) it falls back to the
 * public-domain KJV from bible-api.com so the reader always has something.
 */
export async function getChapterText(
  bookName: string,
  chapter: number,
  version: string = DEFAULT_BIBLE_VERSION
): Promise<ChapterTextResponse> {
  const cacheKey = `${CACHE_PREFIX}${version}_${bookName}_${chapter}`;

  const mem = memoryCache.get(cacheKey);
  if (mem) return mem;

  try {
    const cached = await get<ChapterTextResponse>(cacheKey);
    if (cached) {
      memoryCache.set(cacheKey, cached);
      return cached;
    }
  } catch {
    // fall through to fetch
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let verses: ChapterVerse[] | null = null;
    let translationName = BIBLE_VERSION_NAMES[version] || version;

    // 1. Primary: bolls.life in the requested translation.
    const bookId = BOLLS_BIBLE_BOOK_IDS[bookName];
    if (bookId) {
      const urls = [
        `https://bolls.life/get-chapter/${version}/${bookId}/${chapter}/`,
        `https://bolls.life/get-chapter/${version}/${bookId}/${chapter}`,
      ];
      for (const url of urls) {
        try {
          const data = await fetchWithProxy(url, controller.signal);
          const parsed = parseBollsVerses(data);
          if (parsed) {
            verses = parsed;
            break;
          }
        } catch {
          // try next URL / fall back
        }
      }
    }

    // 2. Fallback: bible-api.com (public-domain KJV, CORS-friendly).
    if (!verses) {
      try {
        const res = await fetch(
          `https://bible-api.com/${encodeURIComponent(bookName)}+${chapter}?translation=kjv`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const apiData = await res.json();
          if (Array.isArray(apiData?.verses) && apiData.verses.length > 0) {
            verses = (apiData.verses as Array<{ verse: number; text: string }>)
              .map((v) => ({ verse: v.verse, text: cleanVerseText(v.text) }))
              .filter((v) => v.text.length > 0)
              .sort((a, b) => a.verse - b.verse);
            translationName = 'King James Version';
          }
        }
      } catch {
        // ignore — handled by the throw below
      }
    }

    if (!verses || verses.length === 0) {
      throw new Error(`${bookName} ${chapter} could not be loaded from any source.`);
    }

    const result: ChapterTextResponse = {
      reference: `${bookName} ${chapter}`,
      verses,
      translationId: version.toLowerCase(),
      translationName,
      _cachedAt: Date.now(),
    };

    memoryCache.set(cacheKey, result);
    try {
      await set(cacheKey, result);
    } catch {
      // storage full / private mode — memory cache still serves this session
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
