/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Is the Bible text the live site serves exactly the text that passed
 * scripts/test-bible-integrity.mts? Run every morning by
 * .github/workflows/daily-bible-check.yml; a failure fails the run, and GitHub
 * emails the failure.
 *
 * The integrity test proves the files in the repo are complete. This proves
 * the phone receives those files: it catches a deploy that did not happen or
 * stopped halfway, a missing file answered with the app's index.html, and a
 * cached copy that is not the current one. Each live chapter is also checked
 * verse by verse on its own.
 *
 * What it reads each morning: every NCV chapter (the translation in daily
 * use), plus a different 1/30 of each other translation, so every chapter of
 * every translation is read at least once a month. FULL=1 reads everything.
 *
 * Run with: npx tsx scripts/check-live-bible.mts
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIBLE_VERSIONS, BOLLS_BIBLE_BOOK_IDS } from '../src/constants';
import { VERSE_COUNTS } from './lib/bible-check.mjs';
import { checkChapterVerses } from '../src/lib/chapterCheck';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'public', 'bible');
const BASE = (process.env.LIVE_BASE || 'https://gen-lang-client-0538747272.web.app').replace(/\/$/, '');
const FULL = process.env.FULL === '1' || process.env.FULL === 'true';
const DAILY = (process.env.DAILY_VERSIONS || 'NCV').split(',').map((s) => s.trim().toUpperCase());
const ROTATION = 30;
const CONCURRENCY = 16;

// The phone requests each file with this query string; ask for the same URL.
const bust = readFileSync(join(HERE, '..', 'src', 'lib', 'chapterText.ts'), 'utf8')
  .match(/STATIC_CACHE_BUST = '([^']+)'/)?.[1];
if (!bust) throw new Error('STATIC_CACHE_BUST not found in src/lib/chapterText.ts');

interface Target { code: string; book: string; chapter: number; file: string; url: string }
const day = Math.floor(Date.now() / 86_400_000);
const targets: Target[] = [];
for (const ver of BIBLE_VERSIONS.filter((v) => v.source === 'bolls')) {
  let i = 0;
  for (const [book, counts] of Object.entries(VERSE_COUNTS.chapters as Record<string, number[]>)) {
    const id = BOLLS_BIBLE_BOOK_IDS[book];
    for (let ch = 1; ch <= counts.length; ch++, i++) {
      if (!FULL && !DAILY.includes(ver.code) && i % ROTATION !== day % ROTATION) continue;
      targets.push({
        code: ver.code, book, chapter: ch,
        file: join(ROOT, ver.code, String(id), `${ch}.json`),
        url: `${BASE}/bible/${ver.code}/${id}/${ch}.json?${bust}`,
      });
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries: one slow or dropped request is not a broken chapter. */
async function fetchText(url: string): Promise<{ status: number; type: string; body: string }> {
  let last: unknown;
  for (const wait of [0, 2000, 6000]) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
      const body = await res.text();
      if (res.status >= 500) { last = new Error(`HTTP ${res.status}`); continue; }
      return { status: res.status, type: res.headers.get('content-type') ?? '', body };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const problems: string[] = [];
async function checkOne(t: Target) {
  const where = `${t.code} ${t.book} ${t.chapter}`;
  if (!existsSync(t.file)) { problems.push(`${where}: not in the repo`); return; }
  let live: { status: number; type: string; body: string };
  try {
    live = await fetchText(t.url);
  } catch (e) {
    problems.push(`${where}: the site did not answer (${e instanceof Error ? e.message : String(e)})`);
    return;
  }
  if (live.status !== 200) { problems.push(`${where}: the site answered HTTP ${live.status}`); return; }
  let data: { reference?: string; verses?: { verse: number; verseEnd?: number; text: string }[] };
  try {
    data = JSON.parse(live.body);
  } catch {
    const page = /<html/i.test(live.body) ? 'a web page instead of the chapter (the file is missing on the site)' : 'something that is not a chapter';
    problems.push(`${where}: the site sent ${page}`);
    return;
  }
  const verses = Array.isArray(data.verses) ? data.verses : [];
  // Same rules as the integrity test (scripts/test-chapter-check.mts proves it).
  const check = checkChapterVerses(verses, t.book, t.chapter);
  if (!check.ok) problems.push(`${where}: the live copy fails the verse check: ${check.problems.join('; ')}`);
  const repo = JSON.parse(readFileSync(t.file, 'utf8'));
  if (JSON.stringify(data) !== JSON.stringify(repo)) {
    const byNumber = (vs: typeof verses) => new Map(vs.map((v) => [v.verse, JSON.stringify(v)]));
    const a = byNumber(repo.verses);
    const b = byNumber(verses);
    const numbers = new Set([...a.keys(), ...b.keys()]);
    const differing = [...numbers].filter((n) => a.get(n) !== b.get(n)).length;
    const what = differing ? `${differing} verse${differing === 1 ? ' differs' : 's differ'}` : 'its details differ';
    problems.push(`${where}: the live copy is not the checked copy (${what}; the site may not have been redeployed since the text changed)`);
  }
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < targets.length) await checkOne(targets[next++]);
}));

const counts = new Map<string, number>();
for (const t of targets) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
const scope = [...counts].map(([code, n]) => `${code} ${n}`).join(', ');
const secs = Math.round((Date.now() - started) / 1000);
const summary: string[] = [];
if (problems.length === 0) {
  summary.push(`## ✅ Bible text check passed`,
    `${targets.length.toLocaleString('en-US')} chapters read from ${BASE} (${scope}) in ${secs}s.`,
    `Every one is complete, in order, and identical to the text that passed the full check.`);
} else {
  summary.push(`## ❌ Bible text check found ${problems.length} problem${problems.length === 1 ? '' : 's'}`,
    `${targets.length.toLocaleString('en-US')} chapters read from ${BASE} (${scope}).`, '',
    ...problems.slice(0, 50).map((p) => `- ${p}`),
    ...(problems.length > 50 ? [`- … and ${problems.length - 50} more`] : []));
}
console.log(summary.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
if (problems.length) {
  for (const p of problems.slice(0, 20)) console.log(`::error title=Bible text::${p}`);
  process.exit(1);
}
