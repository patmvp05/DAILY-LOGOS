#!/usr/bin/env python3
"""
Scrape three public-domain devotionals and write them as static JSON
under public/devotionals/{slug}/{MM-DD}.json.

Sources:
  - morning-evening       (Spurgeon)  — CCEL          — 2 entries/day
  - my-utmost             (Chambers)  — utmost.org    — 1 entry/day
  - streams-in-the-desert (Cowman)    — crosswalk.com — 1 entry/day

Resumable: skips days whose files already exist. Set SMOKE=1 to fetch just
Jan 1 for each slug as a reachability check.

Run:  python scripts/fetch-devotionals.py
"""
import html as html_mod
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

# My Utmost (Chambers, 1927) and Streams in the Desert (Cowman, 1925) are public
# domain but NOT on CCEL. BibleGateway hosts both as dated devotionals with a
# clean per-day URL — and the CI runner can reach BibleGateway (proven by the
# NCV scraper). Use a real Chrome UA like that scraper does.
BG_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
bg_session = requests.Session()
bg_session.headers.update({"User-Agent": BG_UA, "Accept-Language": "en-US,en;q=0.9"})


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


def _clean_section(sec):
    """Strip CCEL nav/search/footer boilerplate from a content section in place."""
    for jid in ["reader-toc", "navbar-popup-loading", "navbar-popup-content",
                "ccel-footer", "copyright"]:
        for el in sec.find_all(id=jid):
            el.decompose()
    for tag in sec.find_all(["nav", "form", "script", "style", "button", "header", "footer"]):
        tag.decompose()


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


def _bg_fetch_with_retry(url, retries=MAX_RETRIES):
    """GET with Chrome UA + exponential backoff. Returns Response on 200, None on 404."""
    for attempt in range(retries):
        try:
            resp = bg_session.get(url, timeout=30, allow_redirects=True)
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


_utmost_date_map = None


def _load_utmost_date_map():
    """Fetch all classic posts via WP REST API, build MM-DD → {slug, title} map.

    The WP date field encodes the devotional calendar date: e.g. 2023-04-13 → April 13.
    Feb 29 uses a leap year (2024). We extract just the MM-DD portion.
    """
    global _utmost_date_map
    if _utmost_date_map is not None:
        return
    _utmost_date_map = {}
    page = 1
    while True:
        api_url = (
            f"https://utmost.org/wp-json/wp/v2/classic"
            f"?per_page=100&page={page}&_fields=date,slug,title"
        )
        try:
            r = bg_session.get(api_url, timeout=30)
            if r.status_code != 200:
                print(f"  WP API page {page}: HTTP {r.status_code}, stopping")
                break
            posts = r.json()
            if not posts:
                break
            for post in posts:
                date_str = post.get("date", "")
                if "T" not in date_str:
                    continue
                ymd = date_str.split("T")[0].split("-")
                if len(ymd) != 3:
                    continue
                mm_dd = f"{ymd[1]}-{ymd[2]}"
                _utmost_date_map[mm_dd] = {
                    "slug": post.get("slug", ""),
                    "title": (post.get("title") or {}).get("rendered", ""),
                }
            page += 1
            time.sleep(1)
        except Exception as e:
            print(f"  WP API error page {page}: {e}")
            break
    print(f"  Utmost date map: {len(_utmost_date_map)} entries loaded from WP API",
          flush=True)


def scrape_utmost(month, day, month_day):
    """
    Scrape My Utmost for His Highest (classic edition) from utmost.org.
    Uses WP REST API for date→slug mapping, then scrapes the page HTML.
    """
    _load_utmost_date_map()

    info = (_utmost_date_map or {}).get(month_day)
    if not info:
        return None

    slug = info["slug"]
    title = html_mod.unescape(info["title"]) if info["title"] else f"{MONTHS[month-1].capitalize()} {day}"
    url = f"https://utmost.org/classic/{slug}/"

    resp = _bg_fetch_with_retry(url)
    if not resp:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    content_widget = soup.select_one("div.elementor-widget-theme-post-content")
    body_paragraphs = []
    if content_widget:
        for p in content_widget.find_all("p"):
            text = clean_text(p.get_text())
            if text and len(text) > 10:
                body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    scripture = ""
    reference = ""
    for widget in soup.select("div.elementor-widget-text-editor"):
        text = clean_text(widget.get_text())
        if " -- " in text and len(text) < 500:
            parts = text.rsplit(" -- ", 1)
            if len(parts) == 2:
                scripture = _strip_quotes(parts[0].strip())
                reference = parts[1].strip()
                break

    entry = {"body": body_paragraphs}
    if scripture:
        entry["scripture"] = scripture
    if reference:
        entry["reference"] = reference

    return {
        "slug": "my-utmost",
        "date": month_day,
        "title": title,
        "entries": [entry],
        "author": "Oswald Chambers",
        "source": "utmost.org",
    }


def _ordinal(n):
    """1→'1st', 2→'2nd', 3→'3rd', 4→'4th', ..., 21→'21st', etc."""
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{['th','st','nd','rd'][min(n % 10, 4)] if n % 10 < 4 else 'th'}"


def scrape_streams(month, day, month_day):
    """
    Scrape Streams in the Desert from crosswalk.com.
    URL: /devotionals/desert/streams-in-the-desert-{month}-{ordinal}.html
    Confirmed working (probe round 4): per-day URLs serve unique content.
    """
    month_name = MONTHS[month - 1]
    ordinal = _ordinal(day)
    url = f"https://www.crosswalk.com/devotionals/desert/streams-in-the-desert-{month_name}-{ordinal}.html"
    resp = _bg_fetch_with_retry(url)
    if not resp:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    h1 = soup.find("h1")
    title = clean_text(h1.get_text()) if h1 else f"{month_name.capitalize()} {day}"
    if " - " in title:
        title = title.split(" - ", 1)[-1].strip()

    article = soup.find("article")
    if not article:
        return None

    body_paragraphs = []
    scripture = ""
    reference = ""

    for p in article.find_all("p"):
        if p.get("class"):
            continue
        text = clean_text(p.get_text())
        if not text or len(text) < 15:
            continue
        body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    first = body_paragraphs[0]
    ref_match = re.search(r'\(([A-Z0-9][a-zA-Z]*\.?\s+\d+[:\d\-,;\s]*(?:[a-zA-Z]*\.?\s*\d*[:\d\-,;\s]*)*)\)\s*$', first)
    if ref_match:
        reference = ref_match.group(1).strip()
        scripture = first[:ref_match.start()].strip()
        body_paragraphs = body_paragraphs[1:]

    if not body_paragraphs:
        return None

    entry = {"body": body_paragraphs}
    if scripture:
        entry["scripture"] = _strip_quotes(scripture)
    if reference:
        entry["reference"] = reference

    return {
        "slug": "streams-in-the-desert",
        "date": month_day,
        "title": title,
        "entries": [entry],
        "author": "L.B. Cowman",
        "source": "Crosswalk",
    }


SCRAPERS = {
    "morning-evening": scrape_spurgeon,
    "my-utmost": scrape_utmost,
    "streams-in-the-desert": scrape_streams,
}


def main():
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
