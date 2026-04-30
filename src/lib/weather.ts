/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
const FALLBACK_LAT = 10.7626;
const FALLBACK_LON = 106.6602;
const FALLBACK_CITY = 'Ho Chi Minh City';

interface LocationData {
  lat: number;
  lon: number;
  city: string;
}

async function getUserLocation(signal: AbortSignal): Promise<LocationData> {
  const defaultLoc = { lat: FALLBACK_LAT, lon: FALLBACK_LON, city: FALLBACK_CITY };

  if (!navigator.geolocation) return defaultLoc;

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 5000,
        maximumAge: 1000 * 60 * 60 * 1 // 1 hour
      });
      // Handle abort from our timeout controller
      signal.addEventListener('abort', () => reject(new Error('Aborted')));
    });

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    // Attempt reverse geocoding to get city name
    try {
      const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { signal });
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const city = geoData.city || geoData.locality || FALLBACK_CITY;
        return { lat, lon, city };
      }
    } catch (e) {
      // Silently fall back to coordinates without city if reverse geocoding fails
    }

    return { lat, lon, city: 'Unknown Location' };
  } catch (e) {
    return defaultLoc;
  }
}

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const loc = await getUserLocation(controller.signal);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const response = await fetch(url, { 
      mode: 'cors',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('Weather fetch failed');

    const data = await response.json();
    const current = data.current;
    const daily = data.daily;

    const snapshot: WeatherSnapshot = {
      tempF: Math.round(current.temperature_2m),
      highF: Math.round(daily.temperature_2m_max[0]),
      lowF: Math.round(daily.temperature_2m_min[0]),
      conditionCode: current.weather_code,
      conditionLabel: WEATHER_CODE_MAP[current.weather_code] || 'Clear',
      city: loc.city,
      fetchedAt: Date.now()
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, ts: Date.now() }));
    } catch (e) {
      // Ignore quota errors or private mode
    }

    return snapshot;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
