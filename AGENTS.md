# Persistent Instructions for The Daily Logos

## Bible Translations
- The user selects a version in Settings (`bibleVersion`, device-local). `getChapterText()`
  in `src/lib/chapterText.ts` is the single source of truth for ALL scripture text —
  the daily proverb, card previews, and the reader all go through it.
- **Two backends, chosen per-version by the `source` field in `src/constants.ts`:**
  - `bibleapi` — public-domain texts (WEB default, KJV) from bible-api.com (keyless, CORS-friendly).
  - `bolls` — modern, copyrighted texts served from **same-origin static JSON files** under
    `public/bible/{CODE}/{bookId}/{chapter}.json`. (`source: 'bolls'` just means "served from
    those static files"; the file's *origin* depends on the version — see below.)
- **Why static files:** bolls.life blocks runtime access — the GCP Cloud Function proxy
  gets Cloudflare 403, the dev sandbox is allowlist-blocked, and direct browser fetch has
  no CORS. Public CORS proxies don't help (they're datacenter IPs too). So the text is
  fetched ONCE and committed. Do NOT reintroduce a runtime bolls.life or proxy fetch for
  Bible text; it does not work in production.
- **Where each version's static files come from (verified):**
  - bolls.life HAS: NIV, NIV2011, ESV, NLT, NKJV, NASB, AMP, NET → scrape with
    `scripts/fetch-bible-static.mjs` (clean JSON API). It does NOT have NCV/CSB/NRSV/NASB2020
    (its get-text endpoint returns `[]`).
  - **NCV** → scraped from **BibleGateway** (`scripts/fetch-biblegateway.py`,
    requests+BeautifulSoup). bolls lacks it and the `meaningless` lib rejects it. 1189/1189 files
    (they were all present yet 38 were missing combined passages until Oct 2026: "all files exist"
    is not "all verses exist", which is why the integrity test counts verses).
  - **CSB** → same BibleGateway scraper, `BG_VERSION=CSB`. bolls returns `[]` for it. The
    verse-span classes are identical across versions (runner-verified: `text John-3-1`,
    `text Ps-23-1`, `text 3John-1-1`, `text Obad-1-1`, and range classes like `Gen-8-3-Gen-8-4`
    for combined verses), so one parser serves both.
  - **BSB** → NOT scraped. bereanbible.com publishes the whole text as ONE tab-separated
    file (`https://bereanbible.com/bsb.txt`, ~4.3 MB, ~31k verses) dedicated to the **public
    domain**, so `scripts/fetch-bsb-berean.mjs` does one request instead of 1189 — no rate
    limiting, nothing to resume. Runner-verified quirks the parser handles: a 3-line
    preamble, books named **"Psalm"** (singular → mapped to "Psalms"), single-chapter books
    as `Obadiah 1:1`, and 16 intentionally empty verses (Matt 17:21, Mark 7:16, …) that are
    skipped. It refuses to write unless all 1189 chapters parse, so a truncated download
    can't commit a half-Bible. Parser is unit-tested offline (`scripts/test-bsb-parser.mts`).
  - Probing a new translation: `.github/workflows/probe-translations.yml` dumps what each
    candidate source actually returns. Established that bolls, getbible.net and
    bible-api.com all 404 for BSB **and** CSB, and that BibleGateway serves no verse spans
    for BSB — so don't retry those routes.
  - **NIV / NLT / ESV / NKJV** → BibleGateway since Oct 2026 (same scraper, `BG_VERSION=NIV` …);
    they came from bolls.life before (see "All six modern translations" below for why that
    stopped). All seven stored versions (NCV, CSB, NIV, NLT, ESV, NKJV, BSB) have 1189/1189
    complete chapters, enforced by `scripts/test-bible-integrity.mts`.
- **Regenerating static text (no local machine needed):** GitHub Actions runs the scrapers
  ON GITHUB'S RUNNERS, which CAN reach bolls.life / BibleGateway (the sandbox can't).
  - NCV: `.github/workflows/scrape-ncv-bg.yml` (BibleGateway). Has a fail-fast smoke test,
    is time-bounded + always-commits + resumable (re-run fills gaps), reports completeness.
  - bolls (no longer a source for any shipped version): `.github/workflows/scrape-bolls.yml` runs `scripts/fetch-bible-static.mjs`
    (honors `ONLY_VERSION=NIV,ESV,...`), one version per job. Resumable (skips existing files);
    its `force` input re-fetches chapters already on disk after a parser change. The NCV/CSB
    workflows take a `refetch` input that re-downloads only files below the current `textVersion`.
