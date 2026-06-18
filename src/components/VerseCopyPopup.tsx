/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronUp, ChevronDown, X, Copy } from 'lucide-react';

import { useUi } from '../state/UiContextCore';
import { BOOK_ABBREVIATIONS } from '../constants';
import { getChapterText, type ChapterVerse } from '../lib/chapterText';
import { triggerHaptic } from '../lib/haptic';

interface VerseCopyPopupProps {
  anchorVerse: number;
  currentVerses: ChapterVerse[];
  bookName: string;
  chapter: number;
  totalChaptersInBook: number;
  versionId: string;
  versionName: string;
  onClose: () => void;
}

function VerseCopyPopup({
  anchorVerse,
  currentVerses,
  bookName,
  chapter,
  totalChaptersInBook,
  versionId,
  versionName,
  onClose,
}: VerseCopyPopupProps) {
  const { showToast } = useUi();

  const [rangeEndVerse, setRangeEndVerse] = useState(anchorVerse);
  const [rangeEndChapter, setRangeEndChapter] = useState(chapter);
  const [extraChapters, setExtraChapters] = useState<Map<number, ChapterVerse[]>>(new Map());
  const [loadingChapter, setLoadingChapter] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'copy' | 'options'>('copy');

  const lastVerseInCurrentChapter = currentVerses.length > 0
    ? currentVerses[currentVerses.length - 1].verse
    : anchorVerse;

  const lastVerseInEndChapter = useMemo(() => {
    if (rangeEndChapter === chapter) return lastVerseInCurrentChapter;
    const chVs = extraChapters.get(rangeEndChapter);
    return chVs && chVs.length > 0 ? chVs[chVs.length - 1].verse : 1;
  }, [rangeEndChapter, chapter, lastVerseInCurrentChapter, extraChapters]);

  const canExpandDown = !(
    rangeEndChapter >= chapter + totalChaptersInBook - (chapter % totalChaptersInBook === 0 ? totalChaptersInBook : chapter % totalChaptersInBook)
    && rangeEndVerse >= lastVerseInEndChapter
  );

  const atBookEnd = rangeEndChapter >= totalChaptersInBook && rangeEndVerse >= lastVerseInEndChapter;
  const atAnchor = rangeEndChapter === chapter && rangeEndVerse === anchorVerse;

  const expandRange = useCallback(async () => {
    if (loadingChapter !== null) return;

    if (rangeEndVerse < lastVerseInEndChapter) {
      setRangeEndVerse(rangeEndVerse + 1);
      triggerHaptic('light');
      return;
    }

    const nextCh = rangeEndChapter + 1;
    if (nextCh > totalChaptersInBook) return;

    if (extraChapters.has(nextCh)) {
      setRangeEndChapter(nextCh);
      setRangeEndVerse(1);
      triggerHaptic('light');
      return;
    }

    setLoadingChapter(nextCh);
    try {
      const data = await getChapterText(bookName, nextCh, versionId);
      setExtraChapters(prev => new Map(prev).set(nextCh, data.verses));
      setRangeEndChapter(nextCh);
      setRangeEndVerse(1);
      triggerHaptic('light');
    } catch {
      showToast("Couldn't load next chapter", 'error');
    } finally {
      setLoadingChapter(null);
    }
  }, [rangeEndVerse, rangeEndChapter, lastVerseInEndChapter, totalChaptersInBook, extraChapters, loadingChapter, bookName, versionId, showToast]);

  const contractRange = useCallback(() => {
    if (atAnchor) return;

    if (rangeEndChapter > chapter && rangeEndVerse > 1) {
      setRangeEndVerse(rangeEndVerse - 1);
    } else if (rangeEndChapter > chapter) {
      const prevCh = rangeEndChapter - 1;
      const prevVerses = prevCh === chapter ? currentVerses : extraChapters.get(prevCh);
      const lastV = prevVerses && prevVerses.length > 0 ? prevVerses[prevVerses.length - 1].verse : anchorVerse;
      setRangeEndChapter(prevCh);
      setRangeEndVerse(lastV);
    } else {
      setRangeEndVerse(rangeEndVerse - 1);
    }
    triggerHaptic('light');
  }, [atAnchor, rangeEndChapter, rangeEndVerse, chapter, currentVerses, extraChapters, anchorVerse]);

  const abbr = BOOK_ABBREVIATIONS[bookName] || bookName;

  const reference = useMemo(() => {
    if (rangeEndChapter === chapter && rangeEndVerse === anchorVerse) {
      return `${abbr} ${chapter}:${anchorVerse}`;
    }
    if (rangeEndChapter === chapter) {
      return `${abbr} ${chapter}:${anchorVerse}-${rangeEndVerse}`;
    }
    return `${abbr} ${chapter}:${anchorVerse}-${rangeEndChapter}:${rangeEndVerse}`;
  }, [abbr, chapter, anchorVerse, rangeEndChapter, rangeEndVerse]);

  const selectedVerses = useMemo(() => {
    const result: { chapter: number; verse: number; text: string }[] = [];

    const endInCurrent = rangeEndChapter === chapter ? rangeEndVerse : Infinity;
    for (const v of currentVerses) {
      if (v.verse >= anchorVerse && v.verse <= endInCurrent) {
        result.push({ chapter, verse: v.verse, text: v.text });
      }
    }

    for (let ch = chapter + 1; ch <= rangeEndChapter; ch++) {
      const chVerses = extraChapters.get(ch);
      if (!chVerses) continue;
      const endV = ch === rangeEndChapter ? rangeEndVerse : Infinity;
      for (const v of chVerses) {
        if (v.verse <= endV) {
          result.push({ chapter: ch, verse: v.verse, text: v.text });
        }
      }
    }

    return result;
  }, [currentVerses, extraChapters, anchorVerse, chapter, rangeEndChapter, rangeEndVerse]);

  const verseCount = selectedVerses.length;

  const buildCopyText = useCallback(() => {
    let fullRef: string;
    if (rangeEndChapter === chapter && rangeEndVerse === anchorVerse) {
      fullRef = `${bookName} ${chapter}:${anchorVerse}`;
    } else if (rangeEndChapter === chapter) {
      fullRef = `${bookName} ${chapter}:${anchorVerse}-${rangeEndVerse}`;
    } else {
      fullRef = `${bookName} ${chapter}:${anchorVerse}-${rangeEndChapter}:${rangeEndVerse}`;
    }

    const lines: string[] = [`${fullRef} (${versionId.toUpperCase()})`];
    let lastCh = chapter;

    for (const sv of selectedVerses) {
      if (sv.chapter !== lastCh) {
        lines.push(`[${bookName} ${sv.chapter}]`);
        lastCh = sv.chapter;
      }
      lines.push(`${sv.verse} ${sv.text}`);
    }

    return lines.join('\n');
  }, [bookName, chapter, anchorVerse, rangeEndChapter, rangeEndVerse, versionId, selectedVerses]);

  const handleCopy = useCallback(async () => {
    const text = buildCopyText();
    try {
      await navigator.clipboard.writeText(text);
      triggerHaptic('medium');
      showToast('Copied!', 'success');
      onClose();
    } catch {
      showToast('Could not copy to clipboard', 'error');
    }
  }, [buildCopyText, showToast, onClose]);

  return (
    <>
      <motion.div
        key="verse-copy-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 z-[10]"
      />
      <motion.div
        key="verse-copy-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="absolute bottom-0 left-0 right-0 z-[20] bg-[var(--bg-primary)] border-t border-[var(--border-color)] rounded-t-[20px] shadow-2xl flex flex-col"
        style={{
          maxHeight: '65vh',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Header */}
        <div className="flex items-center px-5 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-1 flex-1">
            <button
              onClick={() => setActiveTab('copy')}
              className={`px-4 py-2 text-[12px] font-bold uppercase tracking-widest rounded-full transition-colors ${
                activeTab === 'copy'
                  ? 'text-brand bg-brand/10'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Copy Verses
            </button>
            <button
              onClick={() => setActiveTab('options')}
              className={`px-4 py-2 text-[12px] font-bold uppercase tracking-widest rounded-full transition-colors ${
                activeTab === 'options'
                  ? 'text-brand bg-brand/10'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Options
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label="Close verse copy"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] hover:scale-105 transition-transform"
          >
            <X size={16} />
          </button>
        </div>

        {activeTab === 'copy' ? (
          <>
            {/* Reference */}
            <div className="px-5 pb-2 shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                Verse Range: <span className="text-[var(--text-primary)]">{reference}</span>
              </p>
            </div>

            {/* Version label */}
            <div className="px-5 pb-2 shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand/60">
                ({versionId.toUpperCase()})
              </p>
            </div>

            {/* Verses preview */}
            <div className="flex-1 overflow-y-auto ios-scroll px-5 min-h-0">
              <div className="font-serif text-[17px] leading-[1.8] text-[var(--text-primary)] pb-2">
                {selectedVerses.map((sv, i) => {
                  const showChapterHeader = i > 0 && sv.chapter !== selectedVerses[i - 1].chapter;
                  return (
                    <React.Fragment key={`${sv.chapter}-${sv.verse}`}>
                      {showChapterHeader && (
                        <p className="text-[12px] font-bold uppercase tracking-widest text-brand/50 mt-3 mb-1">
                          {bookName} {sv.chapter}
                        </p>
                      )}
                      <span>
                        <span className="text-[11px] font-bold align-super mr-1 text-brand/70 tabular-nums">
                          {sv.verse}
                        </span>
                        {sv.text}{' '}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Controls */}
            <div className="px-5 pt-3 pb-2 shrink-0 flex items-center gap-3">
              {/* Chevron buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={contractRange}
                  disabled={atAnchor}
                  aria-label="Contract verse range"
                  className={`w-10 h-10 rounded-full flex items-center justify-center border border-[var(--border-color)] transition-all ${
                    atAnchor
                      ? 'opacity-30 pointer-events-none bg-[var(--bg-secondary)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:scale-105 active:scale-95'
                  }`}
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  onClick={expandRange}
                  disabled={atBookEnd || loadingChapter !== null}
                  aria-label="Expand verse range"
                  className={`w-10 h-10 rounded-full flex items-center justify-center border border-[var(--border-color)] transition-all ${
                    atBookEnd
                      ? 'opacity-30 pointer-events-none bg-[var(--bg-secondary)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:scale-105 active:scale-95'
                  }`}
                >
                  {loadingChapter !== null ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full"
                    />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className="flex-1 min-h-[48px] flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold uppercase tracking-widest text-[12px] rounded-full active:scale-[0.98] transition-all shadow-sm"
              >
                <Copy size={15} />
                Copy {verseCount} Verse{verseCount !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-5 py-12">
            <p className="text-[13px] text-[var(--text-secondary)] text-center">
              More options coming soon.
            </p>
          </div>
        )}
      </motion.div>
    </>
  );
}

export default VerseCopyPopup;
