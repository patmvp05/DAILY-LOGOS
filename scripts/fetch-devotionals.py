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


_QUOTE_CHARS = "“”‘’\"'"


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
    """1→1st, 2→2nd, 3→3rd, 4→4th, ..., 21→21st, etc."""
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


_insight_date_map = None


def _load_insight_date_map():
    """Fetch all daily-devotional posts via WP REST API, build MM-DD → {slug, title, content} map.

    The WP date field encodes the devotional calendar date (e.g. 2026-06-19T00:00:00).
    Only ~93 posts are available at a time (rolling window), so many days will be missing.
    """
    global _insight_date_map
    if _insight_date_map is not None:
        return
    _insight_date_map = {}
    page = 1
    while True:
        api_url = (
            f"https://insight.org/wp-json/wp/v2/daily-devotional"
            f"?per_page=100&page={page}&_fields=date,slug,title,content"
        )
        try:
            r = bg_session.get(api_url, timeout=30)
            if r.status_code != 200:
                print(f"  Insight API page {page}: HTTP {r.status_code}, stopping")
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
                _insight_date_map[mm_dd] = {
                    "slug": post.get("slug", ""),
                    "title": (post.get("title") or {}).get("rendered", ""),
                    "content": (post.get("content") or {}).get("rendered", ""),
                }
            page += 1
            time.sleep(1)
        except Exception as e:
            print(f"  Insight API error page {page}: {e}")
            break
    print(f"  Insight date map: {len(_insight_date_map)} entries loaded from WP API",
          flush=True)


def scrape_insight(month, day, month_day):
    """
    Scrape Insight for Living (Chuck Swindoll) from insight.org WP REST API.
    Content is served directly as HTML in the API response — no page scraping needed.
    """
    _load_insight_date_map()

    info = (_insight_date_map or {}).get(month_day)
    if not info:
        return None

    title = html_mod.unescape(info["title"]) if info["title"] else f"{MONTHS[month-1].capitalize()} {day}"
    content_html = info.get("content", "")
    if not content_html:
        return None

    soup = BeautifulSoup(content_html, "html.parser")

    scripture = ""
    reference = ""
    body_paragraphs = []

    bq = soup.find("blockquote")
    if bq:
        bq_text = clean_text(bq.get_text())
        ref_match = re.search(r'\(([A-Z0-9][a-zA-Z]*\.?\s+\d+[:\d\-,;\s]*(?:[a-zA-Z]*\.?\s*\d*[:\d\-,;\s]*)*)\)\s*$', bq_text)
        if ref_match:
            reference = ref_match.group(1).strip()
            scripture = _strip_quotes(bq_text[:ref_match.start()].strip())
        else:
            scripture = _strip_quotes(bq_text)
        bq.decompose()

    for p in soup.find_all("p", class_="wp-block-paragraph"):
        text = clean_text(p.get_text())
        if not text or len(text) < 10:
            continue
        if any(skip in text for skip in ["GET DEVOTIONAL", "Sign up to receive", "Chuck Swindoll explains that Insight"]):
            continue
        body_paragraphs.append(text)

    if not body_paragraphs:
        return None

    entry = {"body": body_paragraphs}
    if scripture:
        entry["scripture"] = scripture
    if reference:
        entry["reference"] = reference

    return {
        "slug": "insight-for-living",
        "date": month_day,
        "title": title,
        "entries": [entry],
        "author": "Charles R. Swindoll",
        "source": "insight.org",
    }


SCRAPERS = {
    "morning-evening": scrape_spurgeon,
    "my-utmost": scrape_utmost,
    "streams-in-the-desert": scrape_streams,
    "insight-for-living": scrape_insight,
}


def _probe_url(url, label=""):
    """Fetch a URL with Chrome UA and dump structure to stdout for CI log analysis."""
    tag = f"[PROBE {label}]" if label else "[PROBE]"
    print(f"\n{tag} GET {url}")
    try:
        resp = bg_session.get(url, timeout=30, allow_redirects=True)
        print(f"  Status: {resp.status_code}")
        print(f"  Content-Type: {resp.headers.get('Content-Type', 'unknown')}")
        print(f"  Final URL: {resp.url}")

        if resp.status_code != 200:
            print(f"  Body preview: {resp.text[:500]}")
            return

        ct = resp.headers.get("Content-Type", "")
        if "json" in ct or "xml" in ct or "rss" in ct or "atom" in ct:
            print(f"  Body (first 5000 chars):\n{resp.text[:5000]}")
            return

        soup = BeautifulSoup(resp.text, "html.parser")

        title_tag = soup.find("title")
        if title_tag:
            print(f"  <title>: {clean_text(title_tag.get_text())}")

        for link in soup.find_all("link", attrs={"type": True}):
            lt = link.get("type", "")
            if "rss" in lt or "atom" in lt or "xml" in lt:
                print(f"  RSS/Atom link: {link.get('href', '')} (type={lt})")

        hrefs = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if any(kw in href.lower() for kw in ["devotional", "daily", "devoti", "swindoll"]):
                hrefs.add(href)
        if hrefs:
            print(f"  Relevant <a> hrefs ({len(hrefs)}):")
            for h in sorted(hrefs)[:30]:
                print(f"    {h}")

        h1 = soup.find("h1")
        if h1:
            print(f"  <h1>: {clean_text(h1.get_text())}")

        article = soup.find("article")
        if article:
            paras = [clean_text(p.get_text()) for p in article.find_all("p") if clean_text(p.get_text())]
            print(f"  <article> found: {len(paras)} paragraphs")
            for p in paras[:5]:
                print(f"    {p[:200]}")

        main_el = soup.find("main") or soup.find("div", {"role": "main"})
        if main_el and not article:
            paras = [clean_text(p.get_text()) for p in main_el.find_all("p") if clean_text(p.get_text())]
            print(f"  <main> found: {len(paras)} paragraphs")
            for p in paras[:5]:
                print(f"    {p[:200]}")

        if not article and not main_el:
            print(f"  Body preview (first 3000 chars of HTML):\n{resp.text[:3000]}")

    except Exception as e:
        print(f"  ERROR: {e}")


