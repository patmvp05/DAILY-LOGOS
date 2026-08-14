/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline tests for the reMarkable 7-day pack.
 *
 * Everything here runs against the committed static Bible/devotional files with
 * no credentials and no network, because the daily job has no human watching it:
 * if the pack is wrong, the first sign is a bad morning read. So the things
 * tested are the things that would fail silently — a chapter landing on the
 * wrong day, a walk that skips a book boundary, a nav link that goes nowhere,
 * a mimetype entry that got compressed and made the whole file unopenable.
 *
 * Run with: npx tsx scripts/test-remarkable-pack.mts
 */
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { addDays, format } from 'date-fns';

import { CATEGORIES, CATEGORIES_BY_ID } from '../src/constants';
import type { Progress } from '../src/types';
import {
  walkChapters,
  chapterPath,
  readChapter,
  readDevotional,
  buildPack,
} from './build-remarkable-pack.mts';
import { buildEpub, validateEpub, escapeXml, xhtmlDocument } from './lib/epub.mts';
import { selectStalePacks } from './upload-remarkable.mts';

const VERSION = 'NCV';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

const at = (categoryId: string, bookIndex: number, chapter: number): Progress =>
  ({ categoryId, bookIndex, chapter });

// ─────────────────────────────────────────────── The forward walk

{
  for (const cat of CATEGORIES) {
    const refs = walkChapters(at(cat.id, 0, 1), 7);
    eq(`${cat.id}: 7 chapters from the start`, refs.length, 7);
    ok(`${cat.id}: starts at the pointer`,
       refs[0].bookName === cat.books[0].name && refs[0].chapter === 1);
  }

  // Crossing a book boundary mid-walk — Genesis has 50 chapters, so a pointer at
  // 48 must roll into Exodus 1 rather than asking for "Genesis 51".
  const cross = walkChapters(at('law', 0, 48), 7);
  eq('law: 7 chapters spanning Genesis→Exodus', cross.length, 7);
  ok('law: rolls into Exodus 1 after Genesis 50',
     cross.map((r) => `${r.bookName} ${r.chapter}`).join(', ') ===
     'Genesis 48, Genesis 49, Genesis 50, Exodus 1, Exodus 2, Exodus 3, Exodus 4',
     cross.map((r) => `${r.bookName} ${r.chapter}`).join(', '));

  // Crossing two boundaries in one week: Obadiah and Jonah are 1 and 4 chapters.
  const prophecy = CATEGORIES_BY_ID.get('prophecy')!;
  const obadiah = prophecy.books.findIndex((b) => b.name === 'Obadiah');
  const tiny = walkChapters(at('prophecy', obadiah, 1), 7);
  ok('prophecy: crosses two boundaries (Obadiah→Jonah→Micah)',
     tiny.map((r) => `${r.bookName} ${r.chapter}`).join(', ') ===
     'Obadiah 1, Jonah 1, Jonah 2, Jonah 3, Jonah 4, Micah 1, Micah 2',
     tiny.map((r) => `${r.bookName} ${r.chapter}`).join(', '));

  // At the end of a part the walk must STOP, not spill into the next part.
  const lastIdx = prophecy.books.length - 1;
  const tail = walkChapters(at('prophecy', lastIdx, 20), 7);
  eq('prophecy: stops at the end of Revelation', tail.length, 3);
  ok('prophecy: last chapter is Revelation 22',
     tail[tail.length - 1].bookName === 'Revelation' && tail[tail.length - 1].chapter === 22);

  const psalmsTail = walkChapters(at('psalms', 0, 149), 7);
  eq('psalms: single-book part stops at 150', psalmsTail.length, 2);

  // Corrupt pointers must produce nothing rather than a wrong reading.
  eq('chapter 0 yields nothing', walkChapters(at('law', 0, 0), 7).length, 0);
  eq('chapter past the end yields nothing', walkChapters(at('law', 0, 51), 7).length, 0);
  eq('negative bookIndex yields nothing', walkChapters(at('law', -1, 1), 7).length, 0);
  eq('bookIndex past the end yields nothing', walkChapters(at('law', 99, 1), 7).length, 0);
  eq('unknown category yields nothing', walkChapters(at('nope', 0, 1), 7).length, 0);

  // The walk never invents a chapter a book does not have.
  let overrun = 0;
  let checked = 0;
  for (const cat of CATEGORIES) {
    for (let b = 0; b < cat.books.length; b++) {
      for (const start of [1, cat.books[b].chapters]) {
        for (const ref of walkChapters(at(cat.id, b, start), 7)) {
          checked++;
          const book = CATEGORIES_BY_ID.get(ref.categoryId)!.books[ref.bookIndex];
          if (ref.chapter < 1 || ref.chapter > book.chapters) overrun++;
        }
      }
    }
  }
  ok(`no walk overruns a book (${checked} refs checked)`, overrun === 0, `${overrun} bad refs`);
}

