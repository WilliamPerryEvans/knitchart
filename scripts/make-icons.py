"""Generate the app icons: a Sierpinski gasket knitted in stitches.

The icon is the app's own output — the equilateral generator at depth 2, drawn
as gauge-proportioned stitches (wider than tall, 20 sts / 26 rows) in the
editor's own palette. Run it when the mark changes:

    python scripts/make-icons.py

Writes public/pwa-192.png, public/pwa-512.png, public/pwa-maskable-512.png,
public/apple-touch-icon.png and public/favicon.svg.
"""

import math
import os
from PIL import Image, ImageDraw

BG = (31, 34, 40)  # --panel
MC = (244, 239, 232)  # cream, the background stitches
CC = (49, 67, 95)  # navy, the motif

STITCHES = 20
ASPECT = 20 / 26  # cell height / cell width, worsted gauge
DEPTH = 2
SAMPLES = 4
THRESHOLD = 0.3
ROOT3_2 = math.sqrt(3) / 2

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


def in_gasket(u, v, w, depth):
    """Barycentric membership, same recursion as src/domain/generators.ts."""
    if u < 0 or v < 0 or w < 0:
        return False
    a, b, c = u, v, w
    for _ in range(depth):
        if a >= 0.5:
            a, b, c = 2 * a - 1, b * 2, c * 2
        elif b >= 0.5:
            a, b, c = a * 2, 2 * b - 1, c * 2
        elif c >= 0.5:
            a, b, c = a * 2, b * 2, 2 * c - 1
        else:
            return False
    return True


def gasket_grid():
    """A stitch grid holding one equilateral gasket, nearly square overall."""
    base = STITCHES
    tri_h = base * ROOT3_2  # in stitch-widths
    rows = max(1, round(tri_h / ASPECT))

    ax, ay = base / 2, 0.0  # apex, top centre
    bx, by = 0.0, tri_h
    cx, cy = base, tri_h
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)

    def inside(px, py):
        u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
        v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
        return in_gasket(u, v, 1 - u - v, DEPTH)

    # Coverage sampling, not centre points: where sub-triangles pinch to a
    # point, centre sampling drops the stitch and severs the motif.
    needed = SAMPLES * SAMPLES * THRESHOLD
    grid = []
    for r in range(rows):
        row = []
        for c in range(base):
            hits = 0
            for sy in range(SAMPLES):
                py = (r + (sy + 0.5) / SAMPLES) * ASPECT
                for sx in range(SAMPLES):
                    if inside(c + (sx + 0.5) / SAMPLES, py):
                        hits += 1
            row.append(1 if hits >= needed else 0)
        grid.append(row)
    return grid


def render(size, motif_fraction, rounded):
    """Draw the icon at `size`, motif filling `motif_fraction` of the canvas."""
    grid = gasket_grid()
    rows, cols = len(grid), len(grid[0])

    scale = 4  # supersample, then downscale — the grid lines are hairline
    px = size * scale
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    if rounded:
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=px * 0.22, fill=BG + (255,))
    else:
        d.rectangle([0, 0, px, px], fill=BG + (255,))

    cell_w = (px * motif_fraction) / cols
    cell_h = cell_w * ASPECT
    x0 = (px - cell_w * cols) / 2
    y0 = (px - cell_h * rows) / 2

    for r in range(rows):
        for c in range(cols):
            x, y = x0 + c * cell_w, y0 + r * cell_h
            d.rectangle(
                [x, y, x + cell_w, y + cell_h],
                fill=(CC if grid[r][c] else MC) + (255,),
                outline=BG + (110,),
                width=max(1, int(cell_w * 0.05)),
            )

    return im.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)

    # "any": the icon shown as-is, so it carries its own rounded plate.
    render(512, 0.80, True).save(os.path.join(OUT, "pwa-512.png"))
    render(192, 0.80, True).save(os.path.join(OUT, "pwa-192.png"))
    render(180, 0.80, True).save(os.path.join(OUT, "apple-touch-icon.png"))

    # "maskable": Android crops this to whatever shape the launcher uses, so it
    # must bleed to the edges and keep the motif inside the central 80%.
    render(512, 0.62, False).save(os.path.join(OUT, "pwa-maskable-512.png"))

    # A browser tab is ~16px: the full gasket turns to mush, so the favicon is
    # the same triangle at depth 1, which survives.
    with open(os.path.join(OUT, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(favicon_svg())

    print("wrote", ", ".join(sorted(os.listdir(OUT))))


def favicon_svg():
    """Depth-1 gasket: three solid triangles, still legible at 16px."""
    base = 28.0
    height = base * ROOT3_2
    left_x, right_x = (32 - base) / 2, (32 + base) / 2
    top_y, bottom_y = (32 - height) / 2, (32 + height) / 2
    apex = (16.0, top_y)
    bl = (left_x, bottom_y)
    br = (right_x, bottom_y)

    def mid(p, q):
        return ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)

    m_left, m_right, m_base = mid(apex, bl), mid(apex, br), mid(bl, br)

    def poly(*pts):
        points = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        return f'<polygon points="{points}"/>'

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
        f'<rect width="32" height="32" rx="6" fill="rgb{BG}"/>'
        f'<g fill="rgb{MC}">'
        f"{poly(apex, m_left, m_right)}"
        f"{poly(m_left, bl, m_base)}"
        f"{poly(m_right, m_base, br)}"
        "</g></svg>"
    )


if __name__ == "__main__":
    main()