- **Every stored chapter must be complete (Oct 2026).** NCV Numbers 7 shipped with 17 of its
  89 verses and nothing noticed. `scripts/test-bible-integrity.mts` (in `npm test` AND run by
  `deploy.yml` / `daily-devotional-deploy.yml` before building) reads all 1,189 chapters of
  every stored translation and fails on a missing, duplicated or out-of-order verse, empty
  text, leftover markers ("[a]", "(A)", "[20-21]", a leaked chapter number, HTML), a space
  before punctuation, or a translation whose signature verses read like a different one.
  Verse counts come from `scripts/lib/verse-counts.json` (1,189 chapters, 31,103 verses,
  ESV-style versification, two independent sources agree). Legitimate differences are listed
  there and nowhere else: alternate last verses (3 John 14/15, 2 Cor 13 13/14, Rev 12 17/18)
  and the footnoted verses critical-text translations omit (Matt 17:21 …); each translation's
  exact omission list is pinned in the test. Both scrapers run the same check
  (`scripts/lib/bible-check.mjs`, mirrored in Python) and refuse to write a chapter that fails.
- **Combined verses.** Some translations print several verses as one passage: NCV Genesis 8:3-4
  and Numbers 7:12-83 (38 chapters), NLT Numbers 1:20-21. A file stores it once as
  `{ verse: 12, verseEnd: 83, text }`. The reader, the daily proverb, copy-verse and the header
  range all go through `src/lib/verseLabel.ts`, so it reads "12–83" and copies as "Num 7:12-83".
  Never split a combined passage or invent per-verse text for it.
- **How BibleGateway marks things up** (runner probe, Oct 2026; `scripts/test-biblegateway-parser.py`
  replays the structure offline): verse text is `span.text` with class `Gen-8-2`; a combined
  verse's class is a RANGE, `Gen-8-3-Gen-8-4` (the old parser's single-verse regex dropped
  these, text and all); two NCV verses (1 Cor 6:9, 1 John 3:19) are a "-" placeholder whose text
  is in the next verse, merged into one combined verse; headings are `h3` (dropped), psalm
  superscriptions `h4.psalm-title` (kept, they open verse 1); the divine name is
  `span.small-caps`, so text inside a span is joined with NO separator (joining with " " wrote
  "the Lord ." into ~5,000 NCV/CSB verses); NLT census tables are `tr` rows, joined "cell — cell".
