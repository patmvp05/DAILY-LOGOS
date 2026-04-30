# Agent Instructions

## Proverbs Translation

The daily proverb uses the **World English Bible (WEB)** translation fetched live from the **Bolls.life API**.

### Current implementation
- `src/lib/proverbCache.ts` fetches from `https://bolls.life/get-chapter/WEB/20/{chapter}/`
- `src/lib/bibleCache.ts` also uses WEB for Proverbs chapter previews
- **There is NO `public/proverbs.json` file** — it was intentionally removed

### Rules — DO NOT violate these
- Do NOT add back `public/proverbs.json`
- Do NOT change `TRANSLATION = 'WEB'` to `'KJV'` or any other value
- Do NOT switch Proverbs fetching back to a local file
- Do NOT change the fetch URL away from `bolls.life/get-chapter/WEB/20/`

### Other books
All other Bible books use KJV via the Bolls.life API — this is correct and intentional.
