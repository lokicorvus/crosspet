#!/usr/bin/env python3
"""设置「角色」页卡片墙用的两张图：衣服卡的展示图 portrait.webp、角色卡的探头头像 avatar.webp。
    python3 tools/cards.py            # 处理所有角色
    python3 tools/cards.py grok       # 只处理某个角色
原图放在 characters/<角色id>/raw/portrait.png、avatar.png（或 raw/cards/ 里），这里按卡片的显示大小缩好再存。

为什么要缩：卡片很小（衣服卡约 117×156、角色卡约 70×92），原图却是 1024 级别。Windows 100% 缩放时 WebView2 要把图缩到
五分之一，缩这么多会丢细节、出锯齿（1.3.8-beta.2 实测很糊）。这里先用高质量算法缩到卡片大小的两倍：100% 缩放时只缩两倍左右，
200% 缩放和 Mac 的 Retina 屏接近一比一。卡片以后做大了，改下面的尺寸重新跑一遍就行（原图一直留在 raw/）。
"""
import sys
from pathlib import Path

from PIL import Image

CHARACTERS = Path(__file__).resolve().parent.parent / "characters"
SIZES = {"portrait": (256, 384), "avatar": (192, 192)}   # 宽 × 高；portrait 是 2:3 竖图，avatar 是方图


def source(cid: str, name: str):
    raw = CHARACTERS / cid / "raw"
    for d in (raw / "cards", raw):
        for ext in (".png", ".webp", ".jpg", ".jpeg"):
            if (d / (name + ext)).exists():
                return d / (name + ext)
    return None


def make(src: Path, name: str, out: Path) -> None:
    im = Image.open(src)
    w, h = SIZES[name]
    im = im.convert("RGBA" if name == "avatar" else "RGB")
    # 比例不对时居中裁成目标比例（展示图偏上一点裁，保住脸）
    r = w / h
    if abs(im.width / im.height - r) > 0.01:
        if im.width / im.height > r:
            cw = round(im.height * r)
            im = im.crop(((im.width - cw) // 2, 0, (im.width - cw) // 2 + cw, im.height))
        else:
            ch = round(im.width / r)
            top = round((im.height - ch) * (0.25 if name == "portrait" else 0.5))
            im = im.crop((0, top, im.width, top + ch))
    im = im.resize((w, h), Image.LANCZOS)
    im.save(out, "WEBP", quality=90, method=6)
    print(f"{out.relative_to(CHARACTERS.parent)}  {w}×{h}  {out.stat().st_size // 1024}KB")


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for d in sorted(p for p in CHARACTERS.iterdir() if p.is_dir()):
        if only and d.name != only:
            continue
        for name in SIZES:
            src = source(d.name, name)
            if src:
                make(src, name, d / f"{name}.webp")


if __name__ == "__main__":
    main()
