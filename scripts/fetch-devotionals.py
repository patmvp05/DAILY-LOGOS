#!/usr/bin/env python3
"""
Scrape three public-domain devotionals from CCEL and write them as static JSON
under public/devotionals/{slug}/{MM-DD}.json.

Works:
  - morning-evening  (Charles Spurgeon) — 2 entries/day (morning + evening)
  - my-utmost        (Oswald Chambers)  — 1 entry/day
  - streams-in-the-desert (L.B. Cowman) — 1 entry/day

Resumable: skips days whose files already exist. Set SMOKE=1 to fetch just
Jan 1 for each slug as a reachability check. DELAY tunes the polite gap
between requests (default 1.5s).

Run:  python scripts/fetch-devotionals.py
"""
import os
import re
import sys
import json
import time
import calendar

import requests
from bs4 import BeautifulSoup

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "devotionals")
DELAY = float(os.environ.get("DELAY", "1.5"))
MAX_RETRIES = 5

MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
]

# 366 day entries (include Feb 29)
def all_month_days():
    """Yield (month_num, day_num, MM-DD) for all 366 possible days."""
    for m in range(1, 13):
        max_day = 29 if m == 2 else calendar.monthrange(2024, m)[1]  # 2024 is a leap year
        for d in range(1, max_day + 1):
            yield m, d, f"{m:02d}-{d:02d}"


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; DailyLogosBot/1.0; Bible reading app)"
}


