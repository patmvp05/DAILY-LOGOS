/**
 * Fuzz test for VerseCopyPopup logic — verifies range expansion, contraction,
 * reference formatting, copy text building, and edge cases.
 *
 * Run:  npx tsx scripts/test-verse-copy.mts
 */

// Inline the logic functions (can't import React components in Node)

const BOOK_ABBREVIATIONS: Record<string, string> = {
  'Genesis': 'Gen', 'Exodus': 'Exo', 'Leviticus': 'Lev', 'Numbers': 'Num', 'Deuteronomy': 'Deu',
  'Joshua': 'Jos', 'Judges': 'Jdg', 'Ruth': 'Rut',
  '1 Samuel': '1Sa', '2 Samuel': '2Sa', '1 Kings': '1Ki', '2 Kings': '2Ki',
  '1 Chronicles': '1Ch', '2 Chronicles': '2Ch', 'Ezra': 'Ezr', 'Nehemiah': 'Neh', 'Esther': 'Est',
  'Job': 'Job', 'Psalms': 'Psa', 'Proverbs': 'Pro', 'Ecclesiastes': 'Ecc', 'Song of Solomon': 'Sng',
  'Isaiah': 'Isa', 'Jeremiah': 'Jer', 'Lamentations': 'Lam', 'Ezekiel': 'Eze', 'Daniel': 'Dan',
  'Hosea': 'Hos', 'Joel': 'Joe', 'Amos': 'Amo', 'Obadiah': 'Oba', 'Jonah': 'Jon',
  'Micah': 'Mic', 'Nahum': 'Nah', 'Habakkuk': 'Hab', 'Zephaniah': 'Zep', 'Haggai': 'Hag',
  'Zechariah': 'Zec', 'Malachi': 'Mal',
  'Matthew': 'Mat', 'Mark': 'Mar', 'Luke': 'Luk', 'John': 'Joh', 'Acts': 'Act',
  'Romans': 'Rom', '1 Corinthians': '1Co', '2 Corinthians': '2Co',
  'Galatians': 'Gal', 'Ephesians': 'Eph', 'Philippians': 'Php', 'Colossians': 'Col',
  '1 Thessalonians': '1Th', '2 Thessalonians': '2Th', '1 Timothy': '1Ti', '2 Timothy': '2Ti',
  'Titus': 'Tit', 'Philemon': 'Phm', 'Hebrews': 'Heb', 'James': 'Jam',
  '1 Peter': '1Pe', '2 Peter': '2Pe', '1 John': '1Jn', '2 John': '2Jn', '3 John': '3Jn',
  'Jude': 'Jud', 'Revelation': 'Rev',
};

interface Verse { verse: number; text: string }

interface State {
  anchorVerse: number;
  rangeEndVerse: number;
  rangeEndChapter: number;
  bookName: string;
  chapter: number;
  totalChaptersInBook: number;
  versionId: string;
  currentVerses: Verse[];
  extraChapters: Map<number, Verse[]>;
}

function makeVerses(start: number, end: number): Verse[] {
  const out: Verse[] = [];
  for (let i = start; i <= end; i++) out.push({ verse: i, text: `Verse ${i} text.` });
  return out;
}

function formatReference(s: State): string {
  const abbr = BOOK_ABBREVIATIONS[s.bookName] || s.bookName;
  if (s.rangeEndChapter === s.chapter && s.rangeEndVerse === s.anchorVerse) {
    return `${abbr} ${s.chapter}:${s.anchorVerse}`;
  }
  if (s.rangeEndChapter === s.chapter) {
    return `${abbr} ${s.chapter}:${s.anchorVerse}-${s.rangeEndVerse}`;
  }
  return `${abbr} ${s.chapter}:${s.anchorVerse}-${s.rangeEndChapter}:${s.rangeEndVerse}`;
}

