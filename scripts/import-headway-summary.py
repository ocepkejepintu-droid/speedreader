#!/usr/bin/env python3
"""Extract a Headway book summary via Kimi WebBridge and save to summaries-data/.

Usage:
  python3 scripts/import-headway-summary.py the-art-of-war
  python3 scripts/import-headway-summary.py the-art-of-war --title "The Art of War" --author "Sun Tzu"

Requires: Kimi WebBridge running (extension_connected: true), logged-in Headway tab.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

WEBBRIDGE = "http://127.0.0.1:10086/command"
SESSION = "headway"
WAIT_SEC = 3.0

EXTRACT_JS = r"""(() => {
  const main = document.querySelector('main') || document.body;
  const paras = [...main.querySelectorAll('p')]
    .map(p => p.innerText.trim())
    .filter(t => t.length > 15);
  return JSON.stringify({ text: paras.join('\n\n') });
})()"""

LIST_KEYPOINTS_JS = r"""(() => {
  const links = [...document.querySelectorAll('a')]
    .filter(a => a.href.includes('summary?page='))
    .map(a => {
      const m = a.href.match(/page=(\d+)/);
      const text = a.innerText.replace(/\s+/g, ' ').trim();
      const title = text.replace(/^\d+\s*/, '').trim();
      return { page: m ? Number(m[1]) : 0, title, href: a.href };
    })
    .filter(x => x.page > 0 && x.title);
  const seen = new Set();
  const unique = [];
  for (const item of links.sort((a, b) => a.page - b.page)) {
    if (seen.has(item.page)) continue;
    seen.add(item.page);
    unique.push(item);
  }
  return JSON.stringify(unique);
})()"""


def wb(action: str, args: dict) -> dict:
    body = json.dumps({"action": action, "args": args, "session": SESSION}).encode()
    req = urllib.request.Request(WEBBRIDGE, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    if not data.get("ok"):
        raise RuntimeError(data.get("error", data))
    return data.get("data", {})


def word_count(text: str) -> int:
    return len(text.split()) if text.strip() else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Headway summary into RSVP summaries-data/")
    parser.add_argument("slug", help="Headway book slug, e.g. the-art-of-war")
    parser.add_argument("--title", help="Book title (default: from Headway h1)")
    parser.add_argument("--author", default="", help="Author name")
    parser.add_argument("--out-dir", default="summaries-data", help="Output directory")
    parser.add_argument("--wait", type=float, default=WAIT_SEC, help="Seconds between page loads")
    args = parser.parse_args()

    slug = args.slug.strip().lower()
    book_url = f"https://app.makeheadway.com/books/{slug}"

    wb("find_tab", {"url": "app.makeheadway.com", "active": True})
    wb("navigate", {"url": book_url})
    time.sleep(args.wait)

    raw_points = wb("evaluate", {"code": LIST_KEYPOINTS_JS})
    key_points = json.loads(raw_points["value"])
    if not key_points:
        print("No key points found. Open the book page in Headway first.", file=sys.stderr)
        return 1

    title = args.title
    if not title:
        meta = wb("evaluate", {"code": "JSON.stringify(document.querySelector('h1')?.innerText?.trim() || document.title)"})
        title = json.loads(meta["value"]) or slug.replace("-", " ").title()

    chapters = []
    for kp in key_points:
        page = kp["page"]
        url = f"https://app.makeheadway.com/books/{slug}/summary?page={page}&mode=reading"
        wb("navigate", {"url": url})
        time.sleep(args.wait)
        res = wb("evaluate", {"code": EXTRACT_JS})
        text = json.loads(res["value"]).get("text", "").strip()
        chapters.append({
            "title": kp["title"],
            "text": text,
            "wordCount": word_count(text),
        })
        print(f"  page {page}: {word_count(text)} words — {kp['title'][:50]}…")

    book = {
        "id": slug,
        "title": title,
        "author": args.author,
        "source": "headway",
        "type": "summary",
        "addedAt": int(time.time() * 1000),
        "chapters": chapters,
        "totalWords": sum(ch["wordCount"] for ch in chapters),
    }

    out_path = f"{args.out_dir.rstrip('/')}/{slug}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(book, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(chapters)} chapters ({book['totalWords']} words) → {out_path}")
    print("Next: bash deploy-vps.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())