#!/usr/bin/env python3
"""立绘生产线：出题 → Codex 画 → 机器检查 → 看图验收 → 导入。说明见 art/README.md。

    python3 tools/art.py new <批次> <姿态...> [--chars a,b]   出题：每个角色 × 姿态一份提示词，生成 任务.md
    python3 tools/art.py check <批次>                          检查 成品/ 里画好的图，更新状态，生成 对比.html
    python3 tools/art.py pass <批次> <角色:姿态 | all>...      验收通过（all = 所有「待验收」的）
    python3 tools/art.py redo <批次> <角色:姿态> "原因"        退回重画：原因写进那份提示词，下次画存成新的一版
    python3 tools/art.py import <批次>                         把「通过」的存档到 art/原图/，处理成 characters/<角色>/<姿态>.webp
    python3 tools/art.py status [批次]                         看进度

角色 = art/角色/<id>.md（角色锁定、参考图、每个姿态她自己的动作），姿态 = art/姿态/<姿态>.md（用途、拼哪几段规则、成对和底图），
规则段落 = art/规则/*.txt。一张图一份提示词；成对的（busy_left → busy_right）后画的那张拿先画好的当底图改，不镜像翻转。
成品/ 里每画一次存一版（<角色>__<姿态>__v1.png、v2……），旧的不覆盖不挪走；不要的版本 loki 自己删，检查、对比、导入都用剩下的最新一版。
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
CHARACTERS = ROOT / "characters"
STATES = ["待画", "机检不过", "待验收", "退回", "通过", "已导入"]


# ---------------- 读规格 ----------------

def read_character(cid):
    p = ART / "角色" / f"{cid}.md"
    if not p.exists():
        sys.exit(f"没有角色 {cid}（art/角色/{cid}.md）")
    t = p.read_text()
    meta = dict(re.findall(r"^(角色 id|基于|参考图): *(.+)$", t, re.M))
    lock = re.search(r"## 角色锁定\s*```text\n(.*?)\n```", t, re.S).group(1).strip()
    lines = dict(re.findall(r"^- ([a-z_0-9-]+): *(.+)$", t.split("## 动作", 1)[1], re.M))
    return {
        "id": cid, "name": t.splitlines()[0].lstrip("# ").strip(), "base": meta.get("基于"),
        "refs": [r.strip() for r in meta.get("参考图", "").split(",") if r.strip()], "lock": lock, "lines": lines,
    }


def read_pose(pose, cid=""):
    """彩蛋角色（egg-…）的 pop / pretend / caught / bye / escape 用 姿态/彩蛋/ 里的（bye 和普通角色的道别同名）"""
    egg = ART / "姿态" / "彩蛋" / f"{pose}.md"
    p = egg if cid.startswith("egg-") and egg.exists() else ART / "姿态" / f"{pose}.md"
    if not p.exists():
        sys.exit(f"没有姿态 {pose}（art/姿态/{pose}.md）")
    t = p.read_text()
    meta = dict(re.findall(r"^([^\s:#]+): *(.+)$", t, re.M))
    return {
        "pose": pose, "title": t.splitlines()[0].lstrip("# ").strip(), "rules": [r.strip() for r in meta.get("规则", "通用").split(",")],
        "side": meta.get("方向"), "base": meta.get("底图"), "partner": meta.get("成对"), "import": meta.get("导入", ""),
        "default": meta.get("默认动作", ""),
    }


def rule(name, **kw):
    t = (ART / "规则" / f"{name}.txt").read_text().strip()
    for k, v in kw.items():
        t = t.replace("{" + k + "}", v)
    return t


def shipped_characters():
    out = []
    for f in sorted(CHARACTERS.glob("*/character.json")):
        if not json.loads(f.read_text()).get("egg") and (ART / "角色" / f"{f.parent.name}.md").exists():
            out.append(f.parent.name)
    return out


def action_line(ch, pose):
    """她自己的动作：自己写了用自己的，皮肤没写用「基于」那个角色的，都没有用姿态的默认动作"""
    if pose["pose"] in ch["lines"]:
        return ch["lines"][pose["pose"]]
    if ch["base"]:
        b = read_character(ch["base"])
        if pose["pose"] in b["lines"]:
            return b["lines"][pose["pose"]]
    return pose["default"]


# ---------------- 批次 ----------------

def batch_dir(name):
    return ART / "任务" / name


def versions(batch, cid, pose):
    """成品里这张的所有版本，旧的在前：[(版本号, 路径)]。没带版本号的老文件（2026-11-02 以前）算 v0"""
    d = batch_dir(batch) / "成品"
    out = [(0, d / f"{cid}__{pose}.png")] if (d / f"{cid}__{pose}.png").exists() else []
    for f in d.glob(f"{cid}__{pose}__v*.png"):
        m = re.fullmatch(rf"{re.escape(cid)}__{re.escape(pose)}__v(\d+)\.png", f.name)
        if m:
            out.append((int(m.group(1)), f))
    return sorted(out)


def done_path(batch, cid, pose):
    """这张现在算数的那版：剩下的最新一版；还没画是 None"""
    vs = versions(batch, cid, pose)
    return vs[-1][1] if vs else None


def done_pattern(batch, cid, pose):
    return batch_dir(batch) / "成品" / f"{cid}__{pose}__vN.png"


def archive_latest(cid, pose):
    d = ART / "原图" / cid / pose
    vs = sorted(d.glob("v*.png"), key=lambda p: int(re.sub(r"\D", "", p.stem) or 0)) if d.exists() else []
    return vs[-1] if vs else None


def existing_image(cid, pose):
    """这个角色这个姿态现在用的原图：存档的最新一版 → 老的 raw/ → 处理过的 webp"""
    for p in [archive_latest(cid, pose), CHARACTERS / cid / "raw" / f"{pose}.png", CHARACTERS / cid / f"{pose}.webp"]:
        if p and p.exists():
            return p
    return None


def load(batch):
    p = batch_dir(batch) / "状态.json"
    if not p.exists():
        sys.exit(f"没有批次 {batch}（{p.relative_to(ROOT)}）")
    return json.loads(p.read_text())


def save(batch, st):
    (batch_dir(batch) / "状态.json").write_text(json.dumps(st, ensure_ascii=False, indent=1) + "\n")
    write_tasks(batch, st)


def rel(p):
    return str(Path(p).resolve().relative_to(ROOT))


def rel_any(p):
    """还不存在的文件（vN 占位）也能写成相对路径"""
    return str(Path(p).relative_to(ROOT)) if Path(p).is_absolute() else str(p)


def base_source(batch, st, cid, base_pose):
    """底图：同一批里有就用这批画好的（先画），没有就用现在用的那张"""
    if any(i["char"] == cid and i["pose"] == base_pose for i in st["items"]):
        return done_path(batch, cid, base_pose) or done_pattern(batch, cid, base_pose), True
    return existing_image(cid, base_pose), False


def write_prompt(batch, st, item):
    ch, pose = read_character(item["char"]), read_pose(item["pose"], item["char"])
    side = (pose["side"] or "").upper()
    other = {"LEFT": "RIGHT", "RIGHT": "LEFT"}.get(side, "")
    blocks = [rule(r, SIDE=side) for r in pose["rules"]]   # 照姿态写的顺序拼；彩蛋不用「通用」，用自己那段
    blocks.append(ch["lock"])
    attach = []
    if pose["base"]:
        src, in_batch = base_source(batch, st, ch["id"], pose["base"])
        if in_batch:   # 底图会换版本（loki 删掉不要的），附件写成「最新的一版」，画的时候再看是哪个文件
            src = done_pattern(batch, ch["id"], pose["base"])
        attach.append((src, f"底图：{pose['base']}" + ("（本批画好的那张：成品里版本号最大的那个文件）" if in_batch else "（现在用的那张）")))
        if side and "探头" not in pose["rules"]:   # 眨眼也拿底图改，但不是左右成对
            blocks.append(rule("成对-后画", SIDE=side, OTHER=other, BASE=f"{pose['base']}.png"))
    elif pose["partner"]:
        blocks.append(rule("成对-先画", SIDE=side, PARTNER=f"{pose['partner']}.png"))
    for r in ch["refs"]:
        attach.append((ROOT / r, "设计参考"))
    out = done_pattern(batch, ch["id"], pose["pose"])
    blocks.append(f"POSE ({pose['pose']}): {action_line(ch, pose)}\nSave as: {out.name}")
    md = [f"# {ch['name']} · {pose['title']}", "",
          f"- 保存到：`{rel(out)}`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。"
          "**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）",
          "- 附件（按顺序附上）："]
    for i, (p, why) in enumerate(attach, 1):
        exists = p and (Path(p).exists() or (Path(p).name.endswith("__vN.png") and any(Path(p).parent.glob(Path(p).name.replace("vN", "v*")))))
        ok = "" if exists else "　⚠️ 文件还不存在：先画它"
        md.append(f"  {i}. `{rel_any(p) if p else '（没有）'}`（{why}）{ok}")
    if item.get("notes"):
        md += ["", "## 上次退回的原因（这次一定要改掉）", ""] + [f"- {n}" for n in item["notes"]]
    md += ["", "## 提示词", "", "```text", "\n\n".join(blocks), "```", ""]
    p = batch_dir(batch) / "提示词" / f"{ch['id']}__{pose['pose']}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(md))


def write_tasks(batch, st):
    rows = ["| # | 角色 | 姿态 | 状态 | 提示词 | 说明 |", "|---|---|---|---|---|---|"]
    for n, i in enumerate(st["items"], 1):
        note = "；".join(c["msg"] for c in i.get("checks", []) if c["level"] != "ok") or ""
        if i["state"] == "退回" and i.get("notes"):
            note = "退回：" + i["notes"][-1]
        rows.append(f"| {n} | {i['char']} | {i['pose']} | {i['state']} | [提示词](提示词/{i['char']}__{i['pose']}.md) | {note} |")
    todo = sum(i["state"] in ("待画", "机检不过", "退回") for i in st["items"])
    md = [f"# 批次：{batch}", "", st.get("about", ""), "",
          f"共 {len(st['items'])} 张，还要画 {todo} 张。状态：待画 → 机检不过 / 待验收 → 通过 / 退回 → 已导入。", "",
          "**给 Codex**：照 [art/AGENTS.md](../../AGENTS.md) 做。只画状态是「待画」「机检不过」「退回」的，按表格顺序一张一张画"
          "（成对的左边那张在前），每张单独打开它的提示词、按顺序附上附件、存到提示词里写的路径；每画完一张跑 `python3 tools/art.py check " + batch + "`。", "",
          *rows, ""]
    (batch_dir(batch) / "任务.md").write_text("\n".join(md))


# ---------------- 机器检查 ----------------

def mask_of(path):
    import numpy as np
    from PIL import Image
    im = Image.open(path)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    rgba = np.array(im.convert("RGBA"))
    if has_alpha:
        return True, rgba[:, :, 3] > 16
    # 白底时代的老图（2026-10 以前）：不够白的就算人物，只拿来当底图、对比例，新图照样要求透明
    return False, rgba[:, :, :3].min(axis=2) < 235


def bbox(m):
    import numpy as np
    rows, cols = np.where(m.any(1))[0], np.where(m.any(0))[0]
    return rows[0], rows[-1], cols[0], cols[-1]


def silhouette(m, n=128):
    import numpy as np
    from PIL import Image
    t, b, l, r = bbox(m)
    crop = Image.fromarray((m[t:b + 1, l:r + 1] * 255).astype("uint8")).resize((n, n))
    return np.array(crop) > 127


def iou(a, b):
    return float((a & b).sum()) / max(1, float((a | b).sum()))


def check_image(path, cid, pose_name, batch=None, st=None):
    """返回 [{level: ok/warn/fail, msg}]"""
    import numpy as np
    pose = read_pose(pose_name, cid)
    out = []
    has_alpha, m = mask_of(path)
    H, W = m.shape
    if not has_alpha or m.all():
        return [{"level": "fail", "msg": "不是透明背景（整张不透明）"}]
    if m[0, 0] or m[0, -1] or m[-1, 0] or m[-1, -1]:
        if not ("贴边" in pose["rules"] or "探头" in pose["rules"]):
            out.append({"level": "fail", "msg": "四个角不透明：背景没去干净"})
    if m.mean() > 0.8:
        out.append({"level": "fail", "msg": "人物占了八成以上的画面：背景可能没去掉"})
    if not m.any():
        return [{"level": "fail", "msg": "整张是空的"}]
    t, b, l, r = bbox(m)
    if t <= H * 0.004:
        out.append({"level": "fail", "msg": "头顶贴着上边框：头顶可能被切掉了（上面要留一点空）"})
    edge = "贴边" in pose["rules"] or "探头" in pose["rules"]
    if edge:
        side = pose["side"]
        # 切口不一定正好压在边框上：差几十像素的透明缝导入时会裁掉（prepare.py 裁到人物外框），只要切口是一条直的、离边框不远
        solid = np.where(m[t:b + 1].mean(0) > 0.15)[0]   # 身体盖住一成半以上高度的列：切口就是最靠边的那一列
        gap = W if not len(solid) else (solid[0] if side == "left" else W - 1 - solid[-1])
        far = (r >= W - 2) if side == "left" else (l <= 1)
        if gap > W * 0.06:
            out.append({"level": "fail", "msg": f"{'左' if side == 'left' else '右'}边框没从她身上切过去（贴边图要贴着{'左' if side == 'left' else '右'}边）"})
        if far:
            out.append({"level": "fail", "msg": f"另一边（{'右' if side == 'left' else '左'}边）也贴着边框了：方向可能画反了"})
    else:
        if l <= 1 or r >= W - 2:
            out.append({"level": "fail", "msg": "身体碰到左右边框：被切到了"})
        if (H - 1 - b) > H * 0.15:
            out.append({"level": "warn", "msg": f"脚离底边 {round((H - 1 - b) / H * 100)}%：可能没站在底边"})
    # 比例：和她的待机原图比人物占画面的高度（皮肤有身高锁，差太多会一会儿大一会儿小）
    ref = existing_image(cid, "idle")
    if ref and ref.suffix == ".png":
        _, rm = mask_of(ref)
        rt, rb, _, _ = bbox(rm)
        mine, theirs = (b - t) / H, (rb - rt) / rm.shape[0]
        diff = mine / theirs - 1
        if abs(diff) > 0.1 and not edge:
            out.append({"level": "warn", "msg": f"人物比待机图{'大' if diff > 0 else '小'} {abs(round(diff * 100))}%（桌面上会忽大忽小）"})
    # 成对：后画的那张要和先画的那张方向相反，但不能是直接镜像
    if pose["base"] and pose["side"] and not edge and batch:
        bsrc, _ = base_source(batch, st, cid, pose["base"])
        if bsrc and bsrc.exists():
            _, bm = mask_of(bsrc)
            me, other = silhouette(m), silhouette(bm)
            flipped, same = iou(me, other[:, ::-1]), iou(me, other)
            if same > flipped + 0.08:   # 轮廓本来就左右差不多的（千问拿平板）两个数很接近，差得明显才算画反
                out.append({"level": "fail", "msg": f"和 {pose['base']} 朝同一个方向（轮廓重合 {same:.2f}，翻过来才 {flipped:.2f}）：方向可能没换"})
            elif flipped > 0.97:
                out.append({"level": "warn", "msg": f"和 {pose['base']} 几乎是镜像（{flipped:.2f}）：检查单边的发饰、尾巴是不是跟着翻了"})
    return out or [{"level": "ok", "msg": "机检通过"}]


# ---------------- 对比页 ----------------

def write_sheet(batch, st):
    d = batch_dir(batch)
    def src(p):
        return os.path.relpath(p, d) if p and Path(p).exists() else None
    cards = []
    for i in st["items"]:
        cid, pose = i["char"], i["pose"]
        vs = versions(batch, cid, pose)
        pics = [(f"v{v}" + ("（导入用这版）" if n == len(vs) - 1 else ""), f) for n, (v, f) in reversed(list(enumerate(vs)))] or [("还没画", None)]
        pics.append(("现在用的", CHARACTERS / cid / f"{pose}.webp"))
        spec = read_pose(pose, cid)
        if spec["base"]:
            pics.append((f"底图 {spec['base']}", base_source(batch, st, cid, spec["base"])[0]))
        pics.append(("待机", CHARACTERS / cid / "idle.webp"))
        def fig(title, p):
            inner = f'<img src="{src(p)}">' if src(p) else "<span>没有</span>"
            return f'<figure><div class="pic">{inner}</div><figcaption>{title}</figcaption></figure>'
        imgs = "".join(fig(t, p) for t, p in pics)
        checks = "".join(f'<li class="{c["level"]}">{c["msg"]}</li>' for c in i.get("checks", []))
        notes = "".join(f'<li class="fail">退回：{n}</li>' for n in i.get("notes", []))
        cards.append(f'<section class="s-{i["state"]}"><h2>{cid} · {pose} <em>{i["state"]}</em></h2><div class="row">{imgs}</div>'
                     f'<ul>{checks}{notes}</ul><code>python3 tools/art.py pass {batch} {cid}:{pose}</code>'
                     f'<code>python3 tools/art.py redo {batch} {cid}:{pose} "原因"</code></section>')
    html = f"""<!doctype html><meta charset="utf-8"><title>对比 · {batch}</title>