function getSelectedVerses(s: State): { chapter: number; verse: number; text: string }[] {
  const result: { chapter: number; verse: number; text: string }[] = [];
  const endInCurrent = s.rangeEndChapter === s.chapter ? s.rangeEndVerse : Infinity;
  for (const v of s.currentVerses) {
    if (v.verse >= s.anchorVerse && v.verse <= endInCurrent) {
      result.push({ chapter: s.chapter, verse: v.verse, text: v.text });
    }
  }
  for (let ch = s.chapter + 1; ch <= s.rangeEndChapter; ch++) {
    const chVerses = s.extraChapters.get(ch);
    if (!chVerses) continue;
    const endV = ch === s.rangeEndChapter ? s.rangeEndVerse : Infinity;
    for (const v of chVerses) {
      if (v.verse <= endV) {
        result.push({ chapter: ch, verse: v.verse, text: v.text });
      }
    }
  }
  return result;
}

function buildCopyText(s: State): string {
  const selectedVerses = getSelectedVerses(s);
  let fullRef: string;
  if (s.rangeEndChapter === s.chapter && s.rangeEndVerse === s.anchorVerse) {
    fullRef = `${s.bookName} ${s.chapter}:${s.anchorVerse}`;
  } else if (s.rangeEndChapter === s.chapter) {
    fullRef = `${s.bookName} ${s.chapter}:${s.anchorVerse}-${s.rangeEndVerse}`;
  } else {
    fullRef = `${s.bookName} ${s.chapter}:${s.anchorVerse}-${s.rangeEndChapter}:${s.rangeEndVerse}`;
  }

  const lines: string[] = [`${fullRef} (${s.versionId.toUpperCase()})`];
  let lastCh = s.chapter;

  for (const sv of selectedVerses) {
    if (sv.chapter !== lastCh) {
      lines.push(`[${s.bookName} ${sv.chapter}]`);
      lastCh = sv.chapter;
    }
    lines.push(`${sv.verse} ${sv.text}`);
  }

  return lines.join('\n');
}

function lastVerseInEndChapter(s: State): number {
  if (s.rangeEndChapter === s.chapter) {
    return s.currentVerses.length > 0 ? s.currentVerses[s.currentVerses.length - 1].verse : s.anchorVerse;
  }
  const chVs = s.extraChapters.get(s.rangeEndChapter);
  return chVs && chVs.length > 0 ? chVs[chVs.length - 1].verse : 1;
}

function atBookEnd(s: State): boolean {
  return s.rangeEndChapter >= s.totalChaptersInBook && s.rangeEndVerse >= lastVerseInEndChapter(s);
}

function atAnchor(s: State): boolean {
  return s.rangeEndChapter === s.chapter && s.rangeEndVerse === s.anchorVerse;
}

// Simulate expand (synchronous — assumes extraChapters pre-populated for cross-chapter)
function expandRange(s: State): State {
  const lastV = lastVerseInEndChapter(s);
  if (s.rangeEndVerse < lastV) {
    return { ...s, rangeEndVerse: s.rangeEndVerse + 1 };
  }
  const nextCh = s.rangeEndChapter + 1;
  if (nextCh > s.totalChaptersInBook) return s; // at book end
  return { ...s, rangeEndChapter: nextCh, rangeEndVerse: 1 };
}

function contractRange(s: State): State {
  if (atAnchor(s)) return s;
  if (s.rangeEndChapter > s.chapter && s.rangeEndVerse > 1) {
    return { ...s, rangeEndVerse: s.rangeEndVerse - 1 };
  }
  if (s.rangeEndChapter > s.chapter) {
    const prevCh = s.rangeEndChapter - 1;
    const prevVerses = prevCh === s.chapter ? s.currentVerses : s.extraChapters.get(prevCh);
    const lastV = prevVerses && prevVerses.length > 0 ? prevVerses[prevVerses.length - 1].verse : s.anchorVerse;
    return { ...s, rangeEndChapter: prevCh, rangeEndVerse: lastV };
  }
  return { ...s, rangeEndVerse: s.rangeEndVerse - 1 };
}

