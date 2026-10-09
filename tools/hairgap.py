#!/usr/bin/env python3
"""抠掉头发之间的白缝：生图 AI 画的长发常把背景围在发丝中间，prepare.py 只抠和图片边缘连通的白底，这些缝会留成白块。
    python3 tools/hairgap.py <角色id> [姿态名…]     → 原地处理 characters/<角色id>/*.webp（不写姿态名就是全部）
    python3 tools/hairgap.py --check <角色id> <输出.png>   → 只出一张标红的检查图，不改文件
怎么认「缝」：被发色围着的、纯白的、不太大的封闭白块。下面这些不算：脸上的（眼睛高光）、头顶横条（发带）、
最上 / 最下一截（头饰、袜子鞋子）、又圆又满的（扣子、高光）、旁边紧挨着别的白色的（白衣服被描边隔开的一块）。
只对发色和衣服分得开的角色开（HAIR_HUE）：黑发（GLM）、白发（GPT）、和衣服同色的紫发（Gemini）分不开，不处理。
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from scipy.spatial import ConvexHull
from matplotlib.path import Path as MPath

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
# 发色的色相范围（Lab 色相角，度）
HAIR_HUE = {"claude": (10, 70), "deepseek": (245, 315), "deepseek-hoodie": (245, 315)}


def rgb2lab(a):
    a = a / 255.0
    a = np.where(a > 0.04045, ((a + 0.055) / 1.055) ** 2.4, a / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = a @ m.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def face_hull(lab, hue, chroma, al):
    """脸：上 60% 里最大的一块肤色，取凸包再外扩一点（眼睛、嘴都在里面）"""
    h, w = al.shape
    skin = (al > 200) & (lab[..., 0] > 70) & (chroma > 6) & (chroma < 40) & (hue > 20) & (hue < 80)
    skin[int(h * 0.6):] = False
    lbl, n = ndimage.label(skin)
    if n == 0:
        return np.zeros(skin.shape, bool)
    face = lbl == (ndimage.sum(skin, lbl, range(1, n + 1)).argmax() + 1)
    ys, xs = np.nonzero(face)
    pts = np.c_[xs, ys]
    if len(pts) < 3:
        return face
    yy, xx = np.mgrid[:h, :w]
    inside = MPath(pts[ConvexHull(pts).vertices]).contains_points(np.c_[xx.ravel(), yy.ravel()]).reshape(h, w)
    return ndimage.binary_dilation(inside, iterations=6)


def find_gaps(im: Image.Image, hair_hue) -> np.ndarray:
    a = np.array(im.convert("RGBA")).astype(float)
    rgb, al = a[..., :3], a[..., 3]
    h = al.shape[0]
    white = (rgb.min(-1) >= 236) & (rgb.max(-1) - rgb.min(-1) <= 20) & (al > 200)
    lab = rgb2lab(rgb)
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    lo, hi = hair_hue
    hair = (al > 200) & (chroma > 12) & (((hue - lo) % 360) <= ((hi - lo) % 360))
    lightish = (rgb.min(-1) >= 225) & (al > 30)   # 半透明的白也算（有的立绘围裙是半透明的）
    face = face_hull(lab, hue, chroma, al)
    total = (al > 200).sum()
    lbl, _ = ndimage.label(white)
    out = np.zeros(white.shape, bool)
    for i, sl in enumerate(ndimage.find_objects(lbl), 1):
        y0, y1 = max(sl[0].start - 8, 0), sl[0].stop + 8
        x0, x1 = max(sl[1].start - 8, 0), sl[1].stop + 8
        comp = lbl[y0:y1, x0:x1] == i
        area = comp.sum()
        if area < 12 or area > total * 0.01:
            continue
        if (face[y0:y1, x0:x1] & comp).sum() > area * 0.2:
            continue
        cy = (sl[0].start + sl[0].stop) / 2 / h
        bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if cy < 0.18 or cy > 0.86:  # 头饰、袜子鞋子
            continue
        if cy < 0.35 and bw > 1.4 * bh:  # 头上横着的白条：发带、头饰
            continue
        if area / (bh * bw) > 0.55 and max(bh, bw) / min(bh, bw) < 2.2 and area < 900:  # 又圆又满：扣子、高光
            continue
        mean = rgb[y0:y1, x0:x1][comp].mean(0)
        if mean.min() < 245 or mean.max() - mean.min() > 6:  # 背景是纯白；衣服、耳朵里的白多少带点色
            continue
        near = ndimage.binary_dilation(comp, iterations=7) & ~ndimage.binary_dilation(comp, iterations=1)
        if (near & lightish[y0:y1, x0:x1]).sum() > max(25, area * 0.15):  # 旁边紧挨着别的白色
            continue
        if (near & (al[y0:y1, x0:x1] < 30)).sum() > area * 0.3:  # 周围一圈透明：不是被头发围住的（比如被抠空的衣服里的图案）
            continue
        ring = ndimage.binary_dilation(comp, iterations=4) & ~ndimage.binary_dilation(comp, iterations=1)
        solid = ring & (al[y0:y1, x0:x1] > 200) & (rgb[y0:y1, x0:x1].min(-1) < 215)
        if solid.sum() < 8:
            continue
        if (hair[y0:y1, x0:x1] & solid).sum() / solid.sum() >= 0.7:
            out[y0:y1, x0:x1] |= comp
    return out


def remove_gaps(im: Image.Image, gaps: np.ndarray) -> Image.Image:
    """和外轮廓一样处理：缝往外多吃 1 像素（去掉白色抗锯齿边），再柔化 1 像素"""
    keep = Image.fromarray(np.where(ndimage.binary_dilation(gaps), 0, 255).astype(np.uint8), "L")
    keep = keep.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
    im = im.convert("RGBA")
    alpha = np.array(im.getchannel("A")).astype(float) * np.array(keep).astype(float) / 255
    im.putalpha(Image.fromarray(alpha.round().astype(np.uint8), "L"))
    return im


def clean(im: Image.Image, hair_hue):
    """反复抠，直到没有新的缝：挨着的两条缝会因为「旁边有别的白色」互相挡住，抠掉一条另一条才认得出来。返回 (新图, 抠掉的像素数)"""
    total = 0
    for _ in range(4):
        gaps = find_gaps(im, hair_hue)
        if gaps.sum() < 30:
            break
        im = remove_gaps(im, gaps)
        total += int(gaps.sum())
    return im, total


def process(character: str, names=None) -> int:
    hue = HAIR_HUE[character]
    files = [CHARACTERS / character / f"{n}.webp" for n in names] if names else sorted((CHARACTERS / character).glob("*.webp"))
    changed = 0
    for f in files:
        im, n = clean(Image.open(f), hue)
        if not n:
            continue
        im.save(f, "WEBP", quality=92, method=6)
        changed += 1
        print(f"  {f.relative_to(CHARACTERS.parent)}  抠掉 {n} 像素")
    return changed


def check(character: str, dst: str):
    hue = HAIR_HUE[character]
    tiles = []
    for f in sorted((CHARACTERS / character).glob("*.webp")):
        im = Image.open(f).convert("RGBA")
        gaps = find_gaps(im, hue)
        bg = Image.new("RGBA", im.size, (40, 90, 60, 255))
        bg.alpha_composite(im)
        v = np.array(bg.convert("RGB"))
        v[ndimage.binary_dilation(gaps)] = [255, 0, 0]
        t = Image.fromarray(v)
        t.thumbnail((260, 300))
        tiles.append(t)
    cols = 10
    sheet = Image.new("RGB", (cols * 260, (len(tiles) + cols - 1) // cols * 300), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 260, (i // cols) * 300))
    sheet.save(dst)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--check":
        check(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 2 and sys.argv[1] in HAIR_HUE:
        print(f"{sys.argv[1]}：处理了 {process(sys.argv[1], sys.argv[2:])} 张")
    else:
        print(__doc__)
        sys.exit(1)
