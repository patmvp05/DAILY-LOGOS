#!/usr/bin/env python3
"""
Scrape the New Century Version (NCV) from BibleGateway via the `meaningless`
package and write it as static JSON under public/bible/NCV/{bookId}/{chapter}.json
— the exact ChapterTextResponse shape the app's getChapterText() expects.

Why BibleGateway: bolls.life (our source for NIV/ESV/NLT/NKJV) does NOT carry
NCV — its get-text/NCV endpoint returns an empty array. BibleGateway does have
NCV, and `meaningless` is a maintained scraper that parses its HTML cleanly.

Resumable: skips chapters whose files already exist, so a re-run only fills
gaps left by throttling. Set SMOKE=1 to fetch just John 3 and assert it's
non-empty (fast reachability/capability check). DELAY tunes the polite gap.

Run:  python scripts/fetch-ncv-biblegateway.py
"""
import os
import sys
import json
import time

from meaningless import WebExtractor

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

# meaningless uses its own canonical book names for a few books.
NAME_OVERRIDES = {"Song of Solomon": "Song of Songs"}

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "bible", "NCV")
DELAY = float(os.environ.get("DELAY", "1.0"))
MAX_RETRIES = 5

extractor = WebExtractor(translation="NCV", output_as_list=True, show_passage_numbers=False)


def fetch_chapter(book_name, chapter):
    """Return a list of {verse, text} for one chapter, or [] if nothing usable."""
    name = NAME_OVERRIDES.get(book_name, book_name)
    verses = extractor.get_chapter(name, chapter)  # list[str], one entry per verse
    out = []
    for i, raw in enumerate(verses or []):
        text = " ".join((raw or "").split()).strip()
        if text:
            out.append({"verse": i + 1, "text": text})
    return out


def main():
    if os.environ.get("SMOKE") == "1":
        verses = fetch_chapter("John", 3)
        assert len(verses) > 5, f"NCV John 3 returned only {len(verses)} verses"
        print(f"SMOKE OK: John 3 -> {len(verses)} verses; v1: {verses[0]['text'][:80]!r}", flush=True)
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
                            "translationId": "NCV",
                            "translationName": "New Century Version",
                        }, fh, ensure_ascii=False)
                    fetched += 1
                    ok = True
                    if fetched % 50 == 0:
                        print(f"  NCV {fetched}/{total} ({name} {ch})", flush=True)
                    time.sleep(DELAY)
                    break
                except Exception as e:  # noqa: BLE001 - best effort, gap filled on re-run
                    if attempt < MAX_RETRIES:
                        time.sleep(min(2 * (2 ** attempt), 30))
                    else:
                        errors += 1
                        print(f"  x NCV {name} {ch}: {e}", flush=True)

    print(f"\nNCV done: {fetched}/{total} present, {errors} still missing", flush=True)


if __name__ == "__main__":
    main()
