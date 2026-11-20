"""迷你小帮手：把切好的单帧拼成一张横条 characters/<角色>/mini.webp，桌宠网页（app/web/mini-helper.js）按格子取帧。

    python3 tools/mini_sheet.py <角色> <单帧目录>

单帧目录里每帧一个 <帧名>.webp（顺序和 mini-helper.js 的 FRAMES 一致），切图时同一个比例缩好（站着约 140 高）。
每格 CELL_W × CELL_H，人物底边居中；同一组帧（跑步、抱书跑、思考）切的时候共用一个框，放进格子后相对位置不变。
外壳把角色目录里的 .webp 都当姿态扫进清单，所以 mini 会以「姿态 mini」出现在 poses 里，网页从那里拿地址（不用改外壳）。
"""
import sys
from pathlib import Path
from PIL import Image

FRAMES = ["idle", "happy", "sleep", "run-a", "run-b", "run-c", "wave", "read", "worried",
          "think-a", "think-b", "notes", "carry-a", "carry-b", "carry-c", "point", "gift"]
CELL_W, CELL_H = 136, 148
ROOT = Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    cid, src = sys.argv[1], Path(sys.argv[2])
    sheet = Image.new("RGBA", (CELL_W * len(FRAMES), CELL_H), (0, 0, 0, 0))
    for i, name in enumerate(FRAMES):
        im = Image.open(src / f"{name}.webp").convert("RGBA")
        if im.width > CELL_W or im.height > CELL_H:
            sys.exit(f"{name} 太大：{im.size}，格子 {CELL_W}×{CELL_H}")
        sheet.alpha_composite(im, (i * CELL_W + (CELL_W - im.width) // 2, CELL_H - im.height))
    out = ROOT / "characters" / cid / "mini.webp"
    sheet.save(out, quality=92, method=6)
    print(f"{out.relative_to(ROOT)}：{len(FRAMES)} 帧，{sheet.size[0]}×{sheet.size[1]}，{out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
