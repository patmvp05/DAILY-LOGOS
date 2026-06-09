/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Sparkles, Calendar, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

export function Onboarding({ onComplete }: { onComplete: (date: string) => void }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  return (
    <div className="max-w-xl mx-auto px-6 py-12 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mx-auto mb-8">
        <Sparkles size={40} className="text-brand" />
      </div>
      
      <h1 className="text-4xl font-black tracking-tight uppercase mb-4 text-[var(--audible-text-primary)]">
        Welcome to Logos
      </h1>
      
      <p className="text-lg text-[var(--audible-text-secondary)] font-medium mb-12">
        Let's set your journey in motion. When did you (or when will you) start this reading plan?
      </p>

      <div className="bg-[var(--audible-card)] border border-[var(--audible-border)] p-8 rounded-2xl shadow-xl mb-12">
        <div className="flex items-center gap-4 mb-6">
          <Calendar className="text-brand" size={24} />
          <p className="text-xs uppercase font-black tracking-widest text-[var(--audible-text-secondary)]">Plan Start Date</p>
        </div>
        
        <input 
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-white dark:bg-zinc-900 border-2 border-[var(--audible-border)] rounded-xl p-4 text-xl font-bold focus:border-brand focus:outline-none transition-colors mb-8"
        />

        <button 
          onClick={() => onComplete(new Date(date).toISOString())}
          className="w-full bg-brand text-white font-black uppercase py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-brand/90 transition-all group active:scale-[0.98]"
        >
          Begin My Journey
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <p className="text-[10px] uppercase font-black tracking-[0.2em] text-[var(--audible-text-secondary)] opacity-50 italic">
        You can always change this later in settings.
      </p>
    </div>
  );
}
