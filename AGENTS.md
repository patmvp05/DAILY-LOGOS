# Agent Instructions — Daily Logos

## Rules

1. **Never push directly to `main`.** Always use a pull request.
2. **Always run `git pull origin main` before starting any task.**
3. **Never revert or overwrite changes from previous sessions** unless explicitly asked.
4. **Before editing any file, list the files and changes. Wait for approval.**

## Proverbs Translation

Proverbs fetches from the **Bolls.life API** using **WEB** (World English Bible).

- `proverbCache.ts`: fetches `https://bolls.life/get-chapter/WEB/20/{chapter}/`
- `bibleCache.ts`: uses `WEB` for Proverbs chapter previews
- **There is NO `public/proverbs.json`** — it was intentionally removed. Do not add it back.
- Do NOT change `WEB` to `KJV`, `ESV`, or anything else.
- Do NOT switch back to a local file.

## Other Bible books

All other books use `KJV` via Bolls.life. This is correct and intentional.

## Themes

The app supports: `light`, `dark`, and `textbook`. All three must remain. Do not remove any theme.
