#!/usr/bin/env python3
"""把一张白底立绘处理成桌宠用的透明 WebP。
    python3 tools/prepare.py <输入图> <角色id> <姿态名>   → characters/<角色id>/<姿态名>.webp
做的事：抠掉和图片边缘连通的白底（衣服里的白色不会被抠）→ 裁掉空白 → 统一缩放到 640 高（所有姿态同尺度）→ 存 WebP。
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
TARGET_H = 640


def prepare(src: str, character: str, name: str) -> Path:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.extend([(x, 0), (x, h - 1)])
    for y in range(h):
        q.extend([(0, y), (w - 1, y)])
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, _ = px[x, y]
        if not (r > 232 and g > 232 and b > 232):  # 接近白色才算背景
            continue
        mp[x, y] = 0
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
    im.putalpha(mask)
    im = im.crop(im.getbbox())
    im = im.resize((round(im.width * TARGET_H / im.height), TARGET_H), Image.LANCZOS)
    out_dir = CHARACTERS / character
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{name}.webp"
    im.save(out, "WEBP", quality=92, method=6)
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    out = prepare(*sys.argv[1:])
    print(f"{out.relative_to(CHARACTERS.parent)}  {out.stat().st_size // 1024}KB")
