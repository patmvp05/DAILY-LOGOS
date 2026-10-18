/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Check, Sparkles, FileText } from 'lucide-react';
import { format } from 'date-fns';

import { useUi } from '../../state/UiContextCore';
import { triggerHaptic } from '../../lib/haptic';
import { useOverlayDismiss, useTapGuard } from '../../hooks/useOverlayDismiss';
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

  // Scroll tracking to trigger read completion. The ref latch matters:
  // momentum scrolling fires many events before the "already logged today"
  // check in logProverbRead sees the updated history, so without it a single
  // scroll to the bottom could log duplicate entries (and Firestore writes).
  const hasLoggedRef = useRef(false);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hasLoggedRef.current || isFetchingProverb || !proverbContent) return;
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    // If within 50px of bottom, count as read
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      hasLoggedRef.current = true;
      logProverbRead(dayOfMonth);
    }
  };

  const onClose = () => {
    setShowProverbModal(false);
    setJournalDraft({ id: null, content: '', verse: '' });
  };
  // Ignore the delayed "ghost click" from the tap that opened this modal so it
  // doesn't close itself immediately (see useOverlayDismiss).
  const dismissOverlay = useOverlayDismiss(onClose);
  // The backdrop guard only covers the backdrop, and this window leaves at
  // most a thin frame of it — the ghost click from the tap that opened this
  // lands inside, where the close controls are. See useTapGuard.
  const guardedClose = useTapGuard(onClose);

  const verses = proverbContent?.verses ?? [];
  // Last verse number, so the heading can show the range (e.g. "19:1–29"),
  // the same way the Bible reader does.
  const lastVerse = verses.length > 0 ? verses[verses.length - 1].verse : null;

  return (
    <>
      <motion.div
        key="proverb-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismissOverlay}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      {/* Laid out like the Bible reader (ReaderModal). This used to be an
          `inset-4` card with a plain `py-6` header, which on an iPhone home-screen
          app put the title and Done button under the status bar and Dynamic
          Island — the top looked cut off and the card sat visibly high. Now it
          fills a phone screen, pads the header for the safe area, and centers the
          text in the reader's column. Full-bleed means the ghost click from the
          opening tap lands inside this window, which is why every close below is
          guarded (see useTapGuard). */}
      <motion.div
        key="proverb-window"
        data-testid="proverb-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="fixed inset-0 sm:inset-4 md:inset-10 bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl sm:rounded-[24px] overflow-hidden"
      >
        {/* Header — padded for iPhone notch/Dynamic Island */}
        <div
          className="flex justify-between items-center gap-3 px-5 sm:px-8 bg-[var(--bg-primary)] border-b border-[var(--border-color)] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)',
            paddingBottom: '1.25rem',
          }}
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white bg-brand shadow-sm shrink-0">
              <BookOpen size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter text-[var(--text-primary)] truncate">Proverbs {dayOfMonth}</h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest truncate">{format(new Date(), 'EEEE, MMMM do')}</p>
            </div>
          </div>
          {/* 44×44 minimum tap target for iPhone accessibility */}
          <button
            onClick={guardedClose}
            aria-label="Done reading"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:scale-105 transition-transform bg-[var(--text-primary)] text-[var(--bg-primary)] shrink-0"
          >
            <Check size={20} />
          </button>
        </div>

        <div
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto ios-scroll flex flex-col lg:flex-row bg-[var(--bg-primary)]"
        >
          {/* Bible Content — the reader's centered column and type */}
          <div className="w-full lg:flex-1 lg:border-r border-[var(--border-color)]">
            <div className="px-6 sm:px-12 py-8 sm:py-12 max-w-[680px] mx-auto">
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
                <>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-2 flex items-center gap-2">
                    <Sparkles size={12} />
                    {proverbContent?.translation_name || "King James Version (KJV)"}
                  </p>
                  <h2 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-[var(--text-primary)] mb-8">
                    Proverbs {dayOfMonth}
                    {lastVerse !== null && (
                      <span className="text-[var(--text-secondary)] font-normal">:1–{lastVerse}</span>
                    )}
                  </h2>
                  <div className="reader-prose font-serif text-[19px] sm:text-[20px] leading-[1.9] text-[var(--text-primary)]">
                    {verses.length > 0 ? (
                      verses.map((v) => (
                        <div key={v.verse} className="mb-[1.1em]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVerse(v.verse);
                              triggerHaptic('light');
                            }}
                            className="text-[12px] font-bold align-super mr-1.5 text-brand/70 tabular-nums select-none cursor-pointer hover:text-brand active:scale-110 transition-all inline"
                          >
                            {v.verse}
                          </button>
                          {v.text}
                        </div>
                      ))
                    ) : proverbContent?.text ? (
                      proverbContent.text.split('\n').map((para: string, i: number) => {
                        const verseMatch = para.match(/^\[(\d+)\]\s(.*)/);
                        if (verseMatch) {
                          return (
                            <div key={i} className="mb-[1.1em]">
                              <span className="text-[12px] font-bold align-super mr-1.5 text-brand/70 tabular-nums select-none">{verseMatch[1]}</span>
                              {verseMatch[2]}
                            </div>
                          );
                        }
                        if (!para.trim()) return null;
                        return <p key={i} className="mb-[1.1em]">{para}</p>;
                      })
                    ) : (
                      <p className="text-base italic text-[var(--text-secondary)]">No text available for this chapter.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Journaling — below the text on a phone, a side panel on desktop.
              The bottom pad clears the iPhone home indicator. */}
          <div className="w-full lg:w-[450px] bg-[var(--bg-secondary)] shrink-0 border-t lg:border-t-0 border-[var(--border-color)]">
            <div
              className="px-6 sm:px-12 lg:px-10 pt-8 lg:pt-10 max-w-[680px] mx-auto space-y-8 lg:sticky lg:top-0"
              style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
            >
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
                onClick={guardedClose}
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