// ── Tests ──

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

// ── Test 1: Single verse reference ──
{
  const s: State = {
    anchorVerse: 16, rangeEndVerse: 16, rangeEndChapter: 3,
    bookName: 'John', chapter: 3, totalChaptersInBook: 21,
    versionId: 'ncv', currentVerses: makeVerses(1, 36), extraChapters: new Map(),
  };
  assert(formatReference(s) === 'Joh 3:16', `single ref: got "${formatReference(s)}"`);
  assert(getSelectedVerses(s).length === 1, 'single verse count');
  assert(buildCopyText(s).startsWith('John 3:16 (NCV)'), 'single copy header');
  assert(atAnchor(s), 'at anchor initially');
  assert(!atBookEnd(s), 'not at book end');
}

// ── Test 2: Expand within same chapter ──
{
  let s: State = {
    anchorVerse: 16, rangeEndVerse: 16, rangeEndChapter: 3,
    bookName: 'John', chapter: 3, totalChaptersInBook: 21,
    versionId: 'ncv', currentVerses: makeVerses(1, 36), extraChapters: new Map(),
  };
  s = expandRange(s);
  assert(s.rangeEndVerse === 17, `expand to 17: got ${s.rangeEndVerse}`);
  assert(formatReference(s) === 'Joh 3:16-17', `range ref: got "${formatReference(s)}"`);
  assert(getSelectedVerses(s).length === 2, `2 verses: got ${getSelectedVerses(s).length}`);
  assert(!atAnchor(s), 'not at anchor after expand');

  s = expandRange(s);
  assert(s.rangeEndVerse === 18, `expand to 18: got ${s.rangeEndVerse}`);
  assert(getSelectedVerses(s).length === 3, `3 verses: got ${getSelectedVerses(s).length}`);
}

// ── Test 3: Contract back to anchor ──
{
  let s: State = {
    anchorVerse: 16, rangeEndVerse: 18, rangeEndChapter: 3,
    bookName: 'John', chapter: 3, totalChaptersInBook: 21,
    versionId: 'ncv', currentVerses: makeVerses(1, 36), extraChapters: new Map(),
  };
  s = contractRange(s); assert(s.rangeEndVerse === 17, 'contract 18→17');
  s = contractRange(s); assert(s.rangeEndVerse === 16, 'contract 17→16');
  assert(atAnchor(s), 'back at anchor');
  s = contractRange(s); assert(s.rangeEndVerse === 16, 'no-op at anchor');
}

// ── Test 4: Cross-chapter expansion ──
{
  const ch4Verses = makeVerses(1, 54);
  let s: State = {
    anchorVerse: 35, rangeEndVerse: 35, rangeEndChapter: 3,
    bookName: 'John', chapter: 3, totalChaptersInBook: 21,
    versionId: 'web', currentVerses: makeVerses(1, 36),
    extraChapters: new Map([[4, ch4Verses]]),
  };
  // Expand to end of chapter 3
  s = expandRange(s); assert(s.rangeEndVerse === 36, 'expand to 36');
  // Cross into chapter 4
  s = expandRange(s);
  assert(s.rangeEndChapter === 4, `cross to ch 4: got ch ${s.rangeEndChapter}`);
  assert(s.rangeEndVerse === 1, `verse 1 of ch 4: got ${s.rangeEndVerse}`);
  assert(formatReference(s) === 'Joh 3:35-4:1', `cross ref: got "${formatReference(s)}"`);

  const selected = getSelectedVerses(s);
  assert(selected.length === 3, `3 verses across chapters: got ${selected.length}`);
  assert(selected[0].chapter === 3 && selected[0].verse === 35, 'first verse ch3:35');
  assert(selected[2].chapter === 4 && selected[2].verse === 1, 'last verse ch4:1');

  const copyText = buildCopyText(s);
  assert(copyText.includes('[John 4]'), 'cross-chapter separator in copy text');
  assert(copyText.startsWith('John 3:35-4:1 (WEB)'), `copy header: got "${copyText.split('\n')[0]}"`);
}

