/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { CATEGORIES_BY_ID } from '../../constants';
import { cn } from '../../lib/utils';
import { useApp } from '../../state/AppContext';
import { useUi } from '../../state/UiContext';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

interface BookSelectorModalProps {
  jumpToBook: (catId: string, bookIndex: number) => void;
  toggleBookCompletion: (catId: string, bookName: string) => void;
}

const BookSelectorModal: React.FC<BookSelectorModalProps> = ({
  jumpToBook,
  toggleBookCompletion
}) => {
  const { state } = useApp();
  const { selectingCategoryId, setSelectingCategoryId } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => setSelectingCategoryId(null);
  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

  if (!selectingCategoryId) return null;

  const category = CATEGORIES_BY_ID.get(selectingCategoryId);

  return (
    <>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-md sm:backdrop-blur-xl z-[200]"
      />
      <motion.div 
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
            onClick={onClose} 
            className="text-zinc-400 hover:text-black dark:hover:text-white p-3 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          >
            <Check size={28} />
          </motion.button>
        </div>

        <div className="overflow-y-auto ios-scroll grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 pr-1">
          {category?.books.map((book, idx) => {
            const isCurrent = state.progress.find(p => p.categoryId === selectingCategoryId)?.bookIndex === idx;
            const isCompleted = state.completedBooks.has(`${selectingCategoryId}:${book.name}`);
            
            return (
              <motion.div 
                key={book.name} 
                initial={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.02 }}
                className="relative group"
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => jumpToBook(selectingCategoryId!, idx)}
                  className={cn(
                    "w-full p-4 sm:p-5 border text-left transition-all flex flex-col justify-between h-28 sm:h-32 rounded-2xl shadow-sm",
                    isCompleted ? "bg-evernote border-evernote text-white shadow-evernote/20" :
                    isCurrent 
                      ? "border-evernote bg-evernote/5 text-evernote font-black" 
                      : "bg-white dark:bg-[#1A1A1A] border-[var(--audible-border)] hover:border-evernote text-[var(--audible-text-primary)]"
                  )}
                >
                  <div className="space-y-1">
                    <p className={cn(
                      "text-[9px] font-black uppercase tracking-[0.12em]",
                      (isCurrent || isCompleted) ? "text-current opacity-70" : "text-zinc-400 dark:text-zinc-500"
                    )}>
                      Book {idx + 1}
                    </p>
                    <h4 className="font-black uppercase tracking-tight text-xs sm:text-sm leading-tight line-clamp-2">{book.name}</h4>
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest tabular-nums">{book.chapters} CH.</p>
                  </div>
                </motion.button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookCompletion(selectingCategoryId!, book.name);
                  }}
                  className={cn(
                    "absolute top-2 right-2 sm:top-3 sm:right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 border shadow-md z-10",
                    isCompleted 
                      ? "bg-white text-evernote border-white" 
                      : "bg-[var(--audible-text-primary)] dark:bg-white text-white dark:text-black border-transparent"
                  )}
                  title={isCompleted ? "Mark as unread" : "Mark as completed"}
                >
                  <Check size={14} strokeWidth={isCompleted ? 4 : 2} />
                </button>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </>
  );
};

export default BookSelectorModal;
