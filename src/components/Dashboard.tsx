/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, memo } from 'react';
import { 
  Layers, 
  Play, 
  ArrowRight, 
  Sparkles, 
  TrendingUp, 
  ChevronRight, 
  ExternalLink, 
  Cloud, 
  LogIn, 
  RefreshCw,
  Minus,
  Plus,
  Bookmark
} from 'lucide-react';
import { format, parseISO, isToday, subDays } from 'date-fns';
import { CATEGORIES, CATEGORIES_BY_ID, BOOK_READ_MINUTES, DEFAULT_BOOK_MINUTES } from '../constants';
import { Progress } from '../types';
import { cn, computeProgressStats } from '../lib/utils';
import { XpWindowHeader } from './XpWindowHeader';
import { getChapterInfo } from '../lib/bibleCache';

import { useApp } from '../state/AppContextCore';
import { useUi } from '../state/UiContextCore';
import { useAppStats } from '../hooks/useAppStats';
import { useReadingActions } from '../hooks/useReadingActions';
import { useProverb } from '../hooks/useProverb';

interface DashboardProps {
  handleLogin: (redirect?: boolean) => void;
  isSigningIn: boolean;
}

function DashboardComponent({
  handleLogin,
  isSigningIn
}: DashboardProps) {
  const { state, dispatch } = useApp();
  const { streak, dayNumber, overallProgress, totalRead, totalChaptersCount, lastReadProgress } = useAppStats(state);
  const { advanceChapter } = useReadingActions(state, dispatch, null);
  const dayOfMonth = new Date().getDate();
  const { proverbSnippet, isFetchingProverb } = useProverb(dayOfMonth);

  const { 
    setActivePlanCategory, setShowProverbModal, setActiveDevotion, 
    setSelectingCategoryId, setJournalDraft, syncStatus
  } = useUi();

  const [chapterInfos, setChapterInfos] = useState<Record<string, { firstVerse: string, readTime: number }>>({});

  const handleShowProverbModal = (val: boolean) => {
    if (val) setJournalDraft({ id: null, content: '', verse: '' });
    setShowProverbModal(val);
  };

  const todayReadingStats = useMemo(() => {
    const todayEntries = state.history.filter(
      h => {
        try {
          return isToday(parseISO(h.timestamp));
        } catch {
          return false;
        }
      }
    );
    const minutes = todayEntries.reduce((sum, h) => {
      const perCh = BOOK_READ_MINUTES[h.bookName] ?? DEFAULT_BOOK_MINUTES;
      return sum + perCh;
    }, 0);
    return { minutes, chapterCount: todayEntries.length, entries: todayEntries };
  }, [state.history]);

  const { catProgress } = useMemo(() => 
    computeProgressStats(state.progress, state.completedBooks),
  [state.progress, state.completedBooks]);

  // Optimize history lookup for streak dots: Pre-compute a Set of local date strings for all read days
  const readDatesSet = useMemo(() => {
    const dates = new Set<string>();
    state.history.forEach(entry => {
      try {
        if (entry.timestamp) {
          const dateStr = format(parseISO(entry.timestamp), 'yyyy-MM-dd');
          dates.add(dateStr);
        }
      } catch { /* ignored */ }
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
          const key = `${prog.categoryId}:${prog.bookIndex}:${prog.chapter}`;
          if (chapterInfos[key]) return null;
          return { key, bookName: book.name, chapter: prog.chapter };
        })
        .filter((t): t is { key: string, bookName: string, chapter: number } => t !== null);

      if (tasks.length === 0) return;

      try {
        // 2. Fetch all missing chapter infos in parallel
        const results = await Promise.all(
          tasks.map(async (task) => {
            const info = await getChapterInfo(task.bookName, task.chapter);
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
  }, [state.progress, chapterInfos]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 transition-opacity duration-300">
      {/* Left Control Panel */}
      <div className="lg:col-span-4 flex flex-col justify-between py-2 space-y-12">
        <section>
          <div className="mb-10 text-center lg:text-left">
            <p className="text-[10px] uppercase tracking-[0.4em] font-black text-evernote mb-2">λóγος</p>
            <h1 className="text-5xl sm:text-6xl font-black leading-none mb-4 tracking-tighter text-[var(--audible-text-primary)]">The Daily<br />Logos</h1>
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-6">
              <p className="text-[var(--audible-text-secondary)] font-medium text-lg">Day {dayNumber} of your journey.</p>
            </div>
            <button 
              onClick={() => setActivePlanCategory('_all')}
              className="text-[10px] uppercase tracking-[0.12em] font-black border border-[var(--audible-text-primary)] px-4 py-2 hover:bg-[var(--audible-text-primary)] hover:text-white dark:hover:bg-white dark:hover:text-black transition-all flex items-center gap-2 mx-auto lg:mx-0 rounded-sm"
            >
              <Layers size={12} />
              View Full Plan Breakdown
            </button>
          </div>

          {/* Resume Reading Card (Audible Mini-Player style) */}
          {lastReadProgress && (
            <div className={cn(
              "mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700",
              state.settings.theme === 'xp' && "uber-card"
            )}>
              {state.settings.theme === 'xp' ? (
                <XpWindowHeader title="Resume Reading" icon={Bookmark} />
              ) : (
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)]">Resume Reading</p>
                  {syncStatus === 'syncing' && (
                    <span className="flex items-center gap-1 text-[9px] text-evernote font-black uppercase animate-pulse">
                      <Cloud size={10} />
                      Syncing...
                    </span>
                  )}
                  {syncStatus === 'offline' && (
                    <span className="flex items-center gap-1 text-[9px] text-zinc-400 font-black uppercase">
                      <Cloud size={10} className="text-zinc-400" />
                      Offline Mode
                    </span>
                  )}
                  {syncStatus === 'error' && (
                    <span className="flex items-center gap-1 text-[9px] text-red-500 font-black uppercase">
                      <Cloud size={10} className="text-red-500" />
                      Sync Error
                    </span>
                  )}
                </div>
              )}
              <button 
                onClick={() => setActivePlanCategory(lastReadProgress.categoryId)}
                className={cn(
                  "w-full group relative flex items-center justify-between transition-all rounded-xl",
                  state.settings.theme === 'xp' 
                    ? "xp-content p-6" 
                    : "p-6 bg-[#FAFAFA] dark:bg-[#1C1C1C] border border-[var(--audible-border)] shadow-sm hover:shadow-xl hover:translate-y-[-2px] overflow-hidden"
                )}
              >
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-105 active:scale-95",
                    state.settings.theme === 'xp' ? "bg-blue-600 text-white shadow-inner" : "bg-evernote text-white shadow-[0_0_8px_rgba(0,168,45,0.3)] dark:shadow-[0_0_12px_rgba(0,168,45,0.2)]"
                  )}>
                    <Play size={24} fill="currentColor" />
                  </div>
                  <div className="text-left">
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-[0.12em] mb-1",
                      state.settings.theme === 'xp' ? "text-blue-700" : "text-evernote"
                    )}>
                      {CATEGORIES_BY_ID.get(lastReadProgress.categoryId)?.name}
                    </p>
                    <h4 className={cn(
                      "text-xl font-black uppercase tracking-tight leading-none",
                      state.settings.theme === 'xp' ? "text-black" : "text-[var(--audible-text-primary)]"
                    )}>
                      {(() => {
                        const cat = CATEGORIES_BY_ID.get(lastReadProgress.categoryId);
                        const book = cat?.books[lastReadProgress.bookIndex];
                        return `${book?.name || 'Unknown'} ${lastReadProgress.chapter}`;
                      })()}
                    </h4>
                    <p className="text-[9px] text-[var(--audible-text-secondary)] font-bold uppercase tracking-tighter mt-1.5 italic opacity-80">
                      Last read {format(new Date(lastReadProgress.lastReadAt!), 'h:mm a')}
                    </p>
                  </div>
                </div>
                <ArrowRight size={20} className={cn(
                  "transition-all",
                  state.settings.theme === 'xp' ? "text-blue-600" : "text-gray-300 dark:text-zinc-700 group-hover:text-evernote group-hover:translate-x-1"
                )} />
              </button>
            </div>
          )}

          {/* Proverb of the Day */}
          <button 
            onClick={() => handleShowProverbModal(true)}
            className={cn(
                "w-full p-8 mb-6 relative overflow-hidden group text-left block transition-all rounded-xl",
                state.settings.theme === 'xp' ? "uber-card" : "bg-[var(--audible-card)] border border-[var(--audible-border)] shadow-sm hover:shadow-lg hover:translate-y-[-2px] hover:border-evernote/30"
            )}
          >
            {state.settings.theme === 'xp' && (
              <XpWindowHeader title="Daily Wisdom" icon={Sparkles} />
            )}
            <div className={cn("relative", state.settings.theme === 'xp' && "xp-content")}>
              <Sparkles className={cn("absolute top-4 right-4 group-hover:scale-110 transition-transform", state.settings.theme === 'xp' ? "text-blue-600/20" : "text-evernote/10 dark:text-evernote/20")} size={48} />
              <p className={cn("text-[10px] uppercase tracking-[0.12em] font-black mb-4", state.settings.theme === 'xp' ? "text-blue-700" : "text-[var(--audible-text-secondary)]")}>Daily Proverb</p>
              <h2 className={cn("text-3xl font-black mb-2 tracking-tight", state.settings.theme === 'xp' ? "text-black" : "text-[var(--audible-text-primary)] uppercase")}>Proverbs {dayOfMonth}</h2>
              {isFetchingProverb ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
                  <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
                </div>
              ) : proverbSnippet ? (
                <div className="space-y-2">
                  <p className="text-sm italic text-zinc-500 dark:text-zinc-500 leading-relaxed line-clamp-2 italic">
                    "{proverbSnippet}"
                  </p>
                  <p className={cn("text-[10px] uppercase font-black tracking-widest", state.settings.theme === 'xp' ? "text-blue-700 font-bold" : "text-evernote")}>Click to read more & journal</p>
                </div>
              ) : (
                <p className="text-sm text-[var(--audible-text-secondary)] font-medium leading-relaxed">It's the {format(new Date(), 'do')} of the month. Click to read today's wisdom and journal.</p>
              )}
            </div>
          </button>

          <div className={cn(
            "p-8 rounded-xl mb-10 overflow-hidden relative group transition-all",
            state.settings.theme === 'xp' ? "uber-card" : "bg-[var(--audible-card)] border border-[var(--audible-border)] shadow-sm"
          )}>
            {state.settings.theme === 'xp' && (
              <XpWindowHeader title="Reading Statistics" icon={TrendingUp} />
            )}
            <div className={cn("relative", state.settings.theme === 'xp' && "xp-content")}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-evernote/5 rounded-full -mr-16 -mt-16 blur-xl" />
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--audible-text-secondary)] font-black mb-4">Plan Status</p>
              <div className="flex items-baseline gap-2 mb-8 text-[var(--audible-text-primary)]">
                <h2 className="text-5xl font-black tracking-tighter">{streak}</h2>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest text-evernote animate-pulse">Day Streak</span>
                  <span className="text-[9px] font-bold text-[var(--audible-text-secondary)] uppercase tracking-[0.12em] italic opacity-70 leading-none">Consistent Growth</span>
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
                        "w-full aspect-square border transition-all duration-500 rounded-sm",
                        hasReadOnDay ? "bg-evernote border-evernote" : "border-[var(--audible-border)] bg-zinc-100 dark:bg-zinc-800/30",
                        isTodayVisit && !hasReadOnDay && "border-evernote/50 border-dashed"
                      )} />
                      <span className="text-[7px] font-black uppercase opacity-60 text-[var(--audible-text-secondary)]">{format(checkDate, 'eee')[0]}</span>
                    </div>
                  );
                })}
              </div>
              
              <div className="pt-6 border-t border-[var(--audible-border)] mb-6">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--audible-text-secondary)] font-black">
                    Today's Reading
                  </p>
                  <span className="text-[9px] font-bold text-[var(--audible-text-secondary)] uppercase tracking-[0.12em] italic opacity-70">
                    {format(new Date(), 'EEE, MMM d')}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h2 className={cn(
                    "text-5xl font-black tracking-tighter",
                    todayReadingStats.minutes === 0
                      ? "text-[var(--audible-text-secondary)] opacity-50"
                      : state.settings.theme === 'xp' ? "text-blue-700" : "text-[var(--audible-text-primary)]"
                  )}>
                    {todayReadingStats.minutes}
                  </h2>
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-widest",
                      state.settings.theme === 'xp' ? "text-blue-700" : "text-evernote"
                    )}>
                      {todayReadingStats.minutes === 1 ? 'Minute' : 'Minutes'}
                    </span>
                    <span className="text-[9px] font-bold text-[var(--audible-text-secondary)] uppercase tracking-[0.12em] italic opacity-70 leading-none">
                      {todayReadingStats.chapterCount === 0
                        ? 'No chapters yet today'
                        : `${todayReadingStats.chapterCount} chapter${todayReadingStats.chapterCount === 1 ? '' : 's'} read`}
                    </span>
                  </div>
                </div>
                {todayReadingStats.entries.length > 0 && (
                  <p className="text-[9px] text-[var(--audible-text-secondary)] font-bold uppercase tracking-tight mt-3 line-clamp-1 opacity-80">
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
                  <div className="pt-6 border-t border-[var(--audible-border)]">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--audible-text-secondary)] font-black mb-4">External Devotionals</p>
                    <div className="space-y-2">
                      {state.customDevotionals.map(dev => (
                        <button 
                          key={dev.id}
                          onClick={() => setActiveDevotion({ name: dev.name, url: dev.url })}
                          className="w-full flex items-center justify-between p-3 border border-[var(--audible-border)] hover:border-evernote transition-all text-left bg-gray-50 dark:bg-[#1A1A1A] group rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <ExternalLink size={12} className="text-zinc-400 group-hover:text-evernote" />
                            <span className="text-[10px] font-black uppercase tracking-tight text-[var(--audible-text-primary)]">{dev.name}</span>
                          </div>
                          <ChevronRight size={12} className="text-zinc-500 group-hover:text-evernote group-hover:translate-x-0.5 transition-all" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-end">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--audible-text-secondary)]">Overall Progress</span>
                  <div className="text-right">
                    <span className="text-sm font-black text-[var(--audible-text-primary)] tabular-nums block leading-none">{overallProgress}%</span>
                    <span className="text-[9px] font-bold text-[var(--audible-text-secondary)] uppercase tracking-tighter opacity-50 tabular-nums">
                      {totalRead} / {totalChaptersCount} Chapters
                    </span>
                  </div>
                </div>
                <div 
                  className={cn(
                    "relative w-full h-[6px] rounded-full overflow-hidden",
                    state.settings.theme === 'xp' ? "bg-[#D4D0C8] border border-[#919B9C] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]" : "bg-zinc-200 dark:bg-zinc-800"
                  )}
                  role="progressbar"
                  aria-valuenow={overallProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div 
                    style={{ width: `${overallProgress}%` }}
                    className={cn(
                      "h-full rounded-full transition-all duration-700 ease-out",
                      state.settings.theme === 'xp' ? "bg-[#316AC5]" : "bg-evernote",
                      overallProgress < 100 && state.settings.theme !== 'xp' && "shimmer-effect"
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
              onClick={() => !isSigningIn && handleLogin(false)}
              className={cn(
                "relative p-6 h-56 border border-evernote bg-evernote/[0.03] flex flex-col justify-between group transition-all duration-300 rounded-xl overflow-hidden cursor-pointer text-left focus:outline-none shadow-sm hover:shadow-md",
                isSigningIn && "opacity-60 cursor-wait"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-evernote" />
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-evernote/5 rounded-full blur-3xl group-hover:bg-evernote/10 transition-all" />
              
              <div>
                <span className="text-[10px] uppercase tracking-[0.12em] font-black text-evernote flex items-center gap-2">
                  <Cloud size={12} className="animate-pulse" />
                  Cloud Backup
                </span>
                <h3 className="text-2xl font-black tracking-tight mt-2 uppercase text-[var(--audible-text-primary)] group-hover:text-evernote transition-colors">
                  Sync Your Progress
                </h3>
                <p className="text-xs text-[var(--audible-text-secondary)] font-bold mt-2 leading-relaxed tracking-tight">
                  Pick up where you left off on your phone, iPad, or computer.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] bg-evernote text-white px-5 py-3 rounded-md self-start group-hover:scale-[1.02] shadow-sm transition-transform active:scale-95">
                  {(isSigningIn || isAuthLoading) ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
                  {(isSigningIn || isAuthLoading) ? 'Connecting...' : 'Enable Sync Now'}
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLogin(true);
                  }}
                  className="text-[9px] text-[var(--audible-text-secondary)] font-black uppercase tracking-[0.2em] hover:text-evernote transition-colors focus:outline-none"
                  disabled={isAuthLoading || isSigningIn}
                >
                  Safari User? Try Alternative mode
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.reload();
                  }}
                  className="block text-[8px] text-zinc-400 font-bold uppercase tracking-tight mt-1 hover:text-black dark:hover:text-white"
                >
                  Force Refresh / Reload
                </button>
              </div>
            </div>
          )}

          {CATEGORIES.map((cat, idx) => {
            const prog = state.progress.find(p => p.categoryId === cat.id);
            if (!prog) return null;
            
            const book = cat.books[prog.bookIndex];
            const isDone = prog.lastReadAt && isToday(parseISO(prog.lastReadAt));
            const bookIsCompleted = state.completedBooks.has(`${cat.id}:${book.name}`);
            const infoKey = `${cat.id}:${prog.bookIndex}:${prog.chapter}`;
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
}

const CategoryCard = memo(({
  cat,
  idx,
  prog,
  book,
  isDone,
  bookIsCompleted,
  info,
  theme,
  progressStats,
  advanceChapter,
  setSelectingCategoryId
}: CategoryCardProps) => {
  return (
    <div
      className={cn(
        "relative p-8 h-56 border flex flex-col justify-between group transition-all duration-300 rounded-xl overflow-hidden",
        theme === 'xp' ? "uber-card" : (
          bookIsCompleted 
            ? "bg-evernote text-white border-evernote shadow-[0_0_20px_-10px_rgba(0,168,45,0.6)]" 
            : "bg-[var(--audible-card)] border-[var(--audible-border)] hover:border-evernote hover:translate-y-[-2px] shadow-sm hover:shadow-md"
        )
      )}
    >
      {theme === 'xp' && (
        <XpWindowHeader title={`Section ${idx + 1}: ${cat.name}`} icon={Layers} />
      )}
      <div className={cn("flex flex-col h-full justify-between relative", theme === 'xp' && "xp-content")}>
        {!bookIsCompleted && theme !== 'xp' && (
          <div className={cn(
            "absolute top-0 -left-8 w-1 h-full transition-all",
            (isDone || bookIsCompleted) ? "bg-evernote" : "bg-evernote opacity-0 group-hover:opacity-100"
          )} />
        )}

        <div className={cn(!bookIsCompleted && "border-l-4 border-evernote pl-4 -ml-8 flex flex-col gap-1")}>
          <span className={cn(
            "text-[10px] uppercase tracking-[0.12em] font-black block leading-none",
            bookIsCompleted ? "text-white/60" : "text-[var(--audible-text-secondary)]"
          )}>
            PART 0{idx + 1} / {cat.name} {info && `· ~${info.readTime} MIN`}
          </span>

          {!isDone && !bookIsCompleted && (
            <span className="text-[8px] font-black uppercase text-evernote animate-pulse tracking-[0.12em] block leading-none">
              Next to Read
            </span>
          )}

          <button 
            onClick={() => setSelectingCategoryId(cat.id)}
            className="group/btn flex items-center gap-2 mt-1 w-full text-left"
          >
            <div className="relative">
              <h3 className={cn(
                "text-2xl font-black tracking-tight transition-transform uppercase group-hover/btn:scale-[1.01]",
                bookIsCompleted ? "text-white" : isDone ? "text-zinc-400 dark:text-zinc-600" : "text-[var(--audible-text-primary)]"
              )}>
                {book.name} {prog.chapter}
              </h3>
            </div>
            <ChevronRight size={18} className={cn("transition-all opacity-0 group-hover/btn:opacity-100 group-hover/btn:translate-x-0.5", bookIsCompleted ? "text-white" : "text-evernote")} />
          </button>

          {info ? (
            <p className={cn(
              "text-[10px] font-bold italic line-clamp-1 opacity-50",
              bookIsCompleted ? "text-white" : "text-[var(--audible-text-secondary)]"
            )}>
              {info.firstVerse}
            </p>
          ) : (
            <div className="h-3 w-32 bg-zinc-100 dark:bg-zinc-800/50 rounded animate-pulse" />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button 
                onClick={(e) => { e.stopPropagation(); advanceChapter(cat.id, -1); }}
                className={cn(
                  "w-9 h-9 rounded-full border flex items-center justify-center transition-all duration-200",
                  theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : (
                    bookIsCompleted 
                      ? "border-white/20 hover:bg-white hover:text-evernote" 
                      : "border-[var(--audible-border)] hover:bg-[var(--audible-text-primary)] hover:text-white dark:hover:bg-white dark:hover:text-black hover:border-transparent active:scale-90"
                  )
                )}
                title="Go back one chapter"
              >
                <Minus size={14} />
              </button>
              <div className="relative group/plus">
                <button 
                  onClick={(e) => { e.stopPropagation(); advanceChapter(cat.id, 1); }}
                  className={cn(
                    "w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all duration-200 shadow-sm",
                    theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black border-2 border-blue-600/50" : (
                      bookIsCompleted 
                        ? "border-white text-white hover:bg-white hover:text-evernote shadow-[0_0_12px_rgba(255,255,255,0.2)]" 
                        : "border-evernote text-evernote hover:bg-evernote hover:text-white dark:hover:bg-evernote active:scale-90"
                    )
                  )}
                  title="Advance chapter"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {progressStats && (() => {
              const pct = progressStats.pct;
              const safePct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
              return (
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="flex justify-between items-center px-0.5">
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-[0.12em]",
                      theme === 'xp' ? "text-blue-700" : bookIsCompleted ? "text-white/80" : "text-[var(--audible-text-secondary)]"
                    )}>
                      {safePct === 100 ? 'COMPLETE' : `${safePct}%`}
                    </span>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-[0.12em] hidden xs:inline opacity-60",
                      theme === 'xp' ? "text-blue-700" : bookIsCompleted ? "text-white/60" : "text-[var(--audible-text-secondary)]"
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
                      "relative w-full h-[6px] rounded-full overflow-hidden",
                      theme === 'xp' ? "bg-[#D4D0C8] border border-[#919B9C] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]" : bookIsCompleted ? "bg-white/20" : "bg-zinc-200 dark:bg-zinc-800"
                    )}
                  >
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500 ease-out",
                        theme === 'xp' ? "bg-[#316AC5]" : bookIsCompleted ? "bg-white" : "bg-evernote",
                        safePct < 100 && theme !== 'xp' && !bookIsCompleted && "shimmer-effect"
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
