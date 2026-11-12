# The Daily Logos

A personal Bible-reading tracker: a React + Vite + TypeScript app that installs to the home
screen, signs in with Google and keeps reading progress in step across phone, tablet and
desktop through Firestore.

Live at https://gen-lang-client-0538747272.web.app

`AGENTS.md` is the detailed guide to how the app works and why: where each translation's
text comes from, caching, sync rules, the daily checks and deployment. Read it before
changing anything.

## Run it locally

Needs Node.js 22.

```
npm install
npm run dev          # http://localhost:3000
```

No API keys are needed. To run against the local Firebase emulators instead of production,
use `npm run emulators` in one terminal and `npm run dev:emulator` in another.

## Check a change

```
npm run typecheck
npm run lint
npm test             # every suite, including a read of all 8,323 stored chapters
npm run test:rules   # Firestore rules, against the emulator (needs Java)
```

## Deploy

Pushing to `main` builds the app and deploys the Firestore rules and Firebase Hosting
(`.github/workflows/deploy.yml`). Nothing else deploys it.

The project began as a Google AI Studio app
(https://ai.studio/apps/a46f4fd8-5659-438f-bae6-32f259d36ce9); `metadata.json` and
`.env.example` date from that.
