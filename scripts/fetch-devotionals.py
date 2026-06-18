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


def probe_ccel():
    """
    DIAGNOSTIC: fetch CCEL's known-good entry points and dump their real URL
    scheme + HTML structure into the logs, so we can write a correct parser
    without guessing. Exits non-zero so nothing is scraped/committed on a
    diagnostic run.

    `morneve.today.html` / `morneve.toc.html` are confirmed-real CCEL URLs;
    the `today` page reveals the canonical per-day URL via its redirect /
    <link rel=canonical>, and dumping the content div shows how scripture and
    body are marked up.
    """
    candidates = {
        "spurgeon/morneve": [
            "https://www.ccel.org/ccel/spurgeon/morneve.today.html",
            "https://www.ccel.org/ccel/spurgeon/morneve.toc.html",
            "https://www.ccel.org/ccel/spurgeon/morneve.d0101am.html",
        ],
        "chambers/utmost": [
            "https://www.ccel.org/ccel/chambers/utmost.today.html",
            "https://www.ccel.org/ccel/chambers/utmost.toc.html",
            "https://www.ccel.org/ccel/chambers/utmost.html",
        ],
        "cowman/streams": [
            "https://www.ccel.org/ccel/cowman/streams.today.html",
            "https://www.ccel.org/ccel/cowman/streams.toc.html",
            "https://www.ccel.org/ccel/c/cowman/streams/streams.html",
        ],
    }

    for work, urls in candidates.items():
        print(f"\n{'='*70}\nWORK: {work}\n{'='*70}")
        for url in urls:
            print(f"\n--- GET {url}")
            try:
                resp = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
            except requests.RequestException as e:
                print(f"    EXCEPTION: {e}")
                continue
            print(f"    status={resp.status_code}  final_url={resp.url}")
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            title = soup.find("title")
            print(f"    <title>: {clean_text(title.get_text()) if title else '(none)'}")

            canon = soup.find("link", rel="canonical")
            if canon and canon.get("href"):
                print(f"    canonical: {canon['href']}")
            og = soup.find("meta", property="og:url")
            if og and og.get("content"):
                print(f"    og:url: {og['content']}")

            # Internal links that reveal the per-reading URL scheme.
            work_leaf = work.split("/")[-1]
            seen = []
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if work_leaf in h and h not in seen:
                    seen.append(h)
                if len(seen) >= 12:
                    break
            print(f"    sample links containing '{work_leaf}':")
            for h in seen:
                print(f"      {h}")

            # Dump candidate content containers + how scripture/body look.
            for sel in [
                ("div", {"class": "text"}),
                ("div", {"id": "content-main"}),
                ("div", {"class": "ccel-text"}),
                ("article", {}),
                ("div", {"id": "main"}),
            ]:
                tag, attrs = sel
                el = soup.find(tag, attrs=attrs) if attrs else soup.find(tag)
                if el:
                    snippet = el.decode()[:1500]
                    print(f"    >> container <{tag} {attrs}> first 1500 chars of HTML:")
                    print("    " + snippet.replace("\n", "\n    "))
                    break
            else:
                body = soup.find("body")
                if body:
                    print("    >> NO known container matched; first 1200 chars of <body>:")
                    print("    " + body.decode()[:1200].replace("\n", "\n    "))

    print("\n[DIAGNOSE] probe complete — exiting non-zero so nothing is scraped.")
    sys.exit(1)


def clean_text(text):
    """Strip HTML, normalize whitespace."""
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def scrape_spurgeon(month, day, month_day):
    """Scrape Spurgeon's Morning and Evening from CCEL."""
    month_name = MONTHS[month - 1]
    # CCEL URL pattern: /d/spurgeon/morning_evening/morning_evening.{MonthDD}.html
    # Try both morning and evening
    entries = []

    for period in ["morning", "evening"]:
        # CCEL uses: /ccel/s/spurgeon/morning_evening/{period}/{month_name}{day:02d}
        url = f"https://www.ccel.org/ccel/s/spurgeon/morning_evening/{period}/{month_name}{day:02d}.html"
        resp = fetch_with_retry(url)
        if not resp:
            # Try alternate URL pattern
            url = f"https://www.ccel.org/ccel/spurgeon/morning_evening/{period}/{month_name}{day:02d}.html"
            resp = fetch_with_retry(url)
        if not resp:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")

        # Extract scripture reference and text
        scripture = ""
        reference = ""
        body_paragraphs = []

        # Look for the scripture verse (usually in a blockquote or specific div)
        verse_el = soup.find("p", class_="verse") or soup.find("blockquote")
        if verse_el:
            scripture = clean_text(verse_el.get_text())

        # Look for reference
        ref_el = soup.find("p", class_="ref") or soup.find("cite")
        if ref_el:
            reference = clean_text(ref_el.get_text())

        # Extract body text
        content_div = soup.find("div", class_="text") or soup.find("div", id="content-main") or soup.find("article")
        if content_div:
            for p in content_div.find_all("p"):
                cls = p.get("class", [])
                if "verse" in cls or "ref" in cls:
                    continue
                text = clean_text(p.get_text())
                if text and len(text) > 10:
                    body_paragraphs.append(text)

        # If no structured content found, try getting all text
        if not body_paragraphs:
            main = soup.find("main") or soup.find("body")
            if main:
                for p in main.find_all("p"):
                    text = clean_text(p.get_text())
                    if text and len(text) > 20:
                        body_paragraphs.append(text)

        if body_paragraphs:
            entry = {"period": period, "body": body_paragraphs}
            if scripture:
                entry["scripture"] = scripture
            if reference:
                entry["reference"] = reference
            entries.append(entry)

    if not entries:
        return None

    title = f"{MONTHS[month-1].capitalize()} {day}"
    return {
        "slug": "morning-evening",
        "date": month_day,
        "title": title,
        "entries": entries,
        "author": "Charles H. Spurgeon",
        "source": "CCEL"
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


SCRAPERS = {
    "morning-evening": scrape_spurgeon,
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
