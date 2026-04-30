# Agent Instructions

## Bible Translation for Proverbs

Proverbs is fetched from the **Bolls.life API** using the **World English Bible (WEB)** translation.

- Fetch URL: `https://bolls.life/get-chapter/WEB/20/{chapter}/`
- Book ID for Proverbs on Bolls.life: `20`
- Translation code: `WEB`

All other Bible books use `KJV` via the same Bolls.life API. This is correct.

## Rules

- Do NOT use a local file for Proverbs. There is no `public/proverbs.json`.
- Do NOT change the translation from `WEB` to `KJV` or anything else.
- Do NOT add or restore any local Bible data files.