// ── Test 5: Contract across chapter boundary ──
{
  let s: State = {
    anchorVerse: 35, rangeEndVerse: 2, rangeEndChapter: 4,
    bookName: 'John', chapter: 3, totalChaptersInBook: 21,
    versionId: 'ncv', currentVerses: makeVerses(1, 36),
    extraChapters: new Map([[4, makeVerses(1, 54)]]),
  };
  s = contractRange(s); assert(s.rangeEndVerse === 1, 'contract 4:2→4:1');
  s = contractRange(s);
  assert(s.rangeEndChapter === 3, `back to ch 3: got ch ${s.rangeEndChapter}`);
  assert(s.rangeEndVerse === 36, `last verse of ch 3: got ${s.rangeEndVerse}`);

  s = contractRange(s); assert(s.rangeEndVerse === 35, 'contract to anchor');
  assert(atAnchor(s), 'back at anchor after cross-chapter contract');
}

// ── Test 6: Last verse of last chapter (book end) ──
{
  const s: State = {
    anchorVerse: 21, rangeEndVerse: 21, rangeEndChapter: 21,
    bookName: 'John', chapter: 21, totalChaptersInBook: 21,
    versionId: 'ncv', currentVerses: makeVerses(1, 25), extraChapters: new Map(),
  };
  assert(atBookEnd(s) === false, 'not at book end when verse 21 < last verse 25');

  const s2: State = { ...s, rangeEndVerse: 25 };
  assert(atBookEnd(s2) === true, 'at book end when at last verse of last chapter');

  const s3 = expandRange(s2);
  assert(s3.rangeEndVerse === 25, 'expand at book end is no-op');
  assert(s3.rangeEndChapter === 21, 'chapter unchanged at book end');
}

// ── Test 7: One-chapter book (Obadiah, Philemon, etc.) ──
{
  const s: State = {
    anchorVerse: 10, rangeEndVerse: 10, rangeEndChapter: 1,
    bookName: 'Obadiah', chapter: 1, totalChaptersInBook: 1,
    versionId: 'ncv', currentVerses: makeVerses(1, 21), extraChapters: new Map(),
  };
  assert(formatReference(s) === 'Oba 1:10', `one-chapter ref: got "${formatReference(s)}"`);

  // Expand to last verse
  let s2 = s;
  for (let i = 10; i < 21; i++) s2 = expandRange(s2);
  assert(s2.rangeEndVerse === 21, `at verse 21: got ${s2.rangeEndVerse}`);
  assert(atBookEnd(s2), 'at book end for one-chapter book');

  // Try to expand past — should be no-op
  const s3 = expandRange(s2);
  assert(s3.rangeEndVerse === 21 && s3.rangeEndChapter === 1, 'no-op past one-chapter book end');
}

// ── Test 8: First verse of first chapter ──
{
  const s: State = {
    anchorVerse: 1, rangeEndVerse: 1, rangeEndChapter: 1,
    bookName: 'Genesis', chapter: 1, totalChaptersInBook: 50,
    versionId: 'ncv', currentVerses: makeVerses(1, 31), extraChapters: new Map(),
  };
  assert(atAnchor(s), 'at anchor verse 1');
  const s2 = contractRange(s);
  assert(s2.rangeEndVerse === 1, 'contract at verse 1 is no-op');
}

// ── Test 9: Abbreviation coverage ──
{
  const books = [
    'Genesis', 'Exodus', 'Psalms', 'Song of Solomon', 'Matthew', 'John', 'Acts',
    '1 Corinthians', '2 Timothy', 'Revelation', 'Obadiah', 'Philemon', '3 John', 'Jude',
  ];
  for (const b of books) {
    assert(BOOK_ABBREVIATIONS[b] !== undefined, `abbreviation exists for ${b}`);
    assert(BOOK_ABBREVIATIONS[b].length <= 3, `abbreviation ${BOOK_ABBREVIATIONS[b]} is ≤3 chars for ${b}`);
  }
}

