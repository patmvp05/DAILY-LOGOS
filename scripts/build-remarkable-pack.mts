/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build the "7-day pack" — Daily Logos as a single EPUB for a reMarkable.
 *
 * A reMarkable has no web browser, so the interactive app cannot run on it.
 * What ports instead is the *content and the navigation*: for each of the seven
 * reading parts, the next seven chapters from wherever you actually are; plus
 * each day's proverb, that day's devotionals, a page to handwrite notes, and a
 * progress summary. One EPUB, generated fresh each morning, fully offline.
 *
 * Where "wherever you actually are" comes from:
 *   The plan has no date-based schedule — nothing in the repo says "on Aug 14
 *   read Genesis 12". It is seven independent pointers in Firestore at
 *   users/{uid}/progress/{categoryId}, moved by tapping + in the app. So this
 *   script READS Firestore. Deriving a schedule from settings.startDate instead
 *   would diverge the first time you read two chapters in a day, and would then
 *   silently send the wrong chapters forever.
 *
 * The forward walk is ported from src/lib/prefetchBible.ts:32-63, whose own
 * docstring calls the goal "always a week ahead" — same boundary crossing, same
 * guards, with fs.readFileSync in place of the browser's fetch+IndexedDB.
 *
 * Usage:
 *   npx tsx scripts/build-remarkable-pack.mts --from-start        # no creds, no network
 *   npx tsx scripts/build-remarkable-pack.mts                     # reads Firestore
 *
 * Flags:
 *   --from-start        start every part at chapter 1 instead of reading Firestore
 *   --date YYYY-MM-DD   first day of the pack (default: today, local time)
 *   --days N            days to include (default 7)
 *   --version CODE      translation directory under public/bible (default NCV)
 *   --out DIR           output directory (default dist-remarkable)
 *
 * Environment (omit --from-start):
 *   FIREBASE_SERVICE_ACCOUNT  service-account JSON
 *   DAILY_LOGOS_UID           the Firebase UID whose progress to read
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, format, parseISO, isValid } from 'date-fns';

import { CATEGORIES, CATEGORIES_BY_ID, BOLLS_BIBLE_BOOK_IDS } from '../src/constants';
import { computeProgressStats } from '../src/lib/utils';
import { INTERNAL_DEVOTIONALS } from '../src/lib/devotionalCatalog';
import type { Progress } from '../src/types';
import type { DevotionalContent } from '../src/lib/devotionalContent';
import { buildEpub, validateEpub, escapeXml, xhtmlDocument, type EpubSection } from './lib/epub.mts';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const BIBLE_DIR = join(REPO_ROOT, 'public', 'bible');
const DEVOTIONAL_DIR = join(REPO_ROOT, 'public', 'devotionals');

/** The app's rule for "today's proverb": chapter = day of the month. */
const PROVERBS_BOOK = 'Proverbs';

// ─────────────────────────────────────────────────────────────── CLI

interface Options {
  fromStart: boolean;
  startDate: Date;
  days: number;
  version: string;
  outDir: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    fromStart: false,
    startDate: new Date(),
    days: 7,
    version: 'NCV',
    outDir: join(REPO_ROOT, 'dist-remarkable'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--from-start': opts.fromStart = true; break;
      case '--date': {
        const raw = next();
        const d = parseISO(raw);
        if (!isValid(d)) throw new Error(`--date "${raw}" is not YYYY-MM-DD`);
        opts.startDate = d;
        break;
      }
      case '--days': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1 || n > 31) throw new Error('--days must be 1..31');
        opts.days = n;
        break;
      }
      case '--version': opts.version = next().toUpperCase(); break;
      case '--out': opts.outDir = next(); break;
      default: throw new Error(`unknown argument "${arg}"`);
    }
  }
  return opts;
}

// ─────────────────────────────────────────────────── Reading progress

/**
 * The seven pointers, from Firestore.
 *
 * firebase-admin is imported dynamically so --from-start (and the offline test)
 * never pay for loading it, and so a missing credential fails here with a clear
 * message rather than at import time.
 */
