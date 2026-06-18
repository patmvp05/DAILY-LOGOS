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

# BibleGateway devotional slugs (confirmed via DIAGNOSE=bg probe). Date page:
#   https://www.biblegateway.com/devotionals/{slug}/{YYYY}/{MM}/{DD}
BG_UTMOST_SLUG = "my-utmost-for-his-highest"
BG_STREAMS_SLUG = "streams-in-the-desert"

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


def _bg_get(url, params=None):
    try:
        return bg_session.get(url, params=params, timeout=30, allow_redirects=True)
    except requests.RequestException as e:
        print(f"    EXCEPTION: {e}")
        return None


def _dump_blocks(sec, limit=60):
    """Print <tag.class> text[:160] for block elements inside a section."""
    n = 0
    for el in sec.find_all(["h1", "h2", "h3", "h4", "h5", "p", "blockquote", "cite"]):
        txt = clean_text(el.get_text())
        if not txt:
            continue
        cls = ".".join(el.get("class", [])) or "(none)"
        print(f"      <{el.name}.{cls}> {txt[:160]}")
        n += 1
        if n >= limit:
            print("      … (truncated)")
            break


def _probe_page(url, label):
    """Fetch a URL, dump title + container structure + raw HTML. Returns soup or None."""
    print(f"\n### {label}: GET {url}")
    r = _bg_get(url)
    if not (r and r.status_code == 200):
        print(f"    status={r.status_code if r else 'ERR'} final={r.url if r else ''}")
        return None
    print(f"    final={r.url}")
    soup = BeautifulSoup(r.text, "html.parser")
    title = soup.find("title")
    print(f"    <title>: {clean_text(title.get_text()) if title else '(none)'}")
    sec = None
    for sel in ["article", "div.entry-content", "div.post-content",
                "div.devotional-content", "div.content-body", "div.content", "main"]:
        sec = soup.select_one(sel)
        if sec:
            print(f"    container: {sel}")
            break
    if not sec:
        sec = soup.body
        print("    container: <body>")
    if sec:
        _dump_blocks(sec)
    if sec and sec != soup.body:
        raw = sec.decode()[:2500]
        print(f"\n    >> RAW HTML (first 2500 chars):")
        for line in raw.split("\n")[:80]:
            print(f"    {line}")
    return soup


def probe_biblegateway():
    """
    DIAGNOSTIC round 6: find date metadata on utmost.org classic reading pages,
    try WP API for "classic" custom post type, and test CCEL Chambers URL.
    """

    # 1. Deep-inspect a classic reading page for date indicators
    sample_url = "https://utmost.org/classic/what-to-do-under-the-conditions-classic/"
    print(f"\n### Deep inspect classic page: {sample_url}")
    r = _bg_get(sample_url)
    if r and r.status_code == 200:
        soup = BeautifulSoup(r.text, "html.parser")

        # Meta tags (og:, article:, etc.)
        print("    META TAGS:")
        for meta in soup.find_all("meta"):
            name = meta.get("property") or meta.get("name") or ""
            content = meta.get("content", "")
            if any(k in name.lower() for k in ["date", "time", "publish", "modif", "article"]):
                print(f"      {name} = {content}")
            if any(k in name.lower() for k in ["og:", "twitter:"]):
                print(f"      {name} = {content[:120]}")

        # <time> elements
        for t in soup.find_all("time"):
            print(f"    <time>: datetime={t.get('datetime')} text={clean_text(t.get_text())[:80]}")

        # JSON-LD structured data
        for script in soup.find_all("script", type="application/ld+json"):
            print(f"    JSON-LD: {script.string[:500] if script.string else 'empty'}")

        # All h2/h3/h4 elements (date might be in a heading)
        print("    HEADINGS:")
        for tag in ["h1", "h2", "h3", "h4"]:
            for el in soup.find_all(tag):
                txt = clean_text(el.get_text())[:120]
                if txt:
                    print(f"      <{tag}>: {txt}")

        # Elementor widgets — look for date widget or scripture widget
        print("    ELEMENTOR WIDGETS:")
        for w in soup.select("div.elementor-widget"):
            wtype = " ".join(w.get("class", []))
            txt = clean_text(w.get_text())[:150]
            if txt and len(txt) > 5:
                print(f"      [{wtype[:80]}]: {txt}")

    # 2. Try WP REST API for "classic" custom post type
    wp_endpoints = [
        ("classic CPT", "https://utmost.org/wp-json/wp/v2/classic?per_page=3"),
        ("WP types", "https://utmost.org/wp-json/wp/v2/types"),
        ("classic by slug", "https://utmost.org/wp-json/wp/v2/classic?slug=what-to-do-under-the-conditions-classic&per_page=1"),
    ]
    for label, url in wp_endpoints:
        print(f"\n### {label}: GET {url}")
        r = _bg_get(url)
        if not r:
            print("    ERR (no response)")
            continue
        print(f"    status={r.status_code}")
        if r.status_code == 200:
            text = r.text[:3000]
            print(f"    response (first 3000 chars):")
            for line in text.split("\n")[:50]:
                print(f"    {line[:200]}")

    # 3. Test CCEL Chambers URLs
    ccel_urls = [
        ("CCEL chambers jan1", "https://www.ccel.org/ccel/chambers/utmost/january01.html"),
        ("CCEL chambers jan1 v2", "https://www.ccel.org/ccel/c/chambers/utmost/january01.html"),
        ("CCEL chambers index", "https://www.ccel.org/ccel/chambers/utmost.html"),
        ("CCEL chambers index v2", "https://www.ccel.org/ccel/c/chambers/utmost.html"),
    ]
    for label, url in ccel_urls:
        print(f"\n### {label}: GET {url}")
        r = _bg_get(url)
        if not r:
            print("    ERR (no response)")
            continue
        print(f"    status={r.status_code} final={r.url}")
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            h1 = soup.find("h1")
            if h1:
                print(f"    <h1>: {clean_text(h1.get_text())[:150]}")
            links = [a["href"] for a in soup.find_all("a", href=True)
                     if "chambers" in a["href"] or "utmost" in a["href"]]
            if links:
                print(f"    relevant links ({len(links)}):")
                for l in links[:15]:
                    print(f"      {l}")

    print("\n[DIAGNOSE=bg] probe complete — exiting non-zero so nothing is scraped.")
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

    # Body from the Elementor post-content widget
    content_widget = soup.select_one("div.elementor-widget-theme-post-content")
    body_paragraphs = []
    if content_widget:
        for p in content_widget.find_all("p"):
            text = clean_text(p.get_text())
            if text and len(text) > 10:
                body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    # Scripture: Elementor text-editor widget with "verse -- reference" pattern
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


def scrape_streams(month, day, month_day):
    """
    Scrape Streams in the Desert from crosswalk.com.
    URL: /devotionals/desert/streams-in-the-desert-{month}-{ordinal}.html
    Confirmed working (round 4 probe): per-day URLs serve unique content.
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

    # First paragraph often contains the scripture quote + reference
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
    diag = os.environ.get("DIAGNOSE", "")
    if diag == "bg":
        probe_biblegateway()  # exits non-zero; nothing is scraped
    if diag == "1":
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