// ────────────────────────────── Every enumerated chapter exists on disk

{
  let missing: string[] = [];
  for (const cat of CATEGORIES) {
    for (let b = 0; b < cat.books.length; b++) {
      for (const start of [1, cat.books[b].chapters]) {
        for (const ref of walkChapters(at(cat.id, b, start), 7)) {
          const p = chapterPath(ref.bookName, ref.chapter, VERSION);
          if (!existsSync(p)) missing.push(`${ref.bookName} ${ref.chapter}`);
        }
      }
    }
  }
  ok(`every walked chapter has an ${VERSION} file`, missing.length === 0,
     missing.slice(0, 5).join(', '));

  // The daily proverb is chapter = day of month, so all 31 must exist.
  missing = [];
  for (let c = 1; c <= 31; c++) {
    if (!existsSync(chapterPath('Proverbs', c, VERSION))) missing.push(`Proverbs ${c}`);
  }
  ok('all 31 Proverbs chapters exist', missing.length === 0, missing.join(', '));

  const gen1 = readChapter('Genesis', 1, VERSION);
  eq('Genesis 1 has 31 verses', gen1.verses.length, 31);
  ok('Genesis 1:1 is the NCV wording', gen1.verses[0].text.startsWith('In the beginning God created'),
     gen1.verses[0].text.slice(0, 40));
}

// ────────────────────────────────── Devotionals degrade gracefully

{
  ok('a real devotional day loads', readDevotional('my-utmost', '08-14') !== null);
  ok('a missing devotional day returns null, not a throw',
     readDevotional('my-utmost', '99-99') === null);
  ok('a missing devotional archive returns null',
     readDevotional('no-such-devotional', '08-14') === null);
}

// ──────────────────────────────────────── The pack itself, end to end

const START = new Date(2026, 7, 14); // 2026-08-14, a Friday
const fromStart: Progress[] = CATEGORIES.map((c) => ({ categoryId: c.id, bookIndex: 0, chapter: 1 }));

{
  const packOpts = { startDate: START, days: 7, version: VERSION };
  const result = await buildPack(fromStart, new Set(), packOpts);

  eq('49 chapters (7 parts × 7 days)', result.chapterCount, 49);
  eq('assembled count matches the walk', result.chapterCount, result.expectedChapterCount);
  eq('7 daily proverbs', result.proverbCount, 7);
  ok('devotionals present for the week', result.devotionalCount >= 14,
     `only ${result.devotionalCount}`);
  ok('insight-for-living is reported missing, not silently dropped',
     result.missingDevotionals.includes('insight-for-living'),
     result.missingDevotionals.join(', '));
  eq('filename is dated', result.filename, 'daily-logos-2026-08-14.epub');

  const problems = await validateEpub(result.epub);
  ok('the built EPUB is structurally valid', problems.length === 0, problems.join('; '));

  // Byte-for-byte reproducible: a daily job whose output churned would be
  // impossible to diff, and every rebuild would look like a real change.
  const again = await buildPack(fromStart, new Set(), packOpts);
  ok('same inputs produce identical bytes', result.epub.equals(again.epub),
     `${result.epub.length} vs ${again.epub.length} bytes`);

  // ── The readings actually land on the right day.
  const zip = await JSZip.loadAsync(result.epub);
  const read = async (p: string) => {
    const f = zip.file(`OEBPS/${p}`);
    return f ? f.async('string') : null;
  };

  let wrongDay = 0;
  for (const cat of CATEGORIES) {
    const refs = walkChapters(at(cat.id, 0, 1), 7);
    for (let d = 0; d < 7; d++) {
      const html = await read(`d${d + 1}-${cat.id}.xhtml`);
      const want = `<title>${refs[d].bookName} ${refs[d].chapter}</title>`;
      if (!html || !html.includes(want)) wrongDay++;
    }
  }
  eq('every chapter is on its correct day', wrongDay, 0);

  // ── The proverb follows the day of the month, including across a rollover.
  let wrongProverb = 0;
  for (let d = 0; d < 7; d++) {
    const date = addDays(START, d);
    const html = await read(`d${d + 1}-proverb.xhtml`);
    if (!html || !html.includes(`<title>Proverbs ${date.getDate()}</title>`)) wrongProverb++;
  }
  eq('every daily proverb matches the day of the month', wrongProverb, 0);

  // ── Contents the user asked for are all really there.
  ok('note pages are present', (await read('d1-notes.xhtml'))?.includes('rule-line') === true);
  ok('all 7 note pages are present',
     (await Promise.all([1, 2, 3, 4, 5, 6, 7].map((d) => read(`d${d}-notes.xhtml`))))
       .every((h) => h?.includes('rule-line')));
  ok('the progress page is present',
     (await read('progress.xhtml'))?.includes('of 1189 chapters') === true);
  ok('the week index links to today', (await read('week.xhtml'))?.includes('d1-law.xhtml') === true);
  ok('scripture text made it in',
     (await read('d1-law.xhtml'))?.includes('In the beginning God created') === true);
  ok('a devotional made it in',
     (await read('d1-dev-my-utmost.xhtml'))?.includes('Oswald Chambers') === true);
}