async function readProgressFromFirestore(): Promise<{
  progress: Progress[];
  completedBooks: Set<string>;
}> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const uid = process.env.DAILY_LOGOS_UID;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set (or pass --from-start)');
  if (!uid) throw new Error('DAILY_LOGOS_UID is not set (or pass --from-start)');

  let credentials: { project_id?: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  // The app does not use the (default) database — see firestoreDatabaseId in
  // firebase-applet-config.json. Reading (default) would silently return zero
  // documents, which would look exactly like "you have not started reading".
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, 'firebase-applet-config.json'), 'utf8')
  ) as { firestoreDatabaseId?: string; projectId?: string };
  const databaseId = config.firestoreDatabaseId;
  if (!databaseId) throw new Error('firebase-applet-config.json has no firestoreDatabaseId');

  const app = initializeApp({
    credential: cert(credentials as Parameters<typeof cert>[0]),
    projectId: config.projectId ?? credentials.project_id,
  });
  const db = getFirestore(app, databaseId);

  const [progressSnap, completedSnap] = await Promise.all([
    db.collection(`users/${uid}/progress`).get(),
    db.collection(`users/${uid}/completedBooks`).get(),
  ]);

  const progress: Progress[] = progressSnap.docs.map((d) => {
    const data = d.data() as Partial<Progress>;
    return {
      categoryId: data.categoryId ?? d.id,
      bookIndex: typeof data.bookIndex === 'number' ? data.bookIndex : 0,
      chapter: typeof data.chapter === 'number' ? data.chapter : 1,
      lastReadAt: data.lastReadAt,
    };
  });

  const completedBooks = new Set<string>();
  for (const d of completedSnap.docs) {
    const data = d.data() as { categoryId?: string; bookName?: string };
    if (data.categoryId && data.bookName) completedBooks.add(`${data.categoryId}:${data.bookName}`);
  }

  if (progress.length === 0) {
    throw new Error(
      `no progress documents at users/${uid}/progress — check DAILY_LOGOS_UID, ` +
      'or pass --from-start to build from chapter 1 deliberately'
    );
  }
  return { progress, completedBooks };
}

/** Every part at its first chapter. Only ever reached via an explicit flag. */
function progressFromStart(): Progress[] {
  return CATEGORIES.map((c) => ({ categoryId: c.id, bookIndex: 0, chapter: 1 }));
}

/**
 * Fill in any part Firestore has no document for. A brand-new part (or a doc
 * that never got written) should read from its beginning, not be dropped from
 * the pack — a missing section is far more confusing than a section starting at
 * chapter 1.
 */
function completeProgress(progress: Progress[]): Progress[] {
  const byId = new Map(progress.map((p) => [p.categoryId, p]));
  return CATEGORIES.map(
    (c) => byId.get(c.id) ?? { categoryId: c.id, bookIndex: 0, chapter: 1 }
  );
}

// ───────────────────────────────────────────── Chapter enumeration

interface ChapterRef {
  categoryId: string;
  bookIndex: number;
  bookName: string;
  chapter: number;
}

/**
 * Walk forward `count` chapters from a pointer, crossing book boundaries.
 *
 * Ported verbatim in behaviour from src/lib/prefetchBible.ts:32-63 — including
 * the out-of-range chapter guard and stopping at the end of a part rather than
 * spilling into the next one. Returns fewer than `count` only when the part runs
 * out (e.g. you are in Revelation 20) or the pointer is corrupt.
 */
export function walkChapters(prog: Progress, count: number): ChapterRef[] {
  const category = CATEGORIES_BY_ID.get(prog.categoryId);
  if (!category) return [];

  const out: ChapterRef[] = [];
  let bookIdx = prog.bookIndex;
  let chapter = prog.chapter;
  let remaining = count;

  while (remaining > 0 && bookIdx >= 0 && bookIdx < category.books.length) {
    const book = category.books[bookIdx];
    if (!book) break;

    // Guard against an out-of-range stored chapter.
    if (chapter < 1 || chapter > book.chapters) break;

    out.push({ categoryId: category.id, bookIndex: bookIdx, bookName: book.name, chapter });
    remaining--;

    // Advance to the next chapter, rolling into the next book at a boundary.
    if (chapter < book.chapters) {
      chapter++;
    } else if (bookIdx < category.books.length - 1) {
      bookIdx++;
      chapter = 1;
    } else {
      break; // end of the part — nothing more to include
    }
  }
  return out;
}

