# Daily Logos — Product Requirements Document

## 1. Overview

Daily Logos is a Bible-reading-plan progressive web app (PWA). Users track their
progress through reading plans organized by category (The Law, History, Gospels,
Wisdom, Epistles, Prophecy, Psalms), log daily reading history, journal on Proverbs,
write custom devotionals, and sync everything across devices via Google sign-in +
Firestore. The app works fully offline and reconciles state when connectivity
returns.

Target users: individuals doing a structured, multi-track Bible reading plan who
want their progress to follow them across phone, tablet, and desktop.

## 2. Core Features

### 2.1 Reading Plan Categories
- Seven categories, each a list of books with chapter counts (e.g. Law: Genesis 50,
  Exodus 40, Leviticus 27, Numbers 36, Deuteronomy 34; Psalms: Psalms 150 as a
  single-book category).
- Each category tracks independent progress: current book index + current chapter
  (chapter = next chapter to read, 1-indexed).
- A category's overall % complete = chapters read / total chapters in category.
- A book is "complete" either by reaching its last chapter via tapping forward, or
  by manually toggling it complete in the "Full Plan" view.

### 2.2 Advancing Progress (Dashboard)
- Each category card on the Dashboard shows current book/chapter, a `+`/`-` tap
  control, and a progress bar.
- Tapping `+` advances one chapter; tapping `-` moves back one chapter (never
  below book 1 / chapter 1 of the category).
- Rapid taps are debounced (~200ms) and batched into a single state update +
  cloud write.
- Crossing the last chapter of a book marks that book complete and rolls to
  chapter 1 of the next book.
- At the last chapter of the last book in a category, further `+` taps log the
  final chapter exactly once and mark the book complete — they must NOT create
  duplicate history entries on repeated taps.
- Each chapter advance is appended to reading History with a timestamp,
  local date, category, book name, chapter, and an estimated read time.

### 2.3 Jump to Book / Reset Progress
- "Jump to Book" (via book selector) lets a user set a category's progress
  directly to the start of any book. If this moves progress *backward* from
  where it currently is, the user is shown a confirmation dialog before the
  change is applied.
- "Reset Progress" (Settings) resets all categories to book 0 / chapter 1,
  clears completed-book flags, and sets a new plan start date — but preserves
  journal/devotional/history data.

### 2.4 Full Plan View (per category)
- Lists every book in a category with a checkbox for manual completion.
- Highlights the book the user is currently on.
- Must render correctly even if a category's progress entry is temporarily
  missing (e.g. mid-sync) — should not crash.

### 2.5 Daily Proverb & Journals
- Each day of the month maps to a Proverbs chapter (day-of-month = chapter).
- A "Daily Proverb" card shows a snippet of today's chapter and lets the user
  open a modal to read the full chapter and write/edit a journal entry tied
  to that date+chapter.
- Scrolling to the bottom of the proverb modal logs that day's Proverbs
  reading into History exactly once (no duplicate logs from repeated scroll
  events).
- Saved journals are listed in History/Settings; selecting "View/Edit" on an
  existing journal must load that entry's saved content into the editor (not
  open a blank entry), and saving must update the existing entry rather than
  create a duplicate.

### 2.6 Devotionals
- Users can add custom devotional entries (title/content) and delete them.
- Devotionals sync across devices; editing an existing devotional's content on
  one device must be reflected on other devices after sync (not just additions
  /deletions).

### 2.7 History & Streak
- History is a reverse-chronological log of every chapter read, capped at 2000
  entries (oldest entries drop off once the cap is exceeded — both for local
  writes and incoming cloud snapshots).
- "Streak" = number of consecutive calendar days (local time) with at least one
  reading, ending today or yesterday. If the most recent reading is older than
  yesterday, streak = 0.
- "Day N" of the plan = calendar days since the plan start date (inclusive),
  computed in local time (must not shift by a day due to UTC/timezone parsing).

### 2.8 Onboarding
- New signed-in users with no `startDate` set see an Onboarding screen asking
  them to pick (or confirm) their plan start date (defaults to today).
- The chosen date must be stored as the local calendar date selected — not
  shifted to the previous day due to timezone conversion.

