/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Flame, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { useApp } from '../../state/AppContextCore';
import { useUi } from '../../state/UiContextCore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import { triggerHaptic } from '../../lib/haptic';
import { cn } from '../../lib/utils';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** "12:00 AM", "1:00 PM" — matches the familiar hourly-planner labelling. */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

interface ScriptureSprintModalProps {
  /** Today's local date, 'yyyy-MM-dd'. Kept fresh by useToday upstream. */
  todayStr: string;
}

function ScriptureSprintModal({ todayStr }: ScriptureSprintModalProps) {
  const { state, dispatch } = useApp();
  const { setShowSprintModal, setConfirmDialog, showToast } = useUi();

  const onClose = () => setShowSprintModal(false);
  const dismissOverlay = useOverlayDismiss(onClose);

  const sprint = useMemo(
    () => (state.scriptureSprints ?? []).find((s) => s.date === todayStr),
    [state.scriptureSprints, todayStr]
  );

  const completed = useMemo(
    () => HOURS.filter((h) => sprint?.hours[String(h)]?.done).length,
    [sprint]
  );

  // Live current hour so "now" stays highlighted through the day.
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setCurrentHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Scroll the current hour into view on open so you land on "now", not 12 AM.
  const nowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      nowRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = (hour: number) => {
    triggerHaptic(sprint?.hours[String(hour)]?.done ? 'light' : 'medium');
    dispatch({ type: 'TOGGLE_SPRINT_HOUR', date: todayStr, hour });
  };

  const setReference = (hour: number, reference: string) => {
    dispatch({ type: 'SET_SPRINT_REFERENCE', date: todayStr, hour, reference });
  };

  const onClear = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Clear this sprint',
      message: `This clears all ${completed} checked hour${completed === 1 ? '' : 's'} for today. Your reading plan and stats are untouched.`,
      onConfirm: () => {
        dispatch({ type: 'CLEAR_SPRINT', date: todayStr });
        showToast('Sprint cleared', 'success');
      },
    });
  };

  const pct = Math.round((completed / 24) * 100);

  return (
    <>
      <motion.div
        key="sprint-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismissOverlay}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      <motion.div
        key="sprint-window"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="fixed inset-0 sm:inset-4 md:inset-x-auto md:inset-y-8 md:left-1/2 md:-translate-x-1/2 md:w-[620px] md:max-w-[calc(100vw-4rem)] bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl sm:rounded-[24px] overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex justify-between items-center gap-4 px-5 sm:px-8 bg-[var(--bg-primary)] border-b border-[var(--border-color)] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)',
            paddingBottom: '1.25rem',
          }}
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white bg-brand shadow-sm shrink-0">
              <Flame size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter text-[var(--text-primary)] truncate">
                24-Hour Sprint
              </h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest truncate">
                {format(parseISO(todayStr), 'EEEE, MMMM do')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sprint"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:scale-105 transition-transform bg-[var(--text-primary)] text-[var(--bg-primary)] shrink-0"
          >
            <Check size={20} />
          </button>
        </div>

        {/* Progress band */}
        <div className="px-5 sm:px-8 py-5 border-b border-[var(--border-color)] shrink-0 bg-[var(--bg-secondary)]">
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                'text-[40px] leading-none font-bold tracking-tighter tabular-nums',
                completed === 0 ? 'text-[var(--text-secondary)] opacity-50' : 'text-[var(--text-primary)]'
              )}>
                {completed}
              </span>
              <span className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                of 24 chapters
              </span>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand tabular-nums">
              {pct}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-brand"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
            />
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-3 opacity-80">
            {completed === 24
              ? 'All 24 hours complete. Well done.'
              : 'One chapter every hour, for one full day. Kept separate from your reading plan.'}
          </p>
        </div>

        {/* Hour grid */}
        <div className="flex-1 overflow-y-auto ios-scroll">
          <div className="px-4 sm:px-8 py-4">
            {HOURS.map((h) => {
              const slot = sprint?.hours[String(h)];
              const done = !!slot?.done;
              const isNow = h === currentHour;
              return (
                <div
                  key={h}
                  ref={isNow ? nowRef : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-[14px] px-2 sm:px-3 py-1.5 transition-colors',
                    isNow && 'bg-brand/10 ring-1 ring-brand/30'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(h)}
                    aria-pressed={done}
                    aria-label={`${hourLabel(h)} — mark ${done ? 'unread' : 'read'}`}
                    className="flex items-center gap-3 min-h-[44px] shrink-0 group"
                  >
                    <span className={cn(
                      'text-[13px] font-bold tabular-nums w-[76px] text-right transition-colors',
                      done ? 'text-[var(--text-secondary)] opacity-60'
                           : isNow ? 'text-brand' : 'text-[var(--text-primary)]'
                    )}>
                      {hourLabel(h)}
                    </span>
                    <span className={cn(
                      'w-[26px] h-[26px] rounded-[8px] border-2 flex items-center justify-center transition-all',
                      'group-active:scale-90',
                      done
                        ? 'bg-brand border-brand text-white shadow-sm'
                        : cn(
                            'group-hover:border-brand',
                            // On the highlighted "now" row the default border
                            // disappears into the tint in light mode.
                            isNow ? 'border-brand/50 bg-[var(--bg-primary)]' : 'border-[var(--border-color)]'
                          )
                    )}>
                      {done && <Check size={16} strokeWidth={3.5} />}
                    </span>
                  </button>

                  <input
                    type="text"
                    value={slot?.reference ?? ''}
                    onChange={(e) => setReference(h, e.target.value)}
                    placeholder={isNow ? 'What did you read?' : ''}
                    aria-label={`Chapter read at ${hourLabel(h)}`}
                    className={cn(
                      // A persistent hairline reads as a fill-in field, so the
                      // third column is discoverable without a hover cue.
                      'flex-1 min-w-0 bg-transparent border-0 border-b',
                      'px-1 py-2 text-[15px] font-medium outline-none transition-colors',
                      'focus:border-brand placeholder:text-[var(--text-secondary)] placeholder:opacity-50',
                      done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]',
                      isNow ? 'border-brand/30' : 'border-[var(--border-color)]'
                    )}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 sm:px-8 py-4 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 flex items-center gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onClear}
            disabled={!sprint}
            className="min-h-[52px] px-5 font-bold uppercase tracking-widest text-[12px] transition-all flex items-center justify-center gap-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-[18px] active:scale-[0.98] shrink-0 disabled:opacity-40"
          >
            <RotateCcw size={15} />
            Clear
          </button>
          <button
            onClick={onClose}
            className="flex-1 min-h-[52px] font-bold uppercase tracking-widest text-[12px] transition-all flex items-center justify-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-[18px] shadow-sm hover:opacity-90 active:scale-[0.98]"
          >
            Done
            <Check size={16} />
          </button>
        </div>
      </motion.div>
    </>
  );
}

export default ScriptureSprintModal;
