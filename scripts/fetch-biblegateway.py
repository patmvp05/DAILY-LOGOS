#!/usr/bin/env python3
"""
Scrape a translation from BibleGateway and write it as static JSON under
public/bible/{CODE}/{bookId}/{chapter}.json, the exact ChapterTextResponse
shape the app's getChapterText() expects.

Why direct (not the `meaningless` lib): bolls.life carries neither NCV nor CSB
(its get-text endpoint returns []), and `meaningless` rejects them via a
hardcoded allowlist. BibleGateway DOES serve both, so we fetch its passage HTML
and parse the verse spans ourselves with BeautifulSoup.

How BibleGateway marks up a chapter (verified on a runner, Oct 2026):
  - every piece of verse text is a <span class="text Gen-8-2">; a verse can span
    several (poetry lines, table cells);
  - COMBINED verses carry a range class: <span class="text Gen-8-3-Gen-8-4">,
    shown as "3-4". The NCV combines verses in ~38 chapters (Numbers 7:12-83 is
    one passage). The first version of this script only understood single-verse
    classes, so it silently dropped every combined passage, text and all: NCV
    Numbers 7 went from 89 verses to 17. parse_passage() reads both forms, and
    check_chapter() now refuses to save a chapter with any verse unaccounted for;
  - two NCV spots (1 Corinthians 6:9, 1 John 3:19) are a "-" placeholder whose
    text sits in the next verse; they are merged into a combined verse (9-10);
  - section headings are <h3>, psalm superscriptions are <h4 class="psalm-title">
    (kept: they are scripture, printed above verse 1), footnote and cross-reference
    markers are <sup>s;
  - the divine name is <span class="small-caps">Lord</span>. Joining text nodes
    with a separator turned "the Lord." into "the Lord ." on ~2,400 NCV verses, so
    text inside a span is joined with no separator.

Configured by env so one script serves every BibleGateway-sourced translation:
  BG_VERSION  BibleGateway's version parameter   (default NCV)
  BG_CODE     output dir + translationId          (default = BG_VERSION)
  BG_NAME     translationName written into files  (default from KNOWN_NAMES)
  OUT_ROOT    where {CODE}/ is written            (default public/bible)
  REFETCH=1   re-fetch chapters whose file predates TEXT_VERSION (resumable)
  ONLY        limit to some chapters, e.g. "Numbers 7;Genesis 8"
  ONLY_BOOKS  limit to whole books, e.g. "Psalms,Isaiah"
  SMOKE=1     fetch just John 3 and Numbers 7 and validate them, then stop
  DELAY       polite gap between requests in seconds (default 1.0)

Run:  BG_VERSION=CSB python scripts/fetch-biblegateway.py
Test: python scripts/test-biblegateway-parser.py   (offline, captured HTML)
"""
import os
import re
import sys
import json
import time

from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))

