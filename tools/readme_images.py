#!/usr/bin/env python3
"""生成 README 配图：按 App 里的布局把 立绘 + 光晕 + 特效 + 气泡 + 名牌 + 额度 拼成静态图。
    python3 tools/readme_images.py
特效用 node 从 app/web/effects.js 取出、去掉动画后由 qlmanage 渲染（和 tools/fxcheck 一样），只能在 macOS 上跑。
输出 docs/images/characters.webp、actions.webp、eggs.webp。
"""
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
CHARS = REPO / "characters"
OUT = REPO / "docs/images"
S = 3                       # 渲染倍数（CSS 像素 × 3）
WIN_W = 260                 # App 窗口宽
STAGE_W, STAGE_H = 250, 241
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

# (角色, 姿态, 气泡, 额度)
HERO = [
    ("claude", "idle", "我在这儿～", "5小时 剩余 72% ｜ 本周 剩余 58% · 10/10 重置"),
    ("gpt", "idle", "……来了。今天写什么？", "5小时 剩余 85% ｜ 本周 剩余 63% · 10/10 重置"),
    ("deepseek", "idle", "DeepSeek 来啦！", "余额 ¥6.29"),
    ("gemini", "idle", "喵～Gemini 上线！", "Gemini 剩余 91% · 10/12 重置 ｜ Claude/GPT-OSS 剩余 100%"),
]
ACTIONS = [
    ("claude", "reading", "我看看这里写了什么", None), ("gpt", "running", "跑一下测试。", None),
    ("deepseek", "feast", "有钱啦！再来十碗！", None), ("gemini", "drawing", "Nano Banana，启动！", None),
    ("claude", "proud", "大活干完了！", None), ("gpt", "reset", "reset 了。今天可以多写一点。", None),
    ("deepseek", "compact", "塞、塞不下了！", None), ("gemini", "float", "反——重——力——喵～", None),
    ("claude", "clawd", "Clawd 也在陪我～", None), ("gpt", "searching", "查一查。", None),
    ("deepseek", "swim", "咕噜咕噜～", None), ("gemini", "delegating", "交给分身喵", None),
]
EGGS = [
    ("egg-claude", "pretend", "（翻书）嗯……这个问题很有意思呢。", None),
    ("egg-gpt", "pretend", "……哼，交给我吧。（憋笑）", None),
    ("egg-gemini", "pop", "喵～Gemini 来啦！", None),
]

# 从 effects.js 取出某个特效的静态 SVG：去掉动画，隐藏的元素显出来，笔画画完整
FX_JS = r"""
const fs = require('fs'); global.window = {}
require(process.argv[2]); const F = window.CrossFx
const jobs = JSON.parse(process.argv[3]), out = {}
for (const [key, named] of jobs) {
  let s = (named ? F.named[named] : F.surroundings(key)) || ''
  // 沿路径移动的元素（画笔、纸飞机、放大镜）：放到路径起点
  s = s.replace(/<g>((?:(?!<g>)[\s\S])*?)<animateMotion path="M\s*([-\d.]+)[ ,]+([-\d.]+)[^"]*"([^>]*)\/>((?:<animate[^>]*\/>)*)<\/g>/g,
    (m, body, x, y, rest) => `<g transform="translate(${x} ${y})${/rotate="auto"/.test(rest) ? ' rotate(-55)' : ''}">${body}</g>`)
  s = s.replace(/<animate[^>]*\/>/g, '').replace(/<animateTransform[^>]*\/>/g, '').replace(/<animateMotion[^>]*\/>/g, '')
       .replace(/opacity="0(\.\d+)?"/g, 'opacity="1"').replace(/stroke-dashoffset="\d+"/g, 'stroke-dashoffset="0"')
       .replace(/ scale\(0\)"/g, ' scale(1)"')
       .replace(/var\(--glyph, ([^)]+)\)/g, '$1').replace(/var\(--glyph-stroke, none\)/g, 'none')
  out[key + '|' + (named || '')] = s
}
console.log(JSON.stringify({ fx: out, aura: F.AURA, CW: F.CW, CH: F.CH }))
"""


def font(px):
    return ImageFont.truetype(FONT, px * S)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def glyph_color(svg, cfg):
    g = cfg.get("glyph") or {}
    return svg.replace("#b5651d", g.get("fill", "#b5651d"))


