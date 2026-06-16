/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';
import {
  BIBLE_VERSION_NAMES,
  BOLLS_BIBLE_BOOK_IDS,
  DEFAULT_BIBLE_VERSION,
  getBibleVersion,
  resolveBibleVersion,
} from '../constants';
import { fetchWithProxy } from './api';

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

// v3: bumped when modern translations (NIV/NLT/ESV/NKJV) were added via the
// bolls.life proxy. Earlier caches could hold a KJV fall-back under a non-KJV
// key; bumping discards those so every version re-fetches its real text.
const CACHE_PREFIX = 'chapter_text_v3_';
const FETCH_TIMEOUT_MS = 12000;

// L1 in-memory cache to avoid repeated IndexedDB reads / re-parsing.
const memoryCache = new Map<string, ChapterTextResponse>();

/**
 * Collapse the occasional stray HTML/whitespace bible-api.com returns (verse
 * text can contain embedded newlines and the odd markup) down to clean prose.
 * Pure: safe to unit test.
 */
export function cleanVerseText(raw: string): string {
  return raw
    .replace(/<S>[^<]*<\/S>/gi, '')     // Strong's concordance numbers
    .replace(/<sup>[^<]*<\/sup>/gi, '')  // verse superscripts
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')             // any remaining tags
    .replace(/\s+/g, ' ')
    .trim();
}

interface BibleApiResponse {
  verses?: Array<{ verse: number; text: string }>;
  translation_id?: string;
  translation_name?: string;
}

async function fetchFromBibleApi(
  bookName: string,
  chapter: number,
  code: string,
  signal: AbortSignal
): Promise<ChapterTextResponse | null> {
  const url = `https://bible-api.com/${encodeURIComponent(bookName)}+${chapter}?translation=${code}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data = (await res.json()) as BibleApiResponse;
  if (!Array.isArray(data.verses) || data.verses.length === 0) return null;

  const verses = data.verses
    .map((v) => ({ verse: v.verse, text: cleanVerseText(v.text) }))
    .filter((v) => Number.isFinite(v.verse) && v.text.length > 0)
    .sort((a, b) => a.verse - b.verse);

  if (verses.length === 0) return null;

  return {
    reference: `${bookName} ${chapter}`,
    verses,
    // Trust the server's own labels so the header always reflects what
    // actually loaded — never a version we requested but didn't get.
    translationId: data.translation_id || code,
    translationName: data.translation_name || BIBLE_VERSION_NAMES[code] || code,
    _cachedAt: Date.now(),
  };
}

interface BollsVerse {
  verse?: number;
  text?: string;
}

/**
 * Fetch a chapter from bolls.life (via our Cloud Function proxy, to dodge
 * CORS). bolls serves the modern, copyrighted translations — NIV/NLT/ESV/NKJV.
 * Its book ids are numeric (Genesis = 1 … Revelation = 66) and verse text is
 * HTML, which cleanVerseText() strips. Returns null on any failure so the
 * caller can fall back to public-domain text rather than show a broken page.
 */
async function fetchFromBolls(
  bookName: string,
  chapter: number,
  slug: string,
  displayName: string,
  signal: AbortSignal
): Promise<ChapterTextResponse | null> {
  const bookId = BOLLS_BIBLE_BOOK_IDS[bookName];
  if (!bookId) return null;

  const url = `https://bolls.life/get-text/${slug}/${bookId}/${chapter}/`;
  const data = (await fetchWithProxy(url, signal)) as BollsVerse[];
  if (!Array.isArray(data) || data.length === 0) return null;

  const verses = data
    .map((v) => ({ verse: Number(v.verse), text: cleanVerseText(v.text || '') }))
    .filter((v) => Number.isFinite(v.verse) && v.text.length > 0)
    .sort((a, b) => a.verse - b.verse);

  if (verses.length === 0) return null;

  return {
    reference: `${bookName} ${chapter}`,
    verses,
    translationId: slug,
    translationName: displayName,
    _cachedAt: Date.now(),
  };
}

/**
 * Fetch a full chapter's text for the selected translation.
 *
 * Backend is chosen per-version: public-domain texts come straight from
 * bible-api.com; modern copyrighted texts (NIV/NLT/ESV/NKJV) come from
 * bolls.life through our proxy. Two-tier cache (memory + IndexedDB): once read,
 * a chapter is cached permanently and works offline. If the requested
 * translation fails for any reason, falls back to the public-domain KJV — but
 * the returned translationName reflects whatever genuinely loaded, so the UI
 * never mislabels KJV as another version.
 */
export async function getChapterText(
  bookName: string,
  chapter: number,
  version: string = DEFAULT_BIBLE_VERSION
): Promise<ChapterTextResponse> {
  const id = resolveBibleVersion(version);
  const entry = getBibleVersion(id);
  const cacheKey = `${CACHE_PREFIX}${id}_${bookName}_${chapter}`;

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
    let result: ChapterTextResponse | null = null;

    // 1. Primary: the selected translation, from its own backend.
    try {
      result =
        entry.source === 'bolls'
          ? await fetchFromBolls(bookName, chapter, entry.code, entry.name, controller.signal)
          : await fetchFromBibleApi(bookName, chapter, entry.code, controller.signal);
    } catch {
      // network/parse error — handled by fallback below
    }

    // 2. Fallback: public-domain KJV (only if a different version was asked
    //    for and failed). The header will correctly read "King James Version".
    if (!result && id !== 'kjv') {
      try {
        result = await fetchFromBibleApi(bookName, chapter, 'kjv', controller.signal);
      } catch {
        // ignore — handled by the throw below
      }
    }

    if (!result) {
      throw new Error(`${bookName} ${chapter} could not be loaded.`);
    }

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
