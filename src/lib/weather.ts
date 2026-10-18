/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get as idbGet } from 'idb-keyval';
import { fetchJson } from './api';

// ── Where the weather is for ────────────────────────────────────────────────
//
// Saved once, reused on every launch. The widget used to call
// navigator.geolocation whenever its saved coordinates were over an hour old —
// in practice on nearly every launch — and an iPhone home-screen app forgets a
// location grant each time it is closed. So opening the app meant a "would like
// to use your current location" prompt almost every time.
//
// Now the browser is asked for a position in exactly two cases:
//   1. there is no saved location at all (the very first run), or
//   2. the user taps the weather to update it (`locate: true`).
// Launches and returns to the app reuse the saved spot and never prompt. A
// refused or failed first request still saves the default, so the next launch
// doesn't ask again. scripts/test-weather-location.mts holds this in place.

export interface SavedLocation {
  lat: number;
  lng: number;
  city: string;
  source: 'gps' | 'manual' | 'default';
  savedAt: number;
}

export const LOCATION_KEY = 'dl_weather_location_v1';
/** Where coordinates lived before (IndexedDB) — read once to migrate, so
 *  existing installs don't get one more prompt after this change. */
export const LEGACY_LOCATION_KEY = 'weather-coords';
export const DEFAULT_LOCATION = { lat: 10.8231, lng: 106.6297, city: 'Ho Chi Minh City' };

export interface LocationDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Asks the browser for the device position — the call that shows the prompt. */
  getPosition: () => Promise<{ lat: number; lng: number }>;
  reverseGeocode: (lat: number, lng: number) => Promise<string>;
  loadLegacy: () => Promise<{ lat?: number; lng?: number; city?: string } | undefined>;
  now: () => number;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function browserDeps(): LocationDeps {
  return {
    storage: browserStorage(),
    getPosition: () =>
      new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          reject(new Error('Geolocation unavailable'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          reject,
          { timeout: 10000, maximumAge: 10 * 60 * 1000 },
        );
      }),
    reverseGeocode: async (lat, lng) => {
      const data = await fetchJson(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      );
      return data?.city || data?.locality || '';
    },
    loadLegacy: () => idbGet(LEGACY_LOCATION_KEY),
    now: () => Date.now(),
  };
}

export function loadSavedLocation(
  storage: LocationDeps['storage'] = browserStorage(),
): SavedLocation | null {
  try {
    const raw = storage?.getItem(LOCATION_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      city: typeof loc.city === 'string' ? loc.city : '',
      source: loc.source === 'manual' || loc.source === 'default' ? loc.source : 'gps',
      savedAt: Number(loc.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

function saveLocation(storage: LocationDeps['storage'], loc: SavedLocation): void {
  try {
    storage?.setItem(LOCATION_KEY, JSON.stringify(loc));
  } catch {
    // Private mode / quota — the location still works for this session.
  }
}

/** A city the user typed in. Saved like any other location; never re-asked. */
export function setManualLocation(
  lat: number,
  lng: number,
  city: string,
  storage: LocationDeps['storage'] = browserStorage(),
): SavedLocation {
  const loc: SavedLocation = { lat, lng, city, source: 'manual', savedAt: Date.now() };
  saveLocation(storage, loc);
  return loc;
}

async function migrateLegacyLocation(deps: LocationDeps): Promise<SavedLocation | null> {
  try {
    const legacy = await deps.loadLegacy();
    if (!legacy || !Number.isFinite(legacy.lat) || !Number.isFinite(legacy.lng)) return null;
    const lat = legacy.lat as number;
    const lng = legacy.lng as number;
    let city = legacy.city || '';
    if (!city) {
      try { city = await deps.reverseGeocode(lat, lng); } catch { /* leave blank */ }
    }
    const isDefault = lat === DEFAULT_LOCATION.lat && lng === DEFAULT_LOCATION.lng;
    const loc: SavedLocation = {
      lat, lng, city, source: isDefault ? 'default' : 'gps', savedAt: deps.now(),
    };
    saveLocation(deps.storage, loc);
    return loc;
  } catch {
    return null;
  }
}

/**
 * One position request at a time. A launch can run the widget's refresh twice
 * at once (mount plus a visibilitychange, or StrictMode's double effect in
 * dev), and on a first run each would otherwise ask the browser separately.
 */
let positionRequest: Promise<SavedLocation> | null = null;

/**
 * The location to show weather for. Only asks the browser for a position (and
 * so only ever shows the permission prompt) on the first run or when `locate`
 * is set by an explicit tap — see the note at the top of this section.
 */
export async function resolveWeatherLocation(
  { locate = false }: { locate?: boolean } = {},
  deps: LocationDeps = browserDeps(),
): Promise<SavedLocation> {
  const saved = loadSavedLocation(deps.storage) ?? (await migrateLegacyLocation(deps));

  // Every launch after the first lands here: no GPS, no prompt.
  if (saved && !locate) return saved;

  if (!positionRequest) {
    positionRequest = askForPosition(saved, deps).finally(() => { positionRequest = null; });
  }
  return positionRequest;
}

async function askForPosition(saved: SavedLocation | null, deps: LocationDeps): Promise<SavedLocation> {
  try {
    const { lat, lng } = await deps.getPosition();
    let city = '';
    try { city = await deps.reverseGeocode(lat, lng); } catch { /* fall through */ }
    const loc: SavedLocation = { lat, lng, city: city || 'Unknown', source: 'gps', savedAt: deps.now() };
    saveLocation(deps.storage, loc);
    return loc;
  } catch {
    // Refused, timed out or unavailable. An update that failed keeps the old
    // spot; a first run remembers the default so the next launch won't ask.
    if (saved) return saved;
    const loc: SavedLocation = { ...DEFAULT_LOCATION, source: 'default', savedAt: deps.now() };
    saveLocation(deps.storage, loc);
    return loc;
  }
}

// ── The forecast ────────────────────────────────────────────────────────────

export interface WeatherSnapshot {
  tempF: number;
  highF: number;
  lowF: number;
  conditionCode: number;
  conditionLabel: string;
  city: string;
  fetchedAt: number;
}

const WEATHER_CACHE_KEY = 'dl_weather_v2'; 

const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  56: 'Freezing Drizzle',
  57: 'Freezing Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  66: 'Freezing Rain',
  67: 'Freezing Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Heavy Showers',
  85: 'Snow Showers',
  86: 'Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm'
};

export function getCachedWeather(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    
    const { snapshot, ts } = JSON.parse(raw);
    const ageMs = Date.now() - ts;
    
    // Older than 1 hour? Discard.
    if (ageMs > 1000 * 60 * 60 * 1) return null;
    
    return snapshot;
  } catch {
    return null;
  }
}

export async function fetchWeather(lat: number, lng: number, city: string): Promise<WeatherSnapshot> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const data = await fetchJson(url, controller.signal);
    clearTimeout(timeoutId);

    if (!data || !data.current || !data.daily) throw new Error('Weather data invalid');

    const snapshot: WeatherSnapshot = {
      tempF: Math.round(data.current.temperature_2m),
      highF: Math.round(data.daily.temperature_2m_max[0]),
      lowF: Math.round(data.daily.temperature_2m_min[0]),
      conditionCode: data.current.weather_code,
      conditionLabel: WEATHER_CODE_MAP[data.current.weather_code] || 'Clear',
      city,
      fetchedAt: Date.now()
    };

    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ snapshot, ts: Date.now() }));
    } catch {
      console.warn("Weather cache write failed, possibly due to private mode limits.");
    }
    return snapshot;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
