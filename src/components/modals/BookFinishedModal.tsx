/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { CATEGORIES_BY_ID } from '../../constants';
import { cn } from '../../lib/utils';
import { useApp } from '../../state/AppContextCore';
import { useUi, BookFinishedPromptState } from '../../state/UiContextCore';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useOverlayDismiss, useTapGuard } from '../../hooks/useOverlayDismiss';

interface BookFinishedModalProps {
  jumpToBook: (catId: string, bookIndex: number) => void;
  undoFinishBook: (prompt: BookFinishedPromptState) => void;
}

const BookFinishedModal: React.FC<BookFinishedModalProps> = ({
  jumpToBook,
  undoFinishBook,
}) => {
  const { state } = useApp();
  const {
    bookFinishedPrompt,
    setBookFinishedPrompt,
    readerCategoryId,
    setReaderCategoryId,
  } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => {
    if (
      bookFinishedPrompt &&
      bookFinishedPrompt.recommendedBookIndex === null &&
      readerCategoryId === bookFinishedPrompt.categoryId
    ) {
      setReaderCategoryId(null);
    }
    setBookFinishedPrompt(null);
  };

  const onPrimary = () => {
    onClose();
  };

  const dismissOverlay = useOverlayDismiss(onClose);
  const guardedClose = useTapGuard(onClose);
  const guardedPrimary = useTapGuard(onPrimary);
  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

  if (!bookFinishedPrompt) return null;

  const category = CATEGORIES_BY_ID.get(bookFinishedPrompt.categoryId);
  if (!category) return null;

  const progress = state.progress.find(p => p.categoryId === category.id);
  const planBooks = category.books
    .map((book, rawIndex) => ({ book, rawIndex }))
    .filter(({ book }) => !book.dailyOnly);

  const hasRecommendation =
    bookFinishedPrompt.recommendedBookIndex !== null &&
    bookFinishedPrompt.recommendedBookName !== null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismissOverlay}
        className="fixed inset-0 bg-black/50 backdrop-blur-md z-[520]"
      />
      <motion.div
        data-testid="book-finished-modal"
        initial={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
        animate={prefersReducedMotion ? { opacity: 1 } : { y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
        transition={prefersReducedMotion ? { duration: 0.2 } : { type: 'spring', ...springConfig }}
        className={cn(
          'fixed bottom-0 left-0 right-0 bg-[var(--audible-nav)] z-[530] p-6 sm:p-10 flex flex-col border-t border-black/5 dark:border-white/5 shadow-2xl max-h-[88vh] sm:max-h-[82vh] rounded-t-[2rem] sm:rounded-t-[2.5rem]',
          isStandalone && 'pb-[env(safe-area-inset-bottom)]'
        )}
      >
        <div className="flex justify-between items-start gap-4 mb-5 sm:mb-6 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-black tracking-[0.14em] text-brand mb-1.5 flex items-center gap-1.5">
              <Sparkles size={12} />
              Book Finished · {category.name}
            </p>
            <h3 className="text-xl sm:text-2xl font-black tracking-tight text-[var(--audible-text-primary)] leading-snug">
              {hasRecommendation
                ? `You finished ${bookFinishedPrompt.finishedBookName}. Up next: ${bookFinishedPrompt.recommendedBookName} (recommended).`
                : `You finished ${bookFinishedPrompt.finishedBookName}. ${category.name} is 100% complete!`}
            </h3>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={guardedClose}
            aria-label="Close book finished sheet"
            className="text-zinc-400 hover:text-black dark:hover:text-white p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors shrink-0"
          >
            <X size={22} />
          </motion.button>
        </div>

        {hasRecommendation && (
          <div className="mb-5 shrink-0">
            <button
              type="button"
              onClick={guardedPrimary}
              className="w-full min-h-[50px] px-5 py-3.5 rounded-2xl bg-brand text-white font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 shadow-sm hover:opacity-95 active:scale-[0.98] transition-all"
            >
              <Check size={16} strokeWidth={3} />
              Continue with {bookFinishedPrompt.recommendedBookName} (Recommended)
            </button>
          </div>
        )}

        <p className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-3 shrink-0">
          {hasRecommendation ? 'Or Choose Another Unread Book' : 'Books in This Part'}
        </p>

        <div className="overflow-y-auto ios-scroll grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pr-1 mb-5">
          {planBooks.map(({ book, rawIndex }, planIdx) => {
            const isCompleted = state.completedBooks.has(`${category.id}:${book.name}`);
            const isRecommended = rawIndex === bookFinishedPrompt.recommendedBookIndex;
            const resumeChapter = isRecommended
              ? (progress?.chapter ?? 1)
              : (progress?.partialChapters?.[book.name] ?? 1);

            return (
              <motion.button
                key={book.name}
                type="button"
                disabled={isCompleted}
                whileTap={isCompleted ? undefined : { scale: 0.97 }}
                onClick={() => {
                  if (isCompleted) return;
                  if (rawIndex !== bookFinishedPrompt.recommendedBookIndex) {
                    jumpToBook(category.id, rawIndex);
                  }
                  setBookFinishedPrompt(null);
                }}
                className={cn(
                  'w-full p-4 border text-left transition-all flex flex-col justify-between min-h-[6.5rem] rounded-2xl shadow-sm relative',
                  isCompleted
                    ? 'bg-zinc-100 dark:bg-zinc-900/70 border-[var(--audible-border)] text-zinc-400 dark:text-zinc-500 cursor-not-allowed opacity-75'
                    : isRecommended
                      ? 'border-brand bg-brand/10 text-brand font-black'
                      : 'bg-white dark:bg-[#1A1A1A] border-[var(--audible-border)] hover:border-brand text-[var(--audible-text-primary)]'
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <p
                      className={cn(
                        'text-[9px] font-black uppercase tracking-[0.12em]',
                        isRecommended ? 'text-brand' : 'text-zinc-400 dark:text-zinc-500'
                      )}
                    >
                      Book {planIdx + 1}
                    </p>
                    {isCompleted && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <h4 className="font-black uppercase tracking-tight text-xs sm:text-sm leading-tight line-clamp-2">
                    {book.name}
                  </h4>
                </div>
                <div className="flex justify-between items-center w-full mt-2">
                  <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest tabular-nums">
                    {isCompleted
                      ? 'Finished'
                      : isRecommended
                        ? 'Recommended'
                        : resumeChapter > 1
                          ? `Resume Ch. ${resumeChapter}`
                          : `${book.chapters} CH.`}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>

        <div className="pt-3 border-t border-[var(--audible-border)] flex flex-col sm:flex-row gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => undoFinishBook(bookFinishedPrompt)}
            className="w-full min-h-[46px] px-4 py-3 rounded-xl border border-[var(--audible-border)] bg-white dark:bg-[#1A1A1A] text-[var(--audible-text-primary)] font-bold uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 hover:border-brand active:scale-[0.98] transition-all"
          >
            <RotateCcw size={14} />
            {`Undo, I'm not done with ${bookFinishedPrompt.finishedBookName}`}
          </button>
          {!hasRecommendation && (
            <button
              type="button"
              onClick={guardedPrimary}
              className="w-full min-h-[46px] px-4 py-3 rounded-xl bg-brand text-white font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              Done
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
};

export default BookFinishedModal;
