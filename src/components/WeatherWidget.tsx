/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sun, CloudSun, Cloud, CloudFog, CloudRain, CloudSnow, CloudLightning, Pencil } from 'lucide-react';
import { fetchWeather, getCachedWeather, WeatherSnapshot } from '../lib/weather';
import { useApp } from '../state/AppContextCore';
import { cn } from '../lib/utils';
import { get, set } from 'idb-keyval';

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
  const { state } = useApp();
  const theme = state.settings.theme;

  const refresh = useCallback(async (manualLat?: number, manualLng?: number, manualName?: string) => {
    if (!navigator.onLine) return;
    setIsRefreshing(true);
    
    try {
      let lat: number;
      let lng: number;
      let city: string = '';
      let source: 'geolocation' | 'cache' | 'fallback' = 'fallback';

      // a) Load cached coords
      const cached = await get<{ lat: number, lng: number, city: string, timestamp: number }>('weather-coords');
      const oneHour = 3600000;

      if (manualLat !== undefined && manualLng !== undefined) {
        lat = manualLat;
        lng = manualLng;
        city = manualName || '';
        source = 'cache';
      } else if (cached && cached.timestamp && (Date.now() - cached.timestamp < oneHour)) {
        // b) Use fresh cache
        lat = cached.lat;
        lng = cached.lng;
        city = cached.city || '';
        source = 'cache';
      } else {
        // c) Request geolocation
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { 
              timeout: 5000, 
              maximumAge: 3600000 
            });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          source = 'geolocation';
        } catch (err) {
          console.warn('[DL-DEBUG] Geolocation failed:', (err as Error).message);
          // Fallback to cached coords if available, otherwise HCMC defaults
          const fallback = cached || { lat: 10.8231, lng: 106.6297, city: 'Ho Chi Minh City' };
          lat = fallback.lat;
          lng = fallback.lng;
          city = fallback.city || 'Ho Chi Minh City';
          source = cached ? 'cache' : 'fallback';
        }
      }

      // d) Reverse geocoding
      if (!city || source === 'geolocation') {
        try {
          const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
          const geoData = await geoRes.json();
          city = geoData.city || geoData.locality || 'Unknown';
        } catch {
          city = city || 'Unknown';
        }
      }

      // Update cache with fresh timestamp and city
      await set('weather-coords', { lat, lng, city, timestamp: Date.now() });

      // e) Debug log
      console.log('[DL-DEBUG] Weather coords:', { lat, lng, source });

      const fresh = await fetchWeather(lat, lng, city);
      setWeather(fresh);
    } catch (e) {
      console.error('Weather refresh failed', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleManualLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempCity.trim()) return;
    
    setIsRefreshing(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(tempCity)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        await refresh(parseFloat(item.lat), parseFloat(item.lon), item.display_name.split(',')[0]);
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

  const isXP = theme === 'xp';

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors overflow-hidden">
        <WeatherIcon code={weather.conditionCode} className="shrink-0 w-4 h-4" />
        <span className={cn(
          "text-xs font-black tracking-tighter whitespace-nowrap",
          isXP ? "text-black" : "text-[var(--audible-text-primary)]"
        )}>
          {weather.tempF}°F
        </span>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "flex items-center gap-3 px-3 py-1.5 transition-all",
        isXP 
          ? "bg-[#ECE9D8] border border-[#003C74] rounded-[4px] shadow-sm ml-2" 
          : "hover:bg-black/5 dark:hover:bg-white/5 rounded-xl ml-4"
      )}
    >
      <div className="relative">
        <WeatherIcon code={weather.conditionCode} className="shrink-0" />
        {isRefreshing && (
          <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-evernote rounded-full dot-pulse" />
        )}
      </div>
      
      <div className="hidden lg:flex flex-col leading-tight">
        <div className="flex items-baseline gap-2">
          <span className={cn(
            "text-base font-black tracking-tighter",
            isXP ? "text-black" : "text-[var(--audible-text-primary)]"
          )}>
            {weather.tempF}°F
          </span>
          <span className={cn(
            "text-[9px] uppercase font-black tracking-[0.12em] opacity-60 flex items-center gap-1",
            isXP ? "text-[#003C74]" : "text-[var(--audible-text-secondary)]"
          )}>
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
                  className="p-0.5 hover:text-evernote transition-colors"
                >
                  <Pencil size={8} />
                </button>
              </>
            )}
          </span>
        </div>
        <span className={cn(
          "text-[9px] font-bold tracking-tight opacity-70",
          isXP ? "text-[#003C74]" : "text-[var(--audible-text-secondary)]"
        )}>
          {weather.highF}°F / {weather.lowF}°F · {weather.conditionLabel}
        </span>
      </div>

      <div className="flex lg:hidden flex-col leading-tight">
        <div className="flex items-baseline gap-1">
          <span className={cn(
            "text-sm font-black tracking-tighter",
            isXP ? "text-black" : "text-[var(--audible-text-primary)]"
          )}>
            {weather.tempF}°F
          </span>
          <span className={cn(
            "text-[7px] uppercase font-black tracking-tight opacity-60 truncate max-w-[50px]",
            isXP ? "text-[#003C74]" : "text-[var(--audible-text-secondary)]"
          )}>
            {weather.city}
          </span>
        </div>
        <span className={cn(
          "text-[8px] font-bold tracking-tight opacity-70",
          isXP ? "text-[#003C74]" : "text-[var(--audible-text-secondary)]"
        )}>
          {weather.conditionLabel}
        </span>
      </div>
    </div>
  );
}
