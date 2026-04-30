/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Check } from 'lucide-react';
import { useUi } from '../../state/UiContext';

const DevotionalModal: React.FC = () => {
  const { activeDevotion, setActiveDevotion } = useUi();

  const onClose = () => setActiveDevotion(null);

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
        className="fixed inset-4 md:inset-10 bg-[var(--audible-nav)] z-[510] flex flex-col border border-[var(--audible-border)] shadow-2xl rounded-2xl overflow-hidden"
      >
        <div className="flex justify-between items-center px-6 py-5 bg-white dark:bg-[#1A1A1A] border-b border-[var(--audible-border)] shrink-0">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-[var(--audible-text-primary)]">{activeDevotion.name}</h3>
            <p className="text-[10px] text-[var(--audible-text-secondary)] font-bold uppercase tracking-tight truncate max-w-[250px] sm:max-w-md opacity-60">{activeDevotion.url}</p>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href={activeDevotion.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-2 text-[var(--audible-text-secondary)] hover:text-evernote transition-all"
              title="Open in new tab"
            >
              <ExternalLink size={20} />
            </a>
            <button 
              onClick={onClose}
              className="p-3 bg-black dark:bg-white text-white dark:text-black rounded-full hover:scale-110 active:scale-95 transition-all shadow-md"
            >
              <Check size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-white relative">
          <iframe 
            src={activeDevotion.url} 
            className="w-full h-full border-none"
            title={activeDevotion.name}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
        </div>
      </motion.div>
    </>
  );
};

export default DevotionalModal;
