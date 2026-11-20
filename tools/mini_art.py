"""迷你小帮手的出题：和 tools/art.py 一样用（new / add / redo / check / status / review …），多两条迷你专用的规矩：

1. 姿态文件写了「风格参考: <图>」的（art/姿态/mini.md），提示词附件最后附上那张定好的迷你图，所有角色画成一套。
   图里画的就是她自己（文件名里带她的 id）时不附。
2. 皮肤（角色文件写了「基于: <原版>」）的 mini* 姿态：拿原版同一张（同一批里画好的那张）当底图，
   只换衣服、发饰和道具（art/规则/迷你-换衣.txt），小人的姿势和位置不动，切图时和原版对得上。

    python3 tools/mini_art.py new <批次> mini mini_more mini_work mini_carry --chars deepseek,gemini,…,deepseek-hoodie
    python3 tools/mini_art.py redo <批次> <角色:姿态> "原因"

出题 / 退回重写提示词的 mini 批次请用这个，不要直接用 art.py（art.py 会按普通姿态重写，皮肤就没了底图）。
check、review、status 两个都一样。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art  # noqa: E402

_read_pose = art.read_pose
_write_prompt = art.write_prompt


def read_pose(pose, cid=""):
    spec = _read_pose(pose, cid)
    p = art.ART / "姿态" / f"{pose}.md"
    meta = dict(art.re.findall(r"^([^\s:#]+): *(.+)$", p.read_text(), art.re.M)) if p.exists() else {}
    spec["style"] = meta.get("风格参考", "").strip() or None
    return spec


def attachments_md(attach):
    out = []
    for i, (p, why) in enumerate(attach, 1):
        exists = p and (Path(p).exists() or (Path(p).name.endswith("__vN.png") and any(Path(p).parent.glob(Path(p).name.replace("vN", "v*")))))
        ok = "" if exists else "　⚠️ 文件还不存在：先画它"
        out.append(f"  {i}. `{art.rel_any(p) if p else '（没有）'}`（{why}）{ok}")
    return out


def write_md(batch, item, ch, title, attach, blocks):
    out = art.done_pattern(batch, ch["id"], item["pose"])
    md = [f"# {ch['name']} · {title}", "",
          f"- 保存到：`{art.rel(out)}`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。"
          "**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）",
          "- 附件（按顺序附上）："] + attachments_md(attach)
    if item.get("notes"):
        md += ["", "## 上次退回的原因（这次一定要改掉）", ""] + [f"- {n}" for n in item["notes"]]
    md += ["", "## 提示词", "", "```text", "\n\n".join(blocks), "```", ""]
    p = art.batch_dir(batch) / "提示词" / f"{ch['id']}__{item['pose']}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(md))


def write_prompt(batch, st, item):
    ch, pose = art.read_character(item["char"]), read_pose(item["pose"], item["char"])
    if not pose["pose"].startswith("mini"):
        return _write_prompt(batch, st, item)
    out = art.done_pattern(batch, ch["id"], pose["pose"])
    if ch["base"]:   # 皮肤：拿原版同一张改衣服
        src, in_batch = art.base_source(batch, st, ch["base"], pose["pose"])
        if in_batch:
            src = art.done_pattern(batch, ch["base"], pose["pose"])
        attach = [(src, f"底图：原版 {ch['base']} 的 {pose['pose']}"
                   + ("（本批画好的那张：loki 在验收页选了哪版就用哪版，没选用版本号最大的）" if in_batch else "") + "，要改的就是它")]
        attach += [(art.ROOT / r, "换装参考：只看衣服、发饰和道具，不要照它画脸和姿势") for r in ch["refs"]]
        blocks = [art.rule("迷你-换衣"), ch["lock"],
                  f"POSE ({pose['pose']}): the same sheet as the first image, in this skin.\nSave as: {out.name}"]
        return write_md(batch, item, ch, pose["title"] + "（皮肤：拿原版改衣服）", attach, blocks)
    _write_prompt(batch, st, item)   # 原版：照常出题，再补上画风参考
    if pose["style"] and ch["id"] not in Path(pose["style"]).stem.split("-"):
        p = art.batch_dir(batch) / "提示词" / f"{ch['id']}__{pose['pose']}.md"
        t = p.read_text().split("\n")
        k = max(i for i, line in enumerate(t) if art.re.match(r"  \d+\. `", line))
        n = int(art.re.match(r"  (\d+)\.", t[k]).group(1)) + 1
        t.insert(k + 1, f"  {n}. `{pose['style']}`（画风参考：只看小人的比例、线条和上色，不要照它画人物）")
        p.write_text("\n".join(t))


art.read_pose = read_pose
art.write_prompt = write_prompt

if __name__ == "__main__":
    art.main()