### 2.9 Themes
- Theme toggle in the navbar cycles through: light, dark, system, xp, audible,
  textbook.
- Settings modal exposes light/dark/system as the primary theme choices.
- Theme choice persists locally and syncs to the user's account.

### 2.10 Authentication & Sync
- Google sign-in (popup, with redirect fallback for blocked popups / iframe
  contexts).
- Unauthenticated users can use the app fully offline with local-only
  persistence; signing in later merges local progress into the cloud account.
- All collections sync in real time via Firestore listeners: user settings,
  progress (per category), completed books, journals, devotionals, and
  history.
- **Conflict resolution (critical):** when local and cloud disagree on a
  category's progress:
  - If one side's last update is clearly newer (>5 minutes apart), it wins —
    even if that means moving progress backward (e.g. a deliberate reset or
    jump-to-book on another device must propagate and NOT be reverted by a
    stale device).
  - If both sides were updated within ~5 minutes of each other (near-simultaneous
    edits on two devices), the side with *further* reading progress wins
    (self-heals minor clock drift / simultaneous reading sessions).
  - After resolving, if the cloud doesn't yet reflect the winning value (e.g.
    a previous write silently failed), the app re-pushes the correct value so
    other devices catch up.
- Sync status indicator (navbar) shows: idle / syncing / synced / error /
  offline, with the last-synced time.
- A listener that errors (e.g. transient permission error) automatically
  retries after ~15 seconds rather than leaving sync permanently broken.

### 2.11 Offline / PWA Behavior
- Installable PWA with offline asset precaching.
- Firestore offline persistence allows reading/writing while offline; writes
  sync when connectivity returns.
- A `/reset.html` utility page clears stale service-worker caches.

## 3. Key User Flows (for test planning)

1. **First-time onboarding**: sign in with Google → no start date → Onboarding
   screen → pick start date → land on Dashboard with Day 1.
2. **Advance reading progress**: on Dashboard, tap `+` repeatedly on a category
   → chapter/book advances correctly, history entries appear, progress bar and
   % update, book auto-completes at its last chapter.
3. **Complete the final chapter of a category**: tap `+` until the last chapter
   of the last book; verify it's marked complete and additional taps do not
   create duplicate history rows or re-trigger completion.
4. **Jump to a different book**: open book selector, pick a book earlier than
   current progress → confirmation dialog appears → confirm → progress updates
   to that book's chapter 1.
5. **Manual book completion**: open "Full Plan" for a category, toggle a book's
   checkbox on/off, verify progress % recalculates and the modal doesn't crash
   if progress data is briefly missing.
6. **Daily Proverb journal**: open today's Proverb, scroll to bottom (logs
   reading once), write a journal entry, save; reopen via "View/Edit" and
   confirm the saved content loads and edits update (not duplicate) the entry.
7. **Add/edit/delete a devotional**: create a devotional, edit its content,
   delete it; verify edits are not silently dropped.
8. **Reset progress**: trigger Reset Progress from Settings, confirm dialog,
   verify all categories return to book 0/chapter 1 with a new start date while
   history/journals remain intact.
9. **Theme switching**: cycle the navbar theme toggle through all six themes and
   verify the UI updates each time without errors; verify Settings modal theme
   selector stays in sync.
10. **Offline behavior**: go offline, advance progress / log a journal, go back
    online, verify the sync badge transitions syncing → synced and the change
    persists after reload.
11. **Cross-device sync simulation**: with two sessions signed into the same
    account, advance progress in one, verify the other reflects it after sync
    (and that resets/jumps on one device aren't reverted by stale state on the
    other).
12. **Streak & Day-N display**: with reading history spanning multiple days
    (including a gap), verify the streak count and "Day N" label match expected
    values for the local timezone.

## 4. Non-Functional Requirements

- Works on latest Chrome/Safari (desktop + iOS), installable as PWA.
- All sync-affecting writes must be resilient to transient Firestore errors
  (auto-retry, no permanent "stuck" error state).
- No action should ever silently lose user progress, journal entries, or
  history.
- History list capped at 2000 entries for performance.

## 5. Out of Scope (for now)
- Multi-language / i18n.
- Non-Google auth providers.
- Push notifications / reminders.
