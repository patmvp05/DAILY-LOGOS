/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, AlertCircle } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'danger' | 'info';
  confirmHref?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  type = 'danger',
  confirmHref
}) => {
  const isDanger = type === 'danger';
  const Icon = isDanger ? Trash2 : AlertCircle;
  
  // Materialize static Tailwind class names to prevent CSS builder stripping
  const bgClass = isDanger 
    ? 'bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.3)]' 
    : 'bg-blue-600 hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.3)]';
    
  const iconWrapperClass = isDanger 
    ? 'bg-red-500/10 border-red-500/20' 
    : 'bg-blue-500/10 border-blue-500/20';
    
  const iconTextClass = isDanger 
    ? 'text-red-500' 
    : 'text-blue-500';
  
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16" />
            
            <div className="relative">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 border ${iconWrapperClass}`}>
                <Icon className={`w-6 h-6 ${iconTextClass}`} />
              </div>
              
              <h3 className="text-xl font-black text-white tracking-tight mb-2">
                {title}
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-6 whitespace-pre-wrap">
                {message}
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-sm transition-colors border border-white/5 cursor-pointer"
                >
                  {cancelLabel}
                </button>
                {confirmHref ? (
                  <a
                    href={confirmHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onClose}
                    className={`flex-1 py-3 px-4 rounded-xl text-center font-bold text-sm transition-all focus:outline-none text-white cursor-pointer select-none flex items-center justify-center ${bgClass}`}
                  >
                    {confirmLabel}
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      onConfirm();
                      onClose();
                    }}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all focus:outline-none text-white cursor-pointer select-none ${bgClass}`}
                  >
                    {confirmLabel}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