// ───────────────────────── Real pointers mid-Bible, and a month rollover

{
  // Late in several parts at once, so the pack has to cross book boundaries in
  // the same run that it rolls over into a new month.
  const mid: Progress[] = [
    at('law', 0, 48),        // Genesis 48 → Exodus 4
    at('history', 2, 3),     // Ruth 3 → 1 Samuel 5
    at('gospels', 3, 20),    // John 20 → Acts 5
    at('wisdom', 1, 30),     // Proverbs 30 → Ecclesiastes 5
    at('epistles', 19, 1),   // 3 John 1 → Jude 1 (part nearly finished)
    at('prophecy', 17, 20),  // Revelation 20 → end of the part
    at('psalms', 0, 149),    // Psalms 149 → end of the part
  ];
  const completed = new Set(['law:Genesis', 'psalms:Psalms']);
  const start = new Date(2026, 7, 29); // spans 29,30,31 Aug then 1,2,3,4 Sept
  const result = await buildPack(mid, completed, { startDate: start, days: 7, version: VERSION });

  eq('mid-Bible: assembled count matches the walk',
     result.chapterCount, result.expectedChapterCount);
  ok('mid-Bible: finished parts shrink the pack rather than failing',
     result.chapterCount < 49 && result.chapterCount > 30, String(result.chapterCount));
  const problems = await validateEpub(result.epub);
  ok('mid-Bible pack is structurally valid', problems.length === 0, problems.join('; '));

  const zip = await JSZip.loadAsync(result.epub);
  const read = async (p: string) => (await zip.file(`OEBPS/${p}`)?.async('string')) ?? null;

  ok('mid-Bible: Genesis→Exodus boundary crossed on day 4',
     (await read('d4-law.xhtml'))?.includes('<title>Exodus 1</title>') === true);
  ok('mid-Bible: month rollover gives Proverbs 1 on day 4',
     (await read('d4-proverb.xhtml'))?.includes('<title>Proverbs 1</title>') === true);
  ok('mid-Bible: a part that ran out has no section for the later days',
     (await read('d5-psalms.xhtml')) === null);
  ok('mid-Bible: the day index omits the exhausted part',
     (await read('day5.xhtml'))?.includes('d5-psalms.xhtml') === false);
  ok('mid-Bible: completed books count toward progress',
     (await read('progress.xhtml'))?.includes('50 of 187 chapters') === true);
}

// ─────────────────────── The EPUB writer: guards and its own validator

