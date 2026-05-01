# Persistent Instructions for The Daily Logos

## Bible Translations
- **Proverbs**: MUST always use the local `/public/proverbs.json` file, which contains the ESV (English Standard Version) translation.
- **Other Books**: Use the Bolls Life API with the KJV (King James Version) as default.

## Deployment & Syncing
- **CRITICAL**: The application depends on `/public/proverbs.json`. Do NOT delete, rename, or revert the fetching logic for this file. 
- If the file is missing in the local environment, it may be due to a sync issue with GitHub. Do NOT "fix" this by reverting to the KJV API; instead, preserve the ESV logic.

## Themes — DO NOT REMOVE OR MODIFY
- **CRITICAL**: The application supports multiple themes: `light`, `dark`, `system`, `audible`, `xp`, and `textbook`. ALL of these themes are intentional and must be preserved.
- **DO NOT remove any theme** from `src/types.ts`, `src/hooks/useTheme.ts`, `src/components/modals/SettingsModal.tsx`, `src/components/Dashboard.tsx`, `src/components/Navbar.tsx`, or `src/index.css`.
- The **textbook theme** (vintage parchment styling with per-section colors) was deliberately designed by the app owner. It is not "unused" or "complex" — it is a core feature. Never remove it.
- If you are asked to add or fix something unrelated to themes, leave all theme code untouched.
