# Persistent Instructions for The Daily Logos

## Bible Translations
- **Proverbs**: MUST always use the Bolls Life API, preferring the ESV (English Standard Version) translation. Fallback to KJV if ESV is unavailable.
- **Other Books**: Use the Bolls Life API with the KJV (King James Version) as default.

## Deployment & Syncing
- The application no longer relies on a local `/public/proverbs.json` file. All Bible text is fetched dynamically from the Bolls Life API.
- Caching is managed via browser localStorage to ensure performance and offline resilience.
