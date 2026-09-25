"""
make_icons.py - generate PWA icons (icon-192.png, icon-512.png) with no
third-party libraries. Draws the same blue tile + white "T" + check mark as
icons/icon.svg, but as raw pixels.

Run:  python tools/make_icons.py
"""

import os
import struct
import zlib

BRAND_TOP = (75, 131, 255)
BRAND_BOTTOM = (31, 79, 191)
WHITE = (255, 255, 255)
ACCENT = (31, 79, 191)


def blend(c1, c2, t):
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def rounded_mask(x, y, size, radius):
    """Return True when the pixel is inside the rounded square."""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def rect(x, y, x0, y0, x1, y1):
    return x0 <= x <= x1 and y0 <= y <= y1


def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def check_mark(x, y, size):
    """Thick check drawn from two rotated bars."""
    # coordinates relative to a 192 grid, then scaled
    s = size / 192.0
    # bar 1: from (131,140) to (138,147) ; bar 2: (138,147) to (150,133)
    def near_segment(px, py, ax, ay, bx, by, w):
        px, py, ax, ay, bx, by = (px / s, py / s, ax, ay, bx, by)
        vx, vy = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        seg = vx * vx + vy * vy
        t = 0.0 if seg == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / seg))
        dx, dy = wx - t * vx, wy - t * vy
        return dx * dx + dy * dy <= (w / 2.0) ** 2
    return near_segment(x, y, 131, 140, 138, 147, 7) or near_segment(x, y, 138, 147, 150, 133, 7)


def make_icon(size, path):
    radius = round(size * 0.2)
    vpad = round(size * 0.23)
    stem_w = round(size * 0.083)
    stem_h = round(size * 0.54)
    bar_h = round(size * 0.083)
    bar_w = round(size * 0.58)
    bar_x0 = (size - bar_w) // 2
    stem_x0 = (size - stem_w) // 2
    cx, cy, r = round(size * 0.729), round(size * 0.729), round(size * 0.104)
    inner = r - max(2, round(size * 0.02))

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        t = y / max(1, size - 1)
        bg = blend(BRAND_TOP, BRAND_BOTTOM, t)
        for x in range(size):
            if not rounded_mask(x, y, size, radius):
                raw.extend((0, 0, 0, 0))
                continue
            color = bg
            # white "T"
            if rect(x, y, bar_x0, vpad, bar_x0 + bar_w - 1, vpad + bar_h - 1) or \
               rect(x, y, stem_x0, vpad, stem_x0 + stem_w - 1, vpad + stem_h - 1):
                color = WHITE
            # check badge
            if circle(x, y, cx, cy, r):
                color = WHITE
                if x <= cx - round(size * 0.04):
                    color = WHITE
            if circle(x, y, cx, cy, inner):
                color = (250, 251, 255)
                if check_mark(x, y, size):
                    color = ACCENT
            raw.extend((color[0], color[1], color[2], 255))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, size, 'x', size, len(png), 'bytes')


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), 'icons')
    os.makedirs(out, exist_ok=True)
    make_icon(192, os.path.join(out, 'icon-192.png'))
    make_icon(512, os.path.join(out, 'icon-512.png'))


if __name__ == '__main__':
    main()
