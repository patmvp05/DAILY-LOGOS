/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Check, Sparkles, FileText } from 'lucide-react';
import { format } from 'date-fns';

import { useUi } from '../../state/UiContextCore';
import { triggerHaptic } from '../../lib/haptic';
import VerseCopyPopup from '../VerseCopyPopup';

interface ProverbContent {
  verses?: { verse: number; text: string }[];
  text?: string;
  translation_id?: string;
  translation_name?: string;
}

interface ProverbModalProps {
  dayOfMonth: number;
  isFetchingProverb: boolean;
  proverbContent: ProverbContent | null;
  saveProverbJournal: (content: string, verse: string, id: string | null) => void;
  logProverbRead: (chapter: number) => void;
}

function ProverbModal({
  dayOfMonth,
  isFetchingProverb,
  proverbContent,
  saveProverbJournal,
  logProverbRead,
}: ProverbModalProps) {
  const { setShowProverbModal, journalDraft, setJournalDraft } = useUi();
  const [journalVerse, setJournalVerse] = useState(journalDraft.verse);
  const [journalContent, setJournalContent] = useState(journalDraft.content);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);

  // Scroll tracking to trigger read completion
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    // If within 50px of bottom, count as read
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      logProverbRead(dayOfMonth);
    }
  };

  const onClose = () => {
    setShowProverbModal(false);
    setJournalDraft({ id: null, content: '', verse: '' });
  };

  return (
    <>
      <motion.div 
        key="proverb-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      <motion.div 
        key="proverb-window"
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
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter text-[var(--text-primary)]">Proverbs {dayOfMonth}</h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">{format(new Date(), 'EEEE, MMMM do')}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 sm:p-3 rounded-full hover:scale-105 transition-transform bg-[var(--text-primary)] text-[var(--bg-primary)]"
          >
            <Check size={20} className="sm:hidden" />
            <Check size={24} className="hidden sm:block" />
          </button>
        </div>

        <div 
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto flex flex-col lg:flex-row bg-[var(--bg-primary)]"
        >
          {/* Bible Content */}
          <div className="w-full lg:flex-1 p-6 sm:p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-[var(--border-color)]">
            {isFetchingProverb ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <motion.div 
                   animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full mb-4"
                />
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Opening the scroll...</p>
              </div>
            ) : (
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-8 flex items-center gap-2">
                  <Sparkles size={12} />
                  {proverbContent?.translation_name || "King James Version (KJV)"}
                </p>
                <div className="space-y-6 text-xl leading-relaxed text-gray-800 dark:text-gray-200 font-serif">
                  {proverbContent?.verses ? (
                    proverbContent.verses.map((v, i) => (
                      <p key={i} className="mb-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVerse(v.verse);
                            triggerHaptic('light');
                          }}
                          className="text-[10px] font-black align-top mr-2 text-brand opacity-60 cursor-pointer hover:opacity-100 active:scale-110 transition-all inline"
                        >
                          {v.verse}
                        </button>
                        {v.text}
                      </p>
                    ))
                  ) : (
                    (proverbContent?.text || "").split('\n').map((para: string, i: number) => {
                      const verseMatch = para.match(/^\[(\d+)\]\s(.*)/);
                      if (verseMatch) {
                        return (
                          <p key={i} className="mb-4">
                            <span className="text-[10px] font-black align-top mr-2 text-brand opacity-60">{verseMatch[1]}</span>
                            {verseMatch[2]}
                          </p>
                        );
                      }
                      if (!para.trim()) return null;
                      return <p key={i}>{para}</p>;
                    })
                  )}
                  {!proverbContent?.text && !isFetchingProverb && !proverbContent?.verses && (
                    <p className="text-gray-400 italic">No text available for this chapter.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Journaling Side */}
          <div className="w-full lg:w-[450px] bg-[var(--bg-secondary)] p-8 lg:p-10 shrink-0 border-l border-[var(--border-color)]">
            <div className="space-y-8 lg:sticky lg:top-0">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-4 flex items-center gap-2">
                  <FileText size={14} />
                  Journal Your Reflection
                </p>
                <label className="block text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)] mb-2">Key Verse</label>
                <input 
                  type="text"
                  placeholder="Which verse spoke to you? (e.g. Verse 5)"
                  value={journalVerse}
                  onChange={(e) => setJournalVerse(e.target.value)}
                  className="w-full p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg outline-none focus:border-brand transition-all mb-6 font-bold text-[var(--text-primary)]"
                />
                
                <label className="block text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)] mb-2">Personal Reflection</label>
                <textarea 
                  placeholder="Write down what you learned or how this chapter applies to your life today..."
                  value={journalContent}
                  onChange={(e) => setJournalContent(e.target.value)}
                  className="w-full h-64 lg:h-96 p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg outline-none focus:border-brand transition-all resize-none font-medium leading-relaxed text-[var(--text-primary)]"
                />
              </div>

              <button 
                onClick={() => saveProverbJournal(journalContent, journalVerse, journalDraft.id)}
                disabled={!journalContent.trim()}
                className="w-full p-4 font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 disabled:opacity-50 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-[16px] shadow-sm hover:opacity-90 active:scale-95"
              >
                Save to My Journal
              </button>

              <button 
                onClick={onClose}
                className="w-full p-4 font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 rounded-[16px] bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-sm hover:bg-[var(--bg-tertiary)] active:scale-95 text-center mt-4"
              >
                Done Reading
              </button>
              
              <p className="text-[11px] text-center text-[var(--text-secondary)] font-bold uppercase tracking-widest opacity-60">
                Saved journals are synced to your account.
              </p>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {selectedVerse !== null && proverbContent?.verses && (
            <VerseCopyPopup
              anchorVerse={selectedVerse}
              currentVerses={proverbContent.verses}
              bookName="Proverbs"
              chapter={dayOfMonth}
              totalChaptersInBook={31}
              versionId={proverbContent.translation_id || 'web'}
              onClose={() => setSelectedVerse(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

export default ProverbModal;
