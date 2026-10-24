#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Draws the extension's icon, a viewfinder, as PNGs in four sizes.

Standard library only, so the icons can be rebuilt and checked from source:
    python3 scripts/make_icons.py extension/icons
"""
import math
import struct
import sys
import zlib
from pathlib import Path

COLOR = (0x1A, 0x73, 0xE8)
SIZES = (16, 32, 48, 128)
SS = 4  # supersampling per axis


def inside(x, y):
    """Is the point (in a 1x1 square) on the viewfinder?"""
    # Four corner brackets, each two bars of length L and thickness T.
    lo, hi, T, L = 0.08, 0.92, 0.10, 0.30
    for cx in (lo, hi):
        for cy in (lo, hi):
            # The bracket's arms point into the square.
            dx = (x - cx) * (1 if cx == lo else -1)
            dy = (y - cy) * (1 if cy == lo else -1)
            if 0 <= dx <= L and 0 <= dy <= T:
                return True
            if 0 <= dx <= T and 0 <= dy <= L:
                return True
    # A dot in the middle.
    return math.hypot(x - 0.5, y - 0.5) <= 0.16


def png(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter: none
        for px in range(size):
            hits = sum(
                inside((px + (i + 0.5) / SS) / size, (py + (j + 0.5) / SS) / size)
                for i in range(SS) for j in range(SS)
            )
            row += bytes(COLOR) + bytes([round(255 * hits / (SS * SS))])
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "extension/icons")
    out.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        (out / f"icon{size}.png").write_bytes(png(size))


if __name__ == "__main__":
    main()