<style>
body {{ font: 14px -apple-system, "PingFang SC", sans-serif; margin: 16px; background: #f6f2ee; color: #3a2a22; }}
section {{ background: #fff; border-radius: 10px; padding: 12px 16px; margin: 0 0 16px; }}
section.s-通过, section.s-已导入 {{ opacity: .55; }}
h2 {{ font-size: 16px; margin: 0 0 8px; }} h2 em {{ font-style: normal; font-size: 12px; background: #eee; border-radius: 6px; padding: 2px 6px; }}
.row {{ display: flex; gap: 12px; flex-wrap: wrap; }}
figure {{ margin: 0; text-align: center; }}
.pic {{ width: 220px; height: 260px; display: flex; align-items: flex-end; justify-content: center; border-radius: 8px;
  background: repeating-conic-gradient(#e7e1db 0 25%, #fff 0 50%) 0 0 / 16px 16px; }}
.pic img {{ max-width: 100%; max-height: 100%; }} .pic span {{ color: #aaa; margin: auto; }}
ul {{ padding-left: 18px; }} li.fail {{ color: #c0392b; }} li.warn {{ color: #b9770e; }} li.ok {{ color: #1e8449; }}
code {{ display: block; font-size: 12px; color: #777; user-select: all; }}
</style>
<h1>对比 · {batch}</h1>
<p>棋盘格是透明的地方。左边是画过的每一版（最新的在最左，导入用它），后面是现在用的、底图和待机图。
不喜欢最新那版、想用早一点的：去 成品/ 里把不要的版本删掉，再跑一次 check 刷新这页。</p>
{''.join(cards)}
"""
    (d / "对比.html").write_text(html)


# ---------------- 命令 ----------------

def cmd_new(args):
    if len(args) < 2:
        sys.exit("用法：art.py new <批次> <姿态...> [--chars a,b]")
    chars = None
    if "--chars" in args:
        k = args.index("--chars")
        chars = args[k + 1].split(",")
        args = args[:k] + args[k + 2:]
    batch, poses = args[0], args[1:]
    if (batch_dir(batch) / "状态.json").exists():
        sys.exit(f"批次 {batch} 已经有了")
    chars = chars or shipped_characters()
    for c in chars:
        read_character(c)
    specs = [read_pose(p, chars[0]) for p in poses]
    # 先画底图那张：同一批里有底图的排在底图后面
    items = [{"char": c, "pose": s["pose"], "state": "待画", "notes": [], "checks": []}
             for c in chars for s in sorted((read_pose(p, c) for p in poses), key=lambda s: 1 if s["base"] in poses else 0)]
    batch_dir(batch).mkdir(parents=True)
    (batch_dir(batch) / "成品").mkdir()
    about = "；".join(f"{s['pose']}：{s['title']}" for s in specs)
    st = {"about": about, "items": items}
    for i in items:
        write_prompt(batch, st, i)
    save(batch, st)
    print(f"出好了：{rel(batch_dir(batch) / '任务.md')}（{len(items)} 张）")


def find(st, key):
    cid, _, pose = key.partition(":")
    for i in st["items"]:
        if i["char"] == cid and i["pose"] == pose:
            return i
    sys.exit(f"这批里没有 {key}")


def cmd_check(args):
    batch = args[0]
    st = load(batch)
    for i in st["items"]:
        vs = versions(batch, i["char"], i["pose"])
        if not vs or i["state"] in ("通过", "已导入"):
            continue
        if i["state"] == "退回" and vs[-1][0] <= i.get("rejected", -1):
            continue   # 退回后还没画新的一版
        p = vs[-1][1]
        i["checks"] = check_image(p, i["char"], i["pose"], batch, st)
        i["version"] = vs[-1][0]
        bad = [c["msg"] for c in i["checks"] if c["level"] == "fail"]
        i["state"] = "机检不过" if bad else "待验收"
        print(f"{i['char']}:{i['pose']}  v{vs[-1][0]}  {i['state']}  " + "；".join(c["msg"] for c in i["checks"]))
    save(batch, st)
    write_sheet(batch, st)
    print(f"对比页：{rel(batch_dir(batch) / '对比.html')}")


def cmd_pass(args):
    batch, keys = args[0], args[1:]
    st = load(batch)
    picked = [i for i in st["items"] if i["state"] == "待验收"] if keys == ["all"] else [find(st, k) for k in keys]
    for i in picked:
        if not done_path(batch, i["char"], i["pose"]):
            sys.exit(f"{i['char']}:{i['pose']} 还没画")
        i["state"] = "通过"
    save(batch, st)
    write_sheet(batch, st)
    print(f"通过 {len(picked)} 张")


def cmd_redo(args):
    if len(args) < 3:
        sys.exit('用法：art.py redo <批次> <角色:姿态> "原因"')
    batch, key, why = args[0], args[1], " ".join(args[2:])
    st = load(batch)
    i = find(st, key)
    vs = versions(batch, i["char"], i["pose"])
    i["rejected"] = vs[-1][0] if vs else -1   # 这一版及以前的都不算数了，等新的一版；旧图留在成品里
    i["notes"].append(why)
    i["state"] = "退回"
    i["checks"] = []
    write_prompt(batch, st, i)
    save(batch, st)
    write_sheet(batch, st)
    print(f"退回 {key}：{why}")


def cmd_import(args):
    batch = args[0]
    st = load(batch)
    n, blinks = 0, set()
    for i in st["items"]:
        if i["state"] != "通过":
            continue
        cid, pose = i["char"], i["pose"]
        vs = versions(batch, cid, pose)
        if not vs:
            print(f"{cid}:{pose} 成品里一版都没有了，跳过")
            continue
        src = vs[-1][1]
        d = ART / "原图" / cid / pose
        d.mkdir(parents=True, exist_ok=True)
        v = len(list(d.glob("v*.png"))) + 1
        keep = d / f"v{v}.png"
        shutil.copy2(src, keep)
        env = dict(os.environ)
        for kv in read_pose(pose, cid)["import"].split():
            k, _, val = kv.partition("=")
            env[k] = val
        subprocess.run([sys.executable, str(ROOT / "tools" / "prepare.py"), str(keep), cid, pose], check=True, env=env)
        i["state"] = "已导入"
        n += 1
        more = f"，成品里还有 {len(vs) - 1} 版没删，用的是最新的" if len(vs) > 1 else ""
        print(f"{cid}:{pose} v{vs[-1][0]} → characters/{cid}/{pose}.webp（原图存档 {rel(keep)}{more}）")
        if pose in ("idle", "idle-blink"):
            blinks.add(cid)
    for cid in blinks:   # 眨眼帧只留眼睛那块，免得眨眼时全身抖一下
        if (CHARACTERS / cid / "idle.webp").exists() and (CHARACTERS / cid / "idle-blink.webp").exists():
            subprocess.run([sys.executable, str(ROOT / "tools" / "fix_blink.py"), cid], check=True)
    save(batch, st)
    write_sheet(batch, st)
    print(f"导入 {n} 张")


def cmd_status(args):
    batches = [args[0]] if args else sorted(p.name for p in (ART / "任务").iterdir() if (p / "状态.json").exists())
    for b in batches:
        st = load(b)
        counts = {s: sum(i["state"] == s for i in st["items"]) for s in STATES}
        print(f"{b}：" + "  ".join(f"{s} {c}" for s, c in counts.items() if c))


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("new", "check", "pass", "redo", "import", "status"):
        sys.exit(__doc__)
    {"new": cmd_new, "check": cmd_check, "pass": cmd_pass, "redo": cmd_redo, "import": cmd_import, "status": cmd_status}[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
