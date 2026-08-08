#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builds the Berean Standard Bible (BSB) as static JSON under
 * public/bible/BSB/{bookId}/{chapter}.json — the exact ChapterTextResponse
 * shape getChapterText() expects.
 *
 * Unlike the other translations, BSB needs no scraping: bereanbible.com
 * publishes the whole text as ONE tab-separated file (~4.3 MB, ~31k verses),
 * and dedicates it to the public domain. One request replaces 1189, so there is
 * no rate limiting, no partial runs, and nothing to resume.
 *
 * Verified source shape (GitHub runner probe, see probe-translations.yml):
 *   - 3 preamble lines, then `Verse<TAB>Berean Standard Bible` records
 *   - EVERY line has exactly 2 tab fields (0 malformed across the file)
 *   - references look like `Genesis 1:1`, `Obadiah 1:1`, `3 John 1:1`
 *   - books are named "Psalm" (singular) — mapped to "Psalms" by resolveBook()
 *   - 16 verses are intentionally empty (Matthew 17:21, Mark 7:16, …), the
 *     passages absent from the critical text; they are skipped, matching the
 *     runtime's own `text.length > 0` filter.
 *
 * Run:
 *   node scripts/fetch-bsb-berean.mjs              # downloads the source
 *   BSB_TXT=/path/to/bsb.txt node scripts/…        # uses a local copy
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS, TOTAL_CHAPTERS, resolveBook } from './lib/bibleBooks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(__dirname, '..', 'public', 'bible', 'BSB');

export const SOURCE_URL = 'https://bereanbible.com/bsb.txt';
export const CODE = 'BSB';
export const DISPLAY_NAME = 'Berean Standard Bible';

/**
 * Normalise verse text. The source is already clean prose, but strip any stray
 * markup and collapse whitespace so the committed files are render-ready —
 * mirroring cleanVerseText() in src/lib/chapterText.ts.
 */
export function cleanVerseText(raw) {
  return String(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Genesis 1:1` -> { book, chapter, verse }; null if the line isn't a verse. */
export function parseReference(ref) {
  const m = /^(.+?)\s+(\d+):(\d+)$/.exec(String(ref).trim());
  if (!m) return null;
  const book = resolveBook(m[1]);
  if (!book) return null;
  return { book, chapter: Number(m[2]), verse: Number(m[3]) };
}

/**
 * Parse the whole bsb.txt into chapters.
 *
 * Pure and exported so the parser is unit-tested without any network access
 * (the dev sandbox cannot reach bereanbible.com at all).
 *
 * @returns {{chapters: Map<string, {bookId,bookName,chapter,verses:Array}>, stats: object}}
 */
export function parseBsbText(content) {
  const chapters = new Map(); // `${bookId}:${chapter}` -> record
  const stats = { lines: 0, verses: 0, skippedEmpty: 0, unparsed: 0 };

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    if (!line.trim()) continue;
    stats.lines++;

    const tab = line.indexOf('\t');
    if (tab === -1) { stats.unparsed++; continue; }

    const ref = parseReference(line.slice(0, tab));
    if (!ref) { stats.unparsed++; continue; } // preamble + the header row

    const text = cleanVerseText(line.slice(tab + 1));
    if (!text) { stats.skippedEmpty++; continue; }

    const key = `${ref.book.id}:${ref.chapter}`;
    let rec = chapters.get(key);
    if (!rec) {
      rec = { bookId: ref.book.id, bookName: ref.book.name, chapter: ref.chapter, verses: [] };
      chapters.set(key, rec);
    }
    rec.verses.push({ verse: ref.verse, text });
    stats.verses++;
  }

  for (const rec of chapters.values()) {
    rec.verses.sort((a, b) => a.verse - b.verse);
  }
  return { chapters, stats };
}

/** Shape one chapter exactly like ChapterTextResponse. */
export function toChapterResponse(rec) {
  return {
    reference: `${rec.bookName} ${rec.chapter}`,
    verses: rec.verses,
    translationId: CODE,
    translationName: DISPLAY_NAME,
  };
}

/**
 * Refuse to write a half-broken Bible. A silently truncated download would
 * otherwise commit hundreds of missing chapters that the app then papers over
 * with a KJV fallback.
 */
export function validate(chapters, stats) {
  const problems = [];
  if (stats.verses < 30000) problems.push(`only ${stats.verses} verses parsed (expected ~31000)`);
  if (chapters.size !== TOTAL_CHAPTERS) {
    problems.push(`got ${chapters.size} chapters, expected ${TOTAL_CHAPTERS}`);
  }
  for (const book of BOOKS) {
    for (let ch = 1; ch <= book.chapters; ch++) {
      const rec = chapters.get(`${book.id}:${ch}`);
      if (!rec || rec.verses.length === 0) problems.push(`missing ${book.name} ${ch}`);
    }
  }
  return problems;
}

async function main() {
  const local = process.env.BSB_TXT;
  let content;
  if (local) {
    console.log(`Reading local source: ${local}`);
    content = readFileSync(local, 'utf8');
  } else {
    console.log(`Downloading ${SOURCE_URL} ...`);
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${SOURCE_URL}`);
    content = await res.text();
    console.log(`  ${content.length} bytes`);
  }

  const { chapters, stats } = parseBsbText(content);
  console.log(`Parsed: ${stats.verses} verses across ${chapters.size} chapters ` +
              `(${stats.skippedEmpty} empty verses skipped, ${stats.unparsed} non-verse lines)`);

  const problems = validate(chapters, stats);
  if (problems.length) {
    console.error(`\n✗ Refusing to write — source looks incomplete:`);
    problems.slice(0, 20).forEach((p) => console.error(`   - ${p}`));
    if (problems.length > 20) console.error(`   … and ${problems.length - 20} more`);
    process.exit(1);
  }

  // Rewrite from scratch: the source is a single consistent snapshot, so a
  // stale file from an earlier run must never survive.
  if (existsSync(OUT_ROOT)) rmSync(OUT_ROOT, { recursive: true });

  let written = 0;
  for (const rec of chapters.values()) {
    const dir = join(OUT_ROOT, String(rec.bookId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${rec.chapter}.json`), JSON.stringify(toChapterResponse(rec)));
    written++;
  }

  console.log(`\n✅ Wrote ${written}/${TOTAL_CHAPTERS} chapters to public/bible/${CODE}/`);
}

// Only run when executed directly, so tests can import the parser.
if (process.argv[1] && process.argv[1].endsWith('fetch-bsb-berean.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