- **All six modern translations come from BibleGateway (Oct 2026).** NCV and CSB always did;
  NIV, NLT, ESV and NKJV moved off bolls.life because (1) bolls now answers NIV requests with a
  statement from its owner in place of every verse (every verse number still present, so only a
  content check catches it), and (2) bolls separates headings and poetry lines with the same
  `<br/>`, which no rule separates reliably: the original rule deleted the unpunctuated first line
  of ~1,200 NLT verses in 413 sampled chapters (Amos 1:4 lost "I will send fire on the house of
  Hazael"), and a title-case rule still deleted lines like "The LORD of Heaven's Armies" and left
  headings, speaker labels ("Young Woman") and an editor's note (NLT Mark 16:8) inside verses.
  BibleGateway marks headings as `h3`, so there is nothing to guess. Before switching, a second
  BibleGateway copy of 413 chapters was compared word for word: NKJV matched 8,985 of 8,990 verses
  (the rest are bolls placing "before the LORD" in the wrong verse). `fetch-bible-static.mjs`
  and `scrape-bolls.yml` are kept for reference but feed no shipped translation; do not point
  them at NIV.
- **The NIV is now the 2011 text** (BibleGateway's NIV; Ps 23:1 "I lack nothing"). The app used to
  ship bolls' 1984 NIV, which had lost poetry lines and can no longer be re-downloaded anywhere.
  The ESV is BibleGateway's current text, which differs from the old bolls copy in a handful of
  words (Job 7:4, Lam 3:32 …): those are ESV revisions, not errors.
- **`textVersion` in each file** records which parser wrote it (2 = the Oct 2026 fixes). Run a
  scraper with `REFETCH=1` to re-download only files below the current version; it resumes
  where an interrupted run stopped. Changing what the parser writes means bumping
  `TEXT_VERSION` in the scraper AND the cache prefixes in `chapterText.ts` (`chapter_text_v7_`)
  and `bibleCache.ts` (`bible_chapter_cache_v12_`) plus `STATIC_CACHE_BUST`: a phone otherwise
  keeps the chapter (and its reading time) it cached from the old text forever.
- **Honest fallback:** if a chapter fails to load, `getChapterText()` falls back to
  public-domain KJV but labels it "King James Version" (never mislabeled) and flags the
  result `_fallback`. **Fallbacks are memory-only — NEVER persisted to IndexedDB/localStorage**
  — so the instant a missing modern version's static files deploy, the next reload fetches
  the real text instead of a stuck KJV.

## Devotionals
- **Two kinds, routed at runtime by `id`** in `src/lib/devotionalCatalog.ts`
  (`resolveDevotionalKind`): **internal** = native in-app reader; **external** (the default
  for any id not in the catalog) = opens the source site in the browser at the day's reading.
- **Why `id`-based and not stored fields:** `firestore.rules` `isValidDevotional()` requires
  devotionals to have **exactly** `name`/`description`/`url` (3 keys). So `source`/`slug` are
  NEVER persisted — they're derived from `id` at runtime. Zero migration; returning users
  (local or cloud) route correctly because routing keys off `id`.
- **Internal devotionals** are same-origin static JSON at
  `public/devotionals/{slug}/{MM-DD}.json`, selected by **local** device date (rolls over at
  local midnight — correct regardless of timezone). Schema: `{slug,date,title,entries:[{period?,
  scripture?,reference?,body:[…paragraphs]}],author,source}`. Fetched via
  `src/lib/devotionalContent.ts` (two-tier memory+IndexedDB cache, `devotional_v1_…`, `?b=`
  cache-bust, 02-29→02-28 fallback), hook `useDevotional.ts`, rendered by
  `DevotionalReaderModal.tsx`. Prefetches yesterday/today/tomorrow on load/online
  (`AppContext.tsx`). Scroll-to-bottom or close logs a once-per-day read (`logDevotionalRead`,
  `categoryId:'devotional'`, `chapter:0` — counts toward streak, not plan progress).
- **Currently internal (4):**
  - **Spurgeon's Morning & Evening** (`morning-evening`, 2 readings/day) — CCEL,
    `morneve.d{MMDD}{am|pm}.html`; scripture `<p class=passage>`, reference
    `<h3 class=scripPassage>`, body `<p class=normal>` in `<div id=book-section>`.
  - **My Utmost for His Highest** (`my-utmost`, Chambers) — utmost.org WP REST API
    (`/wp-json/wp/v2/classic`) maps each post's `date` → MM-DD; page HTML parsed for body.
  - **Streams in the Desert** (`streams-in-the-desert`, Cowman) — crosswalk.com per-day URL
    (`streams-in-the-desert-{month}-{ordinal}.html`).
  - **Insight for Living** (`insight-for-living`, Swindoll) — insight.org WP REST API
    (`/wp-json/wp/v2/daily-devotional`) returns content HTML directly; scripture from
    `<blockquote>`, body from `<p class=wp-block-paragraph>`. **Rolling ~93-day window** —
    only recent dates are available (not a full 366), unlike the other three.
- **Content pipeline:** `scripts/fetch-devotionals.py` + `.github/workflows/scrape-devotionals.yml`
  (GitHub Actions — the sandbox/WebFetch can't reach these sites but the runner can; some block
  bot UAs so a Chrome UA `bg_session` is used). Fail-fast smoke (Jan 1, or today for Insight's
  rolling window), resumable, commits `public/devotionals/**`. A `PROBE=insight` mode dumps a
  site's URL scheme + HTML/API structure into the logs (how parsers are derived without local
  access). Same GITHUB_TOKEN-doesn't-deploy caveat as the Bible scrapers (see Deployment).
- **External `{{date}}` interpolation** (`interpolateDevotionalUrl`): `{{date}}`→`yyyy-MM-dd`,
  plus `{{YYYY}}`/`{{MM}}`/`{{DD}}`, all local time, applied at click time. The old blocked
  `<iframe>` is gone — external devotionals open in a new tab via a clean launch screen.
- **SW/headers:** `firebase.json` serves `/devotionals/**` `no-cache`; the SW rule is
  NetworkFirst (`static-devotional-text-v1`) — same anti-poisoning reasoning as `/bible/**`.

## Caching & Prefetch
- **Two-tier text cache:** L1 memory Map → L2 IndexedDB (idb-keyval), keyed by
  version+book+chapter (`chapter_text_v6_…`). Once read, a real chapter is permanent and
  offline. Fallbacks are L1-only (see above). Bump the prefix when the cache could hold
  stale entries from a prior architecture.
- **Look-ahead prefetch:** `src/lib/prefetchBible.ts` warms the next 7 chapters per
  category in the selected version on app start / progress change / reconnect (wired in
  `src/state/AppContext.tsx`). It's best-effort and idempotent.
- **Static-file caching (important):** a chapter URL may not exist yet (a version not
  scraped), and Firebase's SPA rewrite answers a missing file with `index.html` (HTTP 200).
  To stop that poisoning caches: `firebase.json` serves `/bible/**` as `no-cache`; the SW
  rule is **NetworkFirst** (`static-bible-text-v2`), not CacheFirst, so a missing-then-added
  file is picked up immediately; and `fetchFromStatic()` appends a `?b=N` cache-bust to
  escape any entries an earlier `immutable` header already poisoned (bump `STATIC_CACHE_BUST`
  if it recurs). Files are NOT precached — only chapters opened or prefetched get stored.

## Deployment & Syncing
- Firebase Hosting auto-deploys on push to `main` (the `dist/` build). Cloud Functions do
  NOT auto-deploy. `.github/workflows/deploy.yml` is the ONLY push-triggered deploy, and it
  publishes the Firestore rules before hosting. A duplicate `firebase-hosting-deploy.yml`
  ran alongside it on every push (Node 20, no rules step) until it was removed in Oct 2026;
  don't add another. `daily-devotional-deploy.yml` also builds and deploys whenever its
  morning refresh commits new devotional files (or on manual `workflow_dispatch`).
- **Pin `firebaseToolsVersion: '15.34.0'` in `FirebaseExtended/action-hosting-deploy@v0`:**
  `firebase-tools@15.34.1` added a mandatory `serviceusage.services.get` preflight check on
  `firebasehosting.googleapis.com` that fails with `403 PERMISSION_DENIED` unless the CI
  service account has `roles/serviceusage.serviceUsageViewer`. Keep `firebaseToolsVersion`
  pinned to `'15.34.0'` in both `deploy.yml` and `daily-devotional-deploy.yml` unless that
  IAM role has been granted.
- **IMPORTANT — scraper commits don't auto-deploy:** when a scrape workflow commits
  `public/bible/**` to `main`, that push uses `GITHUB_TOKEN`, and GitHub does NOT trigger
  workflows for `GITHUB_TOKEN` pushes (anti-recursion). So the Firebase deploy does NOT fire
  on the bot's commit. After a scrape lands, push any follow-up commit to `main` (a normal
  user push) to deploy the new static files.