def probe_insight():
    """Probe insight.org — round 2: WP sitemap, REST API, individual page HTML."""
    print("=" * 60)
    print("INSIGHT FOR LIVING — PROBE ROUND 2")
    print("=" * 60)

    # 1) WP sitemap for daily-devotional custom post type
    print("\n--- WP Sitemap: daily-devotional posts ---")
    sitemap_url = "https://insight.org/wp-sitemap-posts-daily-devotional-1.xml"
    resp = bg_session.get(sitemap_url, timeout=30)
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.text, "xml")
        locs = [loc.text for loc in soup.find_all("loc")]
        print(f"  Total URLs in sitemap: {len(locs)}")
        for u in locs[:10]:
            print(f"    {u}")
        if len(locs) > 10:
            print(f"    ... ({len(locs) - 10} more)")
            for u in locs[-5:]:
                print(f"    {u}")
        lastmods = [lm.text for lm in soup.find_all("lastmod")]
        if lastmods:
            print(f"  Date range: {lastmods[-1]} to {lastmods[0]}")
    else:
        print(f"  Body preview: {resp.text[:500]}")
    time.sleep(2)

    # 2) WP REST API for daily-devotional
    print("\n--- WP REST API: /wp-json/wp/v2/daily-devotional ---")
    api_url = "https://insight.org/wp-json/wp/v2/daily-devotional?per_page=3&_fields=id,date,slug,title,content,excerpt,meta"
    resp = bg_session.get(api_url, timeout=30)
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        try:
            posts = resp.json()
            print(f"  Posts returned: {len(posts)}")
            for post in posts:
                print(f"  ---")
                print(f"  id={post.get('id')} slug={post.get('slug')} date={post.get('date')}")
                title = post.get("title", {}).get("rendered", "")
                print(f"  title: {title}")
                content = post.get("content", {}).get("rendered", "")
                print(f"  content length: {len(content)} chars")
                print(f"  content preview: {content[:500]}")
                meta = post.get("meta", {})
                if meta:
                    print(f"  meta keys: {list(meta.keys()) if isinstance(meta, dict) else meta}")
                excerpt = post.get("excerpt", {}).get("rendered", "")
                if excerpt:
                    print(f"  excerpt: {excerpt[:300]}")
        except Exception as e:
            print(f"  JSON parse error: {e}")
            print(f"  Body: {resp.text[:500]}")
    else:
        print(f"  Body: {resp.text[:500]}")
    time.sleep(2)

    # 2b) Try alternate REST API route names
    for route in ["daily-devotionals", "devotional", "devotionals"]:
        alt_url = f"https://insight.org/wp-json/wp/v2/{route}?per_page=1&_fields=id,slug,title"
        resp = bg_session.get(alt_url, timeout=30)
        print(f"\n  REST /wp/v2/{route}: {resp.status_code}")
        if resp.status_code == 200:
            print(f"    {resp.text[:300]}")
    time.sleep(2)

    # 3) Individual devotional page — parse HTML structure
    print("\n--- Individual devotional page ---")
    page_url = "https://insight.org/resources/daily-devotional/are-you-lost"
    resp = bg_session.get(page_url, timeout=30)
    print(f"  URL: {page_url}")
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.text, "html.parser")
        title = soup.find("title")
        print(f"  <title>: {title.get_text().strip() if title else 'NONE'}")

        h1 = soup.find("h1")
        print(f"  <h1>: {h1.get_text().strip() if h1 else 'NONE'}")

        # Look for meta tags with date info
        for meta in soup.find_all("meta"):
            name = meta.get("property", meta.get("name", ""))
            if any(kw in name.lower() for kw in ["date", "publish", "modified", "time"]):
                print(f"  meta[{name}]: {meta.get('content', '')}")

        # Dump all heading tags within article/main
        article = soup.find("article") or soup.find("main") or soup.find("div", {"role": "main"})
        container_name = "article" if soup.find("article") else "main"
        if article:
            print(f"\n  Container: <{container_name}>")

            # All headings
            for level in ["h1", "h2", "h3", "h4"]:
                for h in article.find_all(level):
                    print(f"    <{level}>: {h.get_text().strip()[:150]}")

            # Classes on direct children
            print(f"\n  Direct children tags+classes:")
            for child in article.children:
                if hasattr(child, 'name') and child.name:
                    cls = child.get("class", [])
                    text_preview = child.get_text().strip()[:80]
                    print(f"    <{child.name} class=\"{' '.join(cls)}\">{text_preview}")

            # All paragraphs
            paras = article.find_all("p")
            print(f"\n  Paragraphs in <{container_name}>: {len(paras)}")
            for i, p in enumerate(paras):
                cls = p.get("class", [])
                text = p.get_text().strip()
                print(f"    p[{i}] class={cls}: {text[:200]}")

            # Blockquotes (often used for scripture)
            bqs = article.find_all("blockquote")
            if bqs:
                print(f"\n  Blockquotes: {len(bqs)}")
                for i, bq in enumerate(bqs):
                    print(f"    bq[{i}]: {bq.get_text().strip()[:200]}")

            # Look for scripture reference patterns
            for em in article.find_all(["em", "i", "cite", "span"]):
                text = em.get_text().strip()
                if re.search(r'\d+:\d+', text) or any(book in text for book in ["Genesis", "Exodus", "Psalm", "Matthew", "John", "Romans", "Acts"]):
                    cls = em.get("class", [])
                    print(f"    Scripture ref? <{em.name} class={cls}>: {text[:150]}")

        else:
            print("  No <article> or <main> found")
            print(f"  Body preview:\n{resp.text[:3000]}")
    time.sleep(2)

    # 4) Try a second devotional page to confirm structure consistency
    print("\n--- Second devotional page ---")
    page_url2 = "https://insight.org/resources/daily-devotional/change-your-routine"
    resp = bg_session.get(page_url2, timeout=30)
    print(f"  URL: {page_url2}")
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.text, "html.parser")
        h1 = soup.find("h1")
        print(f"  <h1>: {h1.get_text().strip() if h1 else 'NONE'}")

        article = soup.find("article") or soup.find("main")
        if article:
            paras = article.find_all("p")
            print(f"  Paragraphs: {len(paras)}")
            for i, p in enumerate(paras):
                cls = p.get("class", [])
                text = p.get_text().strip()
                print(f"    p[{i}] class={cls}: {text[:200]}")

    # 5) Check the main listing page for date extraction
    print("\n--- Main listing page: date extraction ---")
    resp = bg_session.get("https://insight.org/resources/daily-devotional", timeout=30)
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.text, "html.parser")
        # Look for structured date elements near devotional links
        links = soup.find_all("a", href=re.compile(r"/resources/daily-devotional/[a-z]"))
        print(f"  Devotional links found: {len(links)}")
        for link in links[:8]:
            href = link.get("href", "")
            # Check parent and siblings for date info
            parent = link.parent
            text = link.get_text().strip()
            parent_text = parent.get_text().strip() if parent else ""
            parent_cls = parent.get("class", []) if parent else []
            print(f"    href={href}")
            print(f"      link text: {text[:100]}")
            print(f"      parent <{parent.name if parent else '?'} class={parent_cls}>: {parent_text[:150]}")
            # Check for time/date elements nearby
            time_el = parent.find("time") if parent else None
            if time_el:
                print(f"      <time>: datetime={time_el.get('datetime', '')} text={time_el.get_text().strip()}")

    print("\n" + "=" * 60)
    print("PROBE ROUND 2 COMPLETE")
    print("=" * 60)


def main():
    if os.environ.get("PROBE", "") == "insight":
        probe_insight()
        return

    smoke = os.environ.get("SMOKE", "") == "1"

    for slug, scraper in SCRAPERS.items():
        slug_dir = os.path.join(OUT_DIR, slug)
        os.makedirs(slug_dir, exist_ok=True)

        if smoke:
            if slug == "insight-for-living":
                import datetime
                today = datetime.date.today()
                smoke_m, smoke_d = today.month, today.day
                smoke_md = f"{smoke_m:02d}-{smoke_d:02d}"
            else:
                smoke_m, smoke_d, smoke_md = 1, 1, "01-01"
            print(f"[SMOKE] {slug}: fetching {smoke_md}...")
            result = scraper(smoke_m, smoke_d, smoke_md)
            if not result:
                print(f"  FAIL: no content returned for {slug} {smoke_md}")
                sys.exit(1)
            if not result["entries"] or not result["entries"][0]["body"]:
                print(f"  FAIL: empty body for {slug} {smoke_md}")
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
