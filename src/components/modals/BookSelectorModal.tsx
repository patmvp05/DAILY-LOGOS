/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { CATEGORIES_BY_ID } from '../../constants';
import { cn } from '../../lib/utils';
import { useApp } from '../../state/AppContextCore';
import { useUi } from '../../state/UiContextCore';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useOverlayDismiss, useTapGuard } from '../../hooks/useOverlayDismiss';

interface BookSelectorModalProps {
  jumpToBook: (catId: string, bookIndex: number) => void;
}

const BookSelectorModal: React.FC<BookSelectorModalProps> = ({
  jumpToBook,
}) => {
  const { state } = useApp();
  const { selectingCategoryId, setSelectingCategoryId } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => setSelectingCategoryId(null);
  const dismissOverlay = useOverlayDismiss(onClose);
  // The backdrop guard only covers the backdrop, and this window leaves at
  // most a thin frame of it — the ghost click from the tap that opened this
  // lands inside, where the close controls are. See useTapGuard.
  const guardedClose = useTapGuard(onClose);
  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

  if (!selectingCategoryId) return null;

  const category = CATEGORIES_BY_ID.get(selectingCategoryId);
  const prog = state.progress.find(p => p.categoryId === selectingCategoryId);
  const planBooks = (category?.books ?? [])
    .map((book, rawIndex) => ({ book, rawIndex }))
    .filter(({ book }) => !book.dailyOnly);

  return (
    <>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismissOverlay}
        className="fixed inset-0 bg-black/40 backdrop-blur-md sm:backdrop-blur-xl z-[200]"
      />
      <motion.div 
        data-testid="book-selector-modal"
        initial={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
        animate={prefersReducedMotion ? { opacity: 1 } : { y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
        transition={prefersReducedMotion ? { duration: 0.2 } : { type: "spring", ...springConfig }}
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-[var(--audible-nav)] z-[210] p-6 sm:p-10 flex flex-col border-t border-black/5 dark:border-white/5 shadow-2xl max-h-[85vh] sm:max-h-[80vh] rounded-t-[2rem] sm:rounded-t-[2.5rem]",
          isStandalone && "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        <div className="flex justify-between items-center mb-6 sm:mb-10 shrink-0">
          <div>
            <p className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-1">Select Next Destination</p>
            <h3 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-[var(--audible-text-primary)]">
              {category?.name}
            </h3>
          </div>
          <motion.button 
            whileTap={{ scale: 0.9 }}
            onClick={guardedClose} 
            className="text-zinc-400 hover:text-black dark:hover:text-white p-3 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          >
            <Check size={28} />
          </motion.button>
        </div>

        <div className="overflow-y-auto ios-scroll grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 pr-1">
          {planBooks.map(({ book, rawIndex }, planIdx) => {
            const isCurrent = prog?.bookIndex === rawIndex;
            const isCompleted = state.completedBooks.has(`${selectingCategoryId}:${book.name}`);
            const savedPartial = prog?.partialChapters?.[book.name];
            
            return (
              <motion.div 
                key={book.name} 
                initial={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: planIdx * 0.02 }}
                className="relative"
              >
                <motion.button
                  type="button"
                  disabled={isCompleted}
                  whileTap={isCompleted ? undefined : { scale: 0.97 }}
                  onClick={() => {
                    if (isCompleted) return;
                    jumpToBook(selectingCategoryId!, rawIndex);
                  }}
                  className={cn(
                    "w-full p-4 sm:p-5 border text-left transition-all flex flex-col justify-between h-28 sm:h-32 rounded-2xl shadow-sm",
                    isCompleted
                      ? "bg-zinc-100 dark:bg-zinc-900/70 border-[var(--audible-border)] text-zinc-400 dark:text-zinc-500 cursor-not-allowed opacity-75"
                      : isCurrent 
                        ? "border-brand bg-brand/5 text-brand font-black" 
                        : "bg-white dark:bg-[#1A1A1A] border-[var(--audible-border)] hover:border-brand text-[var(--audible-text-primary)]"
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className={cn(
                        "text-[9px] font-black uppercase tracking-[0.12em]",
                        isCurrent ? "text-current opacity-70" : "text-zinc-400 dark:text-zinc-500"
                      )}>
                        Book {planIdx + 1}
                      </p>
                      {isCompleted && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <h4 className="font-black uppercase tracking-tight text-xs sm:text-sm leading-tight line-clamp-2">{book.name}</h4>
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest tabular-nums">
                      {isCompleted
                        ? 'Finished'
                        : isCurrent
                          ? `Current · Ch. ${prog?.chapter ?? 1}`
                          : savedPartial && savedPartial > 1
                            ? `Resume Ch. ${savedPartial}`
                            : `${book.chapters} CH.`}
                    </p>
                  </div>
                </motion.button>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </>
  );
};

export default BookSelectorModal;
