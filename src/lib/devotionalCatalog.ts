/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { format, subDays, addDays } from 'date-fns';

type DevotionalKind = 'internal' | 'external';

interface InternalDevotionalMeta {
  kind: 'internal';
  slug: string;
  author: string;
}

interface ExternalDevotionalMeta {
  kind: 'external';
}

type DevotionalMeta = InternalDevotionalMeta | ExternalDevotionalMeta;

// Maps a devotional `id` → how it's read. INTERNAL = native in-app reader
// backed by same-origin static JSON (public/devotionals/{slug}/{MM-DD}.json).
// EXTERNAL (the default for any id not listed) = opens the source site in the
// browser at the day's reading.
//
// Only Spurgeon's Morning & Evening is internal: it's public domain AND hosted
// on CCEL with a clean per-day URL scheme, so we scrape it to static JSON.
// My Utmost (Chambers, 1927) and Streams in the Desert (Cowman, 1925) are now
// public domain too, but are NOT on CCEL — so until their text is sourced
// elsewhere they stay external links (utmost.org / crosswalk both show the
// current day's reading). Flip them to internal here once their JSON exists.
const CATALOG: Record<string, DevotionalMeta> = {
  spurgeon: { kind: 'internal', slug: 'morning-evening', author: 'Charles H. Spurgeon' },
};

export function resolveDevotionalKind(id: string): DevotionalKind {
  return CATALOG[id]?.kind ?? 'external';
}

export function getDevotionalSlug(id: string): string | null {
  const meta = CATALOG[id];
  return meta?.kind === 'internal' ? meta.slug : null;
}

export function getDevotionalAuthor(id: string): string | null {
  const meta = CATALOG[id];
  return meta?.kind === 'internal' ? meta.author : null;
}

export const INTERNAL_DEVOTIONAL_SLUGS = Object.values(CATALOG)
  .filter((m): m is InternalDevotionalMeta => m.kind === 'internal')
  .map(m => m.slug);

export function getLocalMonthDay(d: Date = new Date()): string {
  return format(d, 'MM-dd');
}

export function getAdjacentMonthDays(d: Date = new Date()): string[] {
  return [
    getLocalMonthDay(subDays(d, 1)),
    getLocalMonthDay(d),
    getLocalMonthDay(addDays(d, 1)),
  ];
}

export function interpolateDevotionalUrl(url: string, d: Date = new Date()): string {
  return url
    .replace(/\{\{date\}\}/g, format(d, 'yyyy-MM-dd'))
    .replace(/\{\{YYYY\}\}/g, format(d, 'yyyy'))
    .replace(/\{\{MM\}\}/g, format(d, 'MM'))
    .replace(/\{\{DD\}\}/g, format(d, 'dd'));
}
