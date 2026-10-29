# Temporary probe: how does BibleGateway mark up combined verses (e.g. NCV Genesis 8:3-4)?
import json, os, requests
from bs4 import BeautifulSoup
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
s = requests.Session(); s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
os.makedirs("probe/out", exist_ok=True)
for version, book, ch in [("NIV","Psalms",1),("NIV","Psalms",42),("NIV","Psalms",90),("NIV","Song of Solomon",1),("NIV","Habakkuk",3)]:
    r = s.get("https://www.biblegateway.com/passage/", params={"search": f"{book} {ch}", "version": version}, timeout=30)
    soup = BeautifulSoup(r.text, "html.parser")
    div = soup.select_one("div.passage-text")
    tag = f"{version}-{book.replace(' ','')}-{ch}"
    rows = []
    for el in (div.find_all(True) if div else []):
        if el.name in ("span","sup","table","tr","td","th","div","p") :
            rows.append({"tag": el.name, "class": el.get("class"), "id": el.get("id"), "text": el.get_text(" ", strip=True)[:60]})
    json.dump({"status": r.status_code, "found_div": bool(div), "elements": rows}, open(f"probe/out/{tag}.json","w"), indent=0, ensure_ascii=False)
    if div:
        open(f"probe/out/{tag}.html","w").write(div.prettify()[:200000])
    print(tag, r.status_code, bool(div), len(rows))
