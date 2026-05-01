# Persistent Instructions for The Daily Logos

## Bible Translations
- **Proverbs**: MUST always use the local `/public/proverbs.json` file, which contains the ESV (English Standard Version) translation.
- **Other Books**: Use the Bolls Life API with the KJV (King James Version) as default.

## Deployment & Syncing
- **CRITICAL**: The application depends on `/public/proverbs.json`. Do NOT delete, rename, or revert the fetching logic for this file. 
- If the file is missing in the local environment, it may be due to a sync issue with GitHub. Do NOT "fix" this by reverting to the KJV API; instead, preserve the ESV logic.