{
  const section = (id: string, title: string, body = '<p>x</p>') => ({
    id, title, xhtml: xhtmlDocument(title, body),
  });
  const base = {
    title: 'T', author: 'A', identifier: 'urn:test', modified: '2026-01-01T00:00:00Z', css: 'body{}',
  };

  let threw = '';
  try { await buildEpub({ ...base, sections: [] }); } catch (e) { threw = String(e); }
  ok('an empty spine is rejected', threw.includes('empty'));

  threw = '';
  try {
    await buildEpub({ ...base, sections: [section('a', 'A'), section('a', 'B')] });
  } catch (e) { threw = String(e); }
  ok('duplicate section ids are rejected', threw.includes('duplicate'));

  threw = '';
  try { await buildEpub({ ...base, sections: [section('1bad', 'A')] }); } catch (e) { threw = String(e); }
  ok('an unsafe XML id is rejected', threw.includes('safe XML name'));

  // The validator has to actually catch things, or the CI gate is decoration.
  const good = await buildEpub({ ...base, sections: [section('a', 'A'), section('b', 'B')] });
  eq('a minimal valid EPUB has no problems', (await validateEpub(good)).length, 0);

  const dangling = await buildEpub({
    ...base,
    sections: [section('a', 'A', '<p><a href="ghost.xhtml">gone</a></p>'), section('b', 'B')],
  });
  ok('validator catches a link to a missing file',
     (await validateEpub(dangling)).some((p) => p.includes('ghost.xhtml')));

  const badAnchor = await buildEpub({
    ...base,
    sections: [section('a', 'A', '<p><a href="b.xhtml#nope">gone</a></p>'), section('b', 'B')],
  });
  ok('validator catches a link to a missing anchor',
     (await validateEpub(badAnchor)).some((p) => p.includes('id="nope"')));

  // Rebuild the archive with a DEFLATEd mimetype — the classic EPUB defect that
  // makes a reader reject the file outright.
  const reZip = await JSZip.loadAsync(good);
  const rebuilt = await reZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  ok('validator catches a compressed mimetype',
     (await validateEpub(rebuilt)).some((p) => p.includes('must be stored')));

  const opfBroken = await JSZip.loadAsync(good);
  const opfText = await opfBroken.file('OEBPS/content.opf')!.async('string');
  opfBroken.file('OEBPS/content.opf', opfText.replace('idref="b"', 'idref="ghost"'));
  const brokenSpine = await opfBroken.generateAsync({ type: 'nodebuffer' });
  ok('validator catches a spine pointing at an unknown manifest id',
     (await validateEpub(brokenSpine)).some((p) => p.includes('unknown manifest id "ghost"')));

  const noNav = await JSZip.loadAsync(good);
  noNav.file('OEBPS/content.opf', opfText.replace(' properties="nav"', ''));
  const navless = await noNav.generateAsync({ type: 'nodebuffer' });
  ok('validator catches a missing nav document',
     (await validateEpub(navless)).some((p) => p.includes('nav document')));

  ok('validator rejects something that is not a zip at all',
     (await validateEpub(Buffer.from('not a zip'))).length > 0);

  // Escaping: verse text really does contain & and quotes.
  eq('escapeXml handles the XML metacharacters',
     escapeXml(`a & b < c > d " e ' f`),
     'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  const withAmp = await buildEpub({
    ...base,
    sections: [section('a', 'A', `<p>${escapeXml('Shadrach & Meshach <not a tag>')}</p>`)],
  });
  eq('an ampersand does not break the XHTML', (await validateEpub(withAmp)).length, 0);
}

// ─────────────────────────────── Nav structure matches the reading order