- **Offline Mode:** a local sync queue in IndexedDB caches reading progress when offline and
  syncs to Firebase on reconnection.
- **App updates must never reload mid-read, and devotional-only commits must not trigger app reloads.**
  The service worker is `registerType: 'prompt'`
  and `vite.config.ts` must NOT set `workbox.skipWaiting`. `autoUpdate` hard-reloads the page
  the instant a new worker activates (`wb.on('activated', () => location.reload())`, no hook
  to intercept) and `main.tsx` checks for updates on every foreground — so a deploy reloaded
  the app a second after launch, right as you tapped into a chapter. It read as the reader
  closing itself. Now the worker parks in `waiting`, `onNeedRefresh` hands the activate
  function to `src/lib/appUpdate.ts`, and `useDeferredAppUpdate` applies it when no overlay is
  open or the app is backgrounded. Re-adding `skipWaiting: true` breaks this **silently** (the
  worker never waits, so `onNeedRefresh` never fires) — `scripts/test-app-update.mts` guards it.
  Furthermore, `vite.config.ts` stamps `__APP_VERSION__` from a SHA-256 hash of the app's own
  source files (`src/`, `index.html`, `package.json`, `vite.config.ts`) rather than
  `git rev-parse --short HEAD`, so morning devotional refreshes under `public/devotionals/`
  don't alter `index.html` or trigger an app update prompt.
