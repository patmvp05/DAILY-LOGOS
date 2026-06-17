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

// v5: modern translations now served from same-origin static files
// (public/bible/...), since bolls.life blocks both the proxy (Cloudflare 403)
// and direct browser fetch (no CORS). Bump discards v4 entries that fell back
// to KJV under a modern-version key while bolls was unreachable.
const CACHE_PREFIX = 'chapter_text_v5_';
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

async function fetchFromStatic(
  bookName: string,
  chapter: number,
  slug: string,
  displayName: string,
  signal: AbortSignal
): Promise<ChapterTextResponse | null> {
  const bookId = BOLLS_BIBLE_BOOK_IDS[bookName];
  if (!bookId) return null;

  const url = `/bible/${slug}/${bookId}/${chapter}.json`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data = (await res.json()) as ChapterTextResponse | BollsVerse[];

  if (!Array.isArray(data) && Array.isArray(data.verses) && data.verses.length > 0) {
    return { ...data, translationName: displayName, _cachedAt: Date.now() };
  }

  if (Array.isArray(data)) {
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

  return null;
}

/**
 * Run a single network fetch under its OWN abort timeout.
 *
 * Critical: each attempt gets a fresh AbortController. Previously the primary
 * fetch and the KJV fallback shared one controller — so if the primary used up
 * the budget (e.g. a slow path), the fallback inherited an already-aborted
 * signal and threw instantly, surfacing "couldn't load" instead of degrading
 * to KJV. A fresh controller per attempt guarantees the fallback always gets a
 * fair, full-timeout try.
 */
async function fetchWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a full chapter's text for the selected translation.
 *
 * Backend is chosen per-version: public-domain texts come straight from
 * bible-api.com; modern copyrighted texts (NIV/NLT/ESV/NKJV/NCV) come from
 * same-origin static files (public/bible/, pre-fetched from bolls.life). Two-
 * tier cache (memory + IndexedDB): once read, a chapter is cached permanently
 * and works offline. If the requested translation fails for any reason, falls
 * back to the public-domain KJV — but the returned translationName reflects
 * whatever genuinely loaded, so the UI never mislabels KJV as another version.
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

  let result: ChapterTextResponse | null = null;

  // 1. Primary: the selected translation, from its own backend, under its own
  //    timeout. Modern (NIV/ESV/NLT/NKJV/NCV) → same-origin static file;
  //    public-domain → bible-api.com.
  try {
    result = await fetchWithTimeout((signal) =>
      entry.source === 'bolls'
        ? fetchFromStatic(bookName, chapter, entry.code, entry.name, signal)
        : fetchFromBibleApi(bookName, chapter, entry.code, signal)
    );
  } catch {
    // network/parse error — handled by fallback below
  }

  // 2. Fallback: public-domain KJV (only if a different version was asked for
  //    and failed), with its OWN fresh timeout so it always gets a fair attempt.
  //    The header will correctly read "King James Version" — never mislabeled.
  if (!result && id !== 'kjv') {
    try {
      result = await fetchWithTimeout((signal) =>
        fetchFromBibleApi(bookName, chapter, 'kjv', signal)
      );
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
}
