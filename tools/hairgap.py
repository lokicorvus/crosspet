#!/usr/bin/env python3
"""抠掉头发之间被围住的白缝：生图 AI 画的长发常把背景围在发丝中间，prepare.py 只抠和图片边缘连通的白底，这些缝会留成白块。
    python3 tools/hairgap.py <角色id> [姿态名…]          → 原地处理 characters/<角色id>/*.webp（不写姿态名就是全部）
    python3 tools/hairgap.py --check <角色id> <输出.png>  → 只出一张标红的检查图，不改文件
用开源的动漫人物分割模型 isnet-anime（rembg 项目发布，约 170MB，只在本机处理立绘时用，不进仓库、不进安装包）判断哪里是人物：
    mkdir -p ~/.u2net && curl -L -o ~/.u2net/isnet-anime.onnx https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx
只动浅色像素（白缝和它的抗锯齿边），深色的头发、衣服、描边一律不改，所以不会改坏已有的轮廓；白衣服、白头发模型认得出是人物，会留着。
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
MODEL = Path(os.path.expanduser("~/.u2net/isnet-anime.onnx"))
_session = None


def available() -> bool:
    return MODEL.exists()


def person_prob(im: Image.Image) -> np.ndarray:
    """每个像素是人物的概率（0~1）。透明图先铺到白底上，和生图原图一个样子"""
    global _session
    if _session is None:
        import onnxruntime as ort
        _session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    x = np.array(bg.convert("RGB").resize((1024, 1024), Image.LANCZOS)).astype(np.float32)
    x = x / max(float(x.max()), 1e-6) - np.array([0.485, 0.456, 0.406], np.float32)
    out = _session.run(None, {_session.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]
    out = (out - out.min()) / (out.max() - out.min() + 1e-6)
    return np.array(Image.fromarray((out * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)).astype(float) / 255


def gap_weight(im: Image.Image) -> np.ndarray:
    """每个像素保留多少（1 = 不动，0 = 抠掉）。只有浅色、模型又认为不是人物的地方才抠"""
    a = np.array(im.convert("RGBA")).astype(float)
    rgb, al = a[..., :3], a[..., 3]
    p = person_prob(im)
    keep = np.clip((p - 0.25) / 0.35, 0, 1)  # 收紧成干脆的留 / 去，中间留一点过渡
    light = (rgb.min(-1) >= 200) & (rgb.max(-1) - rgb.min(-1) < 40) & (al > 0)
    light = ndimage.binary_dilation(light, iterations=1)  # 带上白缝外圈的抗锯齿像素
    w = np.where(light, keep, 1.0)
    # 只抠被围住的缝：碰到外面透明区的（人物外轮廓）不动，轮廓保持原样；太小的零星斑点也不动（免得在花纹上啃出小洞）
    gone = ndimage.binary_dilation(w < 0.5, iterations=1)
    outside = ndimage.binary_dilation(al < 30, iterations=2)
    lbl, n = ndimage.label(gone)
    if n:
        sizes = ndimage.sum(gone, lbl, range(1, n + 1))
        touch = ndimage.maximum(outside, lbl, range(1, n + 1))
        bad = np.nonzero((sizes < 15) | (touch > 0))[0] + 1
        w[np.isin(lbl, bad)] = 1.0
    # 只动主体人物：旁边分开的小帮手、道具，模型常不当成人物，不碰
    body, n = ndimage.label(al > 30)
    if n > 1:
        main = body == (ndimage.sum(al > 30, body, range(1, n + 1)).argmax() + 1)
        w[~ndimage.binary_fill_holes(main)] = 1.0
    return w


def clean(im: Image.Image):
    """返回 (新图, 抠掉的像素数)"""
    im = im.convert("RGBA")
    w = gap_weight(im)
    a = np.array(im)
    old = a[..., 3].astype(float)
    new = old * w
    removed = int(((old > 128) & (new <= 128)).sum())
    if removed < 30:
        return im, 0
    a[..., 3] = new.round().astype(np.uint8)
    return Image.fromarray(a, "RGBA"), removed


def process(character: str, names=None) -> int:
    files = [CHARACTERS / character / f"{n}.webp" for n in names] if names else sorted((CHARACTERS / character).glob("*.webp"))
    changed = 0
    for f in files:
        im, n = clean(Image.open(f))
        if not n:
            continue
        im.save(f, "WEBP", quality=92, method=6)
        changed += 1
        print(f"  {f.relative_to(CHARACTERS.parent)}  抠掉 {n} 像素", flush=True)
    return changed


def check(character: str, dst: str):
    tiles = []
    for f in sorted((CHARACTERS / character).glob("*.webp")):
        im = Image.open(f).convert("RGBA")
        new, _ = clean(im)
        gone = (np.array(im)[..., 3] > 128) & (np.array(new)[..., 3] <= 128)
        bg = Image.new("RGBA", im.size, (40, 90, 60, 255))
        bg.alpha_composite(im)
        v = np.array(bg.convert("RGB"))
        v[gone] = [255, 0, 0]
        t = Image.fromarray(v)
        t.thumbnail((260, 300))
        tiles.append(t)
    cols = 10
    sheet = Image.new("RGB", (cols * 260, (len(tiles) + cols - 1) // cols * 300), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 260, (i // cols) * 300))
    sheet.save(dst)


if __name__ == "__main__":
    if not available():
        print(f"没有找到模型 {MODEL}，下载方法见本文件开头的说明")
        sys.exit(1)
    if len(sys.argv) >= 4 and sys.argv[1] == "--check":
        check(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 2 and (CHARACTERS / sys.argv[1]).is_dir():
        print(f"{sys.argv[1]}：处理了 {process(sys.argv[1], sys.argv[2:])} 张")
    else:
        print(__doc__)
        sys.exit(1)