// ──────────────────────────────────────────────────── Reading content

interface ChapterText {
  reference: string;
  verses: { verse: number; text: string }[];
  translationName?: string;
}

export function chapterPath(bookName: string, chapter: number, version: string): string {
  const bookId = BOLLS_BIBLE_BOOK_IDS[bookName];
  if (!bookId) throw new Error(`no book id for "${bookName}"`);
  return join(BIBLE_DIR, version, String(bookId), `${chapter}.json`);
}

export function readChapter(bookName: string, chapter: number, version: string): ChapterText {
  const path = chapterPath(bookName, chapter, version);
  const data = JSON.parse(readFileSync(path, 'utf8')) as ChapterText;
  if (!Array.isArray(data.verses) || data.verses.length === 0) {
    throw new Error(`${path} has no verses`);
  }
  return data;
}

/** A day's devotional, or null when that day is not on disk. */
export function readDevotional(slug: string, monthDay: string): DevotionalContent | null {
  try {
    return JSON.parse(
      readFileSync(join(DEVOTIONAL_DIR, slug, `${monthDay}.json`), 'utf8')
    ) as DevotionalContent;
  } catch {
    // A gap in an archive must skip that entry, never abort the pack. Insight
    // for Living is a rolling window of RECENT days, so a forward-looking pack
    // structurally has none of it — that has to degrade quietly.
    return null;
  }
}

// ────────────────────────────────────────────────────────── Rendering

/**
 * E-ink stylesheet.
 *
 * Sizes are all relative so the device's own font-size / margin / line-height
 * controls still work — an EPUB that hard-codes px fights the reader instead of
 * cooperating with it. Text is pure black on white; grey appears only on hairline
 * rules, never on anything you have to read.
 */
const CSS = `@charset "utf-8";

body {
  font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
  color: #000;
  background: #fff;
  line-height: 1.5;
  margin: 0;
  text-align: left;
  widows: 2;
  orphans: 2;
}

h1, h2, h3, .eyebrow, .daylabel, nav ol {
  font-family: "Inter", Helvetica, Arial, sans-serif;
}

/* No page-break rules and no page padding on purpose. Every section is its own
   spine document, so the reader already starts each one on a fresh page, and
   margins are a device setting the reader owns — an EPUB that hard-codes them
   fights the user's own margin control instead of cooperating with it. */

h1 { font-size: 1.5em; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.15em; }
h2 { font-size: 1.15em; font-weight: 700; margin: 1.6em 0 0.5em; }

.eyebrow {
  font-size: 0.68em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  margin: 0 0 0.9em;
}

.subtle { color: #444; }

.rule-top { border-top: 1px solid #000; margin: 0.9em 0 1.4em; }

/* ── Scripture */
.verse { margin: 0 0 0.5em; text-indent: 0; }
.vn {
  font-family: "Inter", Helvetica, Arial, sans-serif;
  font-size: 0.62em;
  font-weight: 700;
  vertical-align: super;
  line-height: 0;
  margin-right: 0.35em;
}

blockquote {
  margin: 1.2em 0;
  padding: 0 0 0 1em;
  border-left: 2px solid #000;
  font-style: italic;
}
blockquote p { margin: 0 0 0.4em; }
cite { display: block; font-style: normal; font-weight: 700; font-size: 0.85em; }

/* ── Index / day pages */
ul.readings { list-style: none; margin: 0; padding: 0; }
ul.readings li {
  margin: 0;
  padding: 0.62em 0;
  border-bottom: 1px solid #999;
}
ul.readings a { color: #000; text-decoration: none; font-weight: 700; }
.part {
  display: block;
  font-family: "Inter", Helvetica, Arial, sans-serif;
  font-size: 0.62em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #444;
  margin-bottom: 0.15em;
}

.daylabel {
  font-size: 0.72em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin: 0 0 0.3em;
}

/* ── Progress bars. Plain block elements with a border rather than a <table>:
   reMarkable's reader is closed-source and table layout is the first thing a
   cut-down renderer gets wrong, while a bordered div is about as basic as CSS
   gets. */
.stat { display: block; font-weight: 700; }
.bar { height: 0.5em; border: 1px solid #000; margin-top: 0.45em; }
.bar div { height: 100%; background: #000; }

/* ── Handwriting pages */
.rule-line { border-bottom: 1px solid #999; height: 2.1em; }
`;

