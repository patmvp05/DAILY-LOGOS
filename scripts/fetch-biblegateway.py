#!/usr/bin/env python3
"""
Scrape a translation from BibleGateway and write it as static JSON under
public/bible/{CODE}/{bookId}/{chapter}.json — the exact ChapterTextResponse
shape the app's getChapterText() expects.

Why direct (not the `meaningless` lib): bolls.life carries neither NCV nor CSB
(its get-text endpoint returns []), and `meaningless` rejects them via a
hardcoded allowlist. BibleGateway DOES serve both, so we fetch its passage HTML
and parse the verse spans ourselves with BeautifulSoup. The span classes are
identical across versions (verified on a runner: `text John-3-1`, `text Ps-23-1`,
`text 3John-1-1`, `text Obad-1-1`), so one parser covers every version.

Configured by env so one script serves every BibleGateway-sourced translation
(defaults to NCV, which is what shipped first):
  BG_VERSION  BibleGateway's version parameter   (default NCV)
  BG_CODE     output dir + translationId          (default = BG_VERSION)
  BG_NAME     translationName written into files  (default from KNOWN_NAMES)

Resumable: skips chapters whose files already exist. Set SMOKE=1 to fetch just
John 3 and assert it's non-empty (fast reachability/capability check). DELAY
tunes the polite gap between requests.

Run:  BG_VERSION=CSB python scripts/fetch-biblegateway.py
"""
import os
import re
import sys
import json
import time

import requests
from bs4 import BeautifulSoup

# (name, bookId, chapterCount) — bookId matches BOLLS_BIBLE_BOOK_IDS in src/constants.ts
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
}

VERSION = os.environ.get("BG_VERSION", "NCV").strip().upper()
CODE = os.environ.get("BG_CODE", VERSION).strip().upper()
NAME = os.environ.get("BG_NAME", KNOWN_NAMES.get(CODE, CODE))

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "bible", CODE)
DELAY = float(os.environ.get("DELAY", "1.0"))
MAX_RETRIES = 5
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

# A verse span carries a class like "text John-3-16" / "text 1Cor-1-2" — the
# trailing -<chapter>-<verse> is what we key on.
VERSE_CLASS_RE = re.compile(r"^[\w]+-(\d+)-(\d+)$")

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})


def fetch_chapter(book_name, chapter):
    """Return a list of {verse, text} for one chapter, or [] if nothing usable."""
    resp = session.get(
        "https://www.biblegateway.com/passage/",
        params={"search": f"{book_name} {chapter}", "version": VERSION},
        timeout=30,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Strip everything that isn't verse prose.
    for sel in [
        "sup.versenum", "span.chapternum", "sup.footnote", "sup.crossreference",
        "div.footnotes", "div.crossrefs", "div.passage-other-trans", "h1", "h2", "h3", "h4",
    ]:
        for el in soup.select(sel):
            el.decompose()

    # Group verse fragments by verse number (a verse can span multiple .text spans).
    verses = {}
    for span in soup.select("div.passage-text span.text"):
        vnum = None
        for cls in span.get("class", []):
            m = VERSE_CLASS_RE.match(cls)
            if m:
                vnum = int(m.group(2))
                break
        if vnum is None:
            continue
        verses.setdefault(vnum, []).append(span.get_text(" ", strip=True))

    out = []
    for v in sorted(verses):
        text = " ".join(" ".join(verses[v]).split()).strip()
        if text:
            out.append({"verse": v, "text": text})
    return out


def main():
    if os.environ.get("SMOKE") == "1":
        verses = fetch_chapter("John", 3)
        assert len(verses) > 5, f"{VERSION} John 3 returned only {len(verses)} verses"
        print(f"SMOKE OK [{VERSION}]: John 3 -> {len(verses)} verses; "
              f"v1: {verses[0]['text'][:80]!r}", flush=True)
        return

    total = sum(c for _, _, c in BOOKS)
    fetched = 0
    errors = 0

    for (name, bid, chapters) in BOOKS:
        for ch in range(1, chapters + 1):
            d = os.path.join(OUT_DIR, str(bid))
            f = os.path.join(d, f"{ch}.json")
            if os.path.exists(f):
                fetched += 1
                continue

            ok = False
            for attempt in range(MAX_RETRIES + 1):
                try:
                    verses = fetch_chapter(name, ch)
                    if not verses:
                        raise ValueError("empty chapter")
                    os.makedirs(d, exist_ok=True)
                    with open(f, "w", encoding="utf-8") as fh:
                        json.dump({
                            "reference": f"{name} {ch}",
                            "verses": verses,
                            "translationId": CODE,
                            "translationName": NAME,
                        }, fh, ensure_ascii=False)
                    fetched += 1
                    ok = True
                    if fetched % 50 == 0:
                        print(f"  {CODE} {fetched}/{total} ({name} {ch})", flush=True)
                    time.sleep(DELAY)
                    break
                except Exception as e:  # noqa: BLE001 - best effort, gap filled on re-run
                    if attempt < MAX_RETRIES:
                        time.sleep(min(2 * (2 ** attempt), 30))
                    else:
                        errors += 1
                        print(f"  x {CODE} {name} {ch}: {e}", flush=True)

    print(f"\n{CODE} done: {fetched}/{total} present, {errors} still missing", flush=True)


if __name__ == "__main__":
    main()
