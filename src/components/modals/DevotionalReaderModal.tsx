/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Check, Sparkles } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import type { DevotionalContent } from '../../lib/devotionalContent';
import { useOverlayDismiss, useTapGuard } from '../../hooks/useOverlayDismiss';

/**
 * Format a devotional's own 'MM-dd' date for the header, resolving it to its
 * most recent real occurrence. Parsing against the current year alone breaks
 * two ways: '02-29' in a non-leap year is an Invalid Date (and format() on it
 * THROWS, white-screening the modal), and a '12-31' fallback shown on Jan 1
 * would get the wrong year's weekday. Try this year, then last year; if the
 * day exists in neither (02-29 twice running), show it without a weekday.
 */
function formatDevotionalDate(monthDay: string): string {
  const now = new Date();
  for (const year of [now.getFullYear(), now.getFullYear() - 1]) {
    const d = parse(monthDay, 'MM-dd', new Date(year, 0, 1));
    if (isValid(d) && d.getTime() <= now.getTime()) return format(d, 'EEEE, MMMM do');
  }
  const leapRef = parse(monthDay, 'MM-dd', new Date(2024, 0, 1));
  return isValid(leapRef) ? format(leapRef, 'MMMM do') : format(now, 'EEEE, MMMM do');
}

const MONTH_DAY = /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}/;

/**
 * The day's own title, shown as the heading the way the Bible reader shows
 * "John 3". My Utmost and Insight for Living have real ones ("The Unheeded
 * Secret"); Morning & Evening and Streams only carry the date ("October 19",
 * "Streams in the Desert - October 19"), which the header already shows.
 */
function dayTitle(content: DevotionalContent | null): string | null {
  const title = content?.title?.trim();
  return title && !MONTH_DAY.test(title) ? title : null;
}

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

  // Only a devotional that actually rendered counts as read — never log while
  // still fetching or after a load error (closing the error screen isn't reading).
  const canLogRead = !isFetching && !error && !!content;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hasLoggedRef.current || !canLogRead) return;
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      hasLoggedRef.current = true;
      onRead();
    }
  };

  const handleClose = () => {
    if (!hasLoggedRef.current && canLogRead) {
      hasLoggedRef.current = true;
      onRead();
    }
    onClose();
  };
  // Ignore the ghost click from the tap that opened this modal (see hook).
  const dismissOverlay = useOverlayDismiss(handleClose);
  // On a phone this window is full-bleed, so the ghost click from the tap that
  // opened it lands INSIDE, on whatever sits at the devotional card's
  // coordinates. Closing here also LOGS a read, so a stray click would record a
  // devotional that was never opened.
  const guardedClose = useTapGuard(handleClose);

  const title = dayTitle(content);

  return (
    <>
      <motion.div
        key="devotional-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismissOverlay}
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[500]"
      />
      {/* The Bible reader's window (ReaderModal). This used to be an `inset-4`
          card with a plain `py-6` header, which in the iPhone home-screen app put
          the title and Done button under the status bar and Dynamic Island. Now
          it fills a phone screen, pads the header for the safe area, and is a
          centered column on tablet and desktop. */}
      <motion.div
        key="devotional-window"
        data-testid="devotional-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="fixed inset-0 sm:inset-4 md:inset-x-auto md:inset-y-8 md:left-1/2 md:-translate-x-1/2 md:w-[760px] md:max-w-[calc(100vw-4rem)] bg-[var(--bg-primary)] z-[510] flex flex-col border border-[var(--border-color)] shadow-2xl sm:rounded-[24px] overflow-hidden"
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
              {/* Wraps instead of truncating: "My Utmost for His Highest" is long. */}
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tighter leading-tight text-[var(--text-primary)]">{name}</h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-widest truncate">
                {content?.date
                  ? formatDevotionalDate(content.date)
                  : format(new Date(), 'EEEE, MMMM do')}
              </p>
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
          // ios-scroll carries overscroll-behavior: contain, so reaching the end of
          // the devotional does not chain the scroll to the page behind it.
          className="flex-1 overflow-y-auto ios-scroll bg-[var(--bg-primary)]"
        >
          {/* The reader's centered column. The bottom pad keeps the Done button
              clear of the iPhone home indicator. */}
          <div
            className="px-6 sm:px-12 pt-8 sm:pt-12 max-w-[680px] mx-auto"
            style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
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
              <>
                <p className={`text-[11px] font-bold uppercase tracking-widest text-brand flex items-center gap-2 ${title ? 'mb-2' : 'mb-8'}`}>
                  <Sparkles size={12} />
                  {author || content.author}
                </p>
                {title && (
                  <h2 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight text-[var(--text-primary)] mb-8">
                    {title}
                  </h2>
                )}

                {content.entries.map((entry, i) => (
                  <div key={i} className={i > 0 ? 'mt-12 pt-12 border-t border-[var(--border-color)]' : ''}>
                    {entry.period && (
                      <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-6">
                        {entry.period === 'morning' ? 'Morning' : 'Evening'}
                      </p>
                    )}

                    {entry.scripture && (
                      <blockquote className="border-l-4 border-brand pl-5 mb-8">
                        <p className="font-serif italic text-[19px] sm:text-[20px] leading-[1.7] text-[var(--text-primary)]">
                          &ldquo;{entry.scripture}&rdquo;
                        </p>
                        {entry.reference && (
                          <cite className="block mt-2 text-sm font-bold text-brand not-italic">
                            — {entry.reference}
                          </cite>
                        )}
                      </blockquote>
                    )}

                    <div className="reader-prose font-serif text-[19px] sm:text-[20px] leading-[1.9] text-[var(--text-primary)]">
                      {entry.body.map((paragraph, j) => (
                        <p key={j} className="mb-[1.1em]">{paragraph}</p>
                      ))}
                    </div>
                  </div>
                ))}

                {/* At the end of the reading rather than a permanent bottom bar:
                    the bar spent ~100px of every phone screen on a button the
                    header ✓ already provides (the same call the Bible reader made). */}
                <button
                  onClick={guardedClose}
                  className="w-full mt-8 min-h-[52px] font-bold uppercase tracking-widest text-[12px] transition-all flex items-center justify-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-[18px] shadow-sm hover:opacity-90 active:scale-[0.98]"
                >
                  Done Reading
                  <Check size={16} />
                </button>
              </>
            ) : (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <p className="text-sm italic text-[var(--text-secondary)]">No devotional content available for today.</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

export default DevotionalReaderModal;