{
  const result = await buildPack(fromStart, new Set(), { startDate: START, days: 7, version: VERSION });
  const zip = await JSZip.loadAsync(result.epub);
  const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');

  eq('nav has one top-level entry per day plus cover/week/progress',
     (nav.match(/<li><a href="day\d\.xhtml"/g) ?? []).length, 7);
  ok('nav nests the day\'s readings under the day',
     /<li><a href="day1\.xhtml">[^<]*<\/a>\s*<ol>/.test(nav));
  ok('nav lists are balanced', (nav.match(/<ol>/g)!.length) === (nav.match(/<\/ol>/g)!.length));
  ok('nav lists are balanced (li)', (nav.match(/<li>/g)!.length) === (nav.match(/<\/li>/g)!.length));

  const opf = await zip.file('OEBPS/content.opf')!.async('string');
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
  eq('the spine covers every section', spine.length, result.sectionCount);
  ok('the spine opens with the cover, week index, then progress',
     spine.slice(0, 4).join(',') === 'cover,week,progress,day1', spine.slice(0, 4).join(','));
  ok('a day index precedes that day\'s readings in the spine',
     spine.indexOf('day3') < spine.indexOf('d3-law'));
  eq('the spine has no duplicates', new Set(spine).size, spine.length);

  const ncx = await zip.file('OEBPS/toc.ncx')!.async('string');
  ok('the EPUB2 fallback TOC is present and non-empty', ncx.includes('<navPoint'));
  eq('every nav point has a play order',
     (ncx.match(/<navPoint/g) ?? []).length, (ncx.match(/playOrder="/g) ?? []).length);
}

// ───────────────────────────────── Pruning old packs off the device

{
  const FOLDER = 'folder-1';
  const doc = (id: string, visibleName: string, parent = FOLDER) =>
    ({ id, type: 'DocumentType', parent, visibleName });

  const today = doc('today', 'Daily Logos 2026-08-14');
  const base = {
    folderId: FOLDER,
    keepId: 'today',
    uploadedName: 'Daily Logos 2026-08-14',
    keepDays: 10,
  };

  const names = (d: ReturnType<typeof selectStalePacks>) =>
    d.action === 'delete' ? d.docs.map((x) => x.visibleName).sort().join(', ') : `SKIP: ${d.reason}`;

  const week = ['08-01', '08-02', '08-03', '08-04', '08-05', '08-13'].map((md, i) =>
    doc(`d${i}`, `Daily Logos 2026-${md}`)
  );

  eq('prunes only packs older than the keep window',
     names(selectStalePacks([today, ...week], base)),
     'Daily Logos 2026-08-01, Daily Logos 2026-08-02, Daily Logos 2026-08-03');

  ok('the cutoff day itself is kept',
     !names(selectStalePacks([today, ...week], base)).includes('2026-08-04'));

  ok('never deletes the pack just uploaded',
     !names(selectStalePacks([today, ...week], { ...base, keepDays: 1 })).includes('2026-08-14'),
     names(selectStalePacks([today, ...week], { ...base, keepDays: 1 })));

  eq('a shorter window prunes more',
     names(selectStalePacks([today, ...week], { ...base, keepDays: 2 })),
     'Daily Logos 2026-08-01, Daily Logos 2026-08-02, Daily Logos 2026-08-03, Daily Logos 2026-08-04, Daily Logos 2026-08-05');

  // Anything not in exactly the pack-name shape is untouchable. This is the
  // guard that keeps the job away from the user's own documents.
  const bystanders = [
    doc('a', 'Daily Logos'),
    doc('b', 'Daily Logos 2026-08-01 copy'),
    doc('c', 'daily logos 2026-08-01'),
    doc('d', 'Meeting notes 2026-08-01'),
    doc('e', 'Daily Logos 2026-8-1'),
    doc('f', '2026-08-01'),
    { id: 'g', type: 'CollectionType', parent: FOLDER, visibleName: 'Daily Logos 2026-08-01' },
    doc('h', 'Daily Logos 2026-08-01', 'some-other-folder'),
    doc('i', 'Daily Logos 2026-08-01', ''),
  ];
  eq('never touches anything outside the exact pack-name shape and folder',
     names(selectStalePacks([today, ...bystanders], base)), '');

  eq('an undated upload name prunes nothing',
     names(selectStalePacks([today, ...week], { ...base, uploadedName: 'Something Else' })),
     'SKIP: "Something Else" is not a dated pack name');

  // A wrong date (or a first run against a folder full of old packs) must not
  // turn into a mass delete.
  const many = Array.from({ length: 40 }, (_, i) =>
    doc(`m${i}`, `Daily Logos 2026-01-${String(i + 1).padStart(2, '0')}`)
  );
  const capped = selectStalePacks([today, ...many], base);
  ok('an implausible number of deletions bails out instead',
     capped.action === 'skip' && capped.reason.includes('cap'),
     names(capped));

  eq('an empty folder prunes nothing', names(selectStalePacks([today], base)), '');
}

console.log('');
if (fail === 0) {
  console.log(`REMARKABLE-PACK PASS ${pass} / ${pass}`);
} else {
  console.log(`REMARKABLE-PACK FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