- **Launch stability & single auth/sync state:**
  - `useAuth()` (`src/hooks/useAuth.ts`) uses a module-level singleton store so all callers
    (`App.tsx`, `AppModals.tsx`, `SettingsModal.tsx`) share one `onAuthStateChanged` subscription,
    never block `setUser` on `initializeUser()`, and keep `isAuthLoading` true until Firebase Auth
    settles so signed-out UI ("Sync Your Progress" card / "Sign in" button) never flashes while
    restoring a session.
  - `"Syncing..."` (`src/hooks/useSyncState.ts`) is only shown for user-initiated writes (not
    listener startup or `background: true` launch reconciliation writes) and only if a write
    remains pending for > 1 second.
  - `saveState` (`src/lib/storage.ts`) writes synchronously to `localStorage` on every state
    change so first paint always has the latest progress, completed books, and history without
    waiting for IndexedDB hydration.

## Reading Plan, Book Completion & Multi-Device Sync Rules
- **Proverbs is `dailyOnly: true` at `wisdom.books[1]` (never delete from the array):**
  - Each category's progress in Firestore (`users/{uid}/progress/{partId}`) stores `bookIndex`
    (position in `category.books`). Removing Proverbs from `wisdom.books` in `src/constants.ts`
    would shift Ecclesiastes (`bookIndex: 2`) and Song of Solomon (`bookIndex: 3`) down by one
    and corrupt saved positions across devices.
  - Keep Proverbs at `wisdom.books[1]` with `dailyOnly: true` and skip `dailyOnly` books
    everywhere (`isPlanBook`, `getPlanBooks`, `computeProgressStats`, `calculateNextProgress`,
    `BookSelectorModal`, `CategoryPlanModal`, `prefetchBible`, `build-remarkable-pack`).
  - Plan totals are **65 books** and **1,158 chapters** (`TOTAL_PLAN_BOOKS = 65`,
    `TOTAL_PLAN_CHAPTERS = 1158`; Wisdom = Job 42 + Ecclesiastes 12 + Song of Solomon 8 = 62).
  - If a saved Wisdom position ever points at `bookIndex: 1` (Proverbs), `normalizeProgressPosition`
    normalizes it to Ecclesiastes chapter 1 (`bookIndex: 2, chapter: 1`). Legacy
    `wisdom:Proverbs` completion docs and old history entries remain untouched in storage/cloud
    and are ignored by plan progress math.
  - Daily Proverb reads (`logProverbRead`) record `categoryName: 'Daily Proverb'`, keep
    `bookName: 'Proverbs'`, and store the real chapter `readTime`.
- **Finishing a book, switching books & completed parts:**
  - Finishing a book's last chapter (via card `+` or reader primary button) logs that chapter
    **once**, marks the book completed, advances the part to the recommended next unread book
    (first unread plan book after the finished book, or wrapping to the first unread plan book
    from the start of the part), and opens `BookFinishedModal` (`"You finished X. Up next: Y
    (recommended)."` with unread book choices and `"Undo, I'm not done with X"`).
  - Switching away from a book partway (`switchBookInProgress` / `JUMP_TO_BOOK`) saves the
    current chapter in `progress.partialChapters[bookName]` so read chapters continue to count
    in `computeProgressStats` and resuming that book later starts at the saved chapter.
  - Stepping backward with `-` stays inside the current book (stops at chapter 1). Undoing a
    finished book goes through `BookFinishedModal`'s Undo action (`UNDO_FINISH_BOOK`) or
    Full Plan (`CategoryPlanModal`, which requires confirmation before toggling completion).
  - When all plan books in a part are completed (`isCategoryComplete`), its card shows `100%
    Complete`, hides `"Next to Read"`, sorts below active parts, and the mobile summary strip
    counts only active parts (`"X of 6 parts today"`).
- **Revision-aware conflict resolution & signed-out completion tracking:**
  - `Progress` docs carry a monotonic `revision` integer. Every user progress change sets
    `revision` to `(current.revision ?? 0) + 1`. In `resolveProgressConflict`, higher
    `revision` wins (allowing deliberate backward book choices and Undo to hold across devices
    without trusting wall clocks); on a tie or when either side lacks `revision`, it falls back
    to the furthest-position rule. `partialChapters` are preserved across merges even if an
    older app version writes a doc without `partialChapters`.
  - `AppState.signedOutCompletedBooks` tracks book completions made while signed out. On the
    first `CompletedBooks` snapshot after launch, `useFirestoreSync` only uploads completions
    present in `signedOutCompletedBooks`, so an Undo made on another device is never
    re-uploaded from stale local state.
