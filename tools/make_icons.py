#!/usr/bin/env python3
"""Generate the extension icon set (no third-party deps).

Design: rounded square with a blue diagonal gradient and a white
"< />" glyph — reads as "API client" at every size.

Usage:  python3 tools/make_icons.py
Output: assets/icons/icon{16,32,48,128}.png
"""

import os
import struct
import zlib

# --- geometry (in a 100x100 design space) -----------------------------------
DESIGN = 100.0
CORNER_R = 22.0          # rounded-rect radius
STROKE = 9.0             # glyph stroke width
GLYPH_Y0, GLYPH_Y1 = 26.0, 74.0   # top / bottom of the chevrons
LEFT_X = 20.0            # outer x of "<"
LEFT_APEX = 36.0         # apex of "<" (points right)
RIGHT_X = 80.0           # outer x of ">"
RIGHT_APEX = 64.0        # apex of ">" (points left)
SLASH_X0, SLASH_Y0 = 44.0, 76.0   # slash: bottom-left ...
SLASH_X1, SLASH_Y1 = 56.0, 24.0   # ... to top-right

C_TOP = (0x38, 0x8D, 0xFF)   # gradient start (top-left)
C_BOT = (0x1B, 0x46, 0xD8)   # gradient end (bottom-right)


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    len2 = dx * dx + dy * dy
    if len2 == 0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / len2))
    cx, cy = x1 + t * dx, y1 + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def coverage(dist, half):
    """1.0 inside the stroke, fading to 0.0 across ~1 design unit."""
    return max(0.0, min(1.0, (half - dist) + 0.5))


def glyph_alpha(u, v):
    """White "< />" glyph coverage at design-space coords (u, v)."""
    half = STROKE / 2.0
    mid_y = (GLYPH_Y0 + GLYPH_Y1) / 2
    # "<" : outer-top -> apex -> outer-bottom
    d_left = min(
        dist_to_segment(u, v, LEFT_X, GLYPH_Y0, LEFT_APEX, mid_y),
        dist_to_segment(u, v, LEFT_APEX, mid_y, LEFT_X, GLYPH_Y1),
    )
    # ">" mirrored on the other side
    d_right = min(
        dist_to_segment(u, v, RIGHT_X, GLYPH_Y0, RIGHT_APEX, mid_y),
        dist_to_segment(u, v, RIGHT_APEX, mid_y, RIGHT_X, GLYPH_Y1),
    )
    d_slash = dist_to_segment(u, v, SLASH_X0, SLASH_Y0, SLASH_X1, SLASH_Y1)
    return max(
        coverage(d_left, half),
        coverage(d_right, half),
        coverage(d_slash, half * 0.78),
    )


def rect_alpha(u, v):
    """Rounded-square background coverage (0..1)."""
    dx = max(abs(u - DESIGN / 2) - (DESIGN / 2 - CORNER_R), 0.0)
    dy = max(abs(v - DESIGN / 2) - (DESIGN / 2 - CORNER_R), 0.0)
    d = (dx * dx + dy * dy) ** 0.5 - CORNER_R
    return max(0.0, min(1.0, -d + 0.5))


def blend(dst, src, a):
    return tuple(round(d * (1 - a) + s * a) for d, s in zip(dst, src))


def render(size, ss=4):
    """Render at `size` px using `ss`-x supersampling for smooth edges."""
    acc = [[[0.0, 0.0, 0.0, 0.0] for _ in range(size)] for _ in range(size)]
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    px = (x + (sx + 0.5) / ss) * DESIGN / size
                    py = (y + (sy + 0.5) / ss) * DESIGN / size
                    bg = rect_alpha(px, py)
                    if bg <= 0:
                        continue
                    # diagonal gradient from top-left to bottom-right
                    t = max(0.0, min(1.0, (px + py) / (2 * DESIGN)))
                    col = blend(C_TOP, C_BOT, t)
                    fg = glyph_alpha(px, py)
                    # white glyph over gradient, both over transparent canvas
                    col = blend(col, (255, 255, 255), fg)
                    alpha = bg  # background already fully opaque where drawn
                    r += col[0] * alpha
                    g += col[1] * alpha
                    b += col[2] * alpha
                    a += alpha
            n = ss * ss
            if a > 0:
                acc[y][x] = [r / n, g / n, b / n, a / n]
    return acc


def write_png(path, size, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: none
        for r, g, b, a in row:
            aa = int(round(a * 255))
            if aa == 0:
                raw.extend((0, 0, 0, 0))
                continue
            # values are already on a 0-255 scale (premultiplied by alpha)
            raw.extend((
                min(255, int(round(r / a))),
                min(255, int(round(g / a))),
                min(255, int(round(b / a))),
                aa,
            ))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        write_png(path, size, render(size))
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