const sectionPage = xhtmlDocument;

function renderChapter(day: DayPlan, ref: ChapterRef, text: ChapterText): string {
  const category = CATEGORIES_BY_ID.get(ref.categoryId)!;
  const last = text.verses[text.verses.length - 1].verse;
  const verses = text.verses
    .map((v) => `<p class="verse"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`)
    .join('\n');

  return sectionPage(
    `${ref.bookName} ${ref.chapter}`,
    `<p class="eyebrow">${escapeXml(category.name)} &#183; Day ${day.index + 1}</p>
<h1>${escapeXml(ref.bookName)} ${ref.chapter}</h1>
<p class="daylabel subtle">Verses 1&#8211;${last}</p>
<div class="rule-top"></div>
${verses}`
  );
}

function renderProverb(day: DayPlan, text: ChapterText): string {
  const last = text.verses[text.verses.length - 1].verse;
  const verses = text.verses
    .map((v) => `<p class="verse"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`)
    .join('\n');

  return sectionPage(
    `Proverbs ${day.proverbChapter}`,
    `<p class="eyebrow">Daily Proverb &#183; Day ${day.index + 1}</p>
<h1>Proverbs ${day.proverbChapter}</h1>
<p class="daylabel subtle">${escapeXml(day.longLabel)} &#183; Verses 1&#8211;${last}</p>
<div class="rule-top"></div>
${verses}`
  );
}

