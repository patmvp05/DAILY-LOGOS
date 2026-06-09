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
      <div className="w-full max-w-xl mx-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-[24px] shadow-2xl overflow-hidden p-8 animate-in fade-in zoom-in-95 duration-300">
          <div className="space-y-8">
            <div className="flex justify-between items-center mb-8">
              <div className="space-y-2">
                <div className="h-2 w-24 bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
                <div className="h-8 w-48 bg-[var(--bg-tertiary)] rounded-lg animate-pulse" />
              </div>
              <div className="w-12 h-12 bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
            </div>
            
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-6 bg-[var(--bg-secondary)] rounded-[16px] border border-[var(--border-color)]">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-8 h-8 bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
                    <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 w-full bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
                    <div className="h-2 w-2/3 bg-[var(--bg-tertiary)] rounded-full animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
      </div>
    </div>
  );
}
