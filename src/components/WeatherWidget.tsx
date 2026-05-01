/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sun, CloudSun, Cloud, CloudFog, CloudRain, CloudSnow, CloudLightning } from 'lucide-react';
import { fetchWeather, getCachedWeather, WeatherSnapshot } from '../lib/weather';
import { useApp } from '../state/AppContext';
import { cn } from '../lib/utils';

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
  const { state } = useApp();
  const theme = state.settings.theme;

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    setIsRefreshing(true);
    try {
      const fresh = await fetchWeather();
      setWeather(fresh);
    } catch (e) {
      console.error('Weather refresh failed', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

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
            "text-[9px] uppercase font-black tracking-[0.12em] opacity-60",
            isXP ? "text-[#003C74]" : "text-[var(--audible-text-secondary)]"
          )}>
            {weather.city}
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
        <span className={cn(
          "text-sm font-black tracking-tighter",
          isXP ? "text-black" : "text-[var(--audible-text-primary)]"
        )}>
          {weather.tempF}°F
        </span>
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
