/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { CATEGORIES } from '../../constants';
import { cn } from '../../lib/utils';

import { useApp } from '../../state/AppContextCore';
import { useUi } from '../../state/UiContextCore';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';

interface CategoryPlanModalProps {
  toggleBookCompletion: (catId: string, bookName: string) => void;
}

const CategoryPlanModal: React.FC<CategoryPlanModalProps> = ({
  toggleBookCompletion
}) => {
  const { state } = useApp();
  const { setActivePlanCategory } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => setActivePlanCategory(null);
  const dismissOverlay = useOverlayDismiss(onClose);
  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

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
        initial={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
        animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
        transition={prefersReducedMotion ? { duration: 0.2 } : { type: "spring", ...springConfig }}
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-xl bg-[var(--bg-primary)] z-[210] flex flex-col border-l border-[var(--border-color)] shadow-2xl overflow-hidden sm:rounded-l-[24px]",
          isStandalone && "pt-[env(safe-area-inset-top)]"
        )}
      >
        <div className="flex-1 overflow-y-auto ios-scroll p-6 sm:p-10 flex flex-col">
          <div className="flex justify-between items-center mb-8 sm:mb-12 shrink-0">
            <div>
              <p className="text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)] mb-1">Structure</p>
              <h3 className="text-3xl sm:text-4xl font-bold uppercase tracking-tight text-[var(--text-primary)]">Plan Breakdown</h3>
            </div>
            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onClose} 
              className="p-3 rounded-full transition-all min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-secondary)] hover:text-brand bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-sm"
            >
              <Check size={24} />
            </motion.button>
          </div>

          <div className="space-y-12 flex-1 overflow-y-auto ios-scroll pr-2">
            {CATEGORIES.map((cat, i) => (
              <motion.div 
                key={cat.id} 
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative pl-8 border-l-2 border-[var(--border-color)] py-2"
              >
                <div className="absolute -left-[5px] top-4 w-2 h-2 rounded-full bg-[var(--text-secondary)]" />
                <span className="text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)]">Section {i + 1}</span>
                <h4 className="text-xl sm:text-2xl font-bold tracking-tight mb-4 text-[var(--text-primary)]">{cat.name}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                  {cat.books.map(book => {
                    const isCompleted = state.completedBooks.has(`${cat.id}:${book.name}`);
                    // Progress may be absent during cloud hydration or for a
                    // newly added category — guard rather than crash the modal.
                    const prog = state.progress.find(p => p.categoryId === cat.id);
                    const isCurrent = !!prog && cat.books[prog.bookIndex]?.name === book.name;
                    
                    return (
                      <motion.button 
                        key={book.name} 
                        whileTap={{ scale: 0.98 }}
                        onClick={() => toggleBookCompletion(cat.id, book.name)}
                        className="flex justify-between items-baseline group/book text-left p-2 -m-2 transition-all rounded-lg min-h-[36px] hover:bg-[var(--bg-secondary)]"
                      >
                        <div className="flex items-center gap-2">
                          {isCompleted && <Check size={12} className="text-brand" strokeWidth={4} />}
                          <span className={cn(
                            "text-sm font-bold uppercase tracking-tight transition-all",
                            isCompleted ? "text-brand line-through opacity-40" : 
                            isCurrent ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                          )}>
                            {book.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-[var(--text-secondary)] group-hover/book:text-[var(--text-primary)]">
                          {book.chapters} CH.
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>

          <div className={cn(
            "mt-12 pt-8 border-t border-[var(--border-color)] flex justify-between items-center shrink-0",
            isStandalone && "pb-[env(safe-area-inset-bottom)]"
          )}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)] tabular-nums">Total Books: 66</p>
            <motion.button 
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="px-8 py-4 font-bold uppercase tracking-widest text-[11px] rounded-[16px] transition-all bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-sm hover:opacity-90 active:scale-95"
            >
              Close Plan
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default CategoryPlanModal;
