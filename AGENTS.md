# Agent Instructions — Daily Logos

## Bible Translation for Proverbs

**The Proverbs fetching logic was intentionally changed by the project owner.**

Proverbs now uses the **Bolls.life API** with the **World English Bible (WEB)** translation.
There is **no local `public/proverbs.json` file**. It was intentionally deleted.

### What the code does (do not change this)
- `src/lib/proverbCache.ts`: fetches `https://bolls.life/get-chapter/WEB/20/{chapter}/`
- `src/lib/bibleCache.ts`: also uses `WEB` for Proverbs chapter previews
- All other books: continue using `KJV` via Bolls.life — this is correct

### Rules
- Do NOT fetch from `/proverbs.json` — the file does not exist
- Do NOT add back `public/proverbs.json`
- Do NOT change `WEB` to `KJV` or `ESV`
- Do NOT revert `proverbCache.ts` or `bibleCache.ts` to local file logic
- This is an **approved change** — do not undo it
