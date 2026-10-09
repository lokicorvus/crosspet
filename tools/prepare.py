#!/usr/bin/env python3
"""把一张白底立绘处理成桌宠用的透明 WebP。
    python3 tools/prepare.py <输入图> <角色id> <姿态名>   → characters/<角色id>/<姿态名>.webp
做的事：抠掉和图片边缘连通的白底（衣服里的白色不会被抠）→ 去掉飘在空中的小碎片（生图 AI 常画的汗滴、速度线、闪光）
和贴地的扁平影子 → 抠掉头发之间被围住的白缝（hairgap.py，只对发色分得开的角色）→ 比主角站得低的小帮手挪到同一条地面上 → 裁掉空白 → 统一缩放到 640 高（所有姿态同尺度）→ 存 WebP。
"""
import os
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hairgap import HAIR_HUE, clean  # noqa: E402

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
TARGET_H = 640
BG_MIN = int(os.environ.get("BG_MIN", 215))
BG_SPREAD = int(os.environ.get("BG_SPREAD", 28))
# 配合严格的 BG_MIN / BG_SPREAD 用：先只抠很白的底（保住没描边的白花边、白围裙），再把紧贴着底、几像素以内的浅色光晕也去掉
BG_HALO = int(os.environ.get("BG_HALO", 0))


def background_mask(im: Image.Image) -> Image.Image:
    """和图片边缘连通的、很亮且几乎不带颜色的像素算背景（0），其余是人物（255）。
    衣服里的白色被深色描边围着、不和边缘连通，不会被抠掉。"""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.extend([(x, 0), (x, h - 1)])
    # 贴边立绘（edge_left / edge_right）有一条边框是从人物身上切过去的：那条边不当背景的起点，
    # 不然贴着切口的白衣服、白头发会被当成白底一路抠进去。用 SKIP_EDGE=left / right 指定
    skip = os.environ.get("SKIP_EDGE", "")
    for y in range(h):
        if skip != "left":
            q.append((0, y))
        if skip != "right":
            q.append((w - 1, y))
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, _ = px[x, y]
        # 接近白色、几乎不带颜色的才算背景（生图 AI 常在脚下画一片极淡的地面光晕，也一起去掉）。
        # 白头发、白衣服的角色（GPT）描边有缺口时会被一起抠掉：用 BG_MIN=250 BG_SPREAD=6 只认更白的
        if not (min(r, g, b) > BG_MIN and max(r, g, b) - min(r, g, b) < BG_SPREAD):
            continue
        mp[x, y] = 0
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    if BG_HALO:
        a = np.array(im.convert("RGB")).astype(int)
        light = (a.min(-1) > 225) & (a.max(-1) - a.min(-1) < 24)
        bg = np.array(mask) == 0
        for _ in range(BG_HALO):
            bg |= ndimage.binary_dilation(bg) & light
        mask = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), "L")
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
    skip = os.environ.get("SKIP_EDGE", "")
    if skip in ("left", "right"):
        # 切口那一侧，原图常留着几列白边：先裁掉（大半是白的列），不然不从那侧抠底时会留成一条白线
        a = np.array(im.convert("RGB")).astype(int)
        cols = ((a.min(-1) > 235) & (a.max(-1) - a.min(-1) < 20)).mean(0) > 0.6
        n = 0
        while n < len(cols) // 4 and cols[n if skip == "left" else -1 - n]:
            n += 1
        if n:
            im = im.crop((n, 0, im.width, im.height) if skip == "left" else (0, 0, im.width - n, im.height))
    mask, labels, keep, main = drop_debris(background_mask(im))
    im.putalpha(mask)
    im = ground_helpers(im, labels, keep, main)  # 先挪，再柔化边缘，免得原位置留下一圈看不见的晕边
    im.putalpha(im.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1)))
    im = im.crop(im.getbbox())
    im = im.resize((round(im.width * TARGET_H / im.height), TARGET_H), Image.LANCZOS)
    out_dir = CHARACTERS / character
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{name}.webp"
    if character in HAIR_HUE:  # 头发之间被围住的白缝（见 hairgap.py）
        im = clean(im, HAIR_HUE[character])[0]
    im.save(out, "WEBP", quality=92, method=6)
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    out = prepare(*sys.argv[1:])
    print(f"{out.relative_to(CHARACTERS.parent)}  {out.stat().st_size // 1024}KB")
