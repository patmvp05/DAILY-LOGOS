#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Downloads Bible chapters from bolls.life and saves them as static JSON files
 * under public/bible/{VERSION}/{bookId}/{chapter}.json
 *
 * Run ONCE from your local machine:
 *   node scripts/fetch-bible-static.mjs
 *
 * Then commit and push — the static files deploy with the app, eliminating
 * all external API dependencies for modern translations.
 */

const VERSIONS = [
  { code: 'NIV',  name: 'New International Version' },
  { code: 'NLT',  name: 'New Living Translation' },
  { code: 'ESV',  name: 'English Standard Version' },
  { code: 'NKJV', name: 'New King James Version' },
  { code: 'NCV',  name: 'New Century Version' },
];

const BOOKS = [
  { id: 1, name: 'Genesis', chapters: 50 },
  { id: 2, name: 'Exodus', chapters: 40 },
  { id: 3, name: 'Leviticus', chapters: 27 },
  { id: 4, name: 'Numbers', chapters: 36 },
  { id: 5, name: 'Deuteronomy', chapters: 34 },
  { id: 6, name: 'Joshua', chapters: 24 },
  { id: 7, name: 'Judges', chapters: 21 },
  { id: 8, name: 'Ruth', chapters: 4 },
  { id: 9, name: '1 Samuel', chapters: 31 },
  { id: 10, name: '2 Samuel', chapters: 24 },
  { id: 11, name: '1 Kings', chapters: 22 },
  { id: 12, name: '2 Kings', chapters: 25 },
  { id: 13, name: '1 Chronicles', chapters: 29 },
  { id: 14, name: '2 Chronicles', chapters: 36 },
  { id: 15, name: 'Ezra', chapters: 10 },
  { id: 16, name: 'Nehemiah', chapters: 13 },
  { id: 17, name: 'Esther', chapters: 10 },
  { id: 18, name: 'Job', chapters: 42 },
  { id: 19, name: 'Psalms', chapters: 150 },
  { id: 20, name: 'Proverbs', chapters: 31 },
  { id: 21, name: 'Ecclesiastes', chapters: 12 },
  { id: 22, name: 'Song of Solomon', chapters: 8 },
  { id: 23, name: 'Isaiah', chapters: 66 },
  { id: 24, name: 'Jeremiah', chapters: 52 },
  { id: 25, name: 'Lamentations', chapters: 5 },
  { id: 26, name: 'Ezekiel', chapters: 48 },
  { id: 27, name: 'Daniel', chapters: 12 },
  { id: 28, name: 'Hosea', chapters: 14 },
  { id: 29, name: 'Joel', chapters: 3 },
  { id: 30, name: 'Amos', chapters: 9 },
  { id: 31, name: 'Obadiah', chapters: 1 },
  { id: 32, name: 'Jonah', chapters: 4 },
  { id: 33, name: 'Micah', chapters: 7 },
  { id: 34, name: 'Nahum', chapters: 3 },
  { id: 35, name: 'Habakkuk', chapters: 3 },
  { id: 36, name: 'Zephaniah', chapters: 3 },
  { id: 37, name: 'Haggai', chapters: 2 },
  { id: 38, name: 'Zechariah', chapters: 14 },
  { id: 39, name: 'Malachi', chapters: 4 },
  { id: 40, name: 'Matthew', chapters: 28 },
  { id: 41, name: 'Mark', chapters: 16 },
  { id: 42, name: 'Luke', chapters: 24 },
  { id: 43, name: 'John', chapters: 21 },
  { id: 44, name: 'Acts', chapters: 28 },
  { id: 45, name: 'Romans', chapters: 16 },
  { id: 46, name: '1 Corinthians', chapters: 16 },
  { id: 47, name: '2 Corinthians', chapters: 13 },
  { id: 48, name: 'Galatians', chapters: 6 },
  { id: 49, name: 'Ephesians', chapters: 6 },
  { id: 50, name: 'Philippians', chapters: 4 },
  { id: 51, name: 'Colossians', chapters: 4 },
  { id: 52, name: '1 Thessalonians', chapters: 5 },
  { id: 53, name: '2 Thessalonians', chapters: 3 },
  { id: 54, name: '1 Timothy', chapters: 6 },
  { id: 55, name: '2 Timothy', chapters: 4 },
  { id: 56, name: 'Titus', chapters: 3 },
  { id: 57, name: 'Philemon', chapters: 1 },
  { id: 58, name: 'Hebrews', chapters: 13 },
  { id: 59, name: 'James', chapters: 5 },
  { id: 60, name: '1 Peter', chapters: 5 },
  { id: 61, name: '2 Peter', chapters: 3 },
  { id: 62, name: '1 John', chapters: 5 },
  { id: 63, name: '2 John', chapters: 1 },
  { id: 64, name: '3 John', chapters: 1 },
  { id: 65, name: 'Jude', chapters: 1 },
  { id: 66, name: 'Revelation', chapters: 22 },
];

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public', 'bible');

const DELAY_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChapter(version, bookId, chapter) {
  const url = `https://bolls.life/get-text/${version}/${bookId}/${chapter}/`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  const totalChapters = BOOKS.reduce((sum, b) => sum + b.chapters, 0);
  let fetched = 0;
  let errors = 0;

  for (const ver of VERSIONS) {
    console.log(`\n📖 Fetching ${ver.name} (${ver.code})...`);
    let verFetched = 0;

    for (const book of BOOKS) {
      for (let ch = 1; ch <= book.chapters; ch++) {
        const outDir = join(PUBLIC_DIR, ver.code, String(book.id));
        const outFile = join(outDir, `${ch}.json`);

        if (existsSync(outFile)) {
          verFetched++;
          fetched++;
          continue;
        }

        try {
          const data = await fetchChapter(ver.code, book.id, ch);
          mkdirSync(outDir, { recursive: true });
          writeFileSync(outFile, JSON.stringify(data));
          verFetched++;
          fetched++;

          if (verFetched % 50 === 0) {
            console.log(`  ${ver.code}: ${verFetched}/${totalChapters} chapters (${book.name} ${ch})`);
          }
          await sleep(DELAY_MS);
        } catch (err) {
          errors++;
          console.error(`  ✗ ${ver.code} ${book.name} ${ch}: ${err.message}`);
          await sleep(1000);
        }
      }
    }
    console.log(`  ${ver.code} done: ${verFetched}/${totalChapters} chapters`);
  }

  console.log(`\n✅ Complete: ${fetched} chapters fetched, ${errors} errors`);
  console.log(`Files saved to: public/bible/`);
  console.log(`\nNext steps:`);
  console.log(`  git add public/bible/`);
  console.log(`  git commit -m "Add static Bible text for modern translations"`);
  console.log(`  git push origin main`);
}

main().catch((e) => { console.error(e); process.exit(1); });
