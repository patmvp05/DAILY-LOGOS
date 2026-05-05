/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../state/AppContextCore';
import { cn } from '../lib/utils';

export default function ModalLoader() {
  const [show, setShow] = useState(false);
  const { state } = useApp();
  const theme = state.settings.theme;

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/5 backdrop-blur-[4px]">
      <div className={cn(
        "w-full max-w-xl mx-4 bg-[var(--audible-nav)] border border-[var(--audible-border)] rounded-2xl shadow-2xl overflow-hidden p-8 animate-in fade-in zoom-in-95 duration-300",
        theme === 'xp' && "xp-window border-0 rounded-none p-0"
      )}>
        {theme === 'xp' ? (
          <div className="xp-content p-8">
            <div className="h-4 bg-gray-200 w-1/4 mb-4 animate-pulse" />
            <div className="h-8 bg-gray-200 w-3/4 mb-8 animate-pulse" />
            <div className="space-y-4">
              <div className="h-24 bg-gray-200 w-full animate-pulse" />
              <div className="h-24 bg-gray-200 w-full animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex justify-between items-center mb-8">
              <div className="space-y-2">
                <div className="h-2 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                <div className="h-8 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
              </div>
              <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
            </div>
            
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-6 bg-zinc-100/50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                    <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                    <div className="h-2 w-2/3 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