def render_fx(svgs, tmp):
    """qlmanage 把每个 SVG 渲染成 PNG。它只出不透明的白底图，所以白底、黑底各渲染一次，
    用两张的差算出透明度（白底 - 黑底 = 255 × (1 - α)）。"""
    def run(bg):
        paths = []
        for i, s in enumerate(svgs):
            p = tmp / f"fx{i}-{bg}.svg"
            back = '<rect width="580" height="580" fill="#000"/>' if bg == "black" else ""
            p.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 580" width="580" height="580">{back}{s}</svg>')
            paths.append(p)
        subprocess.run(["qlmanage", "-t", "-s", str(580 * S), "-o", str(tmp)] + [str(p) for p in paths],
                       check=True, capture_output=True)
        return [Image.open(f"{p}.png").convert("RGB") for p in paths]
    out = []
    for w, b in zip(run("white"), run("black")):
        w = np.asarray(w, dtype=np.float32)
        b = np.asarray(b, dtype=np.float32)
        alpha = np.clip(255 - (w - b).max(axis=2), 0, 255)          # 最保守的通道
        rgb = np.clip(b * 255 / np.maximum(alpha, 1)[..., None], 0, 255)  # 还原颜色 = 黑底 / α
        out.append(Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA"))
    return out


def pill(draw, cx, top, text, fnt, fill, color, border=None, pad=(9, 2), radius=8, maxw=None):
    tw = draw.textlength(text, font=fnt)
    w = tw + pad[0] * 2 * S
    h = fnt.size * 1.35 + pad[1] * 2 * S
    x0 = cx - w / 2
    draw.rounded_rectangle([x0, top, x0 + w, top + h], radius=radius * S, fill=fill,
                           outline=border, width=int(1.5 * S) if border else 0)
    draw.text((cx, top + h / 2), text, font=fnt, fill=color, anchor="mm")
    return top + h


def tile(cid, pose, line, quota, fx_img, aura):
    cfg = json.loads((CHARS / cid / "character.json").read_text(encoding="utf-8"))
    accent = cfg.get("accent", "#e0b48a")
    W = WIN_W * S
    bubble_h = 40 * S
    H = (bubble_h + STAGE_H * S + 62 * S)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sx = (W - STAGE_W * S) // 2
    sy = bubble_h

    # 光晕：radial-gradient(closest-side, c 0%, c·45% 45%, 透明 100%)，整体不透明度 aura_o
    c, o = aura
    if cfg.get("egg"):
        c = cfg.get("aura", "#bcd4ff")
    o = min(.75, o * 1.4)
    R = 120 * S
    glow = Image.new("RGBA", (2 * R, 2 * R), (0, 0, 0, 0))
    gp = glow.load()
    rgb = hex_rgb(c)
    for y in range(2 * R):
        for x in range(2 * R):
            d = ((x - R) ** 2 + (y - R) ** 2) ** 0.5 / R
            if d >= 1:
                continue
            a = 1 - d / .45 * .55 if d < .45 else .45 * (1 - (d - .45) / .55)
            gp[x, y] = rgb + (int(255 * a * o),)
    im.alpha_composite(glow, (sx + STAGE_W * S // 2 - R, sy + STAGE_H * S // 2 - R))

    # 影子
    d = ImageDraw.Draw(im)
    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([sx + (STAGE_W / 2 - 55) * S, sy + (STAGE_H - 17) * S,
                                    sx + (STAGE_W / 2 + 55) * S, sy + (STAGE_H - 7) * S], fill=(0, 0, 0, 33))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(1.5 * S)))

    # 立绘：#body 占舞台 left 17.8% top 21.1% w 64.5% h 75%，contain + 底部居中
    files = sorted((CHARS / cid).glob(f"{pose}.webp")) or sorted((CHARS / cid).glob(f"{pose}-*.webp")) or [CHARS / cid / "idle.webp"]
    art = Image.open(files[0]).convert("RGBA")
    bw, bh = STAGE_W * .645 * S, STAGE_H * .75 * S
    k = min(bw * 1.55 / art.width, bh / art.height)  # 和 App 一样：按高度占满，宽的往两边伸
    art = art.resize((int(art.width * k), int(art.height * k)), Image.LANCZOS)
    bx = sx + STAGE_W * .178 * S + (bw - art.width) / 2
    by = sy + STAGE_H * .211 * S + bh - art.height
    im.alpha_composite(art, (int(bx), int(by)))

    # 特效：580x560 画布等比缩进舞台
    if fx_img is not None:
        k = min(STAGE_W / 580, STAGE_H / 560)
        fw = int(580 * k * S)
        fx = fx_img.resize((fw, fw), Image.LANCZOS)
        ox = sx + (STAGE_W * S - fw) // 2
        oy = sy + (STAGE_H * S - int(560 * k * S)) // 2
        im.alpha_composite(fx, (ox, oy))

    d = ImageDraw.Draw(im)
    if line:
        pill(d, W / 2, 4 * S, line, font(13), (255, 255, 255, 242), (74, 36, 24), border=hex_rgb(accent), pad=(11, 5), radius=12)
    y = sy + STAGE_H * S - 2 * S
    y = pill(d, W / 2, y, cfg.get("name", cid), font(11), (255, 255, 255, 217), (107, 74, 58))
    if quota:  # 和 App 一样：「｜」隔开的每段占一行，放在同一块底板里
        lines = [t.strip() for t in quota.split("｜") if t.strip()]
        f = font(10)
        lh = f.size * 1.35
        w = max(d.textlength(t, font=f) for t in lines) + 16 * S
        top = y + 2 * S
        d.rounded_rectangle([W / 2 - w / 2, top, W / 2 + w / 2, top + lh * len(lines) + 2 * S], radius=7 * S, fill=(255, 255, 255, 204))
        for i, t in enumerate(lines):
            d.text((W / 2, top + S + lh * (i + .5)), t, font=f, fill=(107, 74, 58), anchor="mm")
    return im


def sheet(tiles, cols, pad=16):
    tw, th = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    bg = Image.new("RGBA", (cols * tw + pad * 2 * S, rows * th + pad * 2 * S), (247, 242, 235, 255))
    # 淡淡的纵向渐变，像桌面
    top, bot = (250, 247, 242), (238, 232, 224)
    g = ImageDraw.Draw(bg)
    for y in range(bg.height):
        t = y / bg.height
        g.line([(0, y), (bg.width, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    for i, t in enumerate(tiles):
        bg.alpha_composite(t, (pad * S + (i % cols) * tw, pad * S + (i // cols) * th))
    w = bg.width // 2  # 输出 1.5 倍
    return bg.resize((w, int(bg.height * w / bg.width)), Image.LANCZOS)


def main():
    groups = [("characters", HERO, 4), ("actions", ACTIONS, 4), ("eggs", EGGS, 3)]
    jobs = []
    for _, shots, _ in groups:
        for cid, pose, _, _ in shots:
            cfg = json.loads((CHARS / cid / "character.json").read_text(encoding="utf-8"))
            named = (cfg.get("fx") or {}).get(pose)
            if not cfg.get("egg"):
                jobs.append([pose, named or ""])
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        (tmp / "fx.js").write_text(FX_JS)
        res = json.loads(subprocess.run(["node", str(tmp / "fx.js"), str(REPO / "app/web/effects.js"), json.dumps(jobs)],
                                        check=True, capture_output=True, text=True).stdout)
        OUT.mkdir(parents=True, exist_ok=True)
        for name, shots, cols in groups:
            svgs, metas = [], []
            for cid, pose, line, quota in shots:
                cfg = json.loads((CHARS / cid / "character.json").read_text(encoding="utf-8"))
                named = (cfg.get("fx") or {}).get(pose) or ""
                svg = "" if cfg.get("egg") else res["fx"].get(f"{pose}|{named}", "")
                svgs.append(glyph_color(svg, cfg))
                metas.append((cid, pose, line, quota, res["aura"].get(pose, ["#ffd9b0", .35])))
            fxs = render_fx(svgs, tmp)
            tiles = [tile(cid, pose, line, quota, fx if svg else None, aura)
                     for (cid, pose, line, quota, aura), fx, svg in zip(metas, fxs, svgs)]
            img = sheet(tiles, cols)
            img.convert("RGB").save(OUT / f"{name}.webp", quality=88, method=6)
            print(f"docs/images/{name}.webp  {img.width}x{img.height}")


if __name__ == "__main__":
    main()
