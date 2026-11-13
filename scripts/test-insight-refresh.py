"""
Offline test of how scripts/fetch-devotionals.py treats Insight for Living.

Insight is the one devotional that is not perennial: the site keeps only recent
posts and files are named by month-day, so a post for 03-19 in 2027 has to
REPLACE the 2026 file. The scraper used to skip every file that already
existed, which would have frozen it on last year's text from 19 March 2027.

No network: the site's date map is filled in by hand.

Run with: python3 scripts/test-insight-refresh.py
"""
import importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fd", os.path.join(HERE, "fetch-devotionals.py"))
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)

passed = failed = 0
def ok(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1
        print(f"✗ {name}{': ' + detail if detail else ''}")

def post(title, body):
    return {"slug": "x", "title": title,
            "content": f'<blockquote>"A verse." (John 3:16)</blockquote><p class="wp-block-paragraph">{body}</p>'}

with tempfile.TemporaryDirectory() as out:
    fd.OUT_DIR = out
    fd.SCRAPERS = {"insight-for-living": fd.scrape_insight}
    fd.DELAY = 0
    path = os.path.join(out, "insight-for-living", "03-19.json")

    # 2026: the post for 03-19 is written.
    fd._insight_date_map = {"03-19": post("Old title", "Last year's devotional text, long enough.")}
    fd.main()
    ok("a new post is written", os.path.exists(path))
    first = json.load(open(path))
    ok("with its own title", first["title"] == "Old title")

    # Unchanged: nothing is rewritten (no git diff every night).
    mtime = os.stat(path).st_mtime_ns
    fd._insight_date_map = {"03-19": post("Old title", "Last year's devotional text, long enough.")}
    fd.main()
    ok("an unchanged post is not rewritten", os.stat(path).st_mtime_ns == mtime)

    # 2027: the site's post for 03-19 is a different one. It must win.
    fd._insight_date_map = {"03-19": post("New title", "This year's devotional text, long enough.")}
    fd.main()
    again = json.load(open(path))
    ok("next year's post replaces the old file", again["title"] == "New title", again["title"])
    ok("including its text", "This year" in again["entries"][0]["body"][0])

    # A day the site no longer lists keeps what is on disk.
    fd._insight_date_map = {"03-20": post("Other", "Another devotional text, long enough.")}
    fd.main()
    ok("a day outside the site's window is kept", json.load(open(path))["title"] == "New title")

    # The three perennial devotionals still skip files that exist.
    fd.SCRAPERS = {"my-utmost": lambda m, d, md: {"slug": "my-utmost", "date": md, "title": "NEW", "entries": [{"body": ["x"]}], "author": "a", "source": "s"}}
    os.makedirs(os.path.join(out, "my-utmost"), exist_ok=True)
    keep = os.path.join(out, "my-utmost", "01-01.json")
    json.dump({"title": "ORIGINAL"}, open(keep, "w"))
    fd.all_month_days = lambda: [(1, 1, "01-01")]
    fd.main()
    ok("a perennial devotional's existing file is never overwritten", json.load(open(keep))["title"] == "ORIGINAL")

print(f"INSIGHT-REFRESH {'PASS' if failed == 0 else 'FAIL'} {passed} / {passed + failed}")
sys.exit(1 if failed else 0)
