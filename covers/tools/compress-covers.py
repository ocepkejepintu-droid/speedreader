#!/usr/bin/env python3
"""
Compress deployed covers to small JPEGs for fast page loads.

Source: SOURCE_DIR/{slug}.png (PNG, 1024x1536 base, 1600x2400 fallback).
Output: OUT_DIR/{slug}.jpg (JPEG, max-width 800, quality 82).

The source tree is the master 1024x1536 PNGs — we don't touch those. The
output tree is what gets rsynced to the VPS. After this runs, reader-app.js
should serve ../covers/renders/{slug}.jpg.

Why JPEG:
  - Cover art is photographic / painterly; PNG's lossless codec wastes
    bytes on smooth gradients we can't perceive at 200-400px display size.
  - At quality 82 the artifacts are imperceptible at the rendered size
    (typically 200px wide on a phone, 400px on desktop).

Why 800px max width:
  - The book grid displays covers at ~200-400 CSS px. Even at 2x DPR
    that's 800 device px, so 800 is the practical ceiling.
  - Capping width also caps height (1200px) which is the bitrate lever
    that actually matters for transfer size.

Idempotency: existing .jpg with the same source md5 (stored as a sidecar)
is reused; we don't recompress on re-runs unless source changes.
"""

from PIL import Image
from pathlib import Path
import hashlib
import json
import sys

SOURCE_DIR = Path("/Users/yoseph/rsvp-reader/covers/renders/illustrated")
OUT_DIR = Path("/Users/yoseph/rsvp-reader-gamify-account/covers/renders")
SIDECAR = OUT_DIR / ".compress-cache.json"

MAX_WIDTH = 800
JPEG_QUALITY = 82

# GPT/Grok illustrated PNGs are saved by the generator as
# `{slug}-gpt-v1.png`. Slugs without an illustrated version fall back to
# the plain `{slug}.png` in the parent /renders/ tree.
GPT_PATTERN = "*-gpt-v1.png"
BASE_PATTERN = "*.png"


def md5(p: Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_cache() -> dict:
    if not SIDECAR.exists():
        return {}
    try:
        return json.loads(SIDECAR.read_text())
    except Exception:
        return {}


def save_cache(cache: dict) -> None:
    SIDECAR.parent.mkdir(parents=True, exist_ok=True)
    SIDECAR.write_text(json.dumps(cache, indent=2, sort_keys=True))


def compress_one(png_path: Path, out_path: Path) -> tuple[int, int]:
    """Returns (source_bytes, output_bytes)."""
    with Image.open(png_path) as img:
        # Convert any non-RGB mode (RGBA / P / L) to RGB so JPEG is happy.
        if img.mode != "RGB":
            img = img.convert("RGB")
        # Resize, preserving aspect ratio. We don't upscale — covers that
        # are already smaller than MAX_WIDTH pass through unchanged.
        if img.width > MAX_WIDTH:
            new_h = round(img.height * (MAX_WIDTH / img.width))
            img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
        # optimize=True is supported by Pillow's JPEG plugin; progressive
        # rendering gives a better perceived-load feel on slow networks.
        img.save(out_path, format="JPEG", quality=JPEG_QUALITY,
                 optimize=True, progressive=True)
    return png_path.stat().st_size, out_path.stat().st_size


def resolve_source(slug: str) -> Path | None:
    """Return the highest-quality source PNG for this slug.

    Priority: GPT-illustrated > base cover. The illustrated tree is the
    source of truth when present; base art is the fallback for books the
    generator hasn't gotten to yet.
    """
    illustrated = SOURCE_DIR / f"{slug}-gpt-v1.png"
    if illustrated.is_file():
        return illustrated
    base = SOURCE_DIR.parent / f"{slug}.png"
    if base.is_file():
        return base
    return None


def main() -> int:
    if not SOURCE_DIR.is_dir():
        print(f"ERROR: source dir missing: {SOURCE_DIR}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Walk the illustrated tree for GPT-illustrated covers, then the parent
    # /renders/ for plain base covers. Each becomes one .jpg output.
    seen = set()
    pngs: list[Path] = []
    for pattern in (GPT_PATTERN, BASE_PATTERN):
        for p in sorted(SOURCE_DIR.glob(pattern)):
            slug = p.name[: -len(".png")]
            if pattern == GPT_PATTERN:
                slug = slug[: -len("-gpt-v1")]
            if slug in seen:
                continue
            seen.add(slug)
            pngs.append(p)
    # Base covers that live outside the illustrated dir:
    for p in sorted((SOURCE_DIR.parent).glob(BASE_PATTERN)):
        slug = p.stem
        if slug in seen:
            continue
        seen.add(slug)
        pngs.append(p)
    if not pngs:
        print(f"ERROR: no PNGs found under {SOURCE_DIR}", file=sys.stderr)
        return 1

    cache = load_cache()
    skipped = 0
    written = 0
    src_total = 0
    out_total = 0

    for png in pngs:
        slug = png.name[: -len(".png")]
        if png.name.endswith("-gpt-v1.png"):
            slug = slug[: -len("-gpt-v1")]
        out = OUT_DIR / f"{slug}.jpg"
        digest = md5(png)
        cached = cache.get(slug)
        if (cached
                and cached.get("md5") == digest
                and cached.get("source") == png.name
                and out.exists()
                and out.stat().st_size == cached.get("bytes")):
            skipped += 1
            src_total += png.stat().st_size
            out_total += out.stat().st_size
            continue

        src_b, out_b = compress_one(png, out)
        cache[slug] = {"md5": digest, "bytes": out_b, "source": png.name}
        written += 1
        src_total += src_b
        out_total += out_b
        if written % 25 == 0:
            print(f"  ...{written + skipped}/{len(pngs)} processed")

    save_cache(cache)

    def mb(b: int) -> str:
        return f"{b / 1048576:.1f} MB"

    print("")
    print(f"Source PNGs:    {len(pngs)} files · {mb(src_total)}")
    print(f"Output JPEGs:   {len(pngs)} files · {mb(out_total)}")
    print(f"Reduction:      {(1 - out_total / src_total) * 100:.1f}%")
    print(f"  written: {written}")
    print(f"  cached:  {skipped}")
    print(f"Output dir:     {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())