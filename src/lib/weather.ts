/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

const CACHE_KEY = 'dl_weather_v1';
const DEFAULT_LAT = 31.7683; // Jerusalem
const DEFAULT_LON = 35.2137;

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
    
    // Older than 6 hours? Discard.
    if (ageMs > 1000 * 60 * 60 * 6) return null;
    
    return snapshot;
  } catch (e) {
    return null;
  }
}

export async function fetchWeather(): Promise<WeatherSnapshot> {
  let lat = DEFAULT_LAT;
  let lon = DEFAULT_LON;
  let city = 'Jerusalem';

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
    city = 'Current Location';
    
    // Try to get city name
    try {
      const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const res = await fetch(geoUrl);
      const geoData = await res.json();
      if (geoData) {
        city = geoData.city || geoData.locality || geoData.principalSubdivision || 'Current Location';
      }
    } catch (e) {
      console.warn('Reverse geocoding failed', e);
    }
  } catch (e) {
    console.warn('Geolocation failed, using default', e);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const data = await fetchWithProxy(url, controller.signal);
    clearTimeout(timeoutId);

    if (!data || !data.current || !data.daily) throw new Error('Weather data invalid');

    const current = data.current;
    const daily = data.daily;

    const snapshot: WeatherSnapshot = {
      tempF: Math.round(current.temperature_2m),
      highF: Math.round(daily.temperature_2m_max[0]),
      lowF: Math.round(daily.temperature_2m_min[0]),
      conditionCode: current.weather_code,
      conditionLabel: WEATHER_CODE_MAP[current.weather_code] || 'Clear',
      city,
      fetchedAt: Date.now()
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, ts: Date.now() }));
    } catch (e) {
      // Ignore quota errors
    }

    return snapshot;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
