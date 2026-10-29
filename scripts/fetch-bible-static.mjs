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

const ALL_VERSIONS = [
  { code: 'NIV',  name: 'New International Version' },
  { code: 'NLT',  name: 'New Living Translation' },
  { code: 'ESV',  name: 'English Standard Version' },
  { code: 'NKJV', name: 'New King James Version' },
  { code: 'NCV',  name: 'New Century Version' },
];

// Optional ONLY_VERSION env (comma-separated codes, e.g. "NCV" or "NIV,ESV")
// scrapes just those versions — lets CI fetch one translation at a time.
const ONLY = (process.env.ONLY_VERSION || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const VERSIONS = ONLY.length
  ? ALL_VERSIONS.filter((v) => ONLY.includes(v.code))
  : ALL_VERSIONS;

// A typo'd code would otherwise select nothing and exit 0 — a "successful" run
// that scraped no chapters, and a smoke test that passed without testing.
if (ONLY.length && VERSIONS.length === 0) {
  console.error(
    `ONLY_VERSION="${process.env.ONLY_VERSION}" matched no known version. ` +
    `Known: ${ALL_VERSIONS.map((v) => v.code).join(', ')}`
  );
  process.exit(1);
}
const unknown = ONLY.filter((c) => !ALL_VERSIONS.some((v) => v.code === c));
if (unknown.length) {
  console.error(`Unknown version code(s) ignored: ${unknown.join(', ')}`);
  process.exit(1);
}

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

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { checkChapter, tidyVerseText } from './lib/bible-check.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public', 'bible');