function renderDevotional(
  day: DayPlan,
  name: string,
  author: string,
  content: DevotionalContent
): string {
  const entries = content.entries
    .map((entry) => {
      const parts: string[] = [];
      if (entry.period) {
        parts.push(`<h2>${entry.period === 'morning' ? 'Morning' : 'Evening'}</h2>`);
      }
      if (entry.scripture) {
        parts.push(
          `<blockquote><p>&#8220;${escapeXml(entry.scripture)}&#8221;</p>${
            entry.reference ? `<cite>&#8212; ${escapeXml(entry.reference)}</cite>` : ''
          }</blockquote>`
        );
      }
      for (const p of entry.body) parts.push(`<p>${escapeXml(p)}</p>`);
      return parts.join('\n');
    })
    .join('\n');

  return sectionPage(
    name,
    `<p class="eyebrow">Devotional &#183; Day ${day.index + 1}</p>
<h1>${escapeXml(content.title || name)}</h1>
<p class="daylabel subtle">${escapeXml(name)} &#183; ${escapeXml(author)}</p>
<div class="rule-top"></div>
${entries}`
  );
}

/** Ruled page for handwriting — the reason the pack is a document, not a webpage. */
function renderNotes(day: DayPlan, lines = 26): string {
  // The &#160; matters: an empty block relies on the CSS `height` alone, and if
  // reMarkable's renderer drops that the page collapses to nothing. A non-
  // breaking space guarantees a line box either way.
  const rules = Array.from({ length: lines }, () => '<div class="rule-line">&#160;</div>').join('\n');
  return sectionPage(
    `Notes — Day ${day.index + 1}`,
    `<p class="eyebrow">Notes &#183; Day ${day.index + 1}</p>
<h1>${escapeXml(day.longLabel)}</h1>
<div class="rule-top"></div>
${rules}`
  );
}

function renderDayIndex(day: DayPlan): string {
  const items = day.entries
    .map(
      (e) =>
        `<li><a href="${e.id}.xhtml"><span class="part">${escapeXml(e.part)}</span>${escapeXml(
          e.label
        )}</a></li>`
    )
    .join('\n');

  return sectionPage(
    day.shortLabel,
    `<p class="eyebrow">Day ${day.index + 1} of ${day.total}</p>
<h1>${escapeXml(day.longLabel)}</h1>
<div class="rule-top"></div>
<ul class="readings">
${items}
</ul>`
  );
}

function renderCover(title: string, subtitle: string, version: string): string {
  return sectionPage(
    title,
    `<p class="eyebrow">Daily Logos</p>
<h1>${escapeXml(title)}</h1>
<p class="daylabel subtle">${escapeXml(subtitle)}</p>
<div class="rule-top"></div>
<p>One chapter from each part of Scripture, every day for the week ahead &#8212;
picked up from exactly where you left off in the app.</p>
<p class="subtle">Scripture in the ${escapeXml(version)}. Read it here, then tap it in
Daily Logos to record it: this pack is a copy, not the tracker.</p>`
  );
}

function renderWeekIndex(days: DayPlan[]): string {
  const today = days[0];
  const todayItems = today.entries
    .map(
      (e) =>
        `<li><a href="${e.id}.xhtml"><span class="part">${escapeXml(e.part)}</span>${escapeXml(
          e.label
        )}</a></li>`
    )
    .join('\n');

  const rest = days
    .slice(1)
    .map(
      (d) =>
        `<li><a href="${d.id}.xhtml"><span class="part">Day ${d.index + 1} &#183; ${escapeXml(
          d.shortLabel
        )}</span>${escapeXml(d.summary)}</a></li>`
    )
    .join('\n');

  return sectionPage(
    'This Week',
    `<p class="eyebrow">Today &#183; ${escapeXml(today.shortLabel)}</p>
<h1>${escapeXml(today.longLabel)}</h1>
<div class="rule-top"></div>
<ul class="readings">
${todayItems}
</ul>
<h2>The rest of the week</h2>
<ul class="readings">
${rest}
</ul>`
  );
}

function renderProgress(progress: Progress[], completedBooks: Set<string>): string {
  const stats = computeProgressStats(progress, completedBooks);
  const rows = CATEGORIES.map((c) => {
    const s = stats.catProgress[c.id];
    const prog = progress.find((p) => p.categoryId === c.id);
    const book = prog ? c.books[prog.bookIndex] : undefined;
    const at = book ? escapeXml(`${book.name} ${prog!.chapter}`) : '&#8212;';
    return `<li>
<span class="part">${escapeXml(c.name)} &#183; up to ${at}</span>
<span class="stat">${s.chaptersRead} of ${s.totalChapters} chapters &#183; ${s.pct.toFixed(1)}%</span>
<div class="bar"><div style="width:${Math.round(s.pct)}%"></div></div>
</li>`;
  }).join('\n');

  return sectionPage(
    'Progress',
    `<p class="eyebrow">Progress</p>
<h1>${stats.totalRead} of ${stats.totalChaptersCount} chapters</h1>
<p class="daylabel subtle">${stats.overallProgress.toFixed(1)}% of the Bible</p>
<div class="rule-top"></div>
<ul class="readings">
${rows}
</ul>
<p class="subtle">Counts finished books plus the chapters read in each part&#8217;s
current book. Skipped-over books are deliberately not counted &#8212; the same rule
the app uses.</p>`
  );
}

// ─────────────────────────────────────────────────────────── Assembly

interface DayEntry {
  /** Section id, which is also the xhtml filename base. */
  id: string;
  /** Uppercase eyebrow, e.g. "The Law" or "Devotional". */
  part: string;
  /** Nav / list label, e.g. "Genesis 12". */
  label: string;
}

interface DayPlan {
  id: string;
  index: number;
  total: number;
  date: Date;
  /** 'MM-dd', the devotional archive key. */
  monthDay: string;
  proverbChapter: number;
  shortLabel: string;
  longLabel: string;
  summary: string;
  entries: DayEntry[];
}

export interface PackResult {
  epub: Buffer;
  filename: string;
  /** Bible chapters included, excluding the daily proverbs. */
  chapterCount: number;
  /** What the walk says must be there — computed independently of assembly. */
  expectedChapterCount: number;
  proverbCount: number;
  devotionalCount: number;
  missingDevotionals: string[];
  sectionCount: number;
}

export async function buildPack(
  progress: Progress[],
  completedBooks: Set<string>,
  opts: Pick<Options, 'startDate' | 'days' | 'version'>
): Promise<PackResult> {
  const filled = completeProgress(progress);

  // The plan for each part: opts.days chapters forward from its pointer.
  const walks = new Map<string, ChapterRef[]>();
  for (const p of filled) walks.set(p.categoryId, walkChapters(p, opts.days));
  const expectedChapterCount = [...walks.values()].reduce((n, refs) => n + refs.length, 0);

  const dateStr = format(opts.startDate, 'yyyy-MM-dd');
  const days: DayPlan[] = [];
  const sections: EpubSection[] = [];
  const missingDevotionals = new Set<string>();
  let chapterCount = 0;
  let proverbCount = 0;
  let devotionalCount = 0;

  // Pass 1: lay out each day and render its content sections. The day index page
  // needs the ids of everything in the day, so it is rendered in pass 2.
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.startDate, i);
    const day: DayPlan = {
      id: `day${i + 1}`,
      index: i,
      total: opts.days,
      date,
      monthDay: format(date, 'MM-dd'),
      proverbChapter: date.getDate(),
      shortLabel: format(date, 'EEE, MMM d'),
      longLabel: format(date, 'EEEE, MMMM d'),
      summary: '',
      entries: [],
    };

    const dayChapterSections: EpubSection[] = [];

    for (const category of CATEGORIES) {
      const ref = walks.get(category.id)![i];
      if (!ref) continue; // this part ran out before the end of the week
      const id = `d${i + 1}-${category.id}`;
      const text = readChapter(ref.bookName, ref.chapter, opts.version);
      dayChapterSections.push({
        id,
        title: `${ref.bookName} ${ref.chapter}`,
        xhtml: renderChapter(day, ref, text),
        navLevel: 2,
      });
      day.entries.push({ id, part: category.name, label: `${ref.bookName} ${ref.chapter}` });
      chapterCount++;
    }

    // Daily proverb — same rule as the app: chapter = day of the month.
    const proverbId = `d${i + 1}-proverb`;
    const proverbText = readChapter(PROVERBS_BOOK, day.proverbChapter, opts.version);
    dayChapterSections.push({
      id: proverbId,
      title: `Proverbs ${day.proverbChapter}`,
      xhtml: renderProverb(day, proverbText),
      navLevel: 2,
    });
    day.entries.push({
      id: proverbId,
      part: 'Daily Proverb',
      label: `Proverbs ${day.proverbChapter}`,
    });
    proverbCount++;

    for (const dev of INTERNAL_DEVOTIONALS) {
      const content = readDevotional(dev.slug, day.monthDay);
      if (!content) { missingDevotionals.add(dev.slug); continue; }
      const id = `d${i + 1}-dev-${dev.slug}`;
      dayChapterSections.push({
        id,
        title: dev.name,
        xhtml: renderDevotional(day, dev.name, dev.author, content),
        navLevel: 2,
      });
      day.entries.push({ id, part: 'Devotional', label: dev.name });
      devotionalCount++;
    }

    const notesId = `d${i + 1}-notes`;
    dayChapterSections.push({
      id: notesId,
      title: 'Notes',
      xhtml: renderNotes(day),
      navLevel: 2,
    });
    day.entries.push({ id: notesId, part: 'Notes', label: 'Write' });

    day.summary = day.entries
      .filter((e) => e.part !== 'Notes' && e.part !== 'Devotional')
      .map((e) => e.label)
      .join(', ');

    days.push(day);
    // The day index page precedes its content in the spine.
    sections.push({
      id: day.id,
      title: `Day ${i + 1} · ${day.shortLabel}`,
      xhtml: '', // filled in below, once entries are known
      navLevel: 1,
    });
    sections.push(...dayChapterSections);
  }

  // Pass 2: the day index pages.
  for (const day of days) {
    const slot = sections.find((s) => s.id === day.id)!;
    slot.xhtml = renderDayIndex(day);
  }

  const title = `Daily Logos — Week of ${format(opts.startDate, 'MMMM d, yyyy')}`;
  const front: EpubSection[] = [
    {
      id: 'cover',
      title: 'Daily Logos',
      xhtml: renderCover(title, `${days.length} days from ${format(opts.startDate, 'EEEE, MMMM d')}`, opts.version),
      navLevel: 1,
    },
    {
      id: 'week',
      title: 'This Week',
      xhtml: renderWeekIndex(days),
      navLevel: 1,
    },
    {
      id: 'progress',
      title: 'Progress',
      xhtml: renderProgress(filled, completedBooks),
      navLevel: 1,
    },
  ];

  const allSections = [...front, ...sections];
  const epub = await buildEpub({
    title,
    author: 'Daily Logos',
    identifier: `urn:daily-logos:pack:${dateStr}`,
    // Derived from the pack's date, never from the clock, so the same --date
    // always produces the same bytes.
    modified: `${dateStr}T00:00:00Z`,
    css: CSS,
    sections: allSections,
  });

  return {
    epub,
    filename: `daily-logos-${dateStr}.epub`,
    chapterCount,
    expectedChapterCount,
    proverbCount,
    devotionalCount,
    missingDevotionals: [...missingDevotionals].sort(),
    sectionCount: allSections.length,
  };
}

// ─────────────────────────────────────────────────────────────── main

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let progress: Progress[];
  let completedBooks: Set<string>;
  if (opts.fromStart) {
    console.log('[pack] --from-start: every part begins at chapter 1 (no Firestore read)');
    progress = progressFromStart();
    completedBooks = new Set();
  } else {
    const read = await readProgressFromFirestore();
    progress = read.progress;
    completedBooks = read.completedBooks;
    console.log(`[pack] read ${progress.length} progress pointers, ${completedBooks.size} completed books`);
  }

  const result = await buildPack(progress, completedBooks, opts);

  // Self-check before anything can be uploaded. The expected count comes from
  // the walk, not from a hard-coded 49, so finishing a part is not a failure.
  const problems = await validateEpub(result.epub);
  if (result.chapterCount !== result.expectedChapterCount) {
    problems.push(
      `assembled ${result.chapterCount} chapters, the walk expected ${result.expectedChapterCount}`
    );
  }
  if (problems.length > 0) {
    console.error('[pack] REFUSING TO WRITE — the pack is not valid:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  mkdirSync(opts.outDir, { recursive: true });
  const outPath = join(opts.outDir, result.filename);
  writeFileSync(outPath, result.epub);

  console.log(`[pack] ${outPath}`);
  console.log(`[pack] chapters=${result.chapterCount} proverbs=${result.proverbCount} devotionals=${result.devotionalCount} sections=${result.sectionCount} bytes=${result.epub.length}`);
  for (const cat of CATEGORIES) {
    const p = completeProgress(progress).find((x) => x.categoryId === cat.id)!;
    const refs = walkChapters(p, opts.days);
    const span = refs.length
      ? `${refs[0].bookName} ${refs[0].chapter} → ${refs[refs.length - 1].bookName} ${refs[refs.length - 1].chapter}`
      : '(complete)';
    console.log(`[pack]   ${cat.name.padEnd(10)} ${refs.length} chapters  ${span}`);
  }
  if (result.missingDevotionals.length > 0) {
    console.log(
      `[pack] no future days on disk for: ${result.missingDevotionals.join(', ')} ` +
      '(expected for insight-for-living, which is a rolling window of recent days)'
    );
  }

  // Machine-readable summary for the workflow log / artifacts.
  writeFileSync(
    join(opts.outDir, 'pack-summary.json'),
    JSON.stringify(
      {
        filename: result.filename,
        bytes: result.epub.length,
        chapters: result.chapterCount,
        proverbs: result.proverbCount,
        devotionals: result.devotionalCount,
        sections: result.sectionCount,
        missingDevotionals: result.missingDevotionals,
      },
      null,
      2
    ) + '\n'
  );
}

// Only run when executed directly — the test imports this module.
if (process.argv[1] && /build-remarkable-pack\.mts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`[pack] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
