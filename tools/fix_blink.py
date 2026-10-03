#!/usr/bin/env python3
"""眨眼帧修正。生图模型给的 idle-blink 往往整张重画，和 idle 有细微错位，直接用会让全身在眨眼时抖一下。
这里自动找出两张图差别最大的区域（眼睛），只把那一块从 idle-blink 柔和地贴回 idle。
    python3 tools/fix_blink.py <角色id>
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

d = Path(__file__).resolve().parent.parent / "characters" / sys.argv[1]
idle = Image.open(d / "idle.webp").convert("RGBA")
blink = Image.open(d / "idle-blink.webp").convert("RGBA")
if blink.size != idle.size:
    blink = blink.resize(idle.size, Image.LANCZOS)

diff = ImageChops.difference(idle.convert("L"), blink.convert("L"))
# 只在上半部分找（眼睛在脸上），去掉细线状的重影，只留成块的差异
band = diff.crop((0, 0, idle.width, int(idle.height * 0.6))).point(lambda v: 255 if v > 70 else 0)
box = band.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(25)).getbbox()
if not box:
    sys.exit("没找到眼睛区域，idle-blink 保持原样")
x0, y0, x1, y1 = box
mask = Image.new("L", idle.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((x0 - 6, y0 - 6, x1 + 6, y1 + 6), radius=22, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(5))
Image.composite(blink, idle, mask).save(d / "idle-blink.webp", "WEBP", quality=92, method=6)
print(f"{d.name}/idle-blink.webp 只保留眼睛区域 {box}（占全图 {(x1 - x0) * (y1 - y0) * 100 // (idle.width * idle.height)}%）")
