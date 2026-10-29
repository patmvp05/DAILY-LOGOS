/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set, del, keys, delMany } from 'idb-keyval';
import {
  BIBLE_VERSION_NAMES,
  BOLLS_BIBLE_BOOK_IDS,
  DEFAULT_BIBLE_VERSION,
  getBibleVersion,
  resolveBibleVersion,
} from '../constants';
import { checkChapterVerses, type ChapterCheck } from './chapterCheck';
import { recordTextCheck, textCheckKey } from './textCheckLog';

export interface ChapterVerse {
  verse: number;
  text: string;
  // Set when the translation prints several verses as one passage (NCV
  // Numbers 7:12-83, Genesis 8:3-4): the entry covers verse..verseEnd. Show and
  // count it through src/lib/verseLabel.ts.
  verseEnd?: number;
}

export interface ChapterTextResponse {
  reference: string; // e.g. "Genesis 15"
  verses: ChapterVerse[];
  translationId: string;
  translationName: string;
  _cachedAt?: number;
  // True when this is the KJV safety-net, not the requested translation (e.g. a
  // modern version's static file wasn't deployed yet). Fallbacks are NEVER
  // persisted to disk — only memory-cached for the session — so the moment the
  // real text deploys, the next reload fetches it instead of a stuck KJV.
  _fallback?: boolean;
  // Result of the completeness check (src/lib/chapterCheck.ts) on this copy.
  // Computed every time a chapter is loaded, never saved with it.
  _check?: ChapterCheck;
}

// v8 (Oct 29 2026): NIV psalm titles restored (116 psalms). A copy cached
// without them still passes the verse check, so only a new prefix replaces it.
// v7 (Oct 2026): the committed text was repaired. NCV had dropped every
// combined passage (Numbers 7 kept 17 of 89 verses), NIV/NLT had lost the first
// line of many poetry verses, and thousands of verses read "the Lord ." A cached
// chapter is otherwise kept forever, so without this bump a phone would keep
// showing the broken copy it had already saved. Older prefixes are deleted by
// purgeStaleChapterCache().
// (v6 discarded KJV-fallback entries persisted under a modern version's key.)
const CACHE_PREFIX = 'chapter_text_v8_';
const STALE_PREFIX = /^chapter_text_v\d+_/;
// Cache-bust on the static-file URL. b=2: earlier builds requested files before
// they existed and Firebase answered with index.html under an `immutable`
// header. b=3: the text itself was repaired (see CACHE_PREFIX). b=4: NIV psalm
// titles. Bump whenever
// the committed text changes in a way a stale copy must not survive.
const STATIC_CACHE_BUST = 'b=4';
const FETCH_TIMEOUT_MS = 12000;

// L1 in-memory cache to avoid repeated IndexedDB reads / re-parsing.
const memoryCache = new Map<string, ChapterTextResponse>();

/**
 * Delete chapters cached under an older CACHE_PREFIX. They are never read again,
 * so this only frees storage (a few MB on a phone). Best effort, runs once per
 * prefix per device.
 */
export async function purgeStaleChapterCache(): Promise<number> {
  const marker = `purged_before_${CACHE_PREFIX}`;
  try {
    if (localStorage.getItem(marker)) return 0;
  } catch {
    // no localStorage: still try the purge
  }
  try {
    const stale = (await keys()).filter(
      (k): k is string => typeof k === 'string' && STALE_PREFIX.test(k) && !k.startsWith(CACHE_PREFIX)
    );
    if (stale.length) await delMany(stale);
    try { localStorage.setItem(marker, '1'); } catch { /* ignored */ }
    return stale.length;
  } catch {
    return 0;
  }
}

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

  const url = `/bible/${slug}/${bookId}/${chapter}.json?${STATIC_CACHE_BUST}`;
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
      const checked = withCheck(cached, id, bookName, chapter);
      if (checked._check?.ok) {
        memoryCache.set(cacheKey, checked);
        return checked;
      }
      // A saved copy that fails the check is thrown away and fetched again.
      // This is how a phone gets rid of a broken chapter it saved earlier
      // (NCV Numbers 7 with 17 of 89 verses) without waiting for a cache bump.
      try { await del(cacheKey); } catch { /* ignored */ }
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
  let isFallback = false;
  if (!result && id !== 'kjv') {
    try {
      result = await fetchWithTimeout((signal) =>
        fetchFromBibleApi(bookName, chapter, 'kjv', signal)
      );
      if (result) {
        result._fallback = true;
        isFallback = true;
      }
    } catch {
      // ignore — handled by the throw below
    }
  }

  if (!result) {
    throw new Error(`${bookName} ${chapter} could not be loaded.`);
  }

  const checked = withCheck(result, id, bookName, chapter);

  // Memory-cache everything (cheap, session-scoped). Persist to IndexedDB ONLY
  // a complete copy of the genuinely-requested translation — never a KJV
  // fallback and never a copy that failed the check, so either self-heals on a
  // later load instead of being kept forever.
  memoryCache.set(cacheKey, checked);
  if (!isFallback && checked._check?.ok) {
    try {
      const { _check: _omit, ...toStore } = checked;
      void _omit;
      await set(cacheKey, toStore);
    } catch {
      // storage full / private mode — memory cache still serves this session
    }
  }

  return checked;
}

/**
 * Check a chapter and record the result for the dashboard summary. A KJV
 * fallback counts as a failed check of the requested translation: that
 * translation's text is not what is on screen.
 */
function withCheck(
  result: ChapterTextResponse,
  versionId: string,
  bookName: string,
  chapter: number
): ChapterTextResponse {
  const check = checkChapterVerses(result.verses, bookName, chapter);
  const shown: ChapterCheck = result._fallback
    ? { ...check, ok: false, problems: [`Showing the King James Version: the ${BIBLE_VERSION_NAMES[versionId] ?? versionId} copy could not be loaded`, ...check.problems] }
    : check;
  recordTextCheck(textCheckKey(versionId, bookName, chapter), shown.ok, shown.problems);
  return { ...result, _check: shown };
}

/**
 * Forget every saved copy of a chapter and load it again. Used by the
 * reader's "Download again" button when a chapter fails its check.
 */
export async function refetchChapterText(
  bookName: string,
  chapter: number,
  version: string = DEFAULT_BIBLE_VERSION
): Promise<ChapterTextResponse> {
  const id = resolveBibleVersion(version);
  const cacheKey = `${CACHE_PREFIX}${id}_${bookName}_${chapter}`;
  memoryCache.delete(cacheKey);
  try { await del(cacheKey); } catch { /* ignored */ }
  return getChapterText(bookName, chapter, id);
}
