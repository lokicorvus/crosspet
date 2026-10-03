#!/usr/bin/env python3
"""把 CrossPet 接入各个 AI（或撤销）。install.sh / uninstall.sh 调用它，也可以单独用：

    python3 tools/integrate.py install   claude-hooks | claude-mod | codex | deepseek | gemini
    python3 tools/integrate.py uninstall claude-hooks | claude-mod | codex | deepseek | gemini
    python3 tools/integrate.py status

原则：
- 改任何文件前先备份成 <文件>.bak-crosspet-<时间>
- 只添加 CrossPet 自己的条目，不动你原有的配置；卸载只删 CrossPet 的条目
- 识别 CrossPet 条目的标记：命令里含 crosspet-hook.py，或插件 id 为 crosspet
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent
SUPPORT = HOME / "Library/Application Support/CrossPet"
MARK = "crosspet-hook.py"


def backup(path: Path) -> None:
    if path.exists():
        dst = path.with_name(f"{path.name}.bak-crosspet-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(path, dst)
        print(f"  已备份 {path} → {dst.name}")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    return json.loads(text) if text else {}


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ours(group: dict) -> bool:
    return any(MARK in str(h.get("command", "")) for h in group.get("hooks", []))


def merge_hooks(target: Path, template: Path) -> None:
    """把模板里的钩子按事件追加进 target 的 hooks 字段（已存在的 CrossPet 条目先删再加，保证不重复）。"""
    data = load_json(target)
    hooks = data.setdefault("hooks", {})
    for event, groups in load_json(template)["hooks"].items():
        kept = [g for g in hooks.get(event, []) if not ours(g)]
        hooks[event] = kept + groups
    backup(target)
    save_json(target, data)
    print(f"  已写入 {target}")


def remove_hooks(target: Path) -> None:
    if not target.exists():
        return
    data = load_json(target)
    hooks = data.get("hooks", {})
    changed = False
    for event in list(hooks):
        kept = [g for g in hooks[event] if not ours(g)]
        if len(kept) != len(hooks[event]):
            changed = True
            if kept:
                hooks[event] = kept
            else:
                del hooks[event]
    if not hooks and "hooks" in data:
        del data["hooks"]
    if changed:
        backup(target)
        save_json(target, data)
        print(f"  已从 {target} 移除 CrossPet 钩子")


# ---- Claude Code ----
CLAUDE_SETTINGS = HOME / ".claude/settings.json"
CLAUDE_MOD_DIR = HOME / ".claude/mods/crosspet"


def claude_hooks(install: bool) -> None:
    if install:
        merge_hooks(CLAUDE_SETTINGS, REPO / "integrations/claude-code/hooks.json")
        print("  → 新开的 Claude Code 会话生效（已开的会话要重开）")
    else:
        remove_hooks(CLAUDE_SETTINGS)


def claude_mod(install: bool) -> None:
    data = load_json(CLAUDE_SETTINGS)
    env = data.setdefault("env", {})
    dirs = [d for d in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(":") if d]
    dirs = [d for d in dirs if Path(os.path.expanduser(d)) != CLAUDE_MOD_DIR]
    if install:
        if CLAUDE_MOD_DIR.exists():
            shutil.rmtree(CLAUDE_MOD_DIR)
        shutil.copytree(REPO / "integrations/claude-code/mod", CLAUDE_MOD_DIR)
        dirs.append(str(CLAUDE_MOD_DIR))
        print(f"  已复制 mod 到 {CLAUDE_MOD_DIR}")
    else:
        if CLAUDE_MOD_DIR.exists():
            shutil.rmtree(CLAUDE_MOD_DIR)
            print(f"  已删除 {CLAUDE_MOD_DIR}")
    if dirs:
        env["CLAUDE_CODE_PLUGIN_DIRS"] = ":".join(dirs)
    else:
        env.pop("CLAUDE_CODE_PLUGIN_DIRS", None)
    if not env:
        data.pop("env", None)
    backup(CLAUDE_SETTINGS)
    save_json(CLAUDE_SETTINGS, data)
    print(f"  已更新 {CLAUDE_SETTINGS} 的 env.CLAUDE_CODE_PLUGIN_DIRS")
    if install:
        print("  → 需要 Claude Code 2.1.28x 以上（支持 mod）；新开的会话生效")


# ---- Codex ----
CODEX_HOOKS = HOME / ".codex/hooks.json"


def codex(install: bool) -> None:
    if install:
        merge_hooks(CODEX_HOOKS, REPO / "integrations/codex/hooks.json")
        print("  → 下次打开 Codex 时要审查并「信任」这些钩子（CLI 里用 /hooks），之后才会生效")
    else:
        remove_hooks(CODEX_HOOKS)


# ---- DeepSeek Harness（插件）----
DSH_PROFILE = HOME / ".dsh/profiles/desktop"
DSH_PLUGIN_NAME = "@local/dsh-plugin-crosspet"
DSH_PLUGIN_DIR = SUPPORT / "dsh-plugin-crosspet"
DSH_BLOCK_START = "# ── CrossPet 桌宠（integrations/deepseek）"
DSH_BLOCK = f"""
{DSH_BLOCK_START} ──
# 把 DeepSeek 的工作状态和余额写给桌宠；移除本段即恢复原样。
- insert:
    - id: crosspet
      name: '{DSH_PLUGIN_NAME}'
