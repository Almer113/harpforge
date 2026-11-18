"""The app's icons (public/icons/), drawn from the same shapes as public/favicon.svg: the
harmonica on the app's dark background. Run again after changing the favicon:

    python scripts/make-icons.py

Needs Pillow (pip install pillow).
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = "#13110f"  # Dark theme's background (index.html's theme-color)
GOLD = "#d9a441"
COMB = "#2a2118"
SS = 4  # drawn 4x larger, then scaled down: smooth edges


def harmonica(d: ImageDraw.ImageDraw, size: int, width: float) -> None:
    """The favicon's harmonica (56 x 28 units in a 64 viewBox), `width` of the icon wide, centred."""
    u = size * width / 56
    ox, oy = size / 2 - 32 * u, size / 2 - 32 * u

    def rect(x, y, w, h, r, fill):
        d.rounded_rectangle([ox + x * u, oy + y * u, ox + (x + w) * u, oy + (y + h) * u], radius=r * u, fill=fill)

    rect(4, 18, 56, 28, 6, GOLD)
    rect(8, 27, 48, 10, 2, COMB)
    for x in (15, 23, 31, 39, 47):
        d.rectangle([ox + x * u, oy + 27 * u, ox + (x + 2) * u, oy + 37 * u], fill=GOLD)


def icon(name: str, size: int, width: float, corner: float) -> None:
    """`corner`: the background's corner radius as a share of the size (0 = square, for maskable)."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * corner, fill=BG)
    harmonica(d, big, width)
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


OUT.mkdir(parents=True, exist_ok=True)
# Installed-app icons: a rounded tile.
icon("icon-192.png", 192, 0.78, 0.22)
icon("icon-512.png", 512, 0.78, 0.22)
# Maskable (Android crops it to a circle or other shape): full-bleed, the harmonica inside the safe zone.
icon("icon-maskable-512.png", 512, 0.62, 0)
# iPhone and iPad home screen (iOS rounds the corners itself).
icon("apple-touch-icon.png", 180, 0.72, 0)
print("Icons written to", OUT)
