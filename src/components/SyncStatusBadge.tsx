/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Check, AlertCircle, Cloud } from 'lucide-react';

interface SyncStatusBadgeProps {
  status: 'synced' | 'syncing' | 'error' | 'idle' | 'offline';
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status }) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 dark:bg-black/20 border border-white/10 dark:border-white/5 text-[10px] uppercase font-black tracking-widest min-h-[32px]">
      <AnimatePresence mode="wait">
        {status === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-white/40"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Login to Sync</span>
          </motion.div>
        )}
        {status === 'offline' && (
          <motion.div
            key="offline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-amber-500"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>Offline</span>
          </motion.div>
        )}
        {status === 'syncing' && (
          <motion.div
            key="syncing"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            className="flex items-center gap-2 text-evernote"
          >
            <motion.div 
               animate={{ rotate: 360 }}
               transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </motion.div>
            <motion.span
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              Syncing
            </motion.span>
          </motion.div>
        )}
        {status === 'synced' && (
          <motion.div
            key="synced"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="flex items-center gap-2 text-evernote"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
            >
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
            </motion.div>
            <span className="opacity-80">Cloud Active</span>
          </motion.div>
        )}
        {status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 text-red-500"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="font-black">Sync Error</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
