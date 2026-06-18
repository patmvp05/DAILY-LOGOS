/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Check, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import type { DevotionalContent } from '../../lib/devotionalContent';

interface DevotionalReaderModalProps {
  name: string;
  author: string | null;
  isFetching: boolean;
  content: DevotionalContent | null;
  error: string | null;
  onClose: () => void;
  onRead: () => void;
}

function DevotionalReaderModal({
  name,
  author,
  isFetching,
  content,
  error,
  onClose,
  onRead,
}: DevotionalReaderModalProps) {
  const hasLoggedRef = useRef(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hasLoggedRef.current) return;
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      hasLoggedRef.current = true;
      onRead();
    }
  };

  const handleClose = () => {
    if (!hasLoggedRef.current) {
      hasLoggedRef.current = true;
      onRead();
    }
    onClose();
  };

  return (
    <>
      <motion.div
        key="devotional-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      <motion.div
        key="devotional-window"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="fixed inset-4 md:inset-10 bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl rounded-[24px] overflow-hidden"
      >
        <div className="flex justify-between items-center px-4 sm:px-8 py-6 bg-[var(--bg-primary)] border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white bg-brand shadow-sm">
              <BookOpen size={20} className="sm:hidden" />
              <BookOpen size={24} className="hidden sm:block" />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter text-[var(--text-primary)]">{name}</h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">{format(new Date(), 'EEEE, MMMM do')}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 sm:p-3 rounded-full hover:scale-105 transition-transform bg-[var(--text-primary)] text-[var(--bg-primary)]"
          >
            <Check size={20} className="sm:hidden" />
            <Check size={24} className="hidden sm:block" />
          </button>
        </div>

        <div
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-[var(--bg-primary)]"
        >
          <div className="max-w-3xl mx-auto p-6 sm:p-8 lg:p-12">
            {isFetching ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full mb-4"
                />
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Loading devotional...</p>
              </div>
            ) : error ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-red-500 mb-2">Could not load devotional</p>
                <p className="text-sm text-[var(--text-secondary)]">{error}</p>
              </div>
            ) : content ? (
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-8 flex items-center gap-2">
                  <Sparkles size={12} />
                  {author || content.author}
                </p>

                {content.entries.map((entry, i) => (
                  <div key={i} className={i > 0 ? 'mt-12 pt-12 border-t border-[var(--border-color)]' : ''}>
                    {entry.period && (
                      <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-6">
                        {entry.period === 'morning' ? 'Morning' : 'Evening'}
                      </p>
                    )}

                    {entry.scripture && (
                      <blockquote className="border-l-4 border-brand pl-6 mb-6">
                        <p className="text-lg sm:text-xl font-serif italic text-[var(--text-primary)] leading-relaxed">
                          &ldquo;{entry.scripture}&rdquo;
                        </p>
                        {entry.reference && (
                          <cite className="block mt-2 text-sm font-bold text-brand not-italic">
                            — {entry.reference}
                          </cite>
                        )}
                      </blockquote>
                    )}

                    <div className="space-y-6 text-xl leading-relaxed text-gray-800 dark:text-gray-200 font-serif">
                      {entry.body.map((paragraph, j) => (
                        <p key={j}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <p className="text-gray-400 italic text-sm">No devotional content available for today.</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-8 py-4 bg-[var(--bg-primary)] border-t border-[var(--border-color)] shrink-0">
          <button
            onClick={handleClose}
            className="w-full p-4 font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 rounded-[16px] bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-sm hover:opacity-90 active:scale-95"
          >
            Done Reading
          </button>
        </div>
      </motion.div>
    </>
  );
}

export default DevotionalReaderModal;
