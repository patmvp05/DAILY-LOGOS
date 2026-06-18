/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Check } from 'lucide-react';
import { useUi } from '../../state/UiContextCore';

const DevotionalModal: React.FC = () => {
  const { activeDevotion, setActiveDevotion } = useUi();

  const onClose = () => setActiveDevotion(null);

  useEffect(() => {
    if (activeDevotion?.url) {
      window.open(activeDevotion.url, '_blank', 'noopener,noreferrer');
    }
  }, [activeDevotion?.url]);

  if (!activeDevotion) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="fixed inset-x-4 top-[30%] md:inset-x-[25%] bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl rounded-[24px] overflow-hidden"
      >
        <div className="p-8 sm:p-10 flex flex-col items-center text-center gap-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-brand text-white shadow-sm">
            <ExternalLink size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold uppercase tracking-tighter text-[var(--text-primary)] mb-2">{activeDevotion.name}</h3>
            <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">Opens in your browser</p>
          </div>
          <a
            href={activeDevotion.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full p-4 font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 bg-brand text-white rounded-[16px] shadow-sm hover:opacity-90 active:scale-95"
          >
            <ExternalLink size={14} />
            Open in Browser
          </a>
          <button
            onClick={onClose}
            className="w-full p-4 font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 rounded-[16px] bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-sm hover:bg-[var(--bg-tertiary)] active:scale-95"
          >
            <Check size={14} />
            Close
          </button>
        </div>
      </motion.div>
    </>
  );
};

export default DevotionalModal;