const DELAY_MS = 500;           // polite gap between successful requests
const MAX_RETRIES = 6;          // per-chapter retries before giving up (gap filled on re-run)
const MAX_BACKOFF_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror of cleanVerseText() in src/lib/chapterText.ts. Kept in sync by hand —
// this standalone Node script can't import the TS source. Strips bolls.life's
// Strong's numbers, superscripts and any stray HTML down to clean prose so the
// static files are the final, render-ready shape.
function cleanVerseText(raw) {
  return String(raw)
    .replace(/<S>[^<]*<\/S>/gi, '')
    .replace(/<sup>[^<]*<\/sup>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip bolls' embedded SECTION HEADINGS (and stray chapter numbers) from a verse.
 *
 * bolls puts a heading inline, separated by <br/>, so naively stripping tags
 * glued it onto the text: committed NIV read "The Beginning In the beginning
 * God created…" and "Psalm 23 A psalm of David. The Lord is my shepherd…".
 * Verified raw shapes (runner probe):
 *   NIV Ps 23:1   "Psalm 23<br/>A psalm of David.<br/>The Lord is my shepherd…"
 *   NIV John 3:1  "Jesus Teaches Nicodemus<br/>Now there was a man…"
 *
 * <br/> is ALSO the poetry line break, so a segment is only a heading when it
 * cannot be scripture:
 *   - it is TITLE CASE: every word except small words (of, the, to, on…) is
 *     capitalised. Headings are ("Jesus Teaches Nicodemus", "The Beast out of
 *     the Sea", "Psalm 23"); poetry lines are not.
 *   - it ends with no punctuation, is short (<= 60 chars), and is followed by
 *     more text;
 *   - it leads the verse, or follows a finished sentence (a mid-verse heading,
 *     e.g. NIV Revelation 13:1).
 *
 * The title-case test is the Oct 2026 fix. The first version treated ANY short,
 * capitalised, unpunctuated leading line as a heading, and NIV/NLT poetry often
 * opens a verse with such a line, so it deleted scripture: NIV Amos 1:4 kept
 * "that will consume the fortresses of Ben-Hadad" and lost "I will send fire on
 * the house of Hazael"; NLT Acts 2:21 kept only "will be saved."
 *
 * A bare chapter number before verse 1 ("8<br/>Then the Lord said…", or inline
 * "8 Then the Lord said…") is removed too: bolls prints it where a chapter
 * starts mid-paragraph.
 *
 * Returns { text, stripped[] } so every removal is auditable rather than
 * silently mutating scripture.
 */
const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'of', 'on', 'in',
  'to', 'at', 'by', 'as', 'up', 'from', 'with', 'into', 'onto', 'out', 'over', 'upon',
  'off', 'is', 'are', 'was', 'be', 'about', 'after', 'against', 'among', 'before',
  'between', 'through', 'toward', 'under', 'until', 'within', 'without',
]);

export function isTitleCase(seg) {
  const words = seg
    .split(/\s+/)
    .map((w) => w.replace(/^[‘“"'(\[]+|[’”"')\]]+$/g, ''))
    .filter(Boolean);
  if (words.length === 0) return false;
  let capitalised = 0;
  for (const w of words) {
    if (/^\d/.test(w)) continue;
    if (SMALL_WORDS.has(w.toLowerCase())) continue;
    if (!/^\p{Lu}/u.test(w)) return false;
    capitalised++;
  }
  return capitalised > 0 && /^[\p{Lu}\d‘“(]/u.test(words[0]);
}

function looksLikeHeading(seg) {
  return (
    seg.length > 0 &&
    seg.length <= 60 &&
    !/[.,;:!?"'”’)—-]$/.test(seg) &&
    isTitleCase(seg)
  );
}

export function stripHeadings(rawText, chapter) {
  const parts = String(rawText)
    .split(/<br\s*\/?>/i)
    .map((p) => p.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p, i, all) => p.length > 0 || i === all.length - 1);
  const stripped = [];
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    const isLast = i === parts.length - 1 || parts.slice(i + 1).every((p) => !p);
    const prev = kept[kept.length - 1];
    const atSentenceStart = prev === undefined || /[.!?][”’"')]*$/.test(prev);
    if (chapter !== undefined && kept.length === 0 && seg === String(chapter) && !isLast) {
      stripped.push(seg);
      continue;
    }
    if (!isLast && atSentenceStart && stripped.length < 3 && looksLikeHeading(seg)) {
      stripped.push(seg);
      continue;
    }
    kept.push(seg);
  }
  let text = cleanVerseText(kept.join(' '));
  // Inline chapter number ("8 Then the Lord said…"), seen only before verse 1.
  if (chapter !== undefined) {
    const m = text.match(new RegExp(`^${chapter}\\s+(?=[\\p{L}\\u2018\\u201c(])`, 'u'));
    if (m) { stripped.push(String(chapter)); text = text.slice(m[0].length); }
  }
  if (!text) return { text: cleanVerseText(parts.join(' ')), stripped: [] };
  return { text, stripped };
}

// Kept for older callers/tests; same behaviour.
export function stripLeadingHeadings(rawText, chapter) {
  return stripHeadings(rawText, chapter);
}

/**
 * bolls marks a combined verse by printing its range at the front of the text
 * ("[20-21] This is the number…", NLT Numbers 1). Turn that into verseEnd so
 * the reader shows "20–21" instead of a stray label and an apparent gap.
 */
export function splitRangeLabel(text, verse) {
  const m = String(text).match(/^\s*\[(\d+)\s*[-–]\s*(\d+)\]\s*/);
  if (!m || Number(m[1]) !== verse || Number(m[2]) <= verse) return { text, verseEnd: undefined };
  return { text: text.slice(m[0].length), verseEnd: Number(m[2]) };
}

// Fetch one chapter, retrying with exponential backoff on throttling (429) and
// transient 5xx/network errors. bolls.life rate-limits sustained scraping, so
// backing off (rather than hammering) is what actually lets a full run finish
// without gaps. Gives up after MAX_RETRIES — that chapter is simply left for a
// resumable re-run to fill.
async function fetchChapter(version, bookId, chapter) {
  const url = `https://bolls.life/get-text/${version}/${bookId}/${chapter}/`;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const backoff = Math.min(2000 * 2 ** attempt, MAX_BACKOFF_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        // Throttled / transient — wait and retry.
        if (attempt < MAX_RETRIES) { await sleep(backoff); continue; }
        throw new Error(`${res.status} ${res.statusText} (retries exhausted)`);
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) { await sleep(backoff); continue; }
    }
  }
  throw lastErr || new Error(`failed: ${url}`);
}

/**
 * Transform a raw bolls.life chapter response into the exact ChapterTextResponse
 * shape getChapterText() returns, so the runtime can use the file verbatim with
 * no parsing/cleaning. (_cachedAt is stamped at fetch time on the client.)
 */
const headingsStripped = [];
export const TEXT_VERSION = 2;

export function toChapterResponse(raw, bookName, chapter, code, displayName) {
  if (!Array.isArray(raw)) return null;
  const verses = raw
    .map((v) => {
      const verse = Number(v.verse);
      const { text: stripped1, stripped } = stripHeadings(v.text || '', verse === 1 ? chapter : undefined);
      if (stripped.length) headingsStripped.push({ ref: `${bookName} ${chapter}:${verse}`, removed: stripped });
      const { text: body, verseEnd } = splitRangeLabel(stripped1, verse);
      const out = { verse, text: tidyVerseText(body) };
      if (verseEnd) out.verseEnd = verseEnd;
      return out;
    })
    .filter((v) => Number.isFinite(v.verse) && v.text.length > 0)
    .sort((a, b) => a.verse - b.verse);
  if (verses.length === 0) return null;
  return {
    reference: `${bookName} ${chapter}`,
    verses,
    translationId: code,
    translationName: displayName,
    textVersion: TEXT_VERSION,
  };
}

function needsFetch(outFile) {
  if (!existsSync(outFile)) return true;
  if (process.env.FORCE === '1') return true;
  if (process.env.REFETCH !== '1') return false;
  try {
    return (JSON.parse(readFileSync(outFile, 'utf8')).textVersion || 1) < TEXT_VERSION;
  } catch {
    return true;
  }
}

async function main() {
  const totalChapters = BOOKS.reduce((sum, b) => sum + b.chapters, 0);
  let fetched = 0;
  let errors = 0;

  // SMOKE=1 fetches only John 3 per selected version and asserts it's real.
  // bolls returns HTTP 200 with an empty array `[]` for versions it doesn't
  // carry, so a missing translation looks like a successful run that quietly
  // writes nothing — this turns that into an immediate, obvious failure.
  if (process.env.SMOKE === '1') {
    for (const ver of VERSIONS) {
      const raw = await fetchChapter(ver.code, 43, 3);
      const shaped = toChapterResponse(raw, 'John', 3, ver.code, ver.name);
      if (!shaped || shaped.verses.length < 5) {
        throw new Error(
          `SMOKE FAILED [${ver.code}]: John 3 returned ` +
          `${Array.isArray(raw) ? raw.length : 'non-array'} entries — bolls.life ` +
          `likely does not carry this version.`
        );
      }
      console.log(`SMOKE OK [${ver.code}]: John 3 -> ${shaped.verses.length} verses; ` +
                  `v1: ${JSON.stringify(shaped.verses[0].text.slice(0, 80))}`);
    }
    return;
  }

  for (const ver of VERSIONS) {
    console.log(`\n📖 Fetching ${ver.name} (${ver.code})...`);
    let verFetched = 0;

    for (const book of BOOKS) {
      for (let ch = 1; ch <= book.chapters; ch++) {
        const outDir = join(PUBLIC_DIR, ver.code, String(book.id));
        const outFile = join(outDir, `${ch}.json`);

        // FORCE=1 re-fetches every chapter; REFETCH=1 re-fetches only files
        // written before the current TEXT_VERSION, so an interrupted re-scrape
        // after a parser change resumes where it stopped.
        if (!needsFetch(outFile)) {
          verFetched++;
          fetched++;
          continue;
        }

        try {
          const raw = await fetchChapter(ver.code, book.id, ch);
          const shaped = toChapterResponse(raw, book.name, ch, ver.code, ver.name);
          if (!shaped) throw new Error('empty/invalid chapter payload');
          // Never save an incomplete chapter: a dropped verse used to ship
          // silently (NCV Numbers 7 had 17 of 89 verses).
          const problems = checkChapter(shaped.verses, book.name, ch);
          if (problems.length) throw new Error(`incomplete: ${problems.join('; ')}`);
          mkdirSync(outDir, { recursive: true });
          writeFileSync(outFile, JSON.stringify(shaped));
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
    if (headingsStripped.length) {
      console.log(`  ${ver.code}: removed ${headingsStripped.length} inline headings/chapter numbers, e.g.`);
      headingsStripped.slice(0, 15).forEach((h) => console.log(`     ${h.ref} -> ${h.removed.join(' | ')}`));
      if (headingsStripped.length > 15) console.log(`     … and ${headingsStripped.length - 15} more`);
      // AUDIT_DIR: write every removal to a file so it can be reviewed in full.
      if (process.env.AUDIT_DIR) {
        mkdirSync(process.env.AUDIT_DIR, { recursive: true });
        writeFileSync(join(process.env.AUDIT_DIR, `headings-removed-${ver.code}.json`),
          JSON.stringify(headingsStripped, null, 1));
      }
      headingsStripped.length = 0;
    }
  }

  console.log(`\n✅ Complete: ${fetched} chapters fetched, ${errors} errors`);
  console.log(`Files saved to: public/bible/`);
  if (errors > 0) {
    console.log(`\n⚠️  ${errors} chapters failed — re-run the script to retry only the missing ones.`);
    process.exitCode = 1;
  }
  console.log(`\nNext steps:`);
  console.log(`  git add public/bible/`);
  console.log(`  git commit -m "Add static Bible text for modern translations"`);
  console.log(`  git push origin main`);
}

// Only run when executed directly. Without this, importing the module for
// tests kicked off a real network scrape.
if (process.argv[1] && process.argv[1].endsWith('fetch-bible-static.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
