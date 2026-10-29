#!/usr/bin/env python3
"""
Offline tests for the BibleGateway parser in fetch-biblegateway.py.

The markup below copies the exact structure BibleGateway served on a runner
(Oct 2026): class names, nesting, sup/span placement. The words are
placeholders, not scripture. Each case is a way the first parser lost or
garbled text:
  - combined verses ("Gen-8-3-Gen-8-4"): dropped entirely, which emptied NCV
    Numbers 7:12-83 and 37 other passages;
  - <span class="small-caps">Lord</span>. read "Lord ." on ~2,400 NCV verses;
  - a "-" placeholder verse (NCV 1 Cor 6:9) whose text sits in the next verse.

Run: python3 scripts/test-biblegateway-parser.py   (needs beautifulsoup4)
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("bg", os.path.join(HERE, "fetch-biblegateway.py"))
bg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bg)

passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  x {name}" + (f": {detail}" if detail else ""))


def page(body):
    return f'<html><body><div class="passage-text"><div class="passage-content">{body}</div></div></body></html>'


# 1. Combined verses, small caps, footnotes, cross-references, chapter number.
html = page("""
<h3><span class="text Gen-8-1">A Section Heading</span></h3>
<p class="chapter-1"><span class="text Gen-8-1"><span class="chapternum">8 </span>alpha beta the <span class="small-caps">Lord</span>.</span>
<span class="text Gen-8-2"><sup class="versenum">2 </sup>gamma<sup class="crossreference">(<a>A</a>)</sup> delta,</span>
<span class="text Gen-8-3-Gen-8-4"><sup class="versenum">3-4 </sup>epsilon zeta<sup class="footnote">[<a>a</a>]</sup> eta.</span>
<span class="text Gen-8-5"><sup class="versenum">5 </sup>theta the <span class="small-caps">Lord</span>’s iota.</span></p>
<div class="footnotes"><span class="text Gen-8-3">footnote text that is not scripture</span></div>
""")
v = bg.parse_passage(html, 8)
ok("keeps every entry, in order", [x["verse"] for x in v] == [1, 2, 3, 5], v)
ok("a combined verse keeps its text and its range", v[2] == {"verse": 3, "verseEnd": 4, "text": "epsilon zeta eta."}, v[2])
ok("small caps join without a space", v[0]["text"] == "alpha beta the Lord.", v[0]["text"])
ok("possessive after small caps joins", v[3]["text"] == "theta the Lord’s iota.", v[3]["text"])
ok("cross-reference marker removed", v[1]["text"] == "gamma delta,", v[1]["text"])
ok("headings and footnotes are not verse text", all("Heading" not in x["text"] and "footnote" not in x["text"] for x in v))
ok("chapter number removed from verse 1", not v[0]["text"].startswith("8"), v[0]["text"])

# 2. One passage standing for 72 verses (NCV Numbers 7:12-83).
html = page("".join(
    f'<span class="text Num-7-{n}"><sup class="versenum">{n} </sup>word{n}.</span>' for n in range(1, 12)
) + '<span class="text Num-7-12-Num-7-83"><sup class="versenum">12-83 </sup>first part.</span>'
  + '<span class="text Num-7-12-Num-7-83">second part.</span>'
  + "".join(f'<span class="text Num-7-{n}"><sup class="versenum">{n} </sup>word{n}.</span>' for n in range(84, 90)))
v = bg.parse_passage(html, 7)
big = [x for x in v if x["verse"] == 12]
ok("12-83 survives as one combined entry", big and big[0].get("verseEnd") == 83 and big[0]["text"] == "first part. second part.", big)
ok("Numbers 7 passes the completeness check", bg.check_chapter(v, "Numbers", 7) == [], bg.check_chapter(v, "Numbers", 7))
ok("without the combined entry it fails", bg.check_chapter([x for x in v if x["verse"] != 12], "Numbers", 7) != [])

# 3. A "-" placeholder whose text is in the next verse (NCV 1 Cor 6:9).
html = page('<span class="text 1Cor-6-8"><sup class="versenum">8 </sup>one.</span>'
            '<span class="text 1Cor-6-9"><sup class="versenum">9 </sup>-</span>'
            '<span class="text 1Cor-6-10"><sup class="versenum">10 </sup>two three.</span>')
v = bg.parse_passage(html, 6)
ok("the placeholder becomes a combined 9-10", v[1] == {"verse": 9, "verseEnd": 10, "text": "two three."}, v)

# 4. Psalm title kept as the start of verse 1; poetry lines and <br>.
html = page('<h3><span class="text Ps-23-1">Heading Words</span></h3>'
            '<h4 class="psalm-title"><span class="text Ps-23-1">A title line.</span></h4>'
            '<div class="poetry"><p class="line"><span class="text Ps-23-1"><span class="chapternum">23 </span>line one;</span><br/>'
            '<span class="text Ps-23-1">line two.</span></p>'
            '<p class="line"><span class="text Ps-23-2"><sup class="versenum">2 </sup>three<br/>four.</span></p></div>'
            '<h4 class="resources-header">Footnotes</h4>')
v = bg.parse_passage(html, 23)
ok("psalm title leads verse 1, heading does not", v[0]["text"] == "A title line. line one; line two.", v[0]["text"])
ok("a <br> inside a span is a space", v[1]["text"] == "three four.", v[1]["text"])

# 5. Table cells in one row are joined with a dash (NLT census tables).
html = page('<span class="text Num-1-20-Num-1-21"><sup class="versenum">20-21 </sup>intro:</span>'
            '<table><tr><th><span class="text Num-1-20-Num-1-21">Tribe</span></th><th><span class="text Num-1-20-Num-1-21">Number</span></th></tr>'
            '<tr><td><span class="text Num-1-20-Num-1-21">Reuben</span></td><td><span class="text Num-1-20-Num-1-21">46,500</span></td></tr></table>')
v = bg.parse_passage(html, 1)
ok("table rows read as 'cell — cell'", v[0]["text"] == "intro: Tribe — Number Reuben — 46,500", v[0]["text"])

# 6. Completeness rules.
def entries(*nums):
    return [{"verse": n, "text": f"text {n}"} for n in nums]
ok("3 John may end at 14", bg.check_chapter(entries(*range(1, 15)), "3 John", 1) == [])
ok("3 John may end at 15", bg.check_chapter(entries(*range(1, 16)), "3 John", 1) == [])
ok("a footnoted verse may be absent (Matt 17:21)", bg.check_chapter(entries(*[n for n in range(1, 28) if n != 21]), "Matthew", 17) == [])
ok("any other verse may not", "missing verses [20]" in "; ".join(bg.check_chapter(entries(*[n for n in range(1, 28) if n != 20]), "Matthew", 17)))
ok("out of order is caught", any("out of order" in p for p in bg.check_chapter(entries(1, 3, 2, *range(4, 32)), "Genesis", 1)))
ok("overlap is caught", any("overlapping" in p for p in bg.check_chapter([{"verse": 1, "verseEnd": 3, "text": "x"}] + entries(*range(3, 32)), "Genesis", 1)))
ok("empty text is caught", any("empty" in p for p in bg.check_chapter([{"verse": 1, "text": " "}] + entries(*range(2, 32)), "Genesis", 1)))
# Every verse number present but the text is a notice, not scripture (bolls NIV, Oct 2026).
notice = [{"verse": n, "text": "Some Publisher has prohibited me from using this translation."} for n in range(1, 32)]
ok("a notice in place of scripture is caught", any("notice" in p for p in bg.check_chapter(notice, "Genesis", 1)))
same = [{"verse": n, "text": "identical words"} for n in range(1, 32)]
ok("one text repeated in every verse is caught", any("identical" in p for p in bg.check_chapter(same, "Genesis", 1)))

# 7. Tidy leaves real punctuation alone.
ok("spaced ellipsis kept", bg.tidy("and so . . . they went") == "and so . . . they went", bg.tidy("and so . . . they went"))
ok("adjacent closing quotes keep their space", bg.tidy("he said.’ ”") == "he said.’ ”", bg.tidy("he said.’ ”"))
ok("artifact spaces removed", bg.tidy("“ the Lord , ( yes ) ”") == "“the Lord, (yes)”", bg.tidy("“ the Lord , ( yes ) ”"))

print()
if failed:
    print(f"BIBLEGATEWAY-PARSER FAIL {failed} / {passed + failed}")
    sys.exit(1)
print(f"BIBLEGATEWAY-PARSER PASS {passed} / {passed}")
