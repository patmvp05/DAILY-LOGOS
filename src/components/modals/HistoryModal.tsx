/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { History, Check, Trash2, Ghost } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../../lib/utils';
import { XpWindowHeader } from '../XpWindowHeader';
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
          "fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white dark:bg-zinc-900 z-[210] flex flex-col border-l border-black/5 dark:border-zinc-800 shadow-2xl overflow-hidden sm:rounded-l-2xl",
          state.settings.theme === 'xp' && "xp-window border-0 rounded-none sm:rounded-none",
          isStandalone && "pt-[env(safe-area-inset-top)]"
        )}
      >
        {state.settings.theme === 'xp' && (
          <XpWindowHeader 
            title="Reading Logs - Timeline" 
            onClose={onClose} 
            icon={History} 
          />
        )}
        <div className={cn(
          "flex-1 overflow-y-auto ios-scroll p-6 sm:p-10 flex flex-col", 
          state.settings.theme === 'xp' && "xp-content"
        )}>
          <div className="flex justify-between items-center mb-8 sm:mb-12 shrink-0">
            <div>
              <p className="text-[10px] uppercase font-black tracking-[0.3em] text-gray-400 mb-1">Reading Logs</p>
              <h3 className={cn("text-3xl sm:text-4xl font-black uppercase tracking-tight", state.settings.theme === 'xp' ? "text-black" : "")}>Timeline</h3>
            </div>
            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onClose} 
              className={cn(
                "p-3 rounded-full flex items-center justify-center min-w-[44px] min-h-[44px]",
                state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "text-gray-400 hover:text-black dark:hover:text-white bg-gray-50 dark:bg-zinc-800"
              )}
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
                        <div className="absolute left-[3px] top-4 bottom-4 w-px bg-gray-100 dark:bg-zinc-800" />
                        
                        <div className="space-y-6">
                          {entries.map((entry) => (
                            <div key={entry.id} className="group relative pl-10">
                              <div className={cn(
                                "absolute -left-[-1px] top-4 w-2 h-2 rounded-full ring-4 ring-white dark:ring-zinc-950 group-hover:scale-125 transition-transform z-10",
                                state.settings.theme === 'xp' ? "bg-blue-600" : "bg-black dark:bg-white"
                              )} />
                              <div className={cn(
                                "p-5 border border-gray-100 dark:border-zinc-800 transition-all rounded-xl",
                                state.settings.theme === 'xp' ? "bg-white shadow-sm border-blue-100 rounded-sm" : "bg-gray-50/50 dark:bg-zinc-800/30 group-hover:border-black/10 dark:group-hover:border-white/10 group-hover:bg-gray-100 dark:group-hover:bg-zinc-800/50"
                              )}>
                                <div className="flex justify-between items-baseline mb-1">
                                  <p className={cn("text-[9px] uppercase tracking-widest font-black", state.settings.theme === 'xp' ? "text-blue-700" : "text-gray-400")}>{entry.categoryName}</p>
                                  <span className="text-[9px] font-bold text-gray-400 tabular-nums">
                                    {format(parseISO(entry.timestamp), 'h:mm a')}
                                  </span>
                                </div>
                                <h4 className={cn("text-lg font-black tracking-tight uppercase", state.settings.theme === 'xp' ? "text-black" : "")}>{entry.bookName} {entry.chapter}</h4>
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
                <div className="w-20 h-20 rounded-full bg-gray-50 dark:bg-zinc-800 flex items-center justify-center mb-6">
                  <Ghost size={32} className="text-gray-300 dark:text-gray-600" />
                </div>
                <h4 className="text-sm font-black uppercase tracking-widest mb-2">Nothing to show</h4>
                <p className="text-xs text-gray-400 max-w-[200px]">Your reading activity will appear here once you complete a chapter.</p>
              </div>
            )}
          </div>

          <div className={cn(
            "mt-8 pt-8 border-t border-gray-100 dark:border-zinc-800 shrink-0",
            isStandalone && "pb-[env(safe-area-inset-bottom)]"
          )}>
            <motion.button 
              whileTap={{ scale: 0.98 }}
              onClick={onClearHistory}
              className={cn(
                "flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-colors min-h-[44px] px-4",
                state.settings.theme === 'xp' ? "text-[#E3170A] hover:bg-red-50 rounded-sm" : "text-red-400 hover:text-red-600"
              )}
            >
              <Trash2 size={12} />
              Clear History
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default HistoryModal;
