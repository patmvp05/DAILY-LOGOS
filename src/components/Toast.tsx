/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Info, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStandaloneDetection } from '../hooks/useStandaloneDetection';

export type ToastType = 'success' | 'info' | 'error';

interface ToastProps {
  message: string | null;
  type?: ToastType;
  onClear: () => void;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  onClear,
  duration = 3000,
  action
}) => {
  const isStandalone = useStandaloneDetection();
  
  useEffect(() => {
    if (message) {
      if (!action) {
        const timer = setTimeout(onClear, duration);
        return () => clearTimeout(timer);
      }
    }
  }, [message, onClear, duration, action]);

  return (
    <AnimatePresence>
      {message && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[1100] w-full max-w-xs px-4",
          isStandalone && "pb-[env(safe-area-inset-bottom)]"
        )}>
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "flex flex-col gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-xl",
              type === 'success' && "bg-zinc-900/90 dark:bg-white/90 border-zinc-800 dark:border-white/20 text-white dark:text-black",
              type === 'info' && "bg-blue-600/90 border-blue-500/20 text-white",
              type === 'error' && "bg-red-600/90 border-red-500/20 text-white"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                {type === 'success' && <Check className="w-5 h-5 text-evernote" />}
                {type === 'info' && <Info className="w-5 h-5" />}
                {type === 'error' && <AlertCircle className="w-5 h-5" />}
              </div>
              <p className="text-xs sm:text-sm font-bold tracking-tight">
                {message}
              </p>
            </div>
            {action && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  action.onClick();
                  onClear();
                }}
                className="mt-1 w-full px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-black uppercase tracking-widest transition-colors min-h-[44px]"
              >
                {action.label}
              </motion.button>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
