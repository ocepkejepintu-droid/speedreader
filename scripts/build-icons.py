#!/usr/bin/env python3
"""
Generate alternate app-icon reward PNGs for the RSVP Reader gamification
system. Each icon variant is rendered as a flat square with a centered
glyph + accent color. Outputs are written to icons/<variant>-<size>.png
in three sizes: 180 (iOS), 192 (PWA), 512 (PWA + maskable).

The base icon-192/180/512 PNGs are kept untouched (default Crimson Reader).

Usage: python3 scripts/build-icons.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"

# (variant_id, accent_hex, glyph, label)
# Glyph choices were picked to be readable at 32px while still feeling distinct.
VARIANTS = [
    ("midnight", "#7C3AED", "M", "Midnight"),
    ("ember",    "#D97706", "E", "Ember"),
    ("obsidian", "#059669", "O", "Obsidian"),
    ("crystal",  "#0EA5E9", "C", "Crystal"),
    ("gold",     "#D97706", "G", "Gold"),
]

SIZES = [180, 192, 512]


def hex_to_rgb(hex_str: str):
    hex_str = hex_str.lstrip("#")
    return tuple(int(hex_str[i : i + 2], 16) for i in (0, 2, 4))


def render_icon(size: int, accent: str, glyph: str) -> Image.Image:
    bg = (10, 10, 10, 255)           # surface-obsidian
    accent_rgb = hex_to_rgb(accent)
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)

    # Accent corner triangle (top-left) — keeps the brand mark recognizable.
    tri = [(0, 0), (size // 3, 0), (0, size // 3)]
    draw.polygon(tri, fill=accent_rgb)

    # Centered glyph. Font falls back to default if no system font is found.
    try:
        font_size = int(size * 0.55)
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except (OSError, IOError):
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), glyph, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) // 2 - bbox[0]
    y = (size - h) // 2 - bbox[1]
    draw.text((x, y), glyph, fill=(245, 245, 245, 255), font=font)

    return img


def main() -> int:
    ICONS.mkdir(exist_ok=True)
    written = 0
    for variant, accent, glyph, _label in VARIANTS:
        for size in SIZES:
            out = ICONS / f"icon-{variant}-{size}.png"
            img = render_icon(size, accent, glyph)
            img.save(out, format="PNG", optimize=True)
            written += 1
    print(f"wrote {written} icon files to {ICONS}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
