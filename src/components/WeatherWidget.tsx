/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sun, CloudSun, Cloud, CloudFog, CloudRain, CloudSnow, CloudLightning, Pencil } from 'lucide-react';
import {
  fetchWeather,
  getCachedWeather,
  resolveWeatherLocation,
  setManualLocation,
  WeatherSnapshot,
} from '../lib/weather';
import { cn } from '../lib/utils';

/** Returning to the app within this window reuses the forecast already shown. */
const WEATHER_FRESH_MS = 30 * 60 * 1000;

interface RefreshOptions {
  /** Ask the device for its position. Only ever set by a tap on the weather. */
  locate?: boolean;
  manual?: { lat: number; lng: number; city: string };
}

const WeatherIcon = ({ code, className }: { code: number; className?: string }) => {
  if (code === 0 || code === 1) return <Sun className={cn("text-amber-500", className)} size={28} />;
  if (code === 2) return <CloudSun className={cn("text-amber-500", className)} size={28} />;
  if (code === 3) return <Cloud className={cn("text-sky-400", className)} size={28} />;
  if (code === 45 || code === 48) return <CloudFog className={cn("text-slate-400", className)} size={28} />;
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return <CloudRain className={cn("text-blue-500", className)} size={28} />;
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return <CloudSnow className={cn("text-indigo-300", className)} size={28} />;
  }
  if (code === 95 || code === 96 || code === 99) {
    return <CloudLightning className={cn("text-violet-500", className)} size={28} />;
  }
  return <Sun className={cn("text-amber-500", className)} size={28} />;
};

export default function WeatherWidget({ compact = false }: { compact?: boolean }) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(getCachedWeather());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tempCity, setTempCity] = useState('');

  // Launch and return-to-app refreshes reuse the saved location, so they never
  // show the location prompt. Only a tap on the weather passes `locate: true`
  // (see resolveWeatherLocation in lib/weather.ts for why).
  const refresh = useCallback(async ({ locate = false, manual }: RefreshOptions = {}) => {
    if (!navigator.onLine) return;
    setIsRefreshing(true);

    try {
      const loc = manual
        ? setManualLocation(manual.lat, manual.lng, manual.city)
        : await resolveWeatherLocation({ locate });

      // Coming back to the app doesn't need a new forecast every time.
      const cached = getCachedWeather();
      if (!locate && !manual && cached && cached.city === loc.city
          && Date.now() - cached.fetchedAt < WEATHER_FRESH_MS) {
        setWeather(cached);
        return;
      }

      const fresh = await fetchWeather(loc.lat, loc.lng, loc.city);
      setWeather(fresh);
    } catch (e) {
      console.error('Weather refresh failed', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // A deliberate tap: the one place a location prompt is expected.
  const updateLocation = () => {
    if (!isRefreshing) refresh({ locate: true });
  };

  const handleManualLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempCity.trim()) return;
    
    setIsRefreshing(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(tempCity)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        await refresh({
          manual: { lat: parseFloat(item.lat), lng: parseFloat(item.lon), city: item.display_name.split(',')[0] },
        });
      } else {
        alert("Location not found. Please try a city name.");
      }
    } catch (err) {
      console.error("Manual location failed", err);
    } finally {
      setIsEditing(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (mounted) await refresh();
    };
    init();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mounted) {
        refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  if (!weather) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors overflow-hidden">
        <WeatherIcon code={weather.conditionCode} className="shrink-0 w-4 h-4" />
        <span className="text-xs font-bold tracking-tighter whitespace-nowrap text-[var(--text-primary)]">
          {weather.tempF}°F
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 transition-all hover:bg-[var(--bg-secondary)] rounded-xl ml-4">
      <button
        type="button"
        onClick={updateLocation}
        aria-label="Update weather to my current location"
        title="Update weather to my current location"
        className="relative active:scale-95 transition-transform"
      >
        <WeatherIcon code={weather.conditionCode} className="shrink-0" />
        {isRefreshing && (
          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-brand rounded-full dot-pulse" />
        )}
      </button>

      <div className="hidden lg:flex flex-col leading-tight">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tighter text-[var(--text-primary)]">
            {weather.tempF}°F
          </span>
          <span className="text-[11px] uppercase font-bold tracking-widest opacity-60 flex items-center gap-1 text-[var(--text-secondary)]">
            {isEditing ? (
              <form onSubmit={handleManualLocation} className="flex">
                <input 
                  autoFocus
                  className="bg-transparent border-b border-current outline-none w-20"
                  value={tempCity}
                  onChange={e => setTempCity(e.target.value)}
                  onBlur={() => !tempCity && setIsEditing(false)}
                />
              </form>
            ) : (
              <>
                {weather.city}
                <button 
                  onClick={() => { setIsEditing(true); setTempCity(weather.city); }}
                  className="p-0.5 hover:text-brand transition-colors"
                >
                  <Pencil size={8} />
                </button>
              </>
            )}
          </span>
        </div>
        <span className="text-[11px] font-bold tracking-tight opacity-70 text-[var(--text-secondary)]">
          {weather.highF}°F / {weather.lowF}°F · {weather.conditionLabel}
        </span>
      </div>

      {/* On a phone there's no pencil, so the whole reading is the tap target. */}
      <button
        type="button"
        onClick={updateLocation}
        aria-label="Update weather to my current location"
        className="flex lg:hidden flex-col leading-tight text-left"
      >
        <span className="flex items-baseline gap-1">
          <span className="text-sm font-bold tracking-tighter text-[var(--text-primary)]">
            {weather.tempF}°F
          </span>
          <span className="text-[9px] uppercase font-bold tracking-tight opacity-60 truncate max-w-[50px] text-[var(--text-secondary)]">
            {weather.city}
          </span>
        </span>
        <span className="text-[11px] font-bold tracking-tight opacity-70 text-[var(--text-secondary)]">
          {weather.conditionLabel}
        </span>
      </button>
    </div>
  );
}