def fetch_with_retry(url, retries=MAX_RETRIES):
    """GET with exponential backoff. Returns the Response on 200, None on 404."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
            if resp.status_code == 200:
                return resp
            if resp.status_code == 404:
                return None
            print(f"  HTTP {resp.status_code} for {url}, retry {attempt+1}/{retries}")
        except requests.RequestException as e:
            print(f"  Error fetching {url}: {e}, retry {attempt+1}/{retries}")
        wait = min(2 ** attempt, 30)
        time.sleep(wait)
    return None


def _get(url):
    try:
        return requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
    except requests.RequestException as e:
        print(f"    EXCEPTION: {e}")
        return None


def _clean_section(sec):
    """Strip CCEL nav/search/footer boilerplate from a content section in place."""
    for jid in ["reader-toc", "navbar-popup-loading", "navbar-popup-content",
                "ccel-footer", "copyright"]:
        for el in sec.find_all(id=jid):
            el.decompose()
    for tag in sec.find_all(["nav", "form", "script", "style", "button", "header", "footer"]):
        tag.decompose()


def probe_ccel():
    """
    DIAGNOSTIC round 2: now that we know Spurgeon's day-page URL scheme
    (morneve.d{MMDD}{am|pm}.html) and that the reading lives in
    <div id="book-section">, dump that section's INNER block markup so the
    parser can target scripture vs body exactly. Also probe CCEL author pages
    for Chambers/Cowman to discover the real work IDs (the guessed ones 404'd).
    Exits non-zero so nothing is scraped/committed.
    """
    # 1. Spurgeon day-page inner structure.
    print("\n### SPURGEON inner markup — morneve.d0101am.html")
    r = _get("https://www.ccel.org/ccel/spurgeon/morneve.d0101am.html")
    if r and r.status_code == 200:
        soup = BeautifulSoup(r.text, "html.parser")
        sec = soup.find("div", id="book-section") or soup.find("div", id="content")
        if sec:
            _clean_section(sec)
            print("    block elements (<tag.class> text[:160]):")
            n = 0
            for el in sec.find_all(["h1", "h2", "h3", "h4", "p", "blockquote", "cite"]):
                txt = clean_text(el.get_text())
                if not txt:
                    continue
                cls = ".".join(el.get("class", [])) or "(none)"
                print(f"      <{el.name}.{cls}> {txt[:160]}")
                n += 1
                if n >= 40:
                    break
        else:
            print("    NO book-section/content div found")
    else:
        print(f"    status={r.status_code if r else 'ERR'}")

    # 2. Discover real work IDs for Chambers (My Utmost) + Cowman (Streams).
    for author in ["chambers", "cowman"]:
        print(f"\n### CCEL author page: {author}")
        found = False
        for url in [f"https://www.ccel.org/ccel/{author}/",
                    f"https://www.ccel.org/ccel/{author}",
                    f"https://www.ccel.org/a/{author}"]:
            r = _get(url)
            print(f"    GET {url} -> {r.status_code if r else 'ERR'} final={r.url if r else ''}")
            if r and r.status_code == 200:
                soup = BeautifulSoup(r.text, "html.parser")
                links = []
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    # Dump any link that mentions the author or looks like a work
                    # page, so the real work ID surfaces regardless of href shape.
                    if (author in h or "/ccel/" in h) and h not in links:
                        links.append(h)
                print(f"      ({len(links)} candidate links)")
                for h in links[:50]:
                    print(f"      {h}")
                found = True
                break
        if not found:
            print("    (author landing not found at guessed paths)")

    print("\n[DIAGNOSE] probe complete — exiting non-zero so nothing is scraped.")
    sys.exit(1)


def clean_text(text):
    """Strip HTML, normalize whitespace."""
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


_QUOTE_CHARS = "\"“”‘’'"


def _strip_quotes(text):
    """Remove surrounding straight/curly quotes from a scripture pull-quote."""
    return text.strip().strip(_QUOTE_CHARS).strip()


def _parse_morneve_reading(html, period):
    """
    Parse one CCEL Morning-and-Evening reading page into an entry dict.

    Verified markup (morneve.d{MMDD}{am|pm}.html), content in <div id="book-section">:
      <h2>            "Morning, January 1"   (title — skipped)
      <p class=crossref>  "Go To Evening Reading"   (nav — skipped)
      <p class=passage>   the scripture pull-quote
      <h3 class=scripPassage>  the scripture reference
      <p class=normal>    body paragraphs
    """
    soup = BeautifulSoup(html, "html.parser")
    sec = soup.find("div", id="book-section") or soup.find("div", id="content")
    if not sec:
        return None

    passage_el = sec.find("p", class_="passage")
    scripture = _strip_quotes(clean_text(passage_el.get_text())) if passage_el else ""

    ref_el = sec.find("h3", class_="scripPassage")
    reference = clean_text(ref_el.get_text()) if ref_el else ""

    body_paragraphs = [
        clean_text(p.get_text())
        for p in sec.find_all("p", class_="normal")
        if clean_text(p.get_text())
    ]

    if not body_paragraphs:
        return None

    entry = {"period": period, "body": body_paragraphs}
    if scripture:
        entry["scripture"] = scripture
    if reference:
        entry["reference"] = reference
    return entry


def scrape_spurgeon(month, day, month_day):
    """
    Scrape Spurgeon's Morning and Evening from CCEL — two readings/day.
    URL scheme (confirmed via DIAGNOSE probe):
      https://www.ccel.org/ccel/spurgeon/morneve.d{MMDD}{am|pm}.html
    """
    entries = []
    for period, suffix in [("morning", "am"), ("evening", "pm")]:
        url = f"https://www.ccel.org/ccel/spurgeon/morneve.d{month:02d}{day:02d}{suffix}.html"
        resp = fetch_with_retry(url)
        if not resp:
            continue
        entry = _parse_morneve_reading(resp.text, period)
        if entry:
            entries.append(entry)
        time.sleep(DELAY)

    if not entries:
        return None

    return {
        "slug": "morning-evening",
        "date": month_day,
        "title": f"{MONTHS[month-1].capitalize()} {day}",
        "entries": entries,
        "author": "Charles H. Spurgeon",
        "source": "CCEL",
    }


def scrape_utmost(month, day, month_day):
    """Scrape My Utmost for His Highest from CCEL."""
    month_name = MONTHS[month - 1]
    url = f"https://www.ccel.org/ccel/c/chambers/utmost/{month_name}{day:02d}.html"
    resp = fetch_with_retry(url)
    if not resp:
        # Try alternate pattern
        url = f"https://www.ccel.org/ccel/chambers/utmost/{month_name}{day:02d}.html"
        resp = fetch_with_retry(url)
    if not resp:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    scripture = ""
    reference = ""
    body_paragraphs = []

    verse_el = soup.find("p", class_="verse") or soup.find("blockquote")
    if verse_el:
        scripture = clean_text(verse_el.get_text())

    ref_el = soup.find("p", class_="ref") or soup.find("cite")
    if ref_el:
        reference = clean_text(ref_el.get_text())

    content_div = soup.find("div", class_="text") or soup.find("div", id="content-main") or soup.find("article")
    if content_div:
        for p in content_div.find_all("p"):
            cls = p.get("class", [])
            if "verse" in cls or "ref" in cls:
                continue
            text = clean_text(p.get_text())
            if text and len(text) > 10:
                body_paragraphs.append(text)

    if not body_paragraphs:
        main = soup.find("main") or soup.find("body")
        if main:
            for p in main.find_all("p"):
                text = clean_text(p.get_text())
                if text and len(text) > 20:
                    body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    entry = {"body": body_paragraphs}
    if scripture:
        entry["scripture"] = scripture
    if reference:
        entry["reference"] = reference

    title = f"{MONTHS[month-1].capitalize()} {day}"
    return {
        "slug": "my-utmost",
        "date": month_day,
        "title": title,
        "entries": [entry],
        "author": "Oswald Chambers",
        "source": "CCEL"
    }


def scrape_streams(month, day, month_day):
    """Scrape Streams in the Desert from CCEL."""
    month_name = MONTHS[month - 1]
    url = f"https://www.ccel.org/ccel/c/cowman/streams/{month_name}{day:02d}.html"
    resp = fetch_with_retry(url)
    if not resp:
        url = f"https://www.ccel.org/ccel/cowman/streams/{month_name}{day:02d}.html"
        resp = fetch_with_retry(url)
    if not resp:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    scripture = ""
    reference = ""
    body_paragraphs = []

    verse_el = soup.find("p", class_="verse") or soup.find("blockquote")
    if verse_el:
        scripture = clean_text(verse_el.get_text())

    ref_el = soup.find("p", class_="ref") or soup.find("cite")
    if ref_el:
        reference = clean_text(ref_el.get_text())

    content_div = soup.find("div", class_="text") or soup.find("div", id="content-main") or soup.find("article")
    if content_div:
        for p in content_div.find_all("p"):
            cls = p.get("class", [])
            if "verse" in cls or "ref" in cls:
                continue
            text = clean_text(p.get_text())
            if text and len(text) > 10:
                body_paragraphs.append(text)

    if not body_paragraphs:
        main = soup.find("main") or soup.find("body")
        if main:
            for p in main.find_all("p"):
                text = clean_text(p.get_text())
                if text and len(text) > 20:
                    body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    entry = {"body": body_paragraphs}
    if scripture:
        entry["scripture"] = scripture
    if reference:
        entry["reference"] = reference

    title = f"{MONTHS[month-1].capitalize()} {day}"
    return {
        "slug": "streams-in-the-desert",
        "date": month_day,
        "title": title,
        "entries": [entry],
        "author": "L.B. Cowman",
        "source": "CCEL"
    }


# Only Spurgeon's Morning & Evening is confirmed on CCEL (verified URL scheme +
# markup via DIAGNOSE). Chambers/Cowman CCEL paths are still unknown — their
# scrapers stay defined but are NOT enabled here to avoid ~18min of guaranteed
# 404s per run. Re-add once their work IDs are discovered.
SCRAPERS = {
    "morning-evening": scrape_spurgeon,
}

# Defined but not yet enabled (see note above).
_UNVERIFIED_SCRAPERS = {
    "my-utmost": scrape_utmost,
    "streams-in-the-desert": scrape_streams,
}


def main():
    if os.environ.get("DIAGNOSE", "") == "1":
        probe_ccel()  # exits non-zero; nothing is scraped

    smoke = os.environ.get("SMOKE", "") == "1"

    for slug, scraper in SCRAPERS.items():
        slug_dir = os.path.join(OUT_DIR, slug)
        os.makedirs(slug_dir, exist_ok=True)

        if smoke:
            print(f"[SMOKE] {slug}: fetching Jan 1...")
            result = scraper(1, 1, "01-01")
            if not result:
                print(f"  FAIL: no content returned for {slug} Jan 1")
                sys.exit(1)
            if not result["entries"] or not result["entries"][0]["body"]:
                print(f"  FAIL: empty body for {slug} Jan 1")
                sys.exit(1)
            print(f"  OK: {len(result['entries'])} entry/entries, {sum(len(e['body']) for e in result['entries'])} paragraphs total")
            continue

        count = 0
        skipped = 0
        for month, day, month_day in all_month_days():
            out_path = os.path.join(slug_dir, f"{month_day}.json")
            if os.path.exists(out_path):
                skipped += 1
                continue

            result = scraper(month, day, month_day)
            if result:
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)
                count += 1
                print(f"  [{slug}] {month_day} -> {len(result['entries'])} entries")
            else:
                print(f"  [{slug}] {month_day} -> MISSING (no content)")

            time.sleep(DELAY)

        print(f"[{slug}] Done: {count} new, {skipped} skipped (already existed)")

    if smoke:
        print("Smoke test passed for all slugs.")


if __name__ == "__main__":
    main()
