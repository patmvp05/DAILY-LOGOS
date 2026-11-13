/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';
import { parse, isValid } from 'date-fns';
import { getLocalMonthDay, getAdjacentMonthDays, getRecentMonthDays, INTERNAL_DEVOTIONAL_SLUGS } from './devotionalCatalog';

export interface DevotionalEntry {
  period?: 'morning' | 'evening';
  scripture?: string;
  reference?: string;
  body: string[];
}

export interface DevotionalContent {
  slug: string;
  date: string;
  title: string;
  entries: DevotionalEntry[];
  author: string;
  source: string;
  _cachedAt?: number;
}

const CACHE_PREFIX = 'devotional_v1_';
const FETCH_TIMEOUT_MS = 12000;
const STATIC_CACHE_BUST = 'b=1';

const memoryCache = new Map<string, DevotionalContent>();

/**
 * Devotionals whose files are named by month-day but are NOT perennial: Insight
 * for Living publishes one post per day and the site keeps only the recent
 * ones, so the file for "03-19" is overwritten by the next year's post. A phone
 * that saved last year's copy forever would show it under this year's date, so a
 * saved copy of these is re-checked once it is older than this. The saved copy
 * is still what you get when offline. (Spurgeon, Chambers and Cowman wrote a
 * fixed 366 days: their saved copies never go stale.)
 */
const ROLLING_SLUGS = new Set(['insight-for-living']);
const ROLLING_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export function isCacheFresh(slug: string, entry: Pick<DevotionalContent, '_cachedAt'>, now = Date.now()): boolean {
  if (!ROLLING_SLUGS.has(slug)) return true;
  return typeof entry._cachedAt === 'number' && now - entry._cachedAt < ROLLING_MAX_AGE_MS;
}

/** A saved copy of one day, from memory or IndexedDB, of any age. */
async function readCached(slug: string, day: string): Promise<DevotionalContent | null> {
  const memKey = `${slug}_${day}`;
  const mem = memoryCache.get(memKey);
  if (mem) return mem;
  try {
    const stored = await get<DevotionalContent>(`${CACHE_PREFIX}${memKey}`);
    if (stored) {
      memoryCache.set(memKey, stored);
      return stored;
    }
  } catch {
    // IndexedDB unavailable
  }
  return null;
}

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

export async function getDevotional(
  slug: string,
  monthDay?: string
): Promise<DevotionalContent> {
  const day = monthDay || getLocalMonthDay();

  const cachedToday = await readCached(slug, day);
  if (cachedToday && isCacheFresh(slug, cachedToday)) return cachedToday;

  let result: DevotionalContent | null = null;
  let resolvedDay = day;

  // Walk back from the requested day so a missing latest day (e.g. content not yet
  // published, or Feb 29) falls back to the most recent available. Parse against a
  // leap year so '02-29' is a valid base date.
  const baseDate = monthDay ? parse(monthDay, 'MM-dd', new Date(2024, 0, 1)) : new Date();
  const fallbackDays = isValid(baseDate) ? getRecentMonthDays(8, baseDate) : [day];
  for (const [i, tryDay] of fallbackDays.entries()) {
    // An earlier day that is already saved needs no request. Without this the
    // walk back asked the network for every missing day, then re-downloaded the
    // copy it already held: for Insight (whose newest file is always the US
    // date, a day behind in Vietnam) that was most of nine requests per launch.
    if (i > 0) {
      const saved = await readCached(slug, tryDay);
      if (saved && isCacheFresh(slug, saved)) {
        result = saved;
        resolvedDay = tryDay;
        break;
      }
    }
    try {
      result = await fetchWithTimeout(async (signal) => {
        const url = `/devotionals/${slug}/${tryDay}.json?${STATIC_CACHE_BUST}`;
        const res = await fetch(url, { signal });
        if (!res.ok) return null;
        const data = await res.json();
        return { ...data, _cachedAt: Date.now() } as DevotionalContent;
      });
    } catch {
      // network error, try next day
    }
    if (!result) {
      // Network failed or the file doesn't exist — serve this day's cached
      // copy if we have one. Results are cached under the RESOLVED day, so
      // without this probe a fallback shown yesterday is unreachable offline
      // (the top-of-function lookup only checks the requested day).
      result = await readCached(slug, tryDay);
    }
    if (result) {
      resolvedDay = tryDay;
      break;
    }
  }

  if (!result) {
    throw new Error(`Devotional ${slug} for ${day} could not be loaded.`);
  }

  // Cache under the day that actually resolved (not the requested day) so a fallback
  // result isn't pinned once the requested day's own content becomes available.
  const resolvedMemKey = `${slug}_${resolvedDay}`;
  memoryCache.set(resolvedMemKey, result);
  try {
    await set(`${CACHE_PREFIX}${resolvedMemKey}`, result);
  } catch {
    // storage full / private mode
  }

  return result;
}

export async function prefetchDevotionals(slugs: string[] = INTERNAL_DEVOTIONAL_SLUGS) {
  const days = getAdjacentMonthDays();
  for (const slug of slugs) {
    for (const day of days) {
      try {
        await getDevotional(slug, day);
      } catch {
        // Ignore prefetch failures
      }
    }
  }
}
