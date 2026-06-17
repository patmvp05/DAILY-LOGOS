# Persistent Instructions for The Daily Logos

## Bible Translations
- The user selects a version in Settings (`bibleVersion`, device-local). `getChapterText()`
  in `src/lib/chapterText.ts` is the single source of truth for ALL scripture text —
  the daily proverb, card previews, and the reader all go through it.
- **Two backends, chosen per-version by the `source` field in `src/constants.ts`:**
  - `bibleapi` — public-domain texts (WEB default, KJV) from bible-api.com (keyless, CORS-friendly).
  - `bolls` — modern, copyrighted texts (NIV/NLT/ESV/NKJV/NCV) served from **same-origin
    static JSON files** under `public/bible/{CODE}/{bookId}/{chapter}.json`.
- **Why static files:** bolls.life blocks runtime access — the GCP Cloud Function proxy
  gets Cloudflare 403, the dev sandbox is allowlist-blocked, and direct browser fetch has
  no CORS. Public CORS proxies don't help (they're datacenter IPs too). So the text is
  fetched ONCE and committed. Do NOT reintroduce a runtime bolls.life or proxy fetch for
  Bible text; it does not work in production.
- **Regenerating static text (no local machine needed):** the `.github/workflows/scrape-ncv.yml`
  GitHub Action runs `scripts/fetch-bible-static.mjs` ON GITHUB'S RUNNERS, which CAN reach
  bolls.life (verified: HTTP 200). It probes reachability, scrapes, and commits `public/bible/`
  to `main`. Trigger it by pushing a change to the workflow or the script (or via the Actions
  tab). `ONLY_VERSION=NCV` (env) scrapes one translation at a time; the script is resumable
  (skips existing files). Running it locally still works too (`node scripts/fetch-bible-static.mjs`).
- **Honest fallback:** if a chapter fails to load, `getChapterText()` falls back to
  public-domain KJV but labels it "King James Version" (never mislabeled) and flags the
  result `_fallback`. **Fallbacks are memory-only — NEVER persisted to IndexedDB/localStorage**
  — so the instant a missing modern version's static files deploy, the next reload fetches
  the real text instead of a stuck KJV.

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
- **Offline Mode:** a local sync queue in IndexedDB caches reading progress when offline and
  syncs to Firebase on reconnection.
