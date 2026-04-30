# Agent Instructions

## Proverbs Translation — DO NOT REVERT

The daily proverb must always use the **English Standard Version (ESV)**.

### Rules
- `src/lib/proverbCache.ts`: `const translation` must remain `'ESV'`
- `public/proverbs.json`: This file must always be present. It contains all 31 chapters of Proverbs in ESV. Do not delete it.
- The `translation_id` and `translation_name` in the returned result must remain `'esv'` and `'English Standard Version'`

### Why
The app intentionally uses a local ESV JSON file (`public/proverbs.json`) instead of the bolls.life API (which defaults to KJV). Changing `translation` to `'KJV'` or removing `proverbs.json` breaks the feature.

### What NOT to do
- Do not change `const translation = 'ESV'` to `'KJV'`
- Do not delete or replace `public/proverbs.json`
- Do not switch the proverb fetch to use the bolls.life API
