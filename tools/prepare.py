#!/usr/bin/env python3
"""把一张白底立绘处理成桌宠用的透明 WebP。
    python3 tools/prepare.py <输入图> <角色id> <姿态名>   → characters/<角色id>/<姿态名>.webp
做的事：抠掉和图片边缘连通的白底（衣服里的白色不会被抠）→ 去掉飘在空中的小碎片（生图 AI 常画的汗滴、速度线、闪光）
和贴地的扁平影子 → 裁掉空白 → 统一缩放到 640 高（所有姿态同尺度）→ 存 WebP。
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from scipy import ndimage

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
TARGET_H = 640


def drop_debris(mask: Image.Image) -> Image.Image:
    """只留人物主体和够大的道具：比主体 0.4% 还小的碎块（汗滴、速度线、闪光）去掉；
    又扁又宽、贴在主体脚下的一块（地面影子）也去掉，App 会自己画影子。"""
    a = np.array(mask) > 0
    labels, n = ndimage.label(a)
    if n <= 1:
        return mask
    areas = ndimage.sum(a, labels, range(1, n + 1))
    main = int(np.argmax(areas)) + 1
    boxes = ndimage.find_objects(labels)
    my = boxes[main - 1][0]
    main_h = my.stop - my.start
    keep = np.zeros(n + 1, bool)
    keep[main] = True
    dropped = 0
    for i in range(1, n + 1):
        if i == main:
            continue
        ys, xs = boxes[i - 1]
        h, w = ys.stop - ys.start, xs.stop - xs.start
        shadow = h < main_h * 0.08 and w > h * 3 and ys.start > my.start + main_h * 0.8
        if areas[i - 1] >= areas[main - 1] * 0.004 and not shadow:
            keep[i] = True
        else:
            dropped += 1
    if dropped:
        print(f"  去掉 {dropped} 块碎片 / 影子")
    return Image.fromarray(np.where(keep[labels], 255, 0).astype(np.uint8), "L")


def drop_debris(mask: Image.Image) -> Image.Image:
    """只留人物主体和够大的道具：比主体 0.4% 还小的碎块（汗滴、速度线、闪光）去掉；
    又扁又宽、贴在主体脚下的一块（地面影子）也去掉，App 会自己画影子。"""
    a = np.array(mask) > 0
    labels, n = ndimage.label(a)
    if n <= 1:
        return mask
    areas = ndimage.sum(a, labels, range(1, n + 1))
    main = int(np.argmax(areas)) + 1
    boxes = ndimage.find_objects(labels)
    my = boxes[main - 1][0]
    main_h = my.stop - my.start
    keep = np.zeros(n + 1, bool)
    keep[main] = True
    dropped = 0
    for i in range(1, n + 1):
        if i == main:
            continue
        ys, xs = boxes[i - 1]
        h, w = ys.stop - ys.start, xs.stop - xs.start
        shadow = h < main_h * 0.08 and w > h * 3 and ys.start > my.start + main_h * 0.8
        if areas[i - 1] >= areas[main - 1] * 0.004 and not shadow:
            keep[i] = True
        else:
            dropped += 1
    if dropped:
        print(f"  去掉 {dropped} 块碎片 / 影子")
    return Image.fromarray(np.where(keep[labels], 255, 0).astype(np.uint8), "L")


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
    mask = drop_debris(mask)
    mask = drop_debris(mask)
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
