/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';
import { getLocalMonthDay, getAdjacentMonthDays, INTERNAL_DEVOTIONAL_SLUGS } from './devotionalCatalog';

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

  try {
    result = await fetchWithTimeout(async (signal) => {
      const url = `/devotionals/${slug}/${day}.json?${STATIC_CACHE_BUST}`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const data = await res.json();
      return { ...data, _cachedAt: Date.now() } as DevotionalContent;
    });
  } catch {
    // network error
  }

  // Feb 29 fallback: try Feb 28
  if (!result && day === '02-29') {
    try {
      result = await fetchWithTimeout(async (signal) => {
        const url = `/devotionals/${slug}/02-28.json?${STATIC_CACHE_BUST}`;
        const res = await fetch(url, { signal });
        if (!res.ok) return null;
        const data = await res.json();
        return { ...data, _cachedAt: Date.now() } as DevotionalContent;
      });
    } catch {
      // ignore
    }
  }

  if (!result) {
    throw new Error(`Devotional ${slug} for ${day} could not be loaded.`);
  }

  memoryCache.set(memKey, result);
  try {
    await set(cacheKey, result);
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
