/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { get, set } from 'idb-keyval';
import { fetchWithProxy } from './api';

export interface WeatherSnapshot {
  tempF: number;
  highF: number;
  lowF: number;
  conditionCode: number;
  conditionLabel: string;
  city: string;
  fetchedAt: number;
}

export interface UserLocation {
  lat: number;
  lon: number;
  city: string;
  isManual?: boolean;
}

const CACHE_KEY = 'dl_weather_v2'; 
const LOCATION_CACHE_KEY = 'userLocation';
const DEFAULT_LAT = 10.8231; // Ho Chi Minh City
const DEFAULT_LON = 106.6297;

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
    const raw = localStorage.getItem(CACHE_KEY);
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

export async function getCachedLocation(): Promise<UserLocation | null> {
  try {
    const loc = await get<UserLocation>(LOCATION_CACHE_KEY);
    return loc || null;
  } catch {
    return null;
  }
}

export async function saveLocation(loc: UserLocation) {
  try {
    await set(LOCATION_CACHE_KEY, loc);
  } catch (err) {
    console.error('Failed to save location', err);
  }
}

async function getReverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(geoUrl);
    const geoData = await res.json();
    return geoData.city || geoData.locality || geoData.principalSubdivision || 'My Location';
  } catch {
    return 'My Location';
  }
}

export async function fetchWeather(manualLat?: number, manualLon?: number, manualCity?: string): Promise<WeatherSnapshot> {
  let lat: number;
  let lon: number;
  let city: string;

  // 1. Manual Override
  if (manualLat !== undefined && manualLon !== undefined) {
    lat = manualLat;
    lon = manualLon;
    city = manualCity || await getReverseGeocode(lat, lon);
    await saveLocation({ lat, lon, city, isManual: true });
  } else {
    // 2. Cache Check (IndexedDB)
    const cachedLoc = await getCachedLocation();
    if (cachedLoc) {
      lat = cachedLoc.lat;
      lon = cachedLoc.lon;
      city = cachedLoc.city;
    } else {
      // 3. Geolocation attempt
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        city = await getReverseGeocode(lat, lon);
        await saveLocation({ lat, lon, city });
      } catch (err) {
        // 4. Fallback: Ho Chi Minh City
        console.warn('Geolocation failed, falling back to HCMC', err);
        lat = DEFAULT_LAT;
        lon = DEFAULT_LON;
        city = 'Ho Chi Minh City';
        // Note: We don't save the fallback to cache so we try geoloc again next session
      }
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const data = await fetchWithProxy(url, controller.signal);
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

    localStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, ts: Date.now() }));
    return snapshot;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
