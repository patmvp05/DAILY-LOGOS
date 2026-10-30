/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, memo } from 'react';
import { type User } from 'firebase/auth';
import {
  ChevronRight,
  Cloud,
  LogIn,
  RefreshCw,
  Minus,
  Plus,
  BookOpen,
  Check
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { CATEGORIES, CATEGORIES_BY_ID, BOOK_READ_MINUTES, DEFAULT_BOOK_MINUTES } from '../constants';
import { Progress } from '../types';
import { cn, computeProgressStats, formatLastRead } from '../lib/utils';
import { isCategoryComplete } from '../lib/bible';

import { getChapterInfo, getCachedReadTime } from '../lib/bibleCache';

import { useApp } from '../state/AppContextCore';
import { useUi } from '../state/UiContextCore';
import { useAppStats } from '../hooks/useAppStats';
import { useReadingActions } from '../hooks/useReadingActions';
import { useProverb } from '../hooks/useProverb';
import { useToday } from '../hooks/useToday';
import { TextCheckSummary } from './TextCheck';
import { DevotionalsCard, FinishedPartsCard, ProverbCard, ResumeCard, TodayCard } from './DashboardCards';
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
  // Kept fresh across midnight/background-resume so daily stats, card order,
  // and the proverb chapter all roll over without a reload.
  const todayStr = useToday();
  const dayOfMonth = Number(todayStr.slice(8, 10));
  const bibleVersion = state.settings.bibleVersion;
  const { proverbSnippet, isFetchingProverb } = useProverb(dayOfMonth, bibleVersion);

  const {
    setActivePlanCategory, setShowProverbModal, setShowSprintModal, setActiveDevotion, setActiveInternalDevotional,
    setSelectingCategoryId, setReaderCategoryId, syncStatus
  } = useUi();

  const [chapterInfos, setChapterInfos] = useState<Record<string, { firstVerse: string, readTime: number }>>({});

  const todayReadingStats = useMemo(() => {
    const todayEntries = state.history.filter(
      h => h.localDate === todayStr && h.categoryId !== 'devotional'
    );
    const rawMinutes = todayEntries.reduce((sum, h) => {
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
    return { minutes: Math.round(rawMinutes), chapterCount: todayEntries.length, entries: todayEntries };
  }, [state.history, bibleVersion, todayStr]);

  // Hours checked off in today's 24-hour sprint (its own discipline — never
  // folded into plan progress or reading stats).
  const sprintCompleted = useMemo(() => {
    const sprint = (state.scriptureSprints ?? []).find(s => s.date === todayStr);
    if (!sprint) return 0;
    return Object.values(sprint.hours).filter(h => h.done).length;
  }, [state.scriptureSprints, todayStr]);

  // Active reading-plan parts (parts that still have unread books left).
  const activeCategories = useMemo(
    () => CATEGORIES.filter(cat => !isCategoryComplete(cat.id, state.completedBooks)),
    [state.completedBooks]
  );

  // Reading-plan parts with reading left that were touched today, for the phone
  // summary strip ("2 of 6 parts today" when one part is 100% finished).
  const partsDoneToday = useMemo(
    () =>
      new Set(
        state.progress
          .filter(
            p =>
              p.localDate === todayStr &&
              !isCategoryComplete(p.categoryId, state.completedBooks)
          )
          .map(p => p.categoryId)
      ),
    [state.progress, state.completedBooks, todayStr]
  );

  // Today's proverb counts as read once logProverbRead has logged it — the same
  // test it uses to avoid logging twice: a Proverbs entry for today's chapter.
  // The proverb card stays first either way (it is also the date) and turns
  // slim once read. Display only; nothing here logs anything.
  const proverbReadToday = useMemo(
    () => state.history.some(h => h.bookName === 'Proverbs' && h.chapter === dayOfMonth && h.localDate === todayStr),
    [state.history, dayOfMonth, todayStr]
  );

  const { catProgress } = useMemo(() =>
    computeProgressStats(state.progress, state.completedBooks),
  [state.progress, state.completedBooks]);

  // Optimize history lookup for streak dots: Pre-compute a Set of local date strings for all read days
  const readDatesSet = useMemo(() => {
    const dates = new Set<string>();
    state.history.forEach(entry => {
      if (entry.categoryId === 'devotional') return;
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

  // Reading-plan card order: active parts not yet read today float to the top
  // (in plan order); active parts already read today come next; 100% completed
  // parts sink below all active parts.
  const orderedCategories = useMemo(() => {
    const doneToday = (catId: string) =>
      state.progress.find(p => p.categoryId === catId)?.localDate === todayStr;
    return CATEGORIES
      .map((cat, idx) => ({
        cat,
        idx,
        isCatComplete: isCategoryComplete(cat.id, state.completedBooks),
      }))
      .sort((a, b) => {
        if (a.isCatComplete !== b.isCatComplete) return a.isCatComplete ? 1 : -1;
        const aDone = doneToday(a.cat.id);
        const bDone = doneToday(b.cat.id);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return a.idx - b.idx;
      });
  }, [state.progress, state.completedBooks, todayStr]);

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

  const activeParts = orderedCategories.filter(({ isCatComplete }) => !isCatComplete);
  const finishedParts = orderedCategories.filter(({ isCatComplete }) => isCatComplete);

  const resume = (() => {
    if (!lastReadProgress) return null;
    const cat = CATEGORIES_BY_ID.get(lastReadProgress.categoryId);
    const book = cat?.books[lastReadProgress.bookIndex];
    if (!cat || !book) return null;
    return {
      categoryId: cat.id,
      partName: cat.name,
      bookName: book.name,
      chapter: lastReadProgress.chapter,
      lastRead: formatLastRead(lastReadProgress.lastReadAt!, todayStr),
    };
  })();

  const devotionalsReadToday = new Set(
    state.history
      .filter((h) => h.categoryId === 'devotional' && h.localDate === todayStr)
      .map((h) => h.bookName)
  );

  const openDevotional = (id: string) => {
    const dev = state.customDevotionals.find((d) => d.id === id);
    if (!dev) return;
    const kind = resolveDevotionalKind(dev.id);
    const slug = getDevotionalSlug(dev.id);
    if (kind === 'internal' && slug) {
      setActiveInternalDevotional({ id: dev.id, slug, name: dev.name });
    } else {
      setActiveDevotion({ name: dev.name, url: interpolateDevotionalUrl(dev.url) });
    }
  };

  return (
    // Every block is a card (Oct 2026). Phone order, one column: today's
    // proverb (always first: it is also the date, Proverbs 30 on the 30th; slim
    // once read), the Today card, Resume Reading, the reading parts, finished
    // parts as slim rows, then the devotionals last. The two column wrappers are
    // `display: contents` below lg so their children can be ordered with
    // `order-*`; on desktop the left column holds the proverb, Today, Resume and
    // devotionals, and the right column the parts.
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-5 lg:py-12 flex flex-col gap-4 sm:gap-5 lg:grid lg:grid-cols-12 lg:gap-10 transition-opacity duration-300">
      <div className="contents lg:flex lg:col-span-4 lg:flex-col lg:gap-6">
        <div className="hidden lg:block mb-2">
          <p className="text-[11px] uppercase tracking-widest font-bold text-brand mb-2">{"λóγος"}</p>
          <h1 className="text-5xl xl:text-6xl font-black leading-none tracking-tighter text-[var(--text-primary)]">The Daily<br />Logos</h1>
        </div>

        <ProverbCard
          className="order-1 lg:order-none"
          todayStr={todayStr}
          chapter={dayOfMonth}
          read={proverbReadToday}
          snippet={proverbSnippet}
          loading={isFetchingProverb}
          onOpen={() => setShowProverbModal(true)}
        />

        <TodayCard
          className="order-2 lg:order-none"
          dayNumber={dayNumber}
          streak={streak}
          readDates={readDatesSet}
          todayStr={todayStr}
          activeParts={activeCategories.map((cat) => ({ id: cat.id, doneToday: partsDoneToday.has(cat.id) }))}
          minutes={todayReadingStats.minutes}
          chaptersToday={todayReadingStats.entries.map((e) => `${e.bookName} ${e.chapter}`)}
          overallProgress={overallProgress}
          totalRead={totalRead}
          totalChapters={totalChaptersCount}
          sprintCompleted={sprintCompleted}
          textCheck={<TextCheckSummary progress={state.progress} bibleVersion={bibleVersion} proverbChapter={dayOfMonth} />}
          onOpenPlan={() => setActivePlanCategory('_all')}
          onOpenSprint={() => setShowSprintModal(true)}
        />

        {resume && (
          <ResumeCard
            className="order-3 lg:order-none"
            partName={resume.partName}
            bookName={resume.bookName}
            chapter={resume.chapter}
            lastRead={resume.lastRead}
            syncStatus={syncStatus}
            onOpen={() => setReaderCategoryId(resume.categoryId)}
          />
        )}

        <DevotionalsCard
          className="order-6 lg:order-none"
          items={state.customDevotionals.map((dev) => ({
            id: dev.id,
            name: dev.name,
            internal: resolveDevotionalKind(dev.id) === 'internal' && !!getDevotionalSlug(dev.id),
            readToday: devotionalsReadToday.has(dev.name),
          }))}
          onOpen={openDevotional}
        />

        <footer className="text-[10px] text-zinc-400 uppercase tracking-[0.2em] font-black pt-4 hidden lg:block opacity-60">
          Daily Logos &copy; {new Date().getFullYear()}
        </footer>
      </div>

      <div className="contents lg:flex lg:col-span-8 lg:flex-col lg:gap-6">
        <div className="order-4 lg:order-none grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
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

          {activeParts.map(({ cat, idx, isCatComplete }) => {
            const prog = state.progress.find(p => p.categoryId === cat.id);
            if (!prog) return null;

            const book = cat.books[prog.bookIndex];
            const isDone = prog.localDate === todayStr;
            const bookIsCompleted = isCatComplete || state.completedBooks.has(`${cat.id}:${book.name}`);
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
                categoryIsCompleted={isCatComplete}
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

        <FinishedPartsCard
          className="order-5 lg:order-none"
          parts={finishedParts.map(({ cat, idx }) => ({
            id: cat.id,
            number: idx + 1,
            name: cat.name,
            chapters: catProgress[cat.id]?.totalChapters ?? 0,
          }))}
          onOpen={setSelectingCategoryId}
        />
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
  categoryIsCompleted: boolean;
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
  categoryIsCompleted,
  info,
  progressStats,
  advanceChapter,
  setSelectingCategoryId,
  onOpenReader
}: CategoryCardProps) => {
  return (
    <div
      data-testid={`category-card-${cat.id}`}
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
            PART 0{idx + 1} / {cat.name} {!categoryIsCompleted && info && `· ~${info.readTime} MIN`}
          </span>

          {!isDone && !bookIsCompleted && !categoryIsCompleted && (
            <span className="text-[9px] font-bold uppercase text-brand animate-pulse tracking-widest block leading-none mt-1">
              Next to Read
            </span>
          )}

          {categoryIsCompleted ? (
            <>
              <div className="flex items-center justify-between gap-2 mt-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/20 text-white shrink-0">
                    <Check size={16} strokeWidth={3} />
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-bold tracking-tighter uppercase text-white truncate">
                    100% Complete
                  </h3>
                </div>
                <button
                  onClick={() => setSelectingCategoryId(cat.id)}
                  title="View books in this part"
                  className="shrink-0 p-1.5 rounded-full transition-colors text-white/80 hover:bg-white/10"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <p className="text-xs font-medium text-white/85 mt-1">
                All {progressStats?.totalChapters ?? 0} chapters finished
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {!categoryIsCompleted && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={(e) => { e.stopPropagation(); advanceChapter(cat.id, -1); }}
                  disabled={prog.chapter <= 1}
                  className={cn(
                    "w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none",
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
            )}

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
                      {safePct === 100 ? '100% · COMPLETE' : `${safePct}%`}
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
