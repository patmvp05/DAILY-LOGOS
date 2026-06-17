# Persistent Instructions for The Daily Logos

## Bible Translations
- The user selects a version in Settings (`bibleVersion`, device-local). `getChapterText()`
  in `src/lib/chapterText.ts` is the single source of truth for ALL scripture text —
  the daily proverb, card previews, and the reader all go through it.
- **Two backends, chosen per-version by the `source` field in `src/constants.ts`:**
  - `bibleapi` — public-domain texts (WEB default, KJV) from bible-api.com (keyless, CORS-friendly).
  - `bolls` — modern, copyrighted texts (NIV/NLT/ESV/NKJV/NCV) served from **same-origin
    static JSON files** under `public/bible/{CODE}/{bookId}/{chapter}.json`.
- **Why static files:** bolls.life blocks runtime access entirely — the Cloud Function
  proxy gets Cloudflare 403, and direct browser fetch has no CORS. So the text is
  pre-fetched ONCE (locally) and committed. Do NOT reintroduce a runtime bolls.life or
  proxy fetch for Bible text; it does not work in production.
- **Regenerating static text:** run `node scripts/fetch-bible-static.mjs` locally
  (downloads from bolls.life with a browser User-Agent, ~30 min), then commit
  `public/bible/` and push. The script is resumable (skips files that already exist).
- **Honest fallback:** if a chapter fails to load, `getChapterText()` falls back to
  public-domain KJV but labels it "King James Version" — it never mislabels KJV as
  another version.

## Caching & Prefetch
- **Two-tier text cache:** L1 memory Map → L2 IndexedDB (idb-keyval), keyed by
  version+book+chapter (`chapter_text_v5_…`). Once read, a chapter is permanent and offline.
- **Look-ahead prefetch:** `src/lib/prefetchBible.ts` warms the next 7 chapters per
  category in the selected version on app start / progress change / reconnect (wired in
  `src/state/AppContext.tsx`). It's best-effort and idempotent.
- **Service worker:** `/bible/**` static files use a CacheFirst rule (`static-bible-text`,
  1-year) but are NOT precached — only chapters the user opens or that prefetch warms get
  stored on-device.

## Deployment & Syncing
- Firebase Hosting auto-deploys on push to `main` (the `dist/` build). Cloud Functions do
  NOT auto-deploy.
- **Offline Mode:** a local sync queue in IndexedDB caches reading progress when offline and
  syncs to Firebase on reconnection.
