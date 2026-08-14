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
    requests+BeautifulSoup). bolls lacks it and the `meaningless` lib rejects it. ✅ 1189/1189 committed.
  - **CSB** → same BibleGateway scraper, `BG_VERSION=CSB`. bolls returns `[]` for it. The
    verse-span classes are identical across versions (runner-verified: `text John-3-1`,
    `text Ps-23-1`, `text 3John-1-1`, `text Obad-1-1`), so one parser serves both.
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
  - ⚠️ **NIV / NLT / ESV / NKJV are declared in `BIBLE_VERSIONS` but have NO files in
    `public/bible/`** — only NCV (and now CSB/BSB once their workflows run) are committed.
    Selecting one of those four silently serves the KJV fallback. Run
    `scripts/fetch-bible-static.mjs` with `ONLY_VERSION=` to fill them.
- **Regenerating static text (no local machine needed):** GitHub Actions runs the scrapers
  ON GITHUB'S RUNNERS, which CAN reach bolls.life / BibleGateway (the sandbox can't).
  - NCV: `.github/workflows/scrape-ncv-bg.yml` (BibleGateway). Has a fail-fast smoke test,
    is time-bounded + always-commits + resumable (re-run fills gaps), reports completeness.
  - bolls versions: `scripts/fetch-bible-static.mjs` honors `ONLY_VERSION=NIV,ESV,...`; add a
    workflow like scrape-ncv-bg to run it. Resumable (skips existing files).
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
  NOT auto-deploy.
- **IMPORTANT — scraper commits don't auto-deploy:** when a scrape workflow commits
  `public/bible/**` to `main`, that push uses `GITHUB_TOKEN`, and GitHub does NOT trigger
  workflows for `GITHUB_TOKEN` pushes (anti-recursion). So the Firebase deploy does NOT fire
  on the bot's commit. After a scrape lands, push any follow-up commit to `main` (a normal
  user push) to deploy the new static files.
- **Offline Mode:** a local sync queue in IndexedDB caches reading progress when offline and
  syncs to Firebase on reconnection.

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
  reMarkable's cloud to test any of it. Then `daily-remarkable.yml` runs at `30 22 * * *`,
  deliberately 30 minutes after the 22:00 devotional refresh so the pack picks up that
  morning's content. The EPUB is never committed — it's a build artifact only.
- **Tests:** `scripts/test-remarkable-pack.mts` (in `npm test`) runs fully offline against
  the committed static files — the forward walk, boundary crossing, chapter-to-day mapping,
  EPUB structure, reproducibility, and the prune guards.