# ── CrossPet 结束 ──
"""


def deepseek(install: bool) -> None:
    if not DSH_PROFILE.exists():
        print(f"  没找到 {DSH_PROFILE}，请先打开一次 DeepSeek Harness 桌面版")
        return
    pkg_path = DSH_PROFILE / "package.json"
    patch_path = DSH_PROFILE / "cordis.patch.yml"
    link = DSH_PROFILE / "node_modules/@local/dsh-plugin-crosspet"
    pkg = load_json(pkg_path)
    deps = pkg.setdefault("dependencies", {})
    patch = patch_path.read_text(encoding="utf-8") if patch_path.exists() else ""
    if DSH_BLOCK_START in patch:  # 先去掉旧的一段
        start = patch.index(DSH_BLOCK_START)
        end = patch.index("# ── CrossPet 结束 ──", start) + len("# ── CrossPet 结束 ──\n")
        patch = patch[:start].rstrip("\n") + "\n" + patch[end:]
    if install:
        if DSH_PLUGIN_DIR.exists():
            shutil.rmtree(DSH_PLUGIN_DIR)
        shutil.copytree(REPO / "integrations/deepseek/dsh-plugin-crosspet", DSH_PLUGIN_DIR)
        deps[DSH_PLUGIN_NAME] = f"link:{DSH_PLUGIN_DIR}"
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(DSH_PLUGIN_DIR)
        patch = patch.rstrip("\n") + "\n" + DSH_BLOCK
        print(f"  已安装插件到 {DSH_PLUGIN_DIR}")
    else:
        deps.pop(DSH_PLUGIN_NAME, None)
        if link.is_symlink():
            link.unlink()
        if DSH_PLUGIN_DIR.exists():
            shutil.rmtree(DSH_PLUGIN_DIR)
    backup(pkg_path)
    save_json(pkg_path, pkg)
    backup(patch_path)
    patch_path.write_text(patch, encoding="utf-8")
    print(f"  已更新 {pkg_path.name} 和 {patch_path.name}")
    print("  → 完全退出（⌘Q）再打开 DeepSeek Harness 生效")


# ---- Gemini CLI ----
GEMINI_SETTINGS = HOME / ".gemini/settings.json"


def gemini(install: bool) -> None:
    if install:
        merge_hooks(GEMINI_SETTINGS, REPO / "integrations/gemini/hooks.json")
        print("  → 只对 Gemini CLI 有效；Gemini 桌面 App 没有钩子接口")
    else:
        remove_hooks(GEMINI_SETTINGS)


TARGETS = {"claude-hooks": claude_hooks, "claude-mod": claude_mod, "codex": codex, "deepseek": deepseek, "gemini": gemini}


def status() -> None:
    def has_hooks(p: Path) -> bool:
        try:
            return any(ours(g) for gs in load_json(p).get("hooks", {}).values() for g in gs)
        except Exception:
            return False
    print("Claude Code 标准钩子:", "已接入" if has_hooks(CLAUDE_SETTINGS) else "未接入")
    print("Claude Code mod     :", "已接入" if CLAUDE_MOD_DIR.exists() else "未接入")
    print("Codex               :", "已接入" if has_hooks(CODEX_HOOKS) else "未接入")
    dsh = (DSH_PROFILE / "cordis.patch.yml")
    print("DeepSeek Harness    :", "已接入" if dsh.exists() and DSH_BLOCK_START in dsh.read_text(encoding="utf-8") else "未接入")
    print("Gemini CLI          :", "已接入" if has_hooks(GEMINI_SETTINGS) else "未接入")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "status":
        status()
    elif len(sys.argv) == 3 and sys.argv[1] in ("install", "uninstall") and sys.argv[2] in TARGETS:
        print(f"{'接入' if sys.argv[1] == 'install' else '撤销'} {sys.argv[2]}：")
        TARGETS[sys.argv[2]](sys.argv[1] == "install")
    else:
        print(__doc__)
        sys.exit(1)
