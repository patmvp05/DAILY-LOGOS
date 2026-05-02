/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Check, Sparkles, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';
import { XpWindowHeader } from '../XpWindowHeader';
import { useApp } from '../../state/AppContext';
import { useUi } from '../../state/UiContext';

interface ProverbContent {
  verses?: { verse: number; text: string }[];
  text?: string;
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
  const { state } = useApp();
  const { setShowProverbModal, journalDraft, setJournalDraft } = useUi();
  const [journalVerse, setJournalVerse] = useState(journalDraft.verse);
  const [journalContent, setJournalContent] = useState(journalDraft.content);

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
        className={cn(
          "fixed inset-4 md:inset-10 bg-[var(--audible-card)] z-[510] flex flex-col border border-[var(--audible-border)] shadow-2xl rounded-2xl overflow-hidden",
          state.settings.theme === 'xp' && "xp-window border-0"
        )}
      >
        {state.settings.theme === 'xp' && (
          <XpWindowHeader 
            title={`Daily Wisdom - Proverbs ${dayOfMonth}`} 
            onClose={onClose} 
            icon={BookOpen} 
          />
        )}
        <div className="flex justify-between items-center px-4 sm:px-8 py-6 bg-white dark:bg-[#1A1A1A] border-b border-[var(--audible-border)] shrink-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className={cn(
              "w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white",
              state.settings.theme === 'xp' ? "bg-blue-600 shadow-inner" : "bg-evernote shadow-sm shadow-evernote/20"
            )}>
              <BookOpen size={20} className="sm:hidden" />
              <BookOpen size={24} className="hidden sm:block" />
            </div>
            <div>
              <h3 className={cn("text-xl sm:text-2xl font-black uppercase tracking-tighter", state.settings.theme === 'xp' ? "text-black" : "text-[var(--audible-text-primary)]")}>Proverbs {dayOfMonth}</h3>
              <p className="text-[10px] text-[var(--audible-text-secondary)] font-bold uppercase tracking-[0.12em]">{format(new Date(), 'EEEE, MMMM do')}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className={cn(
              "p-2 sm:p-3 rounded-full shadow-xl hover:scale-110 transition-transform",
              state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "bg-black dark:bg-white text-white dark:text-black"
            )}
          >
            <Check size={20} className="sm:hidden" />
            <Check size={24} className="hidden sm:block" />
          </button>
        </div>

        <div 
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto flex flex-col lg:flex-row bg-white dark:bg-zinc-950"
        >
          {/* Bible Content */}
          <div className="w-full lg:flex-1 p-6 sm:p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-gray-100 dark:border-zinc-800">
            {isFetchingProverb ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <motion.div 
                   animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="w-12 h-12 border-4 border-evernote border-t-transparent rounded-full mb-4"
                />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Opening the scroll...</p>
              </div>
            ) : (
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-evernote mb-8 flex items-center gap-2">
                  <Sparkles size={12} />
                  {proverbContent?.translation_name || "King James Version (KJV)"}
                </p>
                <div className="space-y-6 text-xl leading-relaxed text-gray-800 dark:text-gray-200 font-serif">
                  {proverbContent?.verses ? (
                    proverbContent.verses.map((v, i) => (
                      <p key={i} className="mb-2">
                        <span className="text-[10px] font-black align-top mr-2 text-evernote opacity-60">{v.verse}</span>
                        {v.text}
                      </p>
                    ))
                  ) : (
                    (proverbContent?.text || "").split('\n').map((para: string, i: number) => {
                      const verseMatch = para.match(/^\[(\d+)\]\s(.*)/);
                      if (verseMatch) {
                        return (
                          <p key={i} className="mb-4">
                            <span className="text-[10px] font-black align-top mr-2 text-evernote opacity-60">{verseMatch[1]}</span>
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
          <div className="w-full lg:w-[450px] bg-zinc-50 dark:bg-[#1A1A1A] p-8 lg:p-10 shrink-0 border-l border-[var(--audible-border)] shadow-inner">
            <div className="space-y-8 lg:sticky lg:top-0">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-evernote mb-4 flex items-center gap-2">
                  <FileText size={12} />
                  Journal Your Reflection
                </p>
                <label className="block text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-2">Key Verse</label>
                <input 
                  type="text"
                  placeholder="Which verse spoke to you? (e.g. Verse 5)"
                  value={journalVerse}
                  onChange={(e) => setJournalVerse(e.target.value)}
                  className="w-full p-4 bg-white dark:bg-zinc-800 border border-[var(--audible-border)] rounded-lg outline-none focus:border-evernote dark:focus:border-evernote transition-all mb-6 font-bold text-[var(--audible-text-primary)]"
                />
                
                <label className="block text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-2">Personal Reflection</label>
                <textarea 
                  placeholder="Write down what you learned or how this chapter applies to your life today..."
                  value={journalContent}
                  onChange={(e) => setJournalContent(e.target.value)}
                  className="w-full h-64 lg:h-96 p-4 bg-white dark:bg-zinc-800 border border-[var(--audible-border)] rounded-lg outline-none focus:border-evernote dark:focus:border-evernote transition-all resize-none font-medium leading-relaxed text-[var(--audible-text-primary)]"
                />
              </div>

              <button 
                onClick={() => saveProverbJournal(journalContent, journalVerse, journalDraft.id)}
                disabled={!journalContent.trim()}
                className={cn(
                  "w-full p-5 font-black uppercase tracking-[0.12em] text-[10px] transition-all flex items-center justify-center gap-2 disabled:opacity-50",
                  state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "bg-evernote text-white rounded-xl shadow-[0_10px_20px_-10px_rgba(0,168,45,0.4)] hover:translate-y-[-2px] hover:shadow-lg active:scale-95 transition-all"
                )}
              >
                Save to My Journal
              </button>

              <button 
                onClick={onClose}
                className={cn(
                  "w-full p-5 font-black uppercase tracking-[0.12em] text-[10px] transition-all flex items-center justify-center gap-2 rounded-xl",
                  state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "bg-[var(--audible-text-primary)] dark:bg-white text-white dark:text-black border border-transparent shadow-sm hover:translate-y-[-1px] active:scale-95"
                )}
              >
                Done Reading
              </button>
              
              <p className="text-[10px] text-center text-[var(--audible-text-secondary)] font-bold uppercase tracking-[0.12em] opacity-60">
                Saved journals are synced to your account.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

export default ProverbModal;
