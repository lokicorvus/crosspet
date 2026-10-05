#!/usr/bin/env python3
"""把 CrossPet 接入各个 AI（或撤销）。install.sh / uninstall.sh 调用它，也可以单独用：

    python3 tools/integrate.py install   claude-hooks | claude-mod | codex | deepseek | gemini | antigravity
    python3 tools/integrate.py uninstall claude-hooks | claude-mod | codex | deepseek | gemini | antigravity
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
SUPPORT = Path(os.environ.get("CROSSPET_DATA_DIR") or (str(Path(os.environ.get("LOCALAPPDATA", str(HOME / "AppData/Local"))) / "CrossPet") if os.name == "nt" else str(HOME / "Library/Application Support/CrossPet")))
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


def without_ours(groups: list) -> list:
    """Keep other commands even when they share a matcher group with CrossPet."""
    kept = []
    for group in groups:
        if not ours(group):
            kept.append(group)
            continue
        hooks = [h for h in group.get("hooks", []) if MARK not in str(h.get("command", ""))]
        if hooks:
            kept.append({**group, "hooks": hooks})
    return kept


def win_arg(path: Path) -> str:
    """钩子命令里的一个路径。各家 AI 在 Windows 上用不同的壳跑钩子（cmd、PowerShell、Git Bash），
    带引号的写法总有一种会坏：cmd 会剥掉首尾引号，PowerShell 会把开头带引号的东西当成字符串而不是命令。
    所以尽量不加引号：没有空格直接用正斜杠路径；有空格先换成 8.3 短路径（不含空格）；都不行才加引号。"""
    text = str(path)
    if " " in text:
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(1024)
            if ctypes.windll.kernel32.GetShortPathNameW(text, buf, 1024) and " " not in buf.value:
                text = buf.value
        except Exception:
            pass
    text = Path(text).as_posix()
    return f'"{text}"' if " " in text else text


def load_template(template: Path, via_cmd: bool = False) -> dict:
    """读接入模板；在 Windows 上把 macOS 的 python3 + $HOME 路径换成随包 Python 和本机钩子脚本的绝对路径。
    via_cmd：这个 AI 用 cmd /c 跑钩子（Antigravity），命令以引号开头时要再包一层引号，抵消 cmd 剥引号。"""
    data = load_json(template)
    if os.name != "nt":
        return data
    SUPPORT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REPO / "integrations/crosspet-hook.py", SUPPORT / "crosspet-hook.py")
    prefix = f"{win_arg(Path(sys.executable))} {win_arg(SUPPORT / MARK)}"
    original = 'python3 "$HOME/Library/Application Support/CrossPet/crosspet-hook.py"'

    def command(value: str) -> str:
        cmd = prefix + value[len(original):]
        return f'"{cmd}"' if via_cmd and cmd.startswith('"') else cmd

    def adapt(obj):
        if isinstance(obj, dict):
            return {key: (command(value) if key == "command" and isinstance(value, str) and value.startswith(original) else adapt(value))
                    for key, value in obj.items()}
        if isinstance(obj, list):
            return [adapt(item) for item in obj]
        return obj
    return adapt(data)


def merge_hooks(target: Path, template: Path) -> None:
    """把模板里的钩子按事件追加进 target 的 hooks 字段（已存在的 CrossPet 条目先删再加，保证不重复）。"""
    data = load_json(target)
    hooks = data.setdefault("hooks", {})
    for event, groups in load_template(template)["hooks"].items():
        kept = without_ours(hooks.get(event, []))
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
        kept = without_ours(hooks[event])
        if kept != hooks[event]:
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
# 各 AI 的配置目录都可以用环境变量挪走：CLAUDE_CONFIG_DIR、CODEX_HOME、DSH_HOME，没设就用用户目录下的默认位置
CLAUDE_HOME = Path(os.environ.get("CLAUDE_CONFIG_DIR") or HOME / ".claude")
CLAUDE_SETTINGS = CLAUDE_HOME / "settings.json"
CLAUDE_MOD_DIR = CLAUDE_HOME / "mods/crosspet"


def claude_hooks(install: bool) -> None:
    if install:
        merge_hooks(CLAUDE_SETTINGS, REPO / "integrations/claude-code/hooks.json")
        print("  → 新开的 Claude Code 会话生效（已开的会话要重开）")
    else:
        remove_hooks(CLAUDE_SETTINGS)


def claude_mod(install: bool) -> None:
    if not install and not CLAUDE_MOD_DIR.exists() and not CLAUDE_SETTINGS.exists():
        return  # 从没装过：别凭空建出一个 settings.json
    data = load_json(CLAUDE_SETTINGS)
    env = data.setdefault("env", {})
    # 多个目录用系统的路径分隔符连接：macOS 是冒号，Windows 是分号（Windows 路径里本身就有冒号）
    dirs = [d for d in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(os.pathsep) if d]
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
        env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(dirs)
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
CODEX_HOOKS = Path(os.environ.get("CODEX_HOME", str(HOME / ".codex"))) / "hooks.json"


def codex(install: bool) -> None:
    if install:
        merge_hooks(CODEX_HOOKS, REPO / "integrations/codex/hooks.json")
        print("  → 下次打开 Codex 时要审查并「信任」这些钩子（CLI 里用 /hooks），之后才会生效")
    else:
        remove_hooks(CODEX_HOOKS)


# ---- DeepSeek Harness（插件）----
DSH_PROFILE = Path(os.environ.get("DSH_HOME") or HOME / ".dsh") / "profiles/desktop"
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


def make_link(link: Path, target: Path) -> None:
    """macOS 用软链接；Windows 建软链接要管理员或开发者模式，改用不需要权限的目录联接（junction）。"""
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target)


def remove_link(link: Path) -> None:
    """只拆链接本身，绝不顺着链接删到插件本体。"""
    if link.is_symlink() or (hasattr(os.path, "isjunction") and os.path.isjunction(link)):
        os.rmdir(link) if os.name == "nt" and link.is_dir() else link.unlink()
    elif link.exists():
        if link.is_dir():
            shutil.rmtree(link)
        else:
            link.unlink()


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
        deps[DSH_PLUGIN_NAME] = f"link:{DSH_PLUGIN_DIR.as_posix()}"
        link.parent.mkdir(parents=True, exist_ok=True)
        remove_link(link)
        make_link(link, DSH_PLUGIN_DIR)
        patch = patch.rstrip("\n") + "\n" + DSH_BLOCK
        print(f"  已安装插件到 {DSH_PLUGIN_DIR}")
    else:
        deps.pop(DSH_PLUGIN_NAME, None)
        remove_link(link)
        if DSH_PLUGIN_DIR.exists():
            shutil.rmtree(DSH_PLUGIN_DIR)
    backup(pkg_path)
    save_json(pkg_path, pkg)
    backup(patch_path)
    patch_path.write_text(patch, encoding="utf-8")
    print(f"  已更新 {pkg_path.name} 和 {patch_path.name}")
    if os.name == "nt":
        print("  → 完全退出 DeepSeek Harness（包括任务栏右下角的托盘图标）再打开生效")
    else:
        print("  → 完全退出（⌘Q）再打开 DeepSeek Harness 生效")


# ---- Gemini CLI ----
GEMINI_SETTINGS = HOME / ".gemini/settings.json"


def gemini(install: bool) -> None:
    if install:
        merge_hooks(GEMINI_SETTINGS, REPO / "integrations/gemini/hooks.json")
        print("  → 只对 Gemini CLI 有效；Gemini 桌面 App 没有钩子接口")
    else:
        remove_hooks(GEMINI_SETTINGS)


# ---- Antigravity ----
# 它的 hooks.json 是「名字 → 各事件」的格式，CrossPet 只占 "crosspet" 这一项
ANTIGRAVITY_HOOKS = HOME / ".gemini/config/hooks.json"


def antigravity(install: bool) -> None:
    if not install and not ANTIGRAVITY_HOOKS.exists():
        return
    data = load_json(ANTIGRAVITY_HOOKS) if ANTIGRAVITY_HOOKS.exists() else {}
    if install:
        data.update(load_template(REPO / "integrations/antigravity/hooks.json", via_cmd=True))
    elif data.pop("crosspet", None) is None:
        return
    if ANTIGRAVITY_HOOKS.exists():
        backup(ANTIGRAVITY_HOOKS)
    ANTIGRAVITY_HOOKS.parent.mkdir(parents=True, exist_ok=True)
    save_json(ANTIGRAVITY_HOOKS, data)
    print(f"  已更新 {ANTIGRAVITY_HOOKS}")
    if install:
        print("  → 重开 Antigravity 生效；桌面版和 Antigravity CLI 都有效")


def has_antigravity() -> bool:
    try:
        return "crosspet" in load_json(ANTIGRAVITY_HOOKS)
    except Exception:
        return False


TARGETS = {"claude-hooks": claude_hooks, "claude-mod": claude_mod, "codex": codex, "deepseek": deepseek, "gemini": gemini, "antigravity": antigravity}


def has_hooks(p: Path) -> bool:
    try:
        return any(ours(g) for gs in load_json(p).get("hooks", {}).values() for g in gs)
    except Exception:
        return False


def installed() -> list:
    dsh = DSH_PROFILE / "cordis.patch.yml"
    found = []
    if has_hooks(CLAUDE_SETTINGS): found.append("claude-hooks")
    if CLAUDE_MOD_DIR.exists(): found.append("claude-mod")
    if has_hooks(CODEX_HOOKS): found.append("codex")
    if dsh.exists() and DSH_BLOCK_START in dsh.read_text(encoding="utf-8"): found.append("deepseek")
    if has_hooks(GEMINI_SETTINGS): found.append("gemini")
    if has_antigravity(): found.append("antigravity")
    return found


def status() -> None:
    print("Claude Code 标准钩子:", "已接入" if has_hooks(CLAUDE_SETTINGS) else "未接入")
    print("Claude Code mod     :", "已接入" if CLAUDE_MOD_DIR.exists() else "未接入")
    print("Codex               :", "已接入" if has_hooks(CODEX_HOOKS) else "未接入")
    dsh = (DSH_PROFILE / "cordis.patch.yml")
    print("DeepSeek Harness    :", "已接入" if dsh.exists() and DSH_BLOCK_START in dsh.read_text(encoding="utf-8") else "未接入")
    print("Gemini CLI          :", "已接入" if has_hooks(GEMINI_SETTINGS) else "未接入")
    print("Antigravity         :", "已接入" if has_antigravity() else "未接入")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "status":
        status()
    elif len(sys.argv) == 2 and sys.argv[1] == "refresh":
        for t in installed():
            print(f"更新 {t}：")
            TARGETS[t](True)
    elif len(sys.argv) == 3 and sys.argv[1] in ("install", "uninstall") and sys.argv[2] in TARGETS:
        print(f"{'接入' if sys.argv[1] == 'install' else '撤销'} {sys.argv[2]}：")
        TARGETS[sys.argv[2]](sys.argv[1] == "install")
    else:
        print(__doc__)
        sys.exit(1)
