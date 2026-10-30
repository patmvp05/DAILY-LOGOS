/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The dashboard's cards (Oct 2026 layout). Phone order, top to bottom:
 *   ProverbCard     today's proverb, always first: it doubles as the date
 *                   (Proverbs 30 on the 30th). Slim once read.
 *   TodayCard       day number, parts read today, streak and week, minutes read
 *                   today, whole-Bible progress, the text check, Full Plan and
 *                   the 24-hour sprint. Replaced the summary strip, Today's
 *                   Reading, Plan Status and the sprint card.
 *   ResumeCard      back into the last chapter read.
 *   (reading parts) CategoryCard in Dashboard.tsx, unchanged.
 *   FinishedPartsCard  a 100% part as one slim row instead of a full card.
 *   DevotionalsCard last.
 */

import React from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, Cloud, ExternalLink, Flame, Layers, Play, Sparkles } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { cn } from '../lib/utils';

const LABEL = 'text-[11px] uppercase tracking-widest font-bold';

/** A calendar page: the month over today's date, which is also the proverb's chapter. */
function DateTile({ todayStr, read }: { todayStr: string; read: boolean }) {
  const date = parseISO(todayStr);
  return (
    <div className="relative shrink-0" aria-hidden="true">
      <div className="w-14 h-14 rounded-2xl overflow-hidden flex flex-col bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-sm">
        <span className="bg-brand text-white text-[10px] font-bold uppercase tracking-widest leading-none py-[5px] text-center">
          {format(date, 'MMM')}
        </span>
        <span className="flex-1 flex items-center justify-center text-[24px] font-bold tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
          {format(date, 'd')}
        </span>
      </div>
      {read && (
        <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center ring-2 ring-[var(--bg-secondary)]">
          <Check size={13} strokeWidth={3.5} />
        </span>
      )}
    </div>
  );
}

export function ProverbCard({
  todayStr, chapter, read, snippet, loading, onOpen, className,
}: {
  todayStr: string;
  chapter: number;
  read: boolean;
  snippet: string | null;
  loading: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const date = parseISO(todayStr);
  if (read) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid="proverb-card"
        aria-label={`Proverbs ${chapter}, read today. Open it again`}
        className={cn('dl-card-interactive w-full text-left p-4 flex items-center gap-4', className)}
      >
        <DateTile todayStr={todayStr} read />
        <div className="min-w-0 flex-1">
          <p className={cn(LABEL, 'text-[var(--text-secondary)]')}>Daily Proverb</p>
          <p className="text-[20px] font-bold tracking-tighter leading-tight text-[var(--text-primary)] mt-0.5">
            Proverbs {chapter}
          </p>
          <p className="text-[12px] font-semibold text-brand mt-0.5 truncate">
            Read today · {format(date, 'EEEE, MMMM d')}
          </p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-[var(--text-secondary)]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="proverb-card"
      className={cn('dl-card-interactive w-full text-left p-5 sm:p-6 relative overflow-hidden group', className)}
    >
      <Sparkles
        size={40}
        className="absolute top-5 right-5 text-brand/20 dark:text-brand/40 group-hover:scale-110 transition-transform"
      />
      <div className="flex items-center gap-4 pr-12">
        <DateTile todayStr={todayStr} read={false} />
        <div className="min-w-0">
          <p className={cn(LABEL, 'text-[var(--text-secondary)]')}>Daily Proverb · {format(date, 'EEEE')}</p>
          <h2 className="text-[28px] font-bold tracking-tighter leading-tight text-[var(--text-primary)] mt-0.5">
            Proverbs {chapter}
          </h2>
        </div>
      </div>
      {loading ? (
        <div className="space-y-2 animate-pulse mt-4">
          <div className="h-4 bg-[var(--border-color)] rounded w-3/4" />
          <div className="h-4 bg-[var(--border-color)] rounded w-1/2" />
        </div>
      ) : snippet ? (
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">"{snippet}"</p>
      ) : null}
      <p className="mt-3 text-xs font-semibold text-brand">Read today's proverb &rarr;</p>
    </button>
  );
}

export interface TodayPart {
  id: string;
  doneToday: boolean;
}

