#!/usr/bin/env python3
"""小本子的七款角色字体：按面板上会用到的字做子集，出 app/web/fonts/notebook/*.woff2。

只在开发机上跑（要 fontTools 和 brotli：pip install fonttools brotli）。源字体放 ~/.cache/crosspet-fonts/，
没有就打印下载地址退出。用到的字 = notebook-themes.js、notebook.js、notebook-lines.js、notebook-friends.js、pair-chat.js、pet-talk.js 里的所有字 + 各角色 character.json 的
name / notebook / milestones + ASCII、常用中文标点。子集里没有的字（比如以后新写的批注）会回退到系统字体，
改了台词重跑一次就好：

    python3 tools/build-notebook-fonts.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path.home() / ".cache" / "crosspet-fonts"
OUT = ROOT / "app" / "web" / "fonts" / "notebook"

# 输出名, 源文件, 下载地址（都是 SIL Open Font License 1.1）
# 霞鹜文楷声明了保留字体名（「霞鹜」「LXGW」等）：OFL 不许改过的版本（子集也算）沿用，子集改名 Notebook Kai（RENAME）
RENAME = {"notebook-kai": "Notebook Kai"}
FONTS = [
    ("notebook-kai", "LXGWWenKai-Regular.ttf", "https://github.com/lxgw/LxgwWenKai/releases (LXGWWenKai-Regular.ttf)"),
    ("zcool-kuaile", "ZCOOLKuaiLe-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/zcoolkuaile"),
    ("zcool-xiaowei", "ZCOOLXiaoWei-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/zcoolxiaowei"),
    ("zcool-qingke-huangyou", "ZCOOLQingKeHuangYou-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou"),
    ("ma-shan-zheng", "MaShanZheng-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/mashanzheng"),
    ("long-cang", "LongCang-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/longcang"),
    ("zhi-mang-xing", "ZhiMangXing-Regular.ttf", "https://github.com/google/fonts/tree/main/ofl/zhimangxing"),
]


def wanted_text() -> str:
    parts = []
    # 第二页用各人的字写留言、回复和「最近她们聊了什么」（每对台词、群聊、反应），这些文案都要进子集
    for name in ("notebook-themes.js", "notebook.js", "notebook.html", "notebook-lines.js", "notebook-friends.js", "pair-chat.js", "pet-talk.js"):
        parts.append((ROOT / "app" / "web" / name).read_text(encoding="utf-8"))
    for cj in sorted((ROOT / "characters").glob("*/character.json")):
        try:
            c = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:
            continue
        parts.append(json.dumps([c.get("name"), c.get("notebook"), c.get("milestones")], ensure_ascii=False))
    parts.append("".join(chr(i) for i in range(0x20, 0x7F)))
    parts.append("，。、；：？！…—～·「」『』（）《》“”‘’　")
    return "".join(parts)


def main() -> int:
    missing = [(f, url) for _, f, url in FONTS if not (SRC / f).exists()]
    if missing:
        print(f"缺源字体，放进 {SRC}/ 后重跑：")
        for f, url in missing:
            print(f"  {f}  ← {url}")
        return 1
    from fontTools import subset

    text = wanted_text()
    chars = sorted({ch for ch in text if ord(ch) >= 0x20})
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for out, src, _ in FONTS:
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        font = subset.load_font(str(SRC / src), opts)
        s = subset.Subsetter(opts)
        s.populate(text="".join(chars))
        s.subset(font)
        if out in RENAME:
            family = RENAME[out]
            for rec in list(font["name"].names):
                if rec.nameID in (1, 16):
                    rec.string = family
                elif rec.nameID in (4,):
                    rec.string = family + " Regular"
                elif rec.nameID in (3, 6):
                    rec.string = family.replace(" ", "") + "-Regular"
                elif rec.nameID == 17:
                    rec.string = "Regular"
        dest = OUT / f"{out}.woff2"
        subset.save_font(font, str(dest), opts)
        total += dest.stat().st_size
        print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size // 1024} KB")
    print(f"{len(chars)} 个字，一共 {total // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
