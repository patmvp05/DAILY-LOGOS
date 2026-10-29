/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { format, isToday } from 'date-fns';
import { resolveBibleVersion } from '../constants';
import type { Progress } from '../types';
import { cn } from '../lib/utils';
import { describeVerses, type ChapterCheck } from '../lib/chapterCheck';
import { refetchChapterText } from '../lib/chapterText';
import { upcomingChapters } from '../lib/prefetchBible';
import { getTextCheck, textCheckKey, useTextCheckVersion } from '../lib/textCheckLog';

/**
 * Under a chapter's title in the reader and the daily proverb: proof that the
 * copy on screen was checked verse by verse, or a clear warning with a way to
 * download it again. Before this, a chapter missing 72 verses looked normal.
 */
export function TextCheckBadge({
  check,
  onRetry,
}: {
  check?: ChapterCheck;
  onRetry?: () => void;
}) {
  if (!check) return null;
  if (check.ok) {
    return (
      <p
        data-testid="text-check-ok"
        className="-mt-6 mb-8 flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]"
      >
        <ShieldCheck size={14} className="text-brand shrink-0" />
        <span>
          All {check.lastVerse} verses checked
          {check.footnoted.length > 0 && (
            <span className="opacity-70">
              {' '}· {describeVerses(check.footnoted)} {check.footnoted.length === 1 ? 'is a footnote' : 'are footnotes'} in this translation
            </span>
          )}
        </span>
      </p>
    );
  }
  return (
    <div
      role="alert"
      data-testid="text-check-failed"
      className="-mt-4 mb-8 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-[14px] text-red-700 dark:text-red-400"
    >
      <p className="flex items-center gap-2 font-bold">
        <AlertTriangle size={16} className="shrink-0" />
        This chapter didn't pass the text check
      </p>
      <p className="mt-1 leading-relaxed">{check.problems.join('. ')}.</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-[12px] font-bold uppercase tracking-widest text-white active:scale-95"
        >
          <RefreshCw size={13} />
          Download again
        </button>
      )}
    </div>
  );
}

/**
 * Dashboard line: the chapters the app preloads (the next 7 in every part, plus
 * today's proverb) are checked every time the app opens. Says so when they all
 * pass, names any chapter that fails, and offers to download it again.
 */
export function TextCheckSummary({
  progress,
  bibleVersion,
  proverbChapter,
  className,
}: {
  progress: Progress[];
  bibleVersion?: string;
  /** Today's proverb (chapter = day of month), checked when it preloads. */
  proverbChapter?: number;
  className?: string;
}) {
  useTextCheckVersion();
  const [fixing, setFixing] = useState(false);
  const versionId = resolveBibleVersion(bibleVersion);
  const chapters = upcomingChapters(progress).map(({ bookName, chapter }) => ({ bookName, chapter }));
  if (proverbChapter) chapters.push({ bookName: 'Proverbs', chapter: proverbChapter });
  const rows = chapters.map((c) => ({
    ...c,
    entry: getTextCheck(textCheckKey(versionId, c.bookName, c.chapter)),
  }));
  if (rows.length === 0) return null;

  const failed = rows.filter((r) => r.entry && !r.entry.ok);
  const checked = rows.filter((r) => r.entry).length;
  const latest = Math.max(0, ...rows.map((r) => r.entry?.at ?? 0));
  const when = latest ? `${isToday(latest) ? 'Today' : format(latest, 'MMM d')} at ${format(latest, 'h:mm a')}` : '';

  const fix = async () => {
    setFixing(true);
    for (const r of failed) {
      try { await refetchChapterText(r.bookName, r.chapter, versionId); } catch { /* still failing: stays listed */ }
    }
    setFixing(false);
  };

  if (failed.length > 0) {
    return (
      <div role="alert" data-testid="text-check-summary-failed" className={cn('rounded-2xl border border-red-500/30 bg-red-500/5 p-3', className)}>
        <p className="flex items-start gap-2 text-[12px] font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {failed.length === 1 ? `${failed[0].bookName} ${failed[0].chapter} didn't` : `${failed.length} chapters didn't`} pass
            the text check{failed.length > 1 ? `: ${failed.map((r) => `${r.bookName} ${r.chapter}`).join(', ')}` : ''}.
          </span>
        </p>
        <button
          type="button"
          onClick={fix}
          disabled={fixing}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white disabled:opacity-60"
        >
          <RefreshCw size={12} className={cn(fixing && 'animate-spin')} />
          {fixing ? 'Downloading…' : 'Download again'}
        </button>
      </div>
    );
  }

  const done = checked === rows.length;
  return (
    <div data-testid="text-check-summary" className={cn('flex items-start gap-2', className)}>
      <ShieldCheck size={15} className={cn('mt-0.5 shrink-0', done ? 'text-brand' : 'text-[var(--text-secondary)]')} />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-[var(--text-primary)]">
          {done
            ? `All ${rows.length} preloaded chapters checked`
            : `${checked} of ${rows.length} preloaded chapters checked`}
        </p>
        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
          {done
            ? `Every verse present${when ? ` · ${when}` : ''}`
            : 'The rest are checked as they download'}
        </p>
      </div>
    </div>
  );
}