# (name, bookId, chapterCount); bookId matches BOLLS_BIBLE_BOOK_IDS in src/constants.ts
BOOKS = [
    ("Genesis", 1, 50), ("Exodus", 2, 40), ("Leviticus", 3, 27), ("Numbers", 4, 36),
    ("Deuteronomy", 5, 34), ("Joshua", 6, 24), ("Judges", 7, 21), ("Ruth", 8, 4),
    ("1 Samuel", 9, 31), ("2 Samuel", 10, 24), ("1 Kings", 11, 22), ("2 Kings", 12, 25),
    ("1 Chronicles", 13, 29), ("2 Chronicles", 14, 36), ("Ezra", 15, 10),
    ("Nehemiah", 16, 13), ("Esther", 17, 10), ("Job", 18, 42), ("Psalms", 19, 150),
    ("Proverbs", 20, 31), ("Ecclesiastes", 21, 12), ("Song of Solomon", 22, 8),
    ("Isaiah", 23, 66), ("Jeremiah", 24, 52), ("Lamentations", 25, 5), ("Ezekiel", 26, 48),
    ("Daniel", 27, 12), ("Hosea", 28, 14), ("Joel", 29, 3), ("Amos", 30, 9),
    ("Obadiah", 31, 1), ("Jonah", 32, 4), ("Micah", 33, 7), ("Nahum", 34, 3),
    ("Habakkuk", 35, 3), ("Zephaniah", 36, 3), ("Haggai", 37, 2), ("Zechariah", 38, 14),
    ("Malachi", 39, 4), ("Matthew", 40, 28), ("Mark", 41, 16), ("Luke", 42, 24),
    ("John", 43, 21), ("Acts", 44, 28), ("Romans", 45, 16), ("1 Corinthians", 46, 16),
    ("2 Corinthians", 47, 13), ("Galatians", 48, 6), ("Ephesians", 49, 6),
    ("Philippians", 50, 4), ("Colossians", 51, 4), ("1 Thessalonians", 52, 5),
    ("2 Thessalonians", 53, 3), ("1 Timothy", 54, 6), ("2 Timothy", 55, 4),
    ("Titus", 56, 3), ("Philemon", 57, 1), ("Hebrews", 58, 13), ("James", 59, 5),
    ("1 Peter", 60, 5), ("2 Peter", 61, 3), ("1 John", 62, 5), ("2 John", 63, 1),
    ("3 John", 64, 1), ("Jude", 65, 1), ("Revelation", 66, 22),
]

KNOWN_NAMES = {
    "NCV": "New Century Version",
    "CSB": "Christian Standard Bible",
    "ESV": "English Standard Version",
    "NKJV": "New King James Version",
    "NLT": "New Living Translation",
}

# Bumped whenever the parser changes what it writes. REFETCH=1 re-fetches any
# file below it, so an interrupted full re-scrape resumes where it stopped.
TEXT_VERSION = 2

VERSE_COUNTS = json.load(open(os.path.join(HERE, "lib", "verse-counts.json"), encoding="utf-8"))

# "Gen-8-3" or, for a combined verse, "Gen-8-3-Gen-8-4".
VERSE_CLASS_RE = re.compile(
    r"^([1-3]?[A-Za-z]+)-(\d+)-(\d+)(?:-([1-3]?[A-Za-z]+)-(\d+)-(\d+))?$"
)
PLACEHOLDER_RE = re.compile(r"^[\s\-‐-―]*$")
SPACED_ELLIPSIS_RE = re.compile(r"\.(?:\s\.){2,}")


def tidy(text):
    """Collapse whitespace and remove spaces that markup boundaries inserted
    before closing punctuation ("the Lord ." -> "the Lord."). Spaced ellipses
    (". . .") are typography, not artifacts, and are left alone."""
    text = " ".join(text.split())
    kept = []

    def protect(m):
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    text = SPACED_ELLIPSIS_RE.sub(protect, text)
    text = re.sub(r"\s+([.,;:!?)\]])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    text = re.sub(r"([“‘])\s+", r"\1", text)
    # A closing quote right after a word or punctuation. "’ ”" (two adjacent
    # closing quotes) keeps its space; that one is the printed typography.
    text = re.sub(r"(?<=[\w.,;:!?)\]—–-])\s+([”’])(?!\w)", r"\1", text)
    text = re.sub(r"(?<=\w)\s+(’s)\b", r"\1", text)
    text = re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], text)
    return text.strip()


def verse_range(span, chapter):
    """(start, end) verse numbers a span belongs to in `chapter`, or None."""
    for cls in span.get("class", []):
        m = VERSE_CLASS_RE.match(cls)
        if not m:
            continue
        c1, v1 = int(m.group(2)), int(m.group(3))
        if m.group(4):
            c2, v2 = int(m.group(5)), int(m.group(6))
        else:
            c2, v2 = c1, v1
        if c1 == chapter and c2 == chapter:
            return (v1, v2)
        if c1 == chapter:          # runs into the next chapter: keep our part
            return (v1, v1)
        if c2 == chapter:          # started in the previous chapter
            return (1, v2)
        return None
    return None


