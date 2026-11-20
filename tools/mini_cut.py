"""迷你小帮手：把一个角色画好的 4 张格子图切成单帧、拼成 characters/<角色>/mini.webp（桌宠网页 app/web/mini-helper.js 用）。

    python3 tools/mini_cut.py <批次> <角色>[,<角色>…] [--use mini_carry=1] [--move-batch <批次>] [--frames <目录>]

用哪版：验收页选了哪版用哪版（状态.json 的 pick），没选用版本号最大的；--use 姿态=版本号 可以临时指定。
--move-batch：mini_move（飞 / 游 / 蹿的 3 帧）去那个批次找，不写就在本批找；找不到就不报错，move-a/b/c 用 run-a/b/c 顶上。
--frames：单帧另存一份到 <目录>/<角色>/（看切得对不对用），不写就只出 mini.webp。

四张图（规格见 art/规则/迷你*.txt）：
  mini       方图 2×2：待机、开心、睡觉、走路（走路不用了）
  mini_more  横图 3×2：跑步 3 帧；挥手、看书、着急
  mini_work  横图 3×2：思考 2 帧、记笔记；抱书（单帧，不用）、指你、递礼物
  mini_carry 横图 3×1：抱书跑 3 帧
  mini_move  横图 3×1：移动 3 帧（可选；飞 / 游的身体是横的，按头宽对齐大小，脚对齐左右）
缩放：每张按站着的小人缩到 STAND 高（mini 用待机、mini_more 用挥手、mini_work 用指你），抱书跑按 mini_work 里那个抱书的对齐大小，
四张图之间大小一致。连着播的几帧（跑步、抱书跑按头对齐，思考按脚对齐）共用一个框，放进格子后不会左右抖、腾空那帧还是离地的。
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art  # noqa: E402
from mini_sheet import CELL_H, CELL_W, FRAMES  # noqa: E402

STAND = 140
ALPHA = 40


def mask(im):
    return im.getchannel("A").point(lambda v: 255 if v > ALPHA else 0)


def bbox(im):
    b = mask(im).getbbox()
    if not b:
        raise SystemExit("有一格是空的")
    return b


def cells(im, cols, rows):
    w, h = im.width // cols, im.height // rows
    out = []
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))
            b = bbox(cell)
            if b[0] <= 1 or b[1] <= 1 or b[2] >= w - 1 or b[3] >= h - 1:
                print(f"  ⚠️ 第 {r + 1} 行第 {c + 1} 格的小人碰到格子边了，可能和邻格粘在一起，切完看一眼")
            out.append(cell)
    return out


def center_x(cell, part):
    """头（part='head'：外框最上面 25%）或脚（part='feet'：最下面 12%）的左右中线"""
    b = bbox(cell)
    h = b[3] - b[1]
    band = (b[1], b[1] + h // 4) if part == "head" else (b[3] - max(8, h * 12 // 100), b[3])
    m = mask(cell).crop((0, band[0], cell.width, band[1])).getbbox()
    return (m[0] + m[2]) / 2


def head_width(cell):
    """外框最上面 25% 的不透明宽度（飞 / 游的身体是横的，用头宽比身高稳）"""
    b = bbox(cell)
    m = mask(cell).crop((0, b[1], cell.width, b[1] + max(1, (b[3] - b[1]) // 4))).getbbox()
    return m[2] - m[0]


def group(cs, part):
    """连着播的几帧：按头 / 脚对齐左右，共用一个框（上下不动，腾空的还是离地）"""
    ref = center_x(cs[0], part)
    shifts = [round(ref - center_x(c, part)) for c in cs]
    boxes = [(b[0] + d, b[1], b[2] + d, b[3]) for b, d in zip(map(bbox, cs), shifts)]
    u = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return [c.crop((u[0] - d, u[1], u[2] - d, u[3])) for c, d in zip(cs, shifts)]


def scaled(im, k):
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def sheet_path(batch, st, cid, pose, use):
    if pose in use:
        p = art.batch_dir(batch) / "成品" / f"{cid}__{pose}__v{use[pose]}.png"
        return p if p.exists() else None
    return art.done_path(batch, st, cid, pose)


def move_frames(cs, k_more, wave):
    """mini_move 3 格：按头宽缩到和 mini_more 里挥手那个一样大，脚对齐"""
    k = k_more * head_width(wave) / head_width(cs[0])
    return {name: scaled(c, k) for name, c in zip(("move-a", "move-b", "move-c"), group(cs, "feet"))}


def cut(batch, cid, use, move_batch=None):
    st = art.load(batch)
    src = {p: sheet_path(batch, st, cid, p, use) for p in ("mini", "mini_more", "mini_work", "mini_carry")}
    missing = [p for p, f in src.items() if not f]
    if missing:
        raise SystemExit(f"{cid}：还没画 {', '.join(missing)}")
    print(f"{cid}：" + "、".join(f"{p} {Path(f).stem.rsplit('__', 1)[1]}" for p, f in src.items()))
    mv = sheet_path(move_batch or batch, art.load(move_batch) if move_batch else st, cid, "mini_move", use)
    print(f"  mini_move：{Path(mv).stem.rsplit('__', 1)[1] if mv else '没有，用跑步顶'}")
    im = {p: Image.open(f).convert("RGBA") for p, f in src.items()}
    out = {}

    idle, happy, sleep, _walk = cells(im["mini"], 2, 2)
    k = STAND / (bbox(idle)[3] - bbox(idle)[1])
    for name, c in (("idle", idle), ("happy", happy), ("sleep", sleep)):
        out[name] = scaled(c.crop(bbox(c)), k)

    m = cells(im["mini_more"], 3, 2)
    k = STAND / (bbox(m[3])[3] - bbox(m[3])[1])
    for name, c in zip(("run-a", "run-b", "run-c"), group(m[:3], "head")):
        out[name] = scaled(c, k)
    k_more = k
    for name, c in zip(("wave", "read", "worried"), m[3:]):
        out[name] = scaled(c.crop(bbox(c)), k)

    w = cells(im["mini_work"], 3, 2)
    k_work = STAND / (bbox(w[4])[3] - bbox(w[4])[1])
    for name, c in zip(("think-a", "think-b"), group(w[:2], "feet")):
        out[name] = scaled(c, k_work)
    for name, c in zip(("notes", "point", "gift"), (w[2], w[4], w[5])):
        out[name] = scaled(c.crop(bbox(c)), k_work)

    cc = cells(im["mini_carry"], 3, 1)
    carry_h = bbox(w[3])[3] - bbox(w[3])[1]   # mini_work 里那个抱书的，和这张的第一帧一样大
    k = k_work * carry_h / (bbox(cc[0])[3] - bbox(cc[0])[1])
    for name, c in zip(("carry-a", "carry-b", "carry-c"), group(cc, "head")):
        out[name] = scaled(c, k)

    if mv:
        out.update(move_frames(cells(Image.open(mv).convert("RGBA"), 3, 1), k_more, m[3]))
    else:
        for a, b in (("move-a", "run-a"), ("move-b", "run-b"), ("move-c", "run-c")):
            out[a] = out[b]
    return out


def pack(cid, frames):
    sheet = Image.new("RGBA", (CELL_W * len(FRAMES), CELL_H), (0, 0, 0, 0))
    for i, name in enumerate(FRAMES):
        f = frames[name]
        if f.width > CELL_W or f.height > CELL_H:   # 太宽 / 太高（跑步张开手脚、头发很大）：整体缩进格子
            f = scaled(f, min(CELL_W / f.width, CELL_H / f.height))
            print(f"  {name} 比格子大，缩到 {f.size}")
        sheet.alpha_composite(f, (i * CELL_W + (CELL_W - f.width) // 2, CELL_H - f.height))
    out = art.ROOT / "characters" / cid / "mini.webp"
    if not out.parent.is_dir():
        raise SystemExit(f"没有角色目录 {out.parent}")
    sheet.save(out, quality=92, method=6)
    print(f"  → {out.relative_to(art.ROOT)}（{out.stat().st_size // 1024} KB）")


def main():
    args = sys.argv[1:]
    use, frames_dir = {}, None
    while "--use" in args:
        i = args.index("--use")
        pose, v = args[i + 1].split("=")
        use[pose] = int(v)
        del args[i:i + 2]
    move_batch = None
    if "--move-batch" in args:
        i = args.index("--move-batch")
        move_batch = args[i + 1]
        del args[i:i + 2]
    if "--frames" in args:
        i = args.index("--frames")
        frames_dir = Path(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2:
        raise SystemExit(__doc__)
    batch, chars = args[0], args[1].split(",")
    for cid in chars:
        frames = cut(batch, cid, use, move_batch)
        if frames_dir:
            d = frames_dir / cid
            d.mkdir(parents=True, exist_ok=True)
            for name, f in frames.items():
                f.save(d / f"{name}.webp", quality=92)
        pack(cid, frames)


if __name__ == "__main__":
    main()
