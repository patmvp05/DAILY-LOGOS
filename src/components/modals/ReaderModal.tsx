/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, X, ArrowRight, Check, RefreshCw, Sparkles } from 'lucide-react';

import { useApp } from '../../state/AppContextCore';
import { useUi } from '../../state/UiContextCore';
import { CATEGORIES_BY_ID, DEFAULT_BIBLE_VERSION } from '../../constants';
import { calculateNextProgress } from '../../lib/bible';
import { getChapterText, type ChapterTextResponse } from '../../lib/chapterText';

interface ReaderModalProps {
  // Wired from AppModals' useReadingActions (with the signed-in user), so
  // tapping "Next Chapter" logs history, marks completion, and cloud-syncs —
  // exactly like the dashboard "+" button.
  advanceChapter: (categoryId: string, amount: number) => void;
}

function ReaderModal({ advanceChapter }: ReaderModalProps) {
  const { state } = useApp();
  const { readerCategoryId, setReaderCategoryId } = useUi();

  const version = state.settings.bibleVersion || DEFAULT_BIBLE_VERSION;
  const category = readerCategoryId ? CATEGORIES_BY_ID.get(readerCategoryId) : undefined;
  const progress = state.progress.find((p) => p.categoryId === readerCategoryId);
  const book = category && progress ? category.books[progress.bookIndex] : undefined;
  const chapter = progress?.chapter;

  // A retry bump is part of the request identity so tapping "Retry" re-runs the
  // fetch (and shows the loading state) even for the same chapter/version.
  const [retry, setRetry] = useState(0);
  const reqKey = book && chapter ? `${book.name}|${chapter}|${version}|${retry}` : '';

  // Result is keyed by the request it belongs to; status/content are DERIVED
  // from whether the latest result matches the current request. This avoids a
  // synchronous setState-in-effect (the effect only ever sets state from an
  // async callback) while still showing loading on every chapter/version change.
  const [result, setResult] = useState<{ key: string; data: ChapterTextResponse | null; error: boolean }>({
    key: '', data: null, error: false,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // The Next Chapter / Done action reveals only once the reader has scrolled to
  // the end of the chapter (or immediately for chapters short enough to fit
  // without scrolling). Latches true so it stays visible if you scroll back up.
  const [atEnd, setAtEnd] = useState(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setAtEnd(true);
  };

  const onClose = () => setReaderCategoryId(null);

  // Is there a chapter beyond the current one (within this category's plan)?
  // calculateNextProgress returns the same position at the terminal chapter.
  const hasNext = useMemo(() => {
    if (!readerCategoryId || !progress) return false;
    const next = calculateNextProgress(readerCategoryId, 1, progress, state.completedBooks).progress;
    return !(next.bookIndex === progress.bookIndex && next.chapter === progress.chapter);
  }, [readerCategoryId, progress, state.completedBooks]);

  useEffect(() => {
    if (!reqKey || !book || !chapter) return;
    let ignore = false;
    getChapterText(book.name, chapter, version)
      .then((data) => { if (!ignore) setResult({ key: reqKey, data, error: false }); })
      .catch(() => { if (!ignore) setResult({ key: reqKey, data: null, error: true }); });
    return () => { ignore = true; };
  }, [reqKey, book, chapter, version]);

  // On each chapter (re)load: jump to the top and decide whether the action is
  // immediately visible (chapter fits without scrolling) or hidden until the
  // reader scrolls to the end. Measured inside rAF so it runs after layout and
  // off the effect body (never a synchronous setState-in-effect).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      setAtEnd(el.scrollHeight <= el.clientHeight + 24);
    });
    return () => cancelAnimationFrame(raf);
  }, [result, book?.name, chapter]);

  if (!category || !progress || !book || !chapter) return null;

  const settled = result.key === reqKey;
  const status: 'loading' | 'ready' | 'error' = !settled ? 'loading' : result.error ? 'error' : 'ready';
  const content = settled ? result.data : null;

  const onPrimary = () => {
    if (hasNext) {
      // Advancing updates global progress (debounced), which re-renders this
      // modal onto the next chapter and refetches automatically.
      advanceChapter(readerCategoryId!, 1);
    } else {
      onClose();
    }
  };

  return (
    <>
      <motion.div
        key="reader-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      <motion.div
        key="reader-window"
        data-testid="reader-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="fixed inset-0 sm:inset-4 md:inset-x-auto md:inset-y-8 md:left-1/2 md:-translate-x-1/2 md:w-[760px] md:max-w-[calc(100vw-4rem)] bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl sm:rounded-[24px] overflow-hidden"
      >
        {/* Header — padded for iPhone notch/Dynamic Island */}
        <div
          className="flex justify-between items-center px-5 sm:px-8 bg-[var(--bg-primary)] border-b border-[var(--border-color)] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)',
            paddingBottom: '1.25rem',
          }}
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white bg-brand shadow-sm shrink-0">
              <BookOpen size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter text-[var(--text-primary)] truncate">
                {book.name} {chapter}
              </h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest truncate">
                {category.name}
              </p>
            </div>
          </div>
          {/* 44×44 minimum tap target for iPhone accessibility */}
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:scale-105 transition-transform bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Reading area */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto ios-scroll bg-[var(--bg-primary)]">
          <div className="px-6 sm:px-12 py-8 sm:py-12 max-w-[680px] mx-auto">
            {status === 'loading' ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                  className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full mb-4"
                />
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                  Opening the scroll...
                </p>
              </div>
            ) : status === 'error' ? (
              <div className="py-24 flex flex-col items-center justify-center text-center gap-4">
                <p className="text-sm font-medium text-[var(--text-secondary)] max-w-xs">
                  We couldn't load {book.name} {chapter} right now. Check your connection and try again.
                </p>
                <button
                  onClick={() => setRetry((r) => r + 1)}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold uppercase tracking-widest text-[11px] active:scale-95 transition-transform"
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              </div>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-2 flex items-center gap-2">
                  <Sparkles size={12} />
                  {content?.translationName || version}
                </p>
                <h2 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-[var(--text-primary)] mb-8">
                  {book.name} {chapter}
                </h2>
                <div className="reader-prose font-serif text-[19px] sm:text-[20px] leading-[1.9] text-[var(--text-primary)]">
                  {content?.verses.map((v) => (
                    <p key={v.verse} className="mb-[1.1em]">
                      <span className="text-[12px] font-bold align-super mr-1.5 text-brand/70 tabular-nums select-none">
                        {v.verse}
                      </span>
                      {v.text}
                    </p>
                  ))}
                </div>
                {/* Spacer so the last verse isn't hidden behind the revealed action bar */}
                <div className="h-6" />
              </>
            )}
          </div>
        </div>

        {/* Bottom bar — Close is always visible so users can exit at any time.
            Next Chapter / Done slides in alongside it once the chapter is read. */}
        <div
          className="px-5 sm:px-8 py-4 sm:py-5 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 flex items-center gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="min-h-[52px] px-5 font-bold uppercase tracking-widest text-[12px] transition-all flex items-center justify-center gap-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-[18px] active:scale-[0.98] shrink-0"
          >
            <X size={15} />
            Close
          </button>
          <AnimatePresence>
            {status === 'ready' && atEnd && (
              <motion.button
                key="primary-action"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.22 }}
                onClick={onPrimary}
                className="flex-1 min-h-[52px] font-bold uppercase tracking-widest text-[12px] transition-all flex items-center justify-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-[18px] shadow-sm hover:opacity-90 active:scale-[0.98]"
              >
                {hasNext ? (
                  <>
                    Next Chapter
                    <ArrowRight size={16} />
                  </>
                ) : (
                  <>
                    Done
                    <Check size={16} />
                  </>
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}

export default ReaderModal;
