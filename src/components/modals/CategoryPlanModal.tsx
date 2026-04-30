/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Layers, Check } from 'lucide-react';
import { CATEGORIES_BY_ID, CATEGORIES } from '../../constants';
import { cn } from '../../lib/utils';
import { XpWindowHeader } from '../XpWindowHeader';
import { useApp } from '../../state/AppContext';
import { useUi } from '../../state/UiContext';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

interface CategoryPlanModalProps {
  toggleBookCompletion: (catId: string, bookName: string) => void;
}

const CategoryPlanModal: React.FC<CategoryPlanModalProps> = ({
  toggleBookCompletion
}) => {
  const { state } = useApp();
  const { setActivePlanCategory, activePlanCategory } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => setActivePlanCategory(null);
  const activeCategory = activePlanCategory ? CATEGORIES_BY_ID.get(activePlanCategory) : null;
  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

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
        initial={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
        animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
        transition={prefersReducedMotion ? { duration: 0.2 } : { type: "spring", ...springConfig }}
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-xl bg-[var(--audible-nav)] z-[210] flex flex-col border-l border-black/5 dark:border-zinc-800 shadow-2xl overflow-hidden sm:rounded-l-2xl",
          state.settings.theme === 'xp' && "xp-window border-0 rounded-none sm:rounded-none",
          isStandalone && "pt-[env(safe-area-inset-top)]"
        )}
      >
        {state.settings.theme === 'xp' && (
          <XpWindowHeader 
            title={`Plan Breakdown - ${activeCategory?.name || 'Structure'}`} 
            onClose={onClose} 
            icon={Layers} 
          />
        )}
        <div className={cn(
          "flex-1 overflow-y-auto ios-scroll p-6 sm:p-10 flex flex-col", 
          state.settings.theme === 'xp' && "xp-content"
        )}>
          <div className="flex justify-between items-center mb-8 sm:mb-12 shrink-0">
            <div>
              <p className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-1">Structure</p>
              <h3 className={cn("text-3xl sm:text-4xl font-black uppercase tracking-tight text-[var(--audible-text-primary)]", state.settings.theme === 'xp' ? "text-black" : "")}>Plan Breakdown</h3>
            </div>
            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onClose} 
              className={cn(
                "p-3 rounded-full transition-all min-w-[44px] min-h-[44px] flex items-center justify-center",
                state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "text-[var(--audible-text-secondary)] hover:text-black dark:hover:text-white bg-white dark:bg-[#1A1A1A] border border-[var(--audible-border)] shadow-sm"
              )}
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
                className="relative pl-8 border-l-2 border-gray-100 dark:border-zinc-800 py-2"
              >
                <div className={cn(
                  "absolute -left-[5px] top-4 w-2 h-2 rounded-full",
                  state.settings.theme === 'xp' ? "bg-blue-600" : "bg-black dark:bg-white"
                )} />
                <span className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] dark:text-zinc-600">Section {i + 1}</span>
                <h4 className={cn("text-xl sm:text-2xl font-black tracking-tight mb-4 text-[var(--audible-text-primary)]", state.settings.theme === 'xp' ? "text-black opacity-80" : "")}>{cat.name}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                  {(() => {
                    const prog = state.progress.find(p => p.categoryId === cat.id)!;
                    return cat.books.map(book => {
                      const isCompleted = state.completedBooks.has(`${cat.id}:${book.name}`);
                      const isCurrent = cat.books[prog.bookIndex].name === book.name;

                      return (
                        <motion.button
                          key={book.name}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => toggleBookCompletion(cat.id, book.name)}
                          className={cn(
                            "flex justify-between items-baseline group/book text-left p-2 -m-2 transition-all rounded-lg min-h-[36px]",
                            state.settings.theme === 'xp' ? "hover:bg-blue-50" : "hover:bg-gray-50 dark:hover:bg-white/5"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {isCompleted && <Check size={12} className={state.settings.theme === 'xp' ? "text-blue-600" : "text-evernote"} strokeWidth={4} />}
                            <span className={cn(
                              "text-sm font-bold uppercase tracking-tight transition-all",
                              isCompleted ? (state.settings.theme === 'xp' ? "text-blue-700/40 line-through" : "text-evernote line-through opacity-40") :
                              isCurrent ? (state.settings.theme === 'xp' ? "text-black" : "text-[var(--audible-text-primary)]") : "text-zinc-400 dark:text-zinc-500"
                            )}>
                              {book.name}
                            </span>
                          </div>
                          <span className={cn(
                            "text-[10px] font-mono tabular-nums",
                            state.settings.theme === 'xp' ? "text-blue-700/40 group-hover/book:text-blue-700" : "text-zinc-300 dark:text-zinc-600 group-hover/book:text-[var(--audible-text-primary)]"
                          )}>{book.chapters} CH.</span>
                        </motion.button>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            ))}
          </div>

          <div className={cn(
            "mt-12 pt-8 border-t border-[var(--audible-border)] flex justify-between items-center shrink-0",
            isStandalone && "pb-[env(safe-area-inset-bottom)]"
          )}>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--audible-text-secondary)] tabular-nums">Total Books: 66</p>
            <motion.button 
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className={cn(
                "px-8 py-4 font-black uppercase tracking-[0.12em] text-[10px] rounded-xl transition-all",
                state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black hover:brightness-105" : "bg-black dark:bg-white text-white dark:text-black shadow-lg"
              )}
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