- **Per-book reading time fallback table (`BOOK_READ_MINUTES`):**
  - Generated from the committed NCV Bible text (`public/bible/NCV/{bookId}/{chapter}.json`) at
    225 words per minute by `scripts/compute-read-minutes.mts` and verified in
    `scripts/test-accurate-numbers.mts`.
- **The reader reserves space for its action bar** (`src/lib/readerLayout.ts`). The bar is a
  flex sibling of the scroller, so revealing it shortens the scroller. Nothing moves (shrinking
  a scroller RAISES max scrollTop), but the bottom strip becomes bar instead of text — so the
  tail below the last verse is kept >= bar height + scroll-end slop, proved for every safe-area
  inset by `scripts/test-tap-guard.mts`. Do not "fix" this by scrolling the text out of the
  way instead; that is a visible ~100px jump and fights iOS momentum scrolling.
- **There is an ErrorBoundary now** (`src/components/ErrorBoundary.tsx`), around each lazy
  `Suspense` in App.tsx and the whole tree in main.tsx. React unmounts everything on an
  uncaught render error, so before this a lazy chunk deleted by a deploy was a white screen
  with no way back. A stale chunk self-heals: `src/lib/chunkRecovery.ts` reloads once per tab
  session (a loop is worse than the error), re-armed 10s after a good boot. Do NOT call
  `preventDefault()` on `vite:preloadError` — that makes Vite continue, so the import resolves
  `undefined` and the failure resurfaces as an unrecognisable `Cannot read properties of
  undefined`; `scripts/test-chunk-recovery.mts` asserts it stays out.
- **Full-bleed modals must guard their own close buttons.** `useOverlayDismiss` only guards the
  backdrop, which assumes the iOS ghost click lands there. That holds for an `inset-4` modal;
  it does not for the reader or sprint sheet, which are `fixed inset-0` on a phone — the ghost
  click lands *inside* the window, on whatever was under the tap. Those use `useTapGuard` on
  every handler that closes the modal or moves progress. `scripts/test-tap-guard.mts` detects
  full-bleed modals from their container class, so a new one that forgets fails the suite.
- **The daily proverb and devotional reader use the Bible reader's layout** (`ProverbModal.tsx`,
  `DevotionalReaderModal.tsx`): full-bleed on a phone, header padded with
  `env(safe-area-inset-top)`, text in the reader's centered `max-w-[680px]` column and type,
  scroller tail padded for the home indicator. Both were `inset-4` cards with a plain `py-6`
  header, and in the home-screen app (`black-translucent` status bar) the title and Done button
  sat under the clock and Dynamic Island — "off-centered, top cut off." Any new overlay needs
  the same top padding; a 16px inset does not clear the status bar. The devotional's Done
  button sits at the end of the reading, not in a permanent bottom bar (same reasoning as the
  reader's action bar). Its heading is the day's own title (My Utmost, Insight); titles that
  are just a date (Morning & Evening, Streams) are skipped since the header shows the date.
- **Weather never asks for location on launch** (`resolveWeatherLocation` in
  `src/lib/weather.ts`). The location is saved once (localStorage `dl_weather_location_v1`,
  migrated from the old IndexedDB `weather-coords`) with **no expiry**; the browser is asked
  only on the very first run or when the user taps the weather. The old code re-requested
  geolocation whenever the coords were over an hour old, and an iOS home-screen app forgets
  the grant every time it closes — so it prompted on nearly every open. Do not add an age
  limit or a launch/visibility-time geolocation call back; `scripts/test-weather-location.mts`
  fails if you do.
- **The phone dashboard order is set with `order-*`** (`src/components/Dashboard.tsx`). Below
  `lg` the page is one column: today's proverb while unread (`order-1`), Resume Reading
  (`order-2`), the summary strip (`order-3`, phone only), the seven parts (`order-4`), the
  proverb once read (`order-5`, via `proverbReadToday`, the same Proverbs-today test
  `logProverbRead` uses), then Today's Reading, the sprint and Plan Status (`order-6` to
  `order-8`). The two column wrappers are `display: contents` below `lg` so their children can
  be reordered, and every `lg:` class reproduces the desktop layout unchanged. A new block in
  either column needs its own `order-*` plus `lg:order-none`, or on a phone it lands at order
  0, above everything.

