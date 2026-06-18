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
  - **NCV** → scraped from **BibleGateway** (`scripts/fetch-ncv-biblegateway.py`,
    requests+BeautifulSoup). bolls lacks it and the `meaningless` lib rejects it. ✅ 1189/1189 committed.
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
- **Currently internal:** only **Spurgeon's Morning & Evening** (`morning-evening`, 2
  readings/day) — public domain AND on CCEL with a clean per-day URL
  (`morneve.d{MMDD}{am|pm}.html`; scripture `<p class=passage>`, reference
  `<h3 class=scripPassage>`, body `<p class=normal>` in `<div id=book-section>`).
  **My Utmost** (Chambers) and **Streams in the Desert** (Cowman) are public domain but NOT on
  CCEL, so they stay **external** (utmost.org / crosswalk show the current day) until their
  text is sourced elsewhere — flip them to internal in `devotionalCatalog.ts` once JSON exists.
- **Content pipeline:** `scripts/fetch-devotionals.py` + `.github/workflows/scrape-devotionals.yml`
  (CCEL, GitHub Actions — the sandbox/WebFetch can't reach CCEL but the runner can). Fail-fast
  smoke (Spurgeon Jan 1), resumable, commits `public/devotionals/**`. A `DIAGNOSE=1` mode dumps
  CCEL's URL scheme + HTML structure into the logs (how the parser was derived without local
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
