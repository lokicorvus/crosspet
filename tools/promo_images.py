#!/usr/bin/env python3
"""生成宣传图：
    python3 tools/promo_images.py [输出文件夹]      # 默认 ../crosspet-promo
- docs/images/cover.webp：README 顶部的横幅（封面立绘 + 标题）
- <输出文件夹>/xhs-1…6.png：小红书 / 贴吧用的 3:4 竖图
角色格子和 README 配图同一套画法（tools/readme_images.py 的 render_tiles）。所有宣传图都带原作者署名（立绘是 CC BY-NC-SA 4.0）。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from readme_images import render_tiles  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent / "crosspet-promo"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
W, H = 1242, 1656
INK, MUTED = (59, 42, 34), (138, 122, 112)
ACCENT = {"claude": (232, 163, 61), "gpt": (122, 143, 168), "deepseek": (59, 91, 181), "gemini": (123, 92, 214), "glm": (75, 90, 138)}
CREDIT = "非官方同人 · 角色原型：溟月（上善无形）、大肥鱼 / 白龙（B站 ZipZipPipe）· 立绘 CC BY-NC-SA 4.0 · 不商用"
REPO_URL = "github.com/lokicorvus/crosspet"


def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=2 if bold else 0)


def background(w=W, h=H):
    """淡紫到奶油色的竖向渐变，呼应封面立绘的底色。"""
    top, bot = (238, 230, 250), (251, 246, 239)
    bg = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(bg)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    return bg


def rounded(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.width - 1, img.height - 1], r, fill=255)
    out = img.convert("RGBA")
    out.putalpha(m)
    return out


def shadowed(canvas, img, xy, r=40, blur=24, alpha=60):
    sh = Image.new("RGBA", (img.width + blur * 4, img.height + blur * 4), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([blur * 2, blur * 2 + 10, blur * 2 + img.width, blur * 2 + img.height + 10], r, fill=(90, 60, 120, alpha))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)), (xy[0] - blur * 2, xy[1] - blur * 2))
    canvas.alpha_composite(img, xy)


def text_center(d, y, text, f, fill=INK):
    d.text((W / 2, y), text, font=f, fill=fill, anchor="mt")


def chips(d, y, items, f, cx=None, gap=16, pad=(26, 12)):
    widths = [d.textlength(t, font=f) + pad[0] * 2 for t, _ in items]
    x = (cx if cx is not None else W / 2) - (sum(widths) + gap * (len(items) - 1)) / 2
    for (t, color), w in zip(items, widths):
        h = f.size + pad[1] * 2
        d.rounded_rectangle([x, y, x + w, y + h], h / 2, fill=(255, 255, 255, 230), outline=color, width=3)
        d.text((x + w / 2, y + h / 2), t, font=f, fill=color, anchor="mm")
        x += w + gap


def footer(d, img_h=H):
    d.text((W / 2, img_h - 44), CREDIT, font=font(22), fill=MUTED, anchor="mm")


def trim(tile):
    """裁掉格子四周的透明边距（光晕也算内容），角色才能放大。"""
    a = tile.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    return tile.crop(a.getbbox())


def place(canvas, tiles, cols, top, bottom, captions=None, f=None, gap=24, margin=50):
    """把格子按 cols 列排在 top~bottom 之间，自动选最大的缩放比例；captions 是每格下面的说明文字。返回用到的最下沿。"""
    tiles = [trim(t) for t in tiles]
    rows = (len(tiles) + cols - 1) // cols
    cap_h = (f.size + 16) if captions else 0
    cell_w = (W - margin * 2 - gap * (cols - 1)) / cols
    mw, mh = max(t.width for t in tiles), max(t.height for t in tiles)
    k = min(cell_w / mw, (bottom - top - gap * (rows - 1) - cap_h * rows) / (rows * mh))
    cell_h = mh * k + cap_h
    used = rows * cell_h + gap * (rows - 1)
    y0 = top + (bottom - top - used) / 2
    d = ImageDraw.Draw(canvas)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        n_in_row = min(cols, len(tiles) - r * cols)
        row_w = n_in_row * cell_w + gap * (n_in_row - 1)
        x0 = (W - row_w) / 2 + c * (cell_w + gap)
        im = t.resize((int(t.width * k), int(t.height * k)), Image.LANCZOS)
        y = y0 + r * (cell_h + gap)
        canvas.alpha_composite(im, (int(x0 + (cell_w - im.width) / 2), int(y + mh * k - im.height)))
        if captions:
            d.text((x0 + cell_w / 2, y + mh * k + 8), captions[i], font=f, fill=INK, anchor="mt")
    return y0 + used


def cover_art():
    return Image.open(REPO / "app/icon/icon-source.webp").convert("RGBA")


# ---------- README 横幅 ----------
def readme_cover():
    w, h = 1600, 640
    bg = background(w, h)
    art = rounded(cover_art().resize((520, 520), Image.LANCZOS), 60)
    shadowed(bg, art, (70, 60), r=60)
    d = ImageDraw.Draw(bg)
    x = 660
    d.text((x, 120), "CrossPet", font=font(110, True), fill=INK)
    d.text((x + 4, 255), "跨 AI 桌宠", font=font(52, True), fill=(123, 92, 214))
    d.text((x + 4, 340), "你切到哪个 AI，她就变成哪个 AI 娘；", font=font(34), fill=INK)
    d.text((x + 4, 390), "AI 干什么活，她就跟着做什么动作。", font=font(34), fill=INK)
    f = font(28, True)
    xx = x + 4
    for t in ["Claude", "GPT", "DeepSeek", "Gemini", "GLM"]:
        tw = d.textlength(t, font=f) + 48
        color = ACCENT[t.lower()]
        d.rounded_rectangle([xx, 470, xx + tw, 522], 26, fill=(255, 255, 255, 235), outline=color, width=3)
        d.text((xx + tw / 2, 496), t, font=f, fill=color, anchor="mm")
        xx += tw + 14
    d.text((x + 4, 560), "macOS / Windows · 免费开源 · 非官方同人", font=font(26), fill=MUTED)
    bg.convert("RGB").save(REPO / "docs/images/cover.webp", quality=90, method=6)
    print("docs/images/cover.webp")


# ---------- 小红书 / 贴吧 3:4 ----------
def slide_cover():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 110, "我做了一只", font(70, True), MUTED)
    text_center(d, 200, "会跟着 AI 干活的桌宠", font(92, True))
    art = rounded(cover_art().resize((1000, 1000), Image.LANCZOS), 70)
    shadowed(bg, art, ((W - 1000) // 2, 360), r=70)
    chips(d, 1410, [(n, ACCENT[n.lower()]) for n in ["Claude", "GPT", "DeepSeek", "Gemini"]], font(36, True))
    text_center(d, 1500, "Mac / Windows 桌面小窗 · 免费开源", font(38), INK)
    footer(d)
    return bg


def slide_actions():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 80, "AI 干什么，她就演什么", font(76, True))
    text_center(d, 185, "读文件、写代码、跑命令、查资料、画图、派任务…每个都有立绘和小动画", font(32), MUTED)
    tiles = render_tiles([
        ("claude", "reading", "我看看这里写了什么", None), ("gpt", "running", "跑一下测试。", None),
        ("gemini", "drawing", "Nano Banana，启动！", None), ("deepseek", "searching", "出海找资料～", None),
        ("claude", "compact", "东西太多了……压一压", None), ("gpt", "delegating", "交给它们了。", None),
    ])
    place(bg, tiles, 2, 250, H - 90, gap=14, margin=30)
    footer(d)
    return bg


def slide_quota():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 80, "额度 / 余额，一眼看到", font(76, True))
    text_center(d, 185, "Claude 5 小时 / 每周 · Codex 额度 · DeepSeek 余额 · Antigravity 额度", font(32), MUTED)
    tiles = render_tiles([
        ("claude", "idle", "我在这儿～", "5小时 剩余 72% ｜ 本周 剩余 58% · 10/10 重置"),
        ("gpt", "tired", "额度……快用完了。", "5小时 剩余 6% · 14:30 重置 ｜ 本周 剩余 61%"),
        ("deepseek", "idle", "DeepSeek 来啦！", "余额 ¥26.29"),
        ("gemini", "idle", "喵～Gemini 上线！", "Gemini 剩余 91% · 10/12 重置 ｜ Claude/GPT-OSS 剩余 100%"),
    ])
    end = place(bg, tiles, 2, 250, H - 170, gap=20)
    text_center(d, end + 24, "快用完时额度变红，她会露出累了的样子", font(36, True), (192, 57, 43))
    footer(d)
    return bg


def slide_memes():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 80, "还懂社区梗", font(76, True))
    text_center(d, 185, "每只 AI 娘都有自己的专属反应", font(32), MUTED)
    shots = [
        ("claude", "sorry", "You're absolutely right!", None, "出错被纠正时"),
        ("gpt", "reset", "reset 了。今天可以多写一点。", None, "Codex 额度提前 reset"),
        ("deepseek", "feast", "有钱啦！再来十碗！", None, "充值后大口吃白饭"),
        ("claude", "clawd", "Clawd 也在陪我～", None, "闲着抱 Clawd 发呆"),
        ("gemini", "float", "反——重——力——喵～", None, "Antigravity 反重力"),
        ("deepseek", "proud", "大活干完啦！", None, "大活干完戴皇冠"),
    ]
    tiles = render_tiles([s[:4] for s in shots])
    place(bg, tiles, 2, 240, H - 90, captions=[s[4] for s in shots], f=font(34, True), gap=12, margin=30)
    footer(d)
    return bg


def slide_eggs():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 80, "彩蛋：混进来一条 DeepSeek", font(76, True))
    text_center(d, 185, "用 Claude / GPT / Gemini 时，偶尔会冒出一条穿着她们衣服的 DeepSeek", font(32), MUTED)
    tiles = render_tiles([
        ("egg-claude", "pretend", "（翻书）嗯……这个问题很有意思呢。", None),
        ("egg-gpt", "caught", "角、角掉了！", None),
        ("egg-gemini", "pop", "喵～Gemini 来啦！", None),
    ])
    y = place(bg, tiles, 3, 260, 1150, gap=16) + 70
    for line in ["她会装模作样地学人说话，尾巴却藏不住", "单击一下就能揪出她，她会慌慌张张溜走", "没人理的话，她会得意地自己走掉"]:
        text_center(d, y, line, font(40), INK)
        y += 80
    footer(d)
    return bg


def slide_install():
    bg = background()
    d = ImageDraw.Draw(bg)
    text_center(d, 80, "怎么装", font(76, True))
    art = rounded(cover_art().resize((300, 300), Image.LANCZOS), 40)
    shadowed(bg, art, ((W - 300) // 2, 200), r=40)
    steps = [
        ("1", "GitHub 搜 lokicorvus/crosspet", "打开项目主页，「快速开始」里按系统选"),
        ("2", "Mac：复制那一行命令到终端", "自动下载、安装、接上你用的 AI，不用去系统设置里放行"),
        ("3", "Windows：下载安装包", "解压后双击 install.cmd，不需要管理员权限"),
    ]
    y = 580
    for n, title, sub in steps:
        d.rounded_rectangle([90, y, W - 90, y + 190], 32, fill=(255, 255, 255, 235))
        d.ellipse([130, y + 50, 220, y + 140], fill=(123, 92, 214))
        d.text((175, y + 95), n, font=font(50, True), fill=(255, 255, 255), anchor="mm")
        d.text((260, y + 48), title, font=font(44, True), fill=INK)
        d.text((260, y + 118), sub, font=font(28), fill=MUTED)
        y += 220
    text_center(d, y + 30, "macOS 13+（Apple 芯片 / Intel）· Windows 10 / 11", font(34), INK)
    text_center(d, y + 90, "免费 · 开源 · 不收集任何数据", font(40, True), (123, 92, 214))
    footer(d)
    return bg


def main():
    readme_cover()
    OUT.mkdir(parents=True, exist_ok=True)
    for i, make in enumerate([slide_cover, slide_actions, slide_quota, slide_memes, slide_eggs, slide_install], 1):
        img = make()
        img.convert("RGB").save(OUT / f"xhs-{i}.png", optimize=True)
        print(OUT / f"xhs-{i}.png")


if __name__ == "__main__":
    main()