export function TodayCard({
  dayNumber, streak, readDates, todayStr, activeParts, minutes, chaptersToday,
  overallProgress, totalRead, totalChapters, sprintCompleted, textCheck,
  onOpenPlan, onOpenSprint, className,
}: {
  dayNumber: number;
  streak: number;
  /** Local dates (yyyy-MM-dd) with at least one chapter read. */
  readDates: Set<string>;
  todayStr: string;
  /** Parts with reading left, in plan order. */
  activeParts: TodayPart[];
  minutes: number;
  /** "Proverbs 30", one per chapter read today. */
  chaptersToday: string[];
  overallProgress: number;
  totalRead: number;
  totalChapters: number;
  sprintCompleted: number;
  textCheck: React.ReactNode;
  onOpenPlan: () => void;
  onOpenSprint: () => void;
  className?: string;
}) {
  const doneCount = activeParts.filter((p) => p.doneToday).length;
  const today = parseISO(todayStr);
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = format(subDays(today, 6 - i), 'yyyy-MM-dd');
    return { key, read: readDates.has(key), isToday: i === 6 };
  });
  const daysThisWeek = week.filter((d) => d.read).length;
  const pct = Math.max(0, Math.min(100, Number.isFinite(overallProgress) ? overallProgress : 0));
  const todayLine =
    chaptersToday.length === 0
      ? 'No chapters yet'
      : chaptersToday.length <= 2
        ? chaptersToday.join(' · ')
        : `${chaptersToday.length} chapters`;

  return (
    <section aria-label="Today" data-testid="today-card" className={cn('dl-card p-5 sm:p-6', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn(LABEL, 'text-brand mb-2')}>Day {dayNumber}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] leading-none font-bold tracking-tighter tabular-nums text-[var(--text-primary)]">
              {doneCount}
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              of {activeParts.length} parts today
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <Flame size={18} className="text-brand" />
            <span className="text-[28px] leading-none font-bold tracking-tighter tabular-nums text-[var(--text-primary)]">
              {streak}
            </span>
          </div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-secondary)] mt-2">Day streak</p>
          <div className="flex justify-end gap-1 mt-2" role="img" aria-label={`Read on ${daysThisWeek} of the last 7 days`}>
            {week.map((d) => (
              <span
                key={d.key}
                className={cn(
                  'w-2 h-2 rounded-full',
                  d.read ? 'bg-brand' : d.isToday ? 'border border-dashed border-brand/60' : 'bg-[var(--bg-tertiary)]'
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {activeParts.length > 0 && (
        <div
          className="grid gap-1.5 mt-5"
          style={{ gridTemplateColumns: `repeat(${activeParts.length}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {activeParts.map((p) => (
            <div key={p.id} className={cn('h-1.5 rounded-full', p.doneToday ? 'bg-brand' : 'bg-[var(--bg-tertiary)]')} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 mt-5 pt-5 border-t border-[var(--border-color)]">
        <div className="min-w-0">
          <p className={cn(LABEL, 'text-[var(--text-secondary)]')}>Read today</p>
          <p className="mt-1.5 flex items-baseline gap-1">
            <span
              className={cn(
                'text-[26px] leading-none font-bold tracking-tighter tabular-nums',
                minutes === 0 ? 'text-[var(--text-secondary)] opacity-50' : 'text-[var(--text-primary)]'
              )}
            >
              {minutes}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand">min</span>
          </p>
          <p className="text-[11px] font-medium text-[var(--text-secondary)] mt-2 truncate">{todayLine}</p>
        </div>
        <div className="min-w-0">
          <p className={cn(LABEL, 'text-[var(--text-secondary)]')}>Whole Bible</p>
          <p className="mt-1.5 flex items-baseline gap-0.5">
            <span className="text-[26px] leading-none font-bold tracking-tighter tabular-nums text-[var(--text-primary)]">
              {pct}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand">%</span>
          </p>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Whole Bible progress"
            className="mt-2 h-1.5 rounded-full overflow-hidden bg-[var(--bg-tertiary)]"
          >
            <div
              className={cn('h-full rounded-full bg-brand transition-all duration-700 ease-out', pct < 100 && 'shimmer-effect')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] font-medium text-[var(--text-secondary)] mt-1.5 tabular-nums truncate">
            {totalRead.toLocaleString()} of {totalChapters.toLocaleString()} chapters
          </p>
        </div>
      </div>

      {textCheck && <div className="mt-5">{textCheck}</div>}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button
          type="button"
          onClick={onOpenPlan}
          className="flex items-center justify-center gap-2 py-3 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] text-[13px] font-semibold text-[var(--text-primary)] active:scale-[0.98] transition-transform"
        >
          <Layers size={14} />
          Full Plan
        </button>
        <button
          type="button"
          onClick={onOpenSprint}
          className={cn(
            'flex items-center justify-center gap-2 py-3 rounded-full border text-[13px] font-semibold active:scale-[0.98] transition-transform',
            sprintCompleted > 0
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
          )}
        >
          <Flame size={14} className="text-brand" />
          {sprintCompleted > 0 ? `Sprint ${sprintCompleted}/24` : '24-Hour Sprint'}
        </button>
      </div>
    </section>
  );
}

export function ResumeCard({
  partName, bookName, chapter, lastRead, syncStatus, onOpen, className,
}: {
  partName: string;
  bookName: string;
  chapter: number;
  /** "yesterday at 7:07 AM" */
  lastRead: string;
  syncStatus?: string;
  onOpen: () => void;
  className?: string;
}) {
  const sync =
    syncStatus === 'syncing' ? { text: 'Syncing…', cls: 'text-brand animate-pulse' }
      : syncStatus === 'offline' ? { text: 'Offline', cls: 'text-zinc-400' }
        : syncStatus === 'error' ? { text: 'Sync error', cls: 'text-red-500' }
          : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Resume reading ${bookName} ${chapter}`}
      className={cn('dl-card-interactive w-full text-left p-4 sm:p-5 flex items-center gap-4 group', className)}
    >
      <span className="w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center shrink-0 shadow-md shadow-brand/20 group-hover:scale-105 transition-transform">
        <Play size={22} fill="currentColor" className="ml-1" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className={cn(LABEL, 'text-brand shrink-0')}>Resume reading</span>
          <span className={cn(LABEL, 'text-[var(--text-secondary)] truncate')}>· {partName}</span>
          {sync && (
            <span className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest shrink-0', sync.cls)}>
              <Cloud size={11} />
              {sync.text}
            </span>
          )}
        </span>
        <span className="block text-[22px] font-bold tracking-tighter leading-tight text-[var(--text-primary)] truncate mt-0.5">
          {bookName} {chapter}
        </span>
        <span className="block text-[11px] font-medium text-[var(--text-secondary)] mt-0.5 truncate">
          Last read {lastRead}
        </span>
      </span>
      <ArrowRight size={22} className="shrink-0 text-[#8B909A] group-hover:translate-x-1 transition-transform" />
    </button>
  );
}

export interface FinishedPart {
  id: string;
  number: number;
  name: string;
  chapters: number;
}

/** A finished part takes one slim row. Tapping it opens its books, as before. */
export function FinishedPartsCard({
  parts, onOpen, className,
}: {
  parts: FinishedPart[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  if (parts.length === 0) return null;
  return (
    <section aria-label="Finished parts" data-testid="finished-parts" className={cn('dl-card p-2', className)}>
      <p className={cn(LABEL, 'px-4 pt-2 pb-1 text-[var(--text-secondary)]')}>Finished</p>
      <div className="divide-y divide-[var(--border-color)]">
        {parts.map((part) => (
          <button
            key={part.id}
            type="button"
            onClick={() => onOpen(part.id)}
            data-testid={`finished-part-${part.id}`}
            className="w-full flex items-center gap-3 px-4 py-3 text-left group active:scale-[0.99] transition-transform"
          >
            <span className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
              <Check size={16} strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold tracking-tight text-[var(--text-primary)] truncate">{part.name}</span>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Part {String(part.number).padStart(2, '0')} · all {part.chapters.toLocaleString()} chapters read
              </span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand shrink-0">100%</span>
            <ChevronRight size={18} className="shrink-0 text-[var(--text-secondary)] group-hover:text-brand transition-colors" />
          </button>
        ))}
      </div>
    </section>
  );
}

export interface DevotionalItem {
  id: string;
  name: string;
  internal: boolean;
  readToday: boolean;
}

export function DevotionalsCard({
  items, onOpen, className,
}: {
  items: DevotionalItem[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Daily devotionals" data-testid="devotionals-card" className={cn('dl-card p-2', className)}>
      <p className={cn(LABEL, 'px-4 pt-2 pb-1 text-[var(--text-secondary)]')}>Daily Devotionals</p>
      <div className="divide-y divide-[var(--border-color)]">
        {items.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onOpen(d.id)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left group active:scale-[0.99] transition-transform"
          >
            <span className="w-8 h-8 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] flex items-center justify-center shrink-0 text-[var(--text-secondary)] group-hover:text-brand transition-colors">
              {d.internal ? <BookOpen size={14} /> : <ExternalLink size={14} />}
            </span>
            <span className="flex-1 min-w-0 text-[15px] font-semibold tracking-tight text-[var(--text-primary)] truncate">
              {d.name}
            </span>
            {d.readToday ? (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brand shrink-0">
                <Check size={13} strokeWidth={3} />
                Read
              </span>
            ) : (
              <ChevronRight
                size={18}
                className="shrink-0 text-[var(--text-secondary)] group-hover:text-brand group-hover:translate-x-0.5 transition-all"
              />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