// ── Test 10: Rapid expand-contract cycle (fuzz) ──
{
  let s: State = {
    anchorVerse: 5, rangeEndVerse: 5, rangeEndChapter: 2,
    bookName: 'Ruth', chapter: 2, totalChaptersInBook: 4,
    versionId: 'web', currentVerses: makeVerses(1, 23),
    extraChapters: new Map([[3, makeVerses(1, 18)], [4, makeVerses(1, 22)]]),
  };

  // Expand 60 times (should hit book end and stop)
  for (let i = 0; i < 60; i++) s = expandRange(s);
  assert(atBookEnd(s), 'at book end after many expands');
  assert(s.rangeEndChapter === 4, `fuzz: ended at ch ${s.rangeEndChapter}`);
  assert(s.rangeEndVerse === 22, `fuzz: ended at v ${s.rangeEndVerse}`);

  // Contract all the way back
  for (let i = 0; i < 100; i++) s = contractRange(s);
  assert(atAnchor(s), 'back at anchor after many contracts');
  assert(s.rangeEndChapter === 2 && s.rangeEndVerse === 5, 'restored to original');
}

// ── Test 11: Copy text cross-chapter format ──
{
  const s: State = {
    anchorVerse: 50, rangeEndVerse: 1, rangeEndChapter: 13,
    bookName: 'Exodus', chapter: 12, totalChaptersInBook: 40,
    versionId: 'ncv',
    currentVerses: makeVerses(1, 51),
    extraChapters: new Map([[13, makeVerses(1, 22)]]),
  };
  const text = buildCopyText(s);
  const lines = text.split('\n');
  assert(lines[0] === 'Exodus 12:50-13:1 (NCV)', `header: got "${lines[0]}"`);
  assert(lines[1] === '50 Verse 50 text.', `first verse line: got "${lines[1]}"`);
  assert(lines[2] === '51 Verse 51 text.', `second verse line: got "${lines[2]}"`);
  assert(lines[3] === '[Exodus 13]', `chapter separator: got "${lines[3]}"`);
  assert(lines[4] === '1 Verse 1 text.', `cross-chapter verse: got "${lines[4]}"`);
  assert(lines.length === 5, `5 lines total: got ${lines.length}`);
}

// ── Test 12: Verse count accuracy across chapters ──
{
  const s: State = {
    anchorVerse: 20, rangeEndVerse: 5, rangeEndChapter: 4,
    bookName: 'Ruth', chapter: 2, totalChaptersInBook: 4,
    versionId: 'ncv',
    currentVerses: makeVerses(1, 23),
    extraChapters: new Map([[3, makeVerses(1, 18)], [4, makeVerses(1, 22)]]),
  };
  const selected = getSelectedVerses(s);
  // ch2: 20-23 = 4 verses, ch3: 1-18 = 18 verses, ch4: 1-5 = 5 verses => 27
  assert(selected.length === 27, `cross-chapter count: got ${selected.length}`);
}

// ── Test 13: canExpandDown unused variable check (it IS dead code) ──
{
  // The component has `canExpandDown` computed but never used. Verify `atBookEnd`
  // is the actual guard. Test that atBookEnd works correctly for mid-book chapters.
  const s: State = {
    anchorVerse: 1, rangeEndVerse: 31, rangeEndChapter: 1,
    bookName: 'Genesis', chapter: 1, totalChaptersInBook: 50,
    versionId: 'ncv', currentVerses: makeVerses(1, 31), extraChapters: new Map(),
  };
  assert(!atBookEnd(s), 'ch 1 of 50 is NOT book end even if at last verse');
  // This confirms `atBookEnd` correctly checks chapter >= totalChaptersInBook,
  // not just verse position. (Bug note: canExpandDown is dead code.)
}

console.log(`\nVERSE-COPY ${fail === 0 ? 'PASS' : 'FAIL'} ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
