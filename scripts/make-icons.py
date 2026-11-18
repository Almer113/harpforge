"""The app's icons (public/icons/): the HarpForge mark, brass on the app's dark ground. The
logo kit (outside this repo) is the source of truth; this redraws the same shapes, so a
re-run gives the same icons. Run again only if the mark changes:

    python scripts/make-icons.py

Needs Pillow (pip install pillow).
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
INK = "#13110f"  # the dark ground (Dark theme's background)
BRASS = "#e3a948"  # the mark on dark
SS = 8  # drawn 8x larger, then scaled down: smooth edges

# The mark, in 256 units (as public/favicon.svg and the header's mark in src/App.tsx):
# the body, with five square holes cut out of it. Never more holes: they blur when small.
BODY = (16, 80, 240, 176)
RADIUS = 24
HOLES = [(x, 112, x + 24, 144) for x in (36, 76, 116, 156, 196)]


def mark(d: ImageDraw.ImageDraw, size: int, width: float) -> None:
    """The mark, its body `width` of the icon wide, centred."""
    u = size * width / (BODY[2] - BODY[0])
    cx, cy = (BODY[0] + BODY[2]) / 2, (BODY[1] + BODY[3]) / 2
    at = lambda x, y: (size / 2 + (x - cx) * u, size / 2 + (y - cy) * u)
    d.rounded_rectangle([*at(BODY[0], BODY[1]), *at(BODY[2], BODY[3])], radius=RADIUS * u, fill=BRASS)
    for x0, y0, x1, y1 in HOLES:
        d.rectangle([*at(x0, y0), *at(x1, y1)], fill=INK)


def icon(name: str, size: int, width: float) -> None:
    big = size * SS
    img = Image.new("RGB", (big, big), INK)
    mark(ImageDraw.Draw(img), big, width)
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    # Installed-app icons and the iPhone/iPad home screen: full-bleed squares (the system
    # rounds the corners), the body 86% of the width.
    icon("icon-192.png", 192, 0.86)
    icon("icon-512.png", 512, 0.86)
    icon("apple-touch-icon.png", 180, 0.86)
    # Maskable (Android crops it to a circle or other shape): the body inside the safe zone.
    icon("icon-maskable-512.png", 512, 0.5)
    print("Icons written to", OUT)
