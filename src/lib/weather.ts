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

    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ snapshot, ts: Date.now() }));
    return snapshot;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
