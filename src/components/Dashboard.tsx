/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, memo } from 'react';
import { type User } from 'firebase/auth';
import { 
  Layers, 
  Play, 
  ArrowRight, 
  Sparkles, 
  ChevronRight,
  ExternalLink,
  Cloud,
  LogIn,
  RefreshCw,
  Minus,
  Plus,
  BookOpen
} from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { CATEGORIES, CATEGORIES_BY_ID, BOOK_READ_MINUTES, DEFAULT_BOOK_MINUTES } from '../constants';
import { Progress } from '../types';
import { cn, computeProgressStats } from '../lib/utils';

import { getChapterInfo, getCachedReadTime } from '../lib/bibleCache';

import { useApp } from '../state/AppContextCore';
import { useUi } from '../state/UiContextCore';
import { useAppStats } from '../hooks/useAppStats';
import { useReadingActions } from '../hooks/useReadingActions';
import { useProverb } from '../hooks/useProverb';
import { resolveDevotionalKind, getDevotionalSlug, interpolateDevotionalUrl } from '../lib/devotionalCatalog';

interface DashboardProps {
  handleLogin: (redirect?: boolean) => void;
  isSigningIn: boolean;
  user: User | null;
  isAuthLoading: boolean;
}

function DashboardComponent({
  handleLogin,
  isSigningIn,
  user,
  isAuthLoading
}: DashboardProps) {
  const { state, dispatch } = useApp();
  const { streak, dayNumber, overallProgress, totalRead, totalChaptersCount, lastReadProgress } = useAppStats(state);
  // Pass the signed-in user so chapter advances from the cards actually write
  // to the cloud (progress + history). Previously this was `null`, which
  // silently skipped the cloud write and left other devices stale until an
  // unrelated sync event happened to push the local state up.
  const { advanceChapter } = useReadingActions(state, dispatch, user);
  const dayOfMonth = new Date().getDate();
  const bibleVersion = state.settings.bibleVersion;
  const { proverbSnippet, isFetchingProverb } = useProverb(dayOfMonth, bibleVersion);

  const {
    setActivePlanCategory, setShowProverbModal, setActiveDevotion, setActiveInternalDevotional,
    setSelectingCategoryId, setReaderCategoryId, setJournalDraft, syncStatus
  } = useUi();

  const [chapterInfos, setChapterInfos] = useState<Record<string, { firstVerse: string, readTime: number }>>({});

  const handleShowProverbModal = (val: boolean) => {
    if (val) setJournalDraft({ id: null, content: '', verse: '' });
    setShowProverbModal(val);
  };

  const todayReadingStats = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayEntries = state.history.filter(
      h => h.localDate === todayStr
    );
    const minutes = todayEntries.reduce((sum, h) => {
      if (h.readTime && h.readTime > 0) {
        return sum + h.readTime;
      }
      const cached = getCachedReadTime(h.bookName, h.chapter, bibleVersion);
      if (cached && cached > 0) {
        return sum + cached;
      }
      const perCh = BOOK_READ_MINUTES[h.bookName] ?? DEFAULT_BOOK_MINUTES;
      return sum + perCh;
    }, 0);
    return { minutes, chapterCount: todayEntries.length, entries: todayEntries };
  }, [state.history, bibleVersion]);

  const { catProgress } = useMemo(() => 
    computeProgressStats(state.progress, state.completedBooks),
  [state.progress, state.completedBooks]);

  // Optimize history lookup for streak dots: Pre-compute a Set of local date strings for all read days
  const readDatesSet = useMemo(() => {
    const dates = new Set<string>();
    state.history.forEach(entry => {
      if (entry.localDate) {
        dates.add(entry.localDate);
      } else if (entry.timestamp) {
        try {
          const dateStr = format(parseISO(entry.timestamp), 'yyyy-MM-dd');
          dates.add(dateStr);
        } catch { /* ignored */ }
      }
    });
    return dates;
  }, [state.history]);

  useEffect(() => {
    let active = true;
    
    async function loadInfos() {
      // 1. Identify which chapters need fetching (not already in chapterInfos)
      const tasks = state.progress
        .map(prog => {
          const category = CATEGORIES_BY_ID.get(prog.categoryId);
          if (!category) return null;
          const book = category.books[prog.bookIndex];
          const key = `${bibleVersion}:${prog.categoryId}:${prog.bookIndex}:${prog.chapter}`;
          if (chapterInfos[key]) return null;
          return { key, bookName: book.name, chapter: prog.chapter };
        })
        .filter((t): t is { key: string, bookName: string, chapter: number } => t !== null);

      if (tasks.length === 0) return;

      try {
        // 2. Fetch all missing chapter infos in parallel
        const results = await Promise.all(
          tasks.map(async (task) => {
            const info = await getChapterInfo(task.bookName, task.chapter, bibleVersion);
            return { key: task.key, info };
          })
        );

        // 3. Batch update the state once to avoid multiple re-renders
        if (active) {
          const updates: Record<string, { firstVerse: string, readTime: number }> = {};
          results.forEach(res => {
            updates[res.key] = res.info;
          });
          setChapterInfos(prev => ({ ...prev, ...updates }));
        }
      } catch (e) {
        console.error("Failed to fetch chapter infos in parallel", e);
      }
    }

    loadInfos();
    return () => { active = false; };
  }, [state.progress, chapterInfos, bibleVersion]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 transition-opacity duration-300">
      {/* Left Control Panel */}
      <div className="lg:col-span-4 flex flex-col justify-between py-2 space-y-12">
        <section>
          <div className="mb-10 text-center lg:text-left">
            <p className="text-[11px] uppercase tracking-widest font-bold text-brand mb-2">λóγος</p>
            <h1 className="text-5xl sm:text-6xl font-black leading-none mb-4 tracking-tighter text-[var(--text-primary)]">The Daily<br />Logos</h1>
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-6">
              <p className="text-[var(--text-secondary)] font-medium text-lg">Day {dayNumber} of your journey.</p>
            </div>
            <button 
              onClick={() => setActivePlanCategory('_all')}
              className="cb-button w-full sm:w-auto mx-auto lg:mx-0 flex items-center justify-center gap-2"
            >
              <Layers size={14} />
              View Full Plan
            </button>
          </div>

          {/* Resume Reading Card (Audible Mini-Player style) */}
          {lastReadProgress && (
            <div className={cn(
              "mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700"
            )}>
              <div className="flex justify-between items-center mb-3">
                <p className="text-[11px] uppercase font-bold tracking-widest text-brand">Resume Reading</p>
                {syncStatus === 'syncing' && (
                  <span className="flex items-center gap-1 text-[10px] text-brand font-bold uppercase animate-pulse">
                    <Cloud size={12} />
                    Syncing...
                  </span>
                )}
                {syncStatus === 'offline' && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-bold uppercase">
                    <Cloud size={12} className="text-zinc-400" />
                    Offline Mode
                  </span>
                )}
                {syncStatus === 'error' && (
                  <span className="flex items-center gap-1 text-[10px] text-red-500 font-bold uppercase">
                    <Cloud size={12} className="text-red-500" />
                    Sync Error
                  </span>
                )}
              </div>
              <button 
                onClick={() => setActivePlanCategory(lastReadProgress.categoryId)}
                className="w-full group relative flex items-center justify-between cb-card-interactive"
              >
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center transition-transform duration-300 group-hover:scale-105 active:scale-95 shadow-md shadow-brand/20">
                    <Play size={24} fill="currentColor" className="ml-1" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#8B909A] mb-1">
                      {CATEGORIES_BY_ID.get(lastReadProgress.categoryId)?.name}
                    </p>
                    <h4 className="text-[22px] font-bold tracking-tighter leading-none text-[var(--text-primary)]">
                      {(() => {
                        const cat = CATEGORIES_BY_ID.get(lastReadProgress.categoryId);
                        const book = cat?.books[lastReadProgress.bookIndex];
                        return `${book?.name || 'Unknown'} ${lastReadProgress.chapter}`;
                      })()}
                    </h4>
                    <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1">
                      Last read {format(new Date(lastReadProgress.lastReadAt!), 'h:mm a')}
                    </p>
                  </div>
                </div>
                <ArrowRight size={24} className="text-[#8B909A] transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          )}

          {/* Proverb of the Day */}
          <button 
            onClick={() => handleShowProverbModal(true)}
            className="w-full mb-6 relative overflow-hidden group text-left block cb-card-interactive"
          >
            <div className="relative">
              <Sparkles className="absolute top-0 right-0 group-hover:scale-110 transition-transform text-brand/20 dark:text-brand/40" size={48} />
              <p className="text-[11px] uppercase tracking-widest font-bold mb-4 text-[var(--text-secondary)]">Daily Proverb</p>
              <h2 className="text-3xl font-bold mb-3 tracking-tighter text-[var(--text-primary)]">Proverbs {dayOfMonth}</h2>
              {isFetchingProverb ? (
                <div className="space-y-2 animate-pulse mt-2">
                  <div className="h-4 bg-[var(--border-color)] rounded w-3/4" />
                  <div className="h-4 bg-[var(--border-color)] rounded w-1/2" />
                </div>
              ) : proverbSnippet ? (
                <div className="mt-2 text-[var(--text-secondary)]">
                  <p className="text-[15px] leading-relaxed line-clamp-2">
                    "{proverbSnippet}"
                  </p>
                  <p className="text-xs font-semibold text-brand mt-4">Read more & journal &rarr;</p>
                </div>
              ) : (
                <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed mt-2">It's the {format(new Date(), 'do')} of the month. Click to read today's wisdom and journal.</p>
              )}
            </div>
          </button>

          <div className="cb-card mb-10 overflow-hidden relative group">
            <div className="relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 rounded-full -mr-16 -mt-16 blur-xl" />
              <p className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)] font-bold mb-4">Plan Status</p>
              <div className="flex items-baseline gap-3 mb-8 text-[var(--text-primary)]">
                <h2 className="text-[40px] font-bold tracking-tighter">{streak}</h2>
                <div className="flex flex-col">
                  <span className="text-xs font-bold uppercase tracking-widest text-brand">Day Streak</span>
                </div>
              </div>
              
              <div className="grid grid-cols-7 gap-1 mb-10 group-hover:opacity-100 transition-opacity">
                {Array.from({ length: 7 }).map((_, i) => {
                  const checkDate = subDays(new Date(), 6 - i);
                  const isTodayVisit = i === 6;
                  const dateStr = format(checkDate, 'yyyy-MM-dd');
                  const hasReadOnDay = readDatesSet.has(dateStr);
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className={cn(
                        "w-full aspect-square transition-all duration-500 rounded-full",
                        hasReadOnDay ? "bg-brand" : "bg-[var(--bg-tertiary)]",
                        isTodayVisit && !hasReadOnDay && "bg-transparent border-2 border-brand/50 border-dashed"
                      )} />
                      <span className="text-[9px] font-bold uppercase text-[var(--text-secondary)] mt-1">{format(checkDate, 'eee')[0]}</span>
                    </div>
                  );
                })}
              </div>
              
              <div className="pt-6 border-t border-[var(--border-color)] mb-6">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)] font-bold">
                    Today's Reading
                  </p>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic opacity-70">
                    {format(new Date(), 'EEE, MMM d')}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h2 className={cn(
                    "text-[40px] font-bold tracking-tighter",
                    todayReadingStats.minutes === 0
                      ? "text-[var(--text-secondary)] opacity-50"
                      : "text-[var(--text-primary)]"
                  )}>
                    {todayReadingStats.minutes}
                  </h2>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold uppercase tracking-widest text-brand">
                      {todayReadingStats.minutes === 1 ? 'Minute' : 'Minutes'}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic opacity-70 leading-none mt-1">
                      {todayReadingStats.chapterCount === 0
                        ? 'No chapters yet today'
                        : `${todayReadingStats.chapterCount} chapter${todayReadingStats.chapterCount === 1 ? '' : 's'} read`}
                    </span>
                  </div>
                </div>
                {todayReadingStats.entries.length > 0 && (
                  <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-3 line-clamp-1 opacity-80">
                    {todayReadingStats.entries
                      .slice(0, 3)
                      .map(e => `${e.bookName} ${e.chapter}`)
                      .join(' · ')}
                    {todayReadingStats.entries.length > 3 && ` · +${todayReadingStats.entries.length - 3} more`}
                  </p>
                )}
              </div>

              <div className="space-y-6">
                {state.customDevotionals.length > 0 && (
                  <div className="pt-6 border-t border-[var(--border-color)]">
                    <p className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)] font-bold mb-4">Daily Devotionals</p>
                    <div className="space-y-2">
                      {state.customDevotionals.map(dev => {
                        const kind = resolveDevotionalKind(dev.id);
                        const slug = getDevotionalSlug(dev.id);
                        return (
                          <button
                            key={dev.id}
                            onClick={() => {
                              if (kind === 'internal' && slug) {
                                setActiveInternalDevotional({ id: dev.id, slug, name: dev.name });
                              } else {
                                setActiveDevotion({ name: dev.name, url: interpolateDevotionalUrl(dev.url) });
                              }
                            }}
                            className="w-full flex items-center justify-between p-4 border border-[var(--border-color)] hover:border-brand transition-all text-left bg-[var(--bg-primary)] group rounded-2xl"
                          >
                            <div className="flex items-center gap-3">
                              {kind === 'internal'
                                ? <BookOpen size={14} className="text-zinc-400 group-hover:text-brand" />
                                : <ExternalLink size={14} className="text-zinc-400 group-hover:text-brand" />}
                              <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">{dev.name}</span>
                            </div>
                            <ChevronRight size={16} className="text-zinc-400 group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-end">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Overall Progress</span>
                  <div className="text-right">
                    <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums block leading-none">{overallProgress}%</span>
                    <span className="text-[10px] font-medium text-[var(--text-secondary)] mt-1 tracking-tight tabular-nums opacity-80 block">
                      {totalRead} / {totalChaptersCount} Chapters
                    </span>
                  </div>
                </div>
                <div 
                  className="relative w-full h-[8px] rounded-full overflow-hidden bg-[var(--bg-tertiary)]"
                  role="progressbar"
                  aria-valuenow={overallProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div 
                    style={{ width: `${overallProgress}%` }}
                    className={cn(
                      "h-full rounded-full transition-all duration-700 ease-out bg-brand",
                      overallProgress < 100 && "shimmer-effect"
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="text-[10px] text-zinc-400 uppercase tracking-[0.2em] font-black pt-8 hidden lg:block opacity-60">
          Daily Logos &copy; {new Date().getFullYear()}
        </footer>
      </div>

      {/* Right Grid Area: The 7 Sections */}
      <div className="lg:col-span-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {!user && !isAuthLoading && (
            <div 
              className={cn(
                "relative p-8 h-auto border-2 border-brand bg-brand/[0.03] flex flex-col justify-between group transition-all duration-300 rounded-[24px] overflow-hidden text-left shadow-sm hover:shadow-md",
                isSigningIn && "opacity-60"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-brand" />
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-brand/5 rounded-full blur-3xl group-hover:bg-brand/10 transition-all" />
              
              <div className="mb-4">
                <span className="text-[11px] uppercase tracking-widest font-bold text-brand flex items-center gap-2">
                  <Cloud size={14} className="animate-pulse" />
                  Cloud Backup
                </span>
                <h3 className="text-[22px] font-bold tracking-tight mt-2 text-[var(--text-primary)]">
                  Sync Your Progress
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed tracking-tight">
                  Pick up where you left off on your phone, iPad, or computer.
                </p>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => !isSigningIn && handleLogin(false)}
                  disabled={isSigningIn}
                  className="cb-button-brand w-full sm:w-auto"
                >
                  {(isSigningIn || isAuthLoading) ? <RefreshCw size={18} className="animate-spin mr-2" /> : <LogIn size={18} className="mr-2" />}
                  {(isSigningIn || isAuthLoading) ? 'Connecting...' : 'Enable Sync Now'}
                </button>
                <button
                  onClick={() => !isSigningIn && handleLogin(true)}
                  className="block text-[11px] text-[var(--text-secondary)] font-bold tracking-wide hover:text-brand transition-colors focus:outline-none cursor-pointer mt-4"
                  disabled={isSigningIn}
                >
                  Safari User? Try Alternative mode
                </button>
              </div>
            </div>
          )}

          {CATEGORIES.map((cat, idx) => {
            const prog = state.progress.find(p => p.categoryId === cat.id);
            if (!prog) return null;
            
            const book = cat.books[prog.bookIndex];
            const todayStr = format(new Date(), 'yyyy-MM-dd');
            const isDone = prog.localDate === todayStr;
            const bookIsCompleted = state.completedBooks.has(`${cat.id}:${book.name}`);
            const infoKey = `${bibleVersion}:${cat.id}:${prog.bookIndex}:${prog.chapter}`;
            const info = chapterInfos[infoKey];
            
            return (
              <CategoryCard 
                key={cat.id}
                cat={cat}
                idx={idx}
                prog={prog}
                book={book}
                isDone={isDone as boolean}
                bookIsCompleted={bookIsCompleted}
                info={info}
                theme={state.settings.theme}
                progressStats={catProgress[cat.id]}
                advanceChapter={advanceChapter}
                setSelectingCategoryId={setSelectingCategoryId}
                onOpenReader={setReaderCategoryId}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

interface CategoryCardProps {
  cat: typeof CATEGORIES[number];
  idx: number;
  prog: Progress;
  book: typeof CATEGORIES[number]['books'][number];
  isDone: boolean;
  bookIsCompleted: boolean;
  info: { firstVerse: string, readTime: number } | undefined;
  theme: string;
  progressStats: { pct: number; chaptersRead: number; totalChapters: number } | undefined;
  advanceChapter: (catId: string, diff: number) => void;
  setSelectingCategoryId: (catId: string) => void;
  onOpenReader: (catId: string) => void;
}

const CategoryCard = memo(({
  cat,
  idx,
  prog,
  book,
  isDone,
  bookIsCompleted,
  info,
  progressStats,
  advanceChapter,
  setSelectingCategoryId,
  onOpenReader
}: CategoryCardProps) => {
  return (
    <div
      className={cn(
        "relative p-8 h-60 flex flex-col justify-between group transition-all duration-300 overflow-hidden",
        bookIsCompleted 
          ? "bg-brand text-white rounded-[24px] shadow-md shadow-brand/30" 
          : "cb-card border border-[var(--border-color)] hover:border-brand hover:translate-y-[-2px] shadow-sm hover:shadow-md"
      )}
    >
      <div className="flex flex-col h-full justify-between relative">
        {!bookIsCompleted && (
          <div className={cn(
            "absolute top-0 -left-8 w-1 h-full transition-all rounded-full",
            isDone || bookIsCompleted ? "bg-brand" : "bg-brand opacity-0 group-hover:opacity-100"
          )} />
        )}

        <div className={cn(!bookIsCompleted && "border-l-4 border-brand pl-4 -ml-8 flex flex-col gap-1")}>
          <span className={cn(
            "text-[11px] uppercase tracking-widest font-bold block leading-none",
            bookIsCompleted ? "text-white/80" : "text-[var(--text-secondary)]"
          )}>
            PART 0{idx + 1} / {cat.name} {info && `· ~${info.readTime} MIN`}
          </span>

          {!isDone && !bookIsCompleted && (
            <span className="text-[9px] font-bold uppercase text-brand animate-pulse tracking-widest block leading-none mt-1">
              Next to Read
            </span>
          )}

          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onOpenReader(cat.id)}
              title="Read this chapter"
              className="group/btn flex items-center gap-2 text-left min-w-0 flex-1"
            >
              <h3 className={cn(
                "text-3xl font-bold tracking-tighter transition-transform uppercase group-hover/btn:scale-[1.01] truncate",
                bookIsCompleted ? "text-white" : isDone ? "text-zinc-400 dark:text-zinc-600" : "text-[var(--text-primary)]"
              )}>
                {book.name} {prog.chapter}
              </h3>
              <BookOpen size={18} className={cn("shrink-0 transition-all opacity-0 group-hover/btn:opacity-100", bookIsCompleted ? "text-white" : "text-brand")} />
            </button>
            <button
              onClick={() => setSelectingCategoryId(cat.id)}
              title="Switch book"
              className={cn(
                "shrink-0 p-1.5 rounded-full transition-colors",
                bookIsCompleted ? "text-white/80 hover:bg-white/10" : "text-brand hover:bg-brand/10"
              )}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {info ? (
            <button
              onClick={() => onOpenReader(cat.id)}
              title="Read this chapter"
              className={cn(
                "text-xs font-medium italic line-clamp-1 opacity-70 mt-1 text-left hover:opacity-100 transition-opacity",
                bookIsCompleted ? "text-white" : "text-[var(--text-secondary)]"
              )}
            >
              {info.firstVerse}
            </button>
          ) : (
            <div className="h-4 w-32 bg-[var(--bg-tertiary)] mt-1 rounded animate-pulse" />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button 
                onClick={(e) => { e.stopPropagation(); advanceChapter(cat.id, -1); }}
                className={cn(
                  "w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-200 active:scale-95",
                  bookIsCompleted 
                    ? "border-white/20 hover:bg-white hover:text-brand" 
                    : "border-[var(--border-color)] hover:bg-[var(--text-primary)] hover:text-white dark:hover:bg-white dark:hover:text-black hover:border-transparent"
                )}
                title="Go back one chapter"
              >
                <Minus size={16} />
              </button>
              <div className="relative group/plus">
                <button 
                  onClick={(e) => { e.stopPropagation(); advanceChapter(cat.id, 1); }}
                  className={cn(
                    "w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95",
                    bookIsCompleted 
                      ? "border-white text-white hover:bg-white hover:text-brand shadow-[0_0_12px_rgba(255,255,255,0.2)]" 
                      : "border-brand text-brand hover:bg-brand hover:text-white dark:hover:bg-brand"
                  )}
                  title="Advance chapter"
                >
                  <Plus size={24} />
                </button>
              </div>
            </div>

            {progressStats && (() => {
              const pct = progressStats.pct;
              const safePct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
              return (
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex justify-between items-center px-0.5">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      bookIsCompleted ? "text-white/90" : "text-[var(--text-secondary)]"
                    )}>
                      {safePct === 100 ? 'COMPLETE' : `${safePct}%`}
                    </span>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-widest hidden xs:inline opacity-60",
                      bookIsCompleted ? "text-white/70" : "text-[var(--text-secondary)]"
                    )}>
                      OF {cat.name}
                    </span>
                  </div>
                  <div 
                    role="progressbar" 
                    aria-valuenow={safePct} 
                    aria-valuemin={0} 
                    aria-valuemax={100} 
                    aria-label={`${cat.name} reading progress`}
                    className={cn(
                      "relative w-full h-[8px] rounded-full overflow-hidden",
                      bookIsCompleted ? "bg-white/20" : "bg-[var(--bg-tertiary)]"
                    )}
                  >
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500 ease-out",
                        bookIsCompleted ? "bg-white" : "bg-brand",
                        safePct < 100 && !bookIsCompleted && "shimmer-effect"
                      )}
                      style={{ width: `${safePct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
});

export const Dashboard = memo(DashboardComponent);
