# Persistent Instructions for The Daily Logos

## Bible Translations
- **Proverbs**: MUST always use the Bolls Life API, preferring the ESV (English Standard Version) translation. Fallback to KJV if ESV is unavailable.
- **Other Books**: Use the Bolls Life API with the KJV (King James Version) as default.

## Deployment & Syncing
- The application fetches Bible text dynamically from the Bolls Life API.
- **Offline Mode**: A local sync queue in IndexedDB caches reading progress when offline and automatically syncs to Firebase on reconnection.
- **Proverbs Caching**: The app caches Proverbs chapters permanently in IndexedDB (via idb-keyval) after the first fetch to ensure instant availability and offline resilience for future daily readings.