def parse_passage(html, chapter):
    """Return [{verse, text[, verseEnd]}] for one chapter page, in order."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("div.passage-text") or soup

    for sel in [
        "sup.versenum", "span.chapternum", "sup.footnote", "sup.crossreference",
        "div.footnotes", "div.crossrefs", "div.passage-other-trans",
        "h1", "h2", "h3",
    ]:
        for el in root.select(sel):
            el.decompose()
    for h4 in root.select("h4"):
        if "psalm-title" not in (h4.get("class") or []):
            h4.decompose()
    for br in root.find_all("br"):
        br.replace_with(" ")

    order = []                 # verse starts in document order
    verses = {}                # start -> {"end": int, "parts": [(text, row)]}
    for span in root.select("span.text"):
        rng = verse_range(span, chapter)
        if rng is None:
            continue
        text = " ".join(span.get_text("").split())
        if not text:
            continue
        start, end = rng
        if start not in verses:
            verses[start] = {"end": end, "parts": []}
            order.append(start)
        verses[start]["end"] = max(verses[start]["end"], end)
        verses[start]["parts"].append((text, span.find_parent("tr")))

    out = []
    for start in sorted(order):
        parts = verses[start]["parts"]
        text = parts[0][0]
        for (prev, prev_row), (cur, cur_row) in zip(parts, parts[1:]):
            same_row = cur_row is not None and cur_row is prev_row
            text += (" — " if same_row else " ") + cur
        entry = {"verse": start, "text": tidy(text)}
        if verses[start]["end"] > start:
            entry["verseEnd"] = verses[start]["end"]
        out.append(entry)

    # A "-" placeholder whose text BibleGateway put in the next verse
    # (NCV 1 Corinthians 6:9, 1 John 3:19) becomes one combined verse.
    merged = []
    i = 0
    while i < len(out):
        v = out[i]
        if PLACEHOLDER_RE.match(v["text"]) and i + 1 < len(out):
            nxt = dict(out[i + 1])
            nxt["verseEnd"] = nxt.get("verseEnd", nxt["verse"])
            nxt["verse"] = v["verse"]
            merged.append(nxt)
            i += 2
            continue
        merged.append(v)
        i += 1
    return [v for v in merged if not PLACEHOLDER_RE.match(v["text"])]


def check_chapter(verses, book_name, chapter):
    """Every verse 1..N accounted for, in order, no overlaps, no empty text.
    Returns a list of problems (empty means the chapter is complete)."""
    problems = []
    counts = VERSE_COUNTS["chapters"].get(book_name)
    if not counts or chapter > len(counts):
        return [f"no verse count for {book_name} {chapter}"]
    key = f"{book_name} {chapter}"
    allowed_last = [counts[chapter - 1]] + VERSE_COUNTS["alternateLastVerse"].get(key, [])
    omittable = {
        int(r.split(":")[1]) for r in VERSE_COUNTS["omittable"]["verses"]
        if r.split(":")[0] == key
    }

    covered = []
    last_end = 0
    for v in verses:
        start, end = v["verse"], v.get("verseEnd", v["verse"])
        if not isinstance(start, int) or not isinstance(end, int) or end < start:
            problems.append(f"bad verse numbers {start}-{end}")
            continue
        if start <= last_end:
            problems.append(f"verse {start} out of order or overlapping")
        last_end = max(last_end, end)
        if not v.get("text", "").strip():
            problems.append(f"verse {start} is empty")
        covered.extend(range(start, end + 1))

    have = set(covered)
    best = None
    for n in allowed_last:
        missing = sorted(set(range(1, n + 1)) - have - omittable)
        extra = sorted(x for x in have if x > n)
        if not missing and not extra:
            best = None
            break
        if best is None or len(missing) + len(extra) < len(best[0]) + len(best[1]):
            best = (missing, extra)
    if best:
        if best[0]:
            problems.append(f"missing verses {best[0]}")
        if best[1]:
            problems.append(f"unexpected verses {best[1]}")
    return problems


# ── Network (only used when run as a script) ──────────────────────────────

VERSION = os.environ.get("BG_VERSION", "NCV").strip().upper()
CODE = os.environ.get("BG_CODE", VERSION).strip().upper()
NAME = os.environ.get("BG_NAME", KNOWN_NAMES.get(CODE, CODE))
OUT_ROOT = os.environ.get("OUT_ROOT", os.path.join(HERE, "..", "public", "bible"))
OUT_DIR = os.path.join(OUT_ROOT, CODE)
DELAY = float(os.environ.get("DELAY", "1.0"))
MAX_RETRIES = 5
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

_session = None


def session():
    global _session
    if _session is None:
        import requests
        _session = requests.Session()
        _session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    return _session


def fetch_chapter(book_name, chapter):
    resp = session().get(
        "https://www.biblegateway.com/passage/",
        params={"search": f"{book_name} {chapter}", "version": VERSION},
        timeout=30,
    )
    resp.raise_for_status()
    return parse_passage(resp.text, chapter)


def needs_fetch(path):
    if not os.path.exists(path):
        return True
    if os.environ.get("REFETCH") != "1":
        return False
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("textVersion", 1) < TEXT_VERSION
    except Exception:  # noqa: BLE001 - unreadable file: fetch it again
        return True


def main():
    if os.environ.get("SMOKE") == "1":
        for book, ch in [("John", 3), ("Numbers", 7)]:
            verses = fetch_chapter(book, ch)
            problems = check_chapter(verses, book, ch)
            assert not problems, f"{VERSION} {book} {ch}: {problems}"
            print(f"SMOKE OK [{VERSION}]: {book} {ch} -> {len(verses)} entries, complete", flush=True)
            time.sleep(DELAY)
        return

    only = {s.strip() for s in os.environ.get("ONLY", "").split(";") if s.strip()}
    only_books = {s.strip() for s in os.environ.get("ONLY_BOOKS", "").split(",") if s.strip()}
    total = sum(c for _, _, c in BOOKS)
    done = fetched = 0
    failed = []

    for (name, bid, chapters) in BOOKS:
        for ch in range(1, chapters + 1):
            if only and f"{name} {ch}" not in only:
                continue
            if only_books and name not in only_books:
                continue
            d = os.path.join(OUT_DIR, str(bid))
            f = os.path.join(d, f"{ch}.json")
            if not needs_fetch(f):
                done += 1
                continue
            last_err = None
            for attempt in range(MAX_RETRIES + 1):
                try:
                    verses = fetch_chapter(name, ch)
                    problems = check_chapter(verses, name, ch)
                    if problems:
                        raise ValueError("; ".join(problems))
                    os.makedirs(d, exist_ok=True)
                    with open(f, "w", encoding="utf-8") as fh:
                        json.dump({
                            "reference": f"{name} {ch}",
                            "verses": verses,
                            "translationId": CODE,
                            "translationName": NAME,
                            "textVersion": TEXT_VERSION,
                        }, fh, ensure_ascii=False)
                    done += 1
                    fetched += 1
                    if fetched % 50 == 0:
                        print(f"  {CODE} {done}/{total} ({name} {ch})", flush=True)
                    last_err = None
                    time.sleep(DELAY)
                    break
                except Exception as e:  # noqa: BLE001 - retried, then reported
                    last_err = e
                    if attempt < MAX_RETRIES:
                        time.sleep(min(2 * (2 ** attempt), 30))
            if last_err is not None:
                failed.append(f"{name} {ch}: {last_err}")
                print(f"  x {CODE} {name} {ch}: {last_err}", flush=True)

    print(f"\n{CODE}: {fetched} fetched this run, {done} complete, {len(failed)} failed", flush=True)
    if failed:
        print("::error::" + f"{CODE}: {len(failed)} chapters failed validation or download: "
              + " | ".join(failed[:20]), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
