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
  const memKey = `${slug}_${day}`;

  const mem = memoryCache.get(memKey);
  if (mem) return mem;

  const cacheKey = `${CACHE_PREFIX}${memKey}`;
  try {
    const cached = await get<DevotionalContent>(cacheKey);
    if (cached) {
      memoryCache.set(memKey, cached);
      return cached;
    }
  } catch {
    // fall through to fetch
  }

  let result: DevotionalContent | null = null;
  let resolvedDay = day;

  // Walk back from the requested day so a missing latest day (e.g. content not yet
  // published, or Feb 29) falls back to the most recent available. Parse against a
  // leap year so '02-29' is a valid base date.
  const baseDate = monthDay ? parse(monthDay, 'MM-dd', new Date(2024, 0, 1)) : new Date();
  const fallbackDays = isValid(baseDate) ? getRecentMonthDays(8, baseDate) : [day];
  for (const tryDay of fallbackDays) {
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
      const tryKey = `${slug}_${tryDay}`;
      result = memoryCache.get(tryKey) ?? null;
      if (!result) {
        try {
          result = (await get<DevotionalContent>(`${CACHE_PREFIX}${tryKey}`)) ?? null;
        } catch {
          // IndexedDB unavailable — keep walking back
        }
      }
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