## reMarkable "7-day pack"

Daily Logos as an EPUB for a reMarkable Paper Pro, built and delivered every morning.

- **Why a document and not the app:** reMarkable ships no web browser at any OS version,
  and the on-device ecosystem (Toltec — archived Aug 2026, superseded by Vellum — rmkit,
  Oxide) targets rM1/rM2 and needs physical access; on a Paper Pro, enabling developer mode
  performs a **factory reset**. The cloud API is the only mechanism that works from a
  stateless runner. So the port carries the *content and navigation*, not the React SPA.
- **What's in it:** for each of the seven parts, the next 7 chapters from wherever the
  Firestore pointer actually is; the daily proverb ×7 (chapter = day of month, the app's
  rule); every internal devotional that has that day on disk; a ruled handwriting page per
  day; and a progress summary from `computeProgressStats()`.
- **Insight for Living is structurally absent.** It is a rolling window of *recent* days, so
  a forward-looking pack has none of it. The builder reports which archives had no future
  days rather than hard-coding an exclusion — if that scrape ever looks forward, it appears
  on its own.
- **`scripts/build-remarkable-pack.mts`** — reads `users/{uid}/progress` and
  `users/{uid}/completedBooks` via `firebase-admin` (dynamically imported, so `--from-start`
  needs no credentials). It must read the **named** database (`firestoreDatabaseId` in
  `firebase-applet-config.json`); reading `(default)` returns zero docs, which looks exactly
  like "never started reading". The forward walk is ported from `prefetchBible.ts:32-63`.
  The builder **validates its own output and exits non-zero** rather than writing a bad pack.
- **Deterministic by construction:** every zip entry gets a fixed timestamp and
  `dcterms:modified` comes from the pack's date, never the clock. Same `--date` → identical
  bytes. Don't reintroduce `new Date()` into `scripts/lib/epub.mts`.
- **`scripts/upload-remarkable.mts`** — uses `rmapi-js` (current with sync 1.5 / schema 4;
  `juruen/rmapi`, `rmapy`, `rmcl` and `reMarkable-typescript` are all archived or pre-1.5).
  Uploads with `uploadEpub` + `move`, **not** `putEpub({parent})`: the library's own docs call
  `uploadEpub` the simpler path that "works even with schema version 4" while `putEpub` is
  "a little more finicky".
- **A new dated document each morning, never an overwrite.** Overwriting one fixed document
  would be tidier but would destroy whatever was handwritten on the note pages. Old packs are
  pruned instead — `selectStalePacks()` only ever matches the exact `Daily Logos YYYY-MM-DD`
  shape inside the target folder, never the pack just uploaded, and bails out entirely if an
  implausible number look stale.
- **Secrets:** `DAILY_LOGOS_UID` (the Firebase UID — not derivable from the repo; read it from
  Firebase Console → Authentication → Users) and `REMARKABLE_TOKEN`. Get the token by pairing
  once at `my.remarkable.com/device/desktop/connect` and running
  `npx tsx scripts/upload-remarkable.mts --register <8-char code>` **locally** — it refuses to
  run when `CI` is set, because the thing it prints is the credential. The device-token TTL is
  undocumented, so expect to re-pair eventually. Optional repo *variables*:
  `REMARKABLE_FOLDER`, `REMARKABLE_KEEP_DAYS`.
- **Workflows:** run `probe-remarkable.yml` by hand ONCE first — it round-trips a throwaway
  document (auth → folder → upload → verify → delete) because this sandbox cannot reach
  reMarkable's cloud to test any of it. Then `daily-remarkable.yml` is meant to run at `30 22 * * *` — **currently PAUSED** (the
  schedule is removed; manual `workflow_dispatch` only, because it failed nightly and emailed
  daily before the secrets existed; the cron to restore is in that file's header comment) —
  deliberately 30 minutes after the 22:00 devotional refresh so the pack picks up that
  morning's content. The EPUB is never committed — it's a build artifact only.
- **Tests:** `scripts/test-remarkable-pack.mts` (in `npm test`) runs fully offline against
  the committed static files — the forward walk, boundary crossing, chapter-to-day mapping,
  EPUB structure, reproducibility, and the prune guards.
