#!/usr/bin/env python3
"""把一张白底立绘处理成桌宠用的透明 WebP。
    python3 tools/prepare.py <输入图> <角色id> <姿态名>   → characters/<角色id>/<姿态名>.webp
做的事：抠掉和图片边缘连通的白底（衣服里的白色不会被抠）→ 去掉飘在空中的小碎片（生图 AI 常画的汗滴、速度线、闪光）
和贴地的扁平影子 → 比主角站得低的小帮手挪到同一条地面上 → 裁掉空白 → 统一缩放到 640 高（所有姿态同尺度）→ 存 WebP。
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
TARGET_H = 640


def background_mask(im: Image.Image) -> Image.Image:
    """和图片边缘连通的、很亮且几乎不带颜色的像素算背景（0），其余是人物（255）。
    衣服里的白色被深色描边围着、不和边缘连通，不会被抠掉。"""
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
        # 接近白色、几乎不带颜色的才算背景（生图 AI 常在脚下画一片极淡的地面光晕，也一起去掉）
        if not (min(r, g, b) > 215 and max(r, g, b) - min(r, g, b) < 28):
            continue
        mp[x, y] = 0
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    return mask


def drop_debris(mask: Image.Image):
    """只留人物主体和够大的道具：比主体 0.4% 还小的碎块（汗滴、速度线、闪光）去掉；
    又扁又宽、贴在主体脚下的一块（地面影子）也去掉，App 会自己画影子。
    返回 (新的遮罩, 连通块标号, 每块是否保留, 主体的标号)。"""
    a = np.array(mask) > 0
    labels, n = ndimage.label(a)
    keep = np.zeros(n + 1, bool)
    if n == 0:
        return mask, labels, keep, 0
    areas = ndimage.sum(a, labels, range(1, n + 1))
    main = int(np.argmax(areas)) + 1
    boxes = ndimage.find_objects(labels)
    my = boxes[main - 1][0]
    main_h = my.stop - my.start
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
    return Image.fromarray(np.where(keep[labels], 255, 0).astype(np.uint8), "L"), labels, keep, main


def ground_helpers(im: Image.Image, labels, keep, main) -> Image.Image:
    """和主角分开的小帮手 / 道具如果站得比主角的脚还低，就往上挪到主角脚底那条线上。
    App 按整张图的最底边对齐地面，不挪的话主角会悬空。"""
    if not main:
        return im
    boxes = ndimage.find_objects(labels)
    foot = boxes[main - 1][0].stop
    arr = np.array(im)
    out = arr.copy()
    moved = 0
    for i, box in enumerate(boxes, start=1):
        if i == main or not keep[i] or box is None:
            continue
        ys, xs = box
        if ys.stop <= foot + 2:
            continue
        dy = ys.stop - foot
        sel = labels[ys, xs] == i
        patch = arr[ys, xs].copy()
        region = out[ys, xs]
        region[sel] = 0                      # 擦掉原位置
        out[ys, xs] = region
        dst = out[ys.start - dy:ys.stop - dy, xs]
        dst[sel] = patch[sel]                # 贴到上面
        out[ys.start - dy:ys.stop - dy, xs] = dst
        moved += 1
    if moved:
        print(f"  把 {moved} 个比主角站得低的小帮手挪到同一条地面上")
    return Image.fromarray(out, "RGBA")


def prepare(src: str, character: str, name: str) -> Path:
    im = Image.open(src).convert("RGBA")
    mask, labels, keep, main = drop_debris(background_mask(im))
    im.putalpha(mask)
    im = ground_helpers(im, labels, keep, main)  # 先挪，再柔化边缘，免得原位置留下一圈看不见的晕边
    im.putalpha(im.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1)))
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
