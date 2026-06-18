/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Check, Trash2, Ghost } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../../lib/utils';

import { useApp } from '../../state/AppContextCore';
import { useUi } from '../../state/UiContextCore';
import { useStandaloneDetection } from '../../hooks/useStandaloneDetection';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

const HistoryModal: React.FC = () => {
  const { state, dispatch } = useApp();
  const { setShowHistory, setConfirmDialog } = useUi();
  const isStandalone = useStandaloneDetection();
  const prefersReducedMotion = usePrefersReducedMotion();

  const onClose = () => setShowHistory(false);

  const springConfig = { stiffness: 380, damping: 30, mass: 0.8 };

  const onClearHistory = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Clear History",
      message: "Are you sure you want to clear your reading logs? This cannot be undone.",
      onConfirm: () => dispatch({ type: 'CLEAR_HISTORY' })
    });
  };

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
          "fixed right-0 top-0 bottom-0 w-full max-w-xl bg-[var(--bg-primary)] z-[210] flex flex-col border-l border-[var(--border-color)] shadow-2xl overflow-hidden sm:rounded-l-[24px]",
          isStandalone && "pt-[env(safe-area-inset-top)]"
        )}
      >
        <div className="flex-1 overflow-y-auto ios-scroll p-6 sm:p-10 flex flex-col">
          <div className="flex justify-between items-center mb-8 sm:mb-12 shrink-0">
            <div>
              <p className="text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)] mb-1">Reading Logs</p>
              <h3 className="text-3xl sm:text-4xl font-bold uppercase tracking-tight text-[var(--text-primary)]">Timeline</h3>
            </div>
            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onClose} 
              className="p-3 rounded-full flex items-center justify-center min-w-[44px] min-h-[44px] text-[var(--text-secondary)] hover:text-brand bg-[var(--bg-secondary)] shadow-sm border border-[var(--border-color)]"
            >
              <Check size={24} />
            </motion.button>
          </div>

          <div className="flex-1 overflow-y-auto ios-scroll space-y-8 pr-2">
            {state.history && state.history.length > 0 ? (
              (() => {
                // Group by date
                const sortedHistory = [...state.history].sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
                const groups: Record<string, typeof sortedHistory> = {};
                
                sortedHistory.forEach(entry => {
                  const dateKey = format(parseISO(entry.timestamp), 'yyyy-MM-dd');
                  if (!groups[dateKey]) groups[dateKey] = [];
                  groups[dateKey].push(entry);
                });

                return Object.entries(groups)
                  .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
                  .map(([dateKey, entries], groupIndex) => (
                    <motion.div 
                      key={dateKey} 
                      initial={prefersReducedMotion ? {} : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: groupIndex * 0.05 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="h-px flex-1 bg-gray-100 dark:bg-zinc-800" />
                        <span className="text-[10px] uppercase font-black tracking-[0.2em] text-gray-400 whitespace-nowrap tabular-nums">
                          {format(parseISO(dateKey), 'EEEE, MMMM dd')}
                        </span>
                        <div className="h-px flex-1 bg-gray-100 dark:bg-zinc-800" />
                      </div>
                      
                      <div className="relative pl-0.5">
                        <div className="absolute left-[3px] top-4 bottom-4 w-px bg-[var(--border-color)]" />
                        
                        <div className="space-y-6">
                          {entries.map((entry) => (
                            <div key={entry.id} className="group relative pl-10">
                              <div className="absolute -left-[-1px] top-4 w-2 h-2 rounded-full ring-4 ring-[var(--bg-primary)] group-hover:scale-125 transition-transform z-10 bg-[var(--text-secondary)]" />
                              <div className="p-5 border border-[var(--border-color)] transition-all rounded-[16px] bg-[var(--bg-secondary)] group-hover:border-brand shadow-sm">
                                <div className="flex justify-between items-baseline mb-1">
                                  <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--text-secondary)]">{entry.categoryName}</p>
                                  <span className="text-[11px] font-bold text-[var(--text-secondary)] tabular-nums">
                                    {format(parseISO(entry.timestamp), 'h:mm a')}
                                  </span>
                                </div>
                                <h4 className="text-xl font-bold tracking-tight text-[var(--text-primary)] uppercase">{entry.bookName}{entry.chapter > 0 ? ` ${entry.chapter}` : ''}</h4>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ));
              })()
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-20 h-20 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-6 text-[var(--text-secondary)]">
                  <Ghost size={32} />
                </div>
                <h4 className="text-sm font-bold uppercase tracking-widest mb-2 text-[var(--text-primary)]">Nothing to show</h4>
                <p className="text-xs text-[var(--text-secondary)] max-w-[200px]">Your reading activity will appear here once you complete a chapter.</p>
              </div>
            )}
          </div>

          <div className={cn(
            "mt-8 pt-8 border-t border-[var(--border-color)] shrink-0",
            isStandalone && "pb-[env(safe-area-inset-bottom)]"
          )}>
            <motion.button 
              whileTap={{ scale: 0.98 }}
              onClick={onClearHistory}
              className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest transition-colors min-h-[44px] px-4 text-red-500 hover:text-red-400 bg-red-500/10 rounded-full w-full justify-center"
            >
              <Trash2 size={14} />
              Clear History
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default HistoryModal;
