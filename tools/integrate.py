#!/usr/bin/env python3
"""把 CrossPet 接入各个 AI（或撤销）。install.sh / uninstall.sh 调用它，也可以单独用：

    python3 tools/integrate.py install   claude-hooks | claude-mod | codex | deepseek | gemini | antigravity | workbuddy | zcode | hermes
    python3 tools/integrate.py uninstall claude-hooks | claude-mod | codex | deepseek | gemini | antigravity | workbuddy | zcode | hermes
    python3 tools/integrate.py status

原则：
- 改任何文件前先备份成 <文件>.bak-crosspet-<时间>
- 只添加 CrossPet 自己的条目，不动你原有的配置；卸载只删 CrossPet 的条目
- 识别 CrossPet 条目的标记：命令里含 crosspet-hook.py，或插件 id 为 crosspet
"""
import json
import re
import os
import shutil
import sys
import time
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent
SUPPORT = Path(os.environ.get("CROSSPET_DATA_DIR") or (str(Path(os.environ.get("LOCALAPPDATA", str(HOME / "AppData/Local"))) / "CrossPet") if os.name == "nt" else str(HOME / "Library/Application Support/CrossPet")))
MARK = "crosspet-hook.py"


QUIET = False   # 自动接回去（heal）时不备份：只补 CrossPet 自己的一项，备份多了会把之前真正有用的备份挤掉


def backup(path: Path) -> None:
    if path.exists() and not QUIET:
        dst = path.with_name(f"{path.name}.bak-crosspet-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(path, dst)
        print(f"  已备份 {path} → {dst.name}")
        # 只留最近 3 份，免得每次接入 / 更新都多一个
        for old in sorted(path.parent.glob(f"{path.name}.bak-crosspet-*"))[:-3]:
            try:
                old.unlink()
            except OSError:
                pass


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
    """把模板里的钩子按事件追加进 target 的 hooks 字段。
    先清掉所有事件里 CrossPet 自己的旧条目（包括新版模板已经不用的事件），再按模板加回去，保证不重复、不残留。"""
    data = load_json(target)
    hooks = data.setdefault("hooks", {})
    for event in list(hooks):
        kept = without_ours(hooks[event])
        if kept:
            hooks[event] = kept
        else:
            del hooks[event]
    for event, groups in load_template(template)["hooks"].items():
        hooks[event] = hooks.get(event, []) + groups
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


def found(path: Path, app: str, ours: tuple = (), quiet: bool = False) -> bool:
    """接入前先确认这个 AI 装过：它的配置目录在，而且里面有它自己的东西。
    ours 是 CrossPet 自己会往这个目录里写的文件 / 文件夹（连同备份），只有这些的话不算装过——
    旧版接入工具在没装的电脑上凭空建过这些，不能因为它们还在就显示「已接入」"""
    if not ours and path.is_dir():
        return True  # CrossPet 从来不会建的目录：在就说明装过
    try:
        own = [p for p in path.iterdir() if p.name not in ours and ".bak-crosspet-" not in p.name and p.name != ".DS_Store"]
    except OSError:
        own = []
    if own:
        return True
    if not quiet:
        print(f"  没找到 {app} 的配置（{path}），请先安装并打开一次 {app} 再接入")
    return False


# ---- Claude Code ----
# 各 AI 的配置目录都可以用环境变量挪走：CLAUDE_CONFIG_DIR、CODEX_HOME、DSH_HOME，没设就用用户目录下的默认位置
CLAUDE_HOME = Path(os.environ.get("CLAUDE_CONFIG_DIR") or HOME / ".claude")
CLAUDE_SETTINGS = CLAUDE_HOME / "settings.json"
CLAUDE_MOD_DIR = CLAUDE_HOME / "mods/crosspet"
CLAUDE_OURS = ("settings.json", "mods")


def claude_hooks(install: bool) -> None:
    if install:
        if not found(CLAUDE_HOME, "Claude Code", CLAUDE_OURS):
            return
        merge_hooks(CLAUDE_SETTINGS, REPO / "integrations/claude-code/hooks.json")
        print("  → 新开的 Claude Code 会话生效（已开的会话要重开）")
    else:
        remove_hooks(CLAUDE_SETTINGS)


MOD_MIN_CLI = (2, 1, 287)   # 终端里的 Claude Code 从这一版起默认加载 mod（桌面 App 自带的那份从 2.1.286 起）


def claude_cli_version():
    """终端里 claude --version 的版本号；找不到 claude 时返回 None"""
    import subprocess
    candidates = [shutil.which("claude"), str(HOME / ".local/bin/claude"), str(HOME / ".claude/local/claude")]
    for exe in [c for c in candidates if c and Path(c).exists()]:
        try:
            out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout
        except Exception:
            continue
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", out)
        if m:
            return tuple(int(x) for x in m.groups())
    return None


def claude_mod(install: bool) -> None:
    if not install and not CLAUDE_MOD_DIR.exists() and not CLAUDE_SETTINGS.exists():
        return  # 从没装过：别凭空建出一个 settings.json
    if install and not found(CLAUDE_HOME, "Claude Code", CLAUDE_OURS):
        return
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
        print("  → 新开的会话生效。需要终端里的 Claude Code 2.1.287 以上（桌面 App 2.1.286 以上）")
        v = claude_cli_version()
        if v and v < MOD_MIN_CLI:
            print(f"  ！终端里的 Claude Code 是 {'.'.join(map(str, v))}，还不会加载 mod：请先更新 Claude Code，"
                  "或者改用标准钩子（claude-hooks，所有版本可用，只是不显示额度）")
        print("  → 公司 / 组织账号如果被管理员禁了自己装的 mod，或者在 WSL 里用，mod 不会运行，请改用标准钩子")


def claude_mod_ok() -> bool:
    """mod 真的接着：文件夹在，而且 settings.json 的 CLAUDE_CODE_PLUGIN_DIRS 里有它"""
    if not CLAUDE_MOD_DIR.exists():
        return False
    try:
        dirs = load_json(CLAUDE_SETTINGS).get("env", {}).get("CLAUDE_CODE_PLUGIN_DIRS", "")
    except Exception:
        return True   # 正被别的程序写到一半：先当没事
    return any(Path(os.path.expanduser(d)) == CLAUDE_MOD_DIR for d in dirs.split(os.pathsep) if d)


def ccswitch_note() -> None:
    """CC Switch 3.x 切换服务商时会整个重写 ~/.claude/settings.json，CrossPet 的接入跟着被冲掉（4.0 起只换关键字段）"""
    if not (HOME / ".cc-switch").exists():
        return
    version = None
    plist = Path("/Applications/CC Switch.app/Contents/Info.plist")
    if plist.exists():
        try:
            import plistlib
            version = plistlib.loads(plist.read_bytes()).get("CFBundleShortVersionString")
        except Exception:
            pass
    if version and not version.startswith(("1.", "2.", "3.")):
        return
    which = f"CC Switch {version}" if version else "CC Switch（如果是 3.x 版）"
    print(f"  ！检测到 {which}：切换服务商时会重写 Claude 的配置，把 CrossPet 的接入一起冲掉。"
          "桌宠开着时会自动接回去（新开的会话生效），建议把 CC Switch 升级到 4.0 以上，就不会再被冲掉")


# 用户接入过、想一直接着的目标。被别的工具改掉了（比如 CC Switch 3.x 切换服务商会整个重写 settings.json），
# 桌宠发现后调 `integrate.py heal` 接回去；在 CrossPet 里撤销接入的就不再管
WANTED = SUPPORT / "wanted.json"
HEALABLE = {"claude-mod": claude_mod_ok, "claude-hooks": lambda: has_hooks(CLAUDE_SETTINGS)}


def wanted() -> set:
    try:
        return set(json.loads(WANTED.read_text(encoding="utf-8")))
    except Exception:
        return set()


def set_wanted(target: str, on: bool) -> None:
    w = wanted()
    if on == (target in w):
        return
    (w.add if on else w.discard)(target)
    SUPPORT.mkdir(parents=True, exist_ok=True)
    WANTED.write_text(json.dumps(sorted(w)), encoding="utf-8")


def heal() -> list:
    """接过、现在却不在了的接回去，返回接回去的目标。还没记过的老用户：mod 文件夹在就算接过"""
    global QUIET
    if not CLAUDE_SETTINGS.exists():
        return []
    try:
        load_json(CLAUDE_SETTINGS)
    except Exception:
        return []   # 正被别的程序写到一半，下次再看
    if CLAUDE_MOD_DIR.exists():
        set_wanted("claude-mod", True)
    if has_hooks(CLAUDE_SETTINGS):
        set_wanted("claude-hooks", True)
    healed = []
    import contextlib
    import io
    for target in sorted(wanted() & set(HEALABLE)):
        if HEALABLE[target]():
            continue
        QUIET = True
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                TARGETS[target](True)
        finally:
            QUIET = False
        if HEALABLE[target]():
            healed.append(target)
    return healed


# ---- Codex ----
CODEX_HOOKS = Path(os.environ.get("CODEX_HOME", str(HOME / ".codex"))) / "hooks.json"


def codex(install: bool) -> None:
    if install:
        if not found(CODEX_HOOKS.parent, "Codex", ("hooks.json",)):
            return
        merge_hooks(CODEX_HOOKS, REPO / "integrations/codex/hooks.json")
        print("  → 下次打开 Codex 时要审查并「信任」这些钩子（CLI 里用 /hooks），之后才会生效")
    else:
        remove_hooks(CODEX_HOOKS)


# ---- DeepSeek Harness（插件）----
DSH_BLOCK_START = "# ── CrossPet 桌宠（integrations/deepseek）"


def dsh_profile() -> Path:
    """DeepSeek Harness 当前的 profile 目录。home 和 profile 名都可能不一样（有的机器只有 profiles/web），
    所以不写死：DSH_PROFILE_DIR / DSH_PROFILE 环境变量优先；否则先找已经接入过 CrossPet 的，
    再找 desktop，再取最近改过的那个。一个都没有时返回默认位置（用来提示）"""
    if os.environ.get("DSH_PROFILE_DIR"):
        return Path(os.environ["DSH_PROFILE_DIR"])
    if os.environ.get("DSH_HOME"):
        homes = [Path(os.environ["DSH_HOME"])]  # 设了就只认它
    else:
        homes = [HOME / ".dsh"]
        if os.name == "nt" and os.environ.get("APPDATA"):
            homes.append(Path(os.environ["APPDATA"]) / "dsh-desktop/harness")
    profiles = []
    for home in homes:
        try:
            profiles += [p for p in (home / "profiles").iterdir()
                         if p.is_dir() and not p.name.startswith(".") and p.name != "node_modules"
                         and ((p / "package.json").exists() or (p / "cordis.patch.yml").exists())]
        except OSError:
            pass
    if not profiles:
        return homes[0] / "profiles/desktop"
    wanted = os.environ.get("DSH_PROFILE")
    for p in profiles:
        if wanted and p.name == wanted:
            return p

    def ours(p: Path) -> bool:
        try:
            return DSH_BLOCK_START in (p / "cordis.patch.yml").read_text(encoding="utf-8")
        except OSError:
            return False

    def mtime(p: Path) -> float:
        return max((f.stat().st_mtime for f in (p / "cordis.patch.yml", p / "package.json") if f.exists()), default=0)

    return (next((p for p in profiles if ours(p)), None) or next((p for p in profiles if p.name == "desktop"), None)
            or max(profiles, key=mtime))


DSH_PROFILE = dsh_profile()
DSH_PLUGIN_NAME = "@local/dsh-plugin-crosspet"
DSH_PLUGIN_DIR = SUPPORT / "dsh-plugin-crosspet"
DSH_BLOCK_END = "# ── CrossPet 结束 ──"
DSH_BLOCK = f"""
{DSH_BLOCK_START} ──
# 把 DeepSeek 的工作状态和余额写给桌宠；移除本段即恢复原样。
- insert:
    - id: crosspet
      name: '{DSH_PLUGIN_NAME}'
{DSH_BLOCK_END}
"""
DSH_RESTORED = SUPPORT / "dsh-patch-restored"   # 一次性找回做过了（见 dsh_restore）


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def dsh_strip(text: str) -> str:
    """去掉 CrossPet 自己写进 cordis.patch.yml 的那几行，别的一行不动。
    Harness 加服务商等配置时会写到文件末尾，也就是我们这段的两行注释中间（甚至挂在我们的 - insert: 下面），
    所以不能按注释区间整段删：只删两行注释、结束注释、我们那一项；- insert: 下面没别的东西了才删它"""
    lines = text.split("\n")
    drop, headers = set(), []
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith(DSH_BLOCK_START) or s.startswith("# 把 DeepSeek 的工作状态和余额写给桌宠") or s == DSH_BLOCK_END:
            drop.add(i)
            if s.startswith(DSH_BLOCK_START) and i > 0 and not lines[i - 1].strip():
                drop.add(i - 1)   # 接入时在这段前面空的那一行
        elif re.fullmatch(r"-\s+id:\s*['\"]?crosspet['\"]?", s):
            body = [i]
            j = i + 1
            while j < len(lines) and lines[j].strip() and _indent(lines[j]) > _indent(line) and not lines[j].lstrip().startswith("-"):
                body.append(j)
                j += 1
            if not any(DSH_PLUGIN_NAME in lines[k] for k in body):
                continue
            drop.update(body)
            k = i - 1
            while k >= 0 and (k in drop or not lines[k].strip() or lines[k].lstrip().startswith("#")):
                k -= 1
            if k >= 0 and re.fullmatch(r"-\s*insert:\s*", lines[k]):
                headers.append(k)
    for k in headers:   # 我们那个 - insert: 下面还挂着别人的条目就留着
        after = (lines[j] for j in range(k + 1, len(lines)) if j not in drop)
        nxt = next((l for l in after if l.strip() and not l.lstrip().startswith("#")), "")
        if _indent(nxt) == 0:
            drop.add(k)
    out = "\n".join(l for i, l in enumerate(lines) if i not in drop).rstrip("\n")
    return out + "\n" if out.strip() else ""


def dsh_units(text: str) -> list:
    """把 cordis.patch.yml 拆成一条条配置：顶层每个 - xxx: 一条；- insert: 这种下面是列表的，按列表项拆开"""
    items = []
    for line in text.split("\n"):
        if not line.strip() or (_indent(line) == 0 and line.startswith("#")):
            continue
        if _indent(line) == 0:
            items.append([line])
        elif items:
            items[-1].append(line)
    units = []
    for head, *body in items:
        firsts = [l for l in body if not l.lstrip().startswith("#")]
        if re.fullmatch(r"-\s*\w+:\s*", head) and firsts and firsts[0].lstrip().startswith("- "):
            ind, cur = _indent(firsts[0]), None
            for l in body:
                if _indent(l) == ind and l.lstrip().startswith("- "):
                    cur = [head, l]
                    units.append(cur)
                elif cur:
                    cur.append(l)
        else:
            units.append([head] + body)
    return ["\n".join(u) for u in units]


def dsh_key(unit: str) -> tuple:
    m = re.search(r"^\s*(?:-\s+)?id:\s*['\"]?([^'\"\s#]+)", unit, re.M)
    head = unit.split("\n", 1)[0].strip()
    return ("id", head, m.group(1)) if m else ("text", " ".join(unit.split()))


def dsh_restore(patch: str, patch_path: Path) -> str:
    """一次性找回：1.3.0 及以前的接入工具按注释区间整段删，把夹在我们两行注释中间的服务商配置删掉了。
    当时改文件前都备份过：从备份里找出被夹在中间的条目，现在文件里没有的（按 id 比对）补回去。只做一次，
    免得以后用户自己删掉的又被加回来"""
    if DSH_RESTORED.exists():
        return patch
    have = {dsh_key(u) for u in dsh_units(dsh_strip(patch))}
    restored = []
    for bak in sorted(patch_path.parent.glob(f"{patch_path.name}.bak-crosspet-*"), reverse=True):   # 新的优先
        try:
            text = bak.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if DSH_BLOCK_START not in text or DSH_BLOCK_END not in text[text.index(DSH_BLOCK_START):]:
            continue
        start = text.index(DSH_BLOCK_START)
        region = text[start:text.index(DSH_BLOCK_END, start) + len(DSH_BLOCK_END)]
        for unit in dsh_units(dsh_strip(region)):
            key = dsh_key(unit)
            if key not in have:
                have.add(key)
                restored.append(unit)
    if restored:
        patch = (patch.rstrip("\n") + "\n" if patch.strip() else "") + "\n".join(restored) + "\n"
        print(f"  已从备份找回 {len(restored)} 条被旧版接入工具误删的配置（比如第三方服务商）")
    try:
        DSH_RESTORED.parent.mkdir(parents=True, exist_ok=True)
        DSH_RESTORED.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    except OSError:
        pass
    return patch


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
        print(f"  没找到 {DSH_PROFILE}，请先打开一次 DeepSeek Harness 桌面版"
              "（如果 Harness 装在别处，可以用环境变量 DSH_PROFILE_DIR 指定 profile 目录）")
        return
    pkg_path = DSH_PROFILE / "package.json"
    patch_path = DSH_PROFILE / "cordis.patch.yml"
    link = DSH_PROFILE / "node_modules/@local/dsh-plugin-crosspet"
    pkg = load_json(pkg_path)
    deps = pkg.setdefault("dependencies", {})
    patch = patch_path.read_text(encoding="utf-8") if patch_path.exists() else ""
    patch = dsh_restore(dsh_strip(patch), patch_path)   # 先去掉旧的那几行（只去我们自己的）；找回要赶在下面备份删掉老备份之前
    if install:
        if DSH_PLUGIN_DIR.exists():
            shutil.rmtree(DSH_PLUGIN_DIR)
        shutil.copytree(REPO / "integrations/deepseek/dsh-plugin-crosspet", DSH_PLUGIN_DIR)
        # Harness 的插件列表显示 package.json 里的版本：跟插件代码里的 PLUGIN_VERSION 保持一致
        try:
            ver = re.search(r'PLUGIN_VERSION = "([^"]+)"', (DSH_PLUGIN_DIR / "lib/index.js").read_text(encoding="utf-8")).group(1)
            pj = load_json(DSH_PLUGIN_DIR / "package.json")
            pj["version"] = ver
            save_json(DSH_PLUGIN_DIR / "package.json", pj)
        except Exception:
            pass
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


# ---- WorkBuddy（腾讯）----
# 桌面版里跑的是 CodeBuddy 的智能体，钩子格式和 Claude Code 一样，配置目录由安装包决定：
# 国际版 ~/.workbuddy-ai，国内版 ~/.workbuddy（专享版另有名字，可用 WORKBUDDY_CONFIG_DIR 指定）。
# 每条事件都带当前模型名，钩子脚本按它选角色（crosspet-hook.py workbuddy）
def workbuddy_dirs() -> list:
    env = os.environ.get("WORKBUDDY_CONFIG_DIR")
    dirs = [Path(env)] if env else [HOME / ".workbuddy-ai", HOME / ".workbuddy"]
    # 智能体真正用的目录里会有它自己的东西（下载的组件、记忆、人设文件）；只有 device-id、logs 的不算
    return [d for d in dirs if any((d / n).exists() for n in ("binaries", "memory", "SOUL.md"))]


def workbuddy(install: bool) -> None:
    dirs = workbuddy_dirs()
    if install:
        if not dirs:
            print("  没找到 WorkBuddy 的配置（~/.workbuddy-ai 或 ~/.workbuddy），请先安装并打开一次 WorkBuddy 再接入")
            return
        for d in dirs:
            merge_hooks(d / "settings.json", REPO / "integrations/workbuddy/hooks.json")
        print("  → 完全退出再打开 WorkBuddy 生效；用 GPT / Claude / Gemini / DeepSeek 时换成对应角色，其他模型由当前角色来演")
    else:
        for d in dirs:
            remove_hooks(d / "settings.json")


# ---- ZCode（智谱）----
# 钩子写在 ~/.zcode/cli/config.json 的 hooks 里，格式和 Claude Code 不同：要打开 hooks.enabled，
# 事件放在 hooks.events 下，命令和参数分开写（直接启动进程，不经过 shell，所以路径要写成绝对路径）。
# 模型名只在会话开始时给，钩子脚本按会话记住（crosspet-hook.py zcode）
ZCODE_HOME = HOME / ".zcode"
ZCODE_CONFIG = ZCODE_HOME / "cli/config.json"
ZCODE_FLAG = SUPPORT / "zcode-hooks-enabled-by-crosspet"   # 钩子总开关是 CrossPet 打开的：撤销时关回去
ZCODE_EVENTS = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "Stop")


def zcode_ours(group: dict) -> bool:
    return any(MARK in " ".join(map(str, [h.get("command", "")] + list(h.get("args", [])))) for h in group.get("hooks", []))


def zcode(install: bool) -> None:
    if install and not found(ZCODE_HOME, "ZCode", ("cli",)):
        return
    if not install and not ZCODE_CONFIG.exists():
        return
    data = load_json(ZCODE_CONFIG) if ZCODE_CONFIG.exists() else {}
    hooks = data.setdefault("hooks", {})
    events = hooks.setdefault("events", {})
    for ev in list(events):
        kept = [g for g in events[ev] if not zcode_ours(g)]
        if kept:
            events[ev] = kept
        else:
            del events[ev]
    if install:
        if os.name == "nt":
            SUPPORT.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / "integrations/crosspet-hook.py", SUPPORT / MARK)
            command = sys.executable
        else:
            command = "python3"
        hook = {"type": "process", "command": command, "args": [str(SUPPORT / MARK), "zcode"]}
        for ev in ZCODE_EVENTS:
            events.setdefault(ev, []).append({"hooks": [dict(hook)]})
        if hooks.get("enabled") is not True:
            SUPPORT.mkdir(parents=True, exist_ok=True)
            ZCODE_FLAG.write_text("1")
            hooks["enabled"] = True
    else:
        if ZCODE_FLAG.exists():   # 开关原本是关着的（或者没有）：还原
            hooks["enabled"] = False
            ZCODE_FLAG.unlink()
        if not events:
            data.pop("hooks", None)   # 只剩 CrossPet 加的东西：整段拿掉
    if ZCODE_CONFIG.exists():
        backup(ZCODE_CONFIG)
    ZCODE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    save_json(ZCODE_CONFIG, data)
    print(f"  已更新 {ZCODE_CONFIG}")
    if install:
        print("  → 新开的 ZCode 会话生效；用 GLM 时换成 GLM 角色（还没装这个角色时由当前角色来演），用别家模型时换成对应角色")


def has_zcode() -> bool:
    try:
        return any(zcode_ours(g) for gs in load_json(ZCODE_CONFIG).get("hooks", {}).get("events", {}).values() for g in gs)
    except Exception:
        return False


# ---- Gemini CLI ----
GEMINI_SETTINGS = HOME / ".gemini/settings.json"


def gemini(install: bool) -> None:
    if install:
        if not found(GEMINI_SETTINGS.parent, "Gemini CLI", ("settings.json", "config")):
            return
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
    # Antigravity 第一次打开时会建 ~/.gemini/antigravity；只有 Gemini CLI 时没有这个目录
    if install and not found(ANTIGRAVITY_HOOKS.parent.parent / "antigravity", "Antigravity"):
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


# ---- Hermes Agent（Nous Research）----
# 用 Hermes 的 Python 插件（不是 config.yaml 里的 shell 钩子：那个每条命令第一次都要你点同意，网关里还不生效）。
# 插件放在 <HERMES_HOME>/plugins/crosspet/，要写进 config.yaml 的 plugins.enabled 才会加载：
# 有 hermes 命令就用 `hermes plugins enable crosspet`，没有就小心地改文本（看不懂的写法不动，提示你手动开）
HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (str(Path(os.environ.get("LOCALAPPDATA", str(HOME / "AppData/Local"))) / "hermes") if os.name == "nt" else str(HOME / ".hermes")))
HERMES_PLUGIN = HERMES_HOME / "plugins/crosspet"
HERMES_CONFIG = HERMES_HOME / "config.yaml"


def hermes_cli():
    for c in (shutil.which("hermes"), HOME / ".local/bin/hermes", HERMES_HOME / "hermes-agent/venv/bin/hermes",
              HERMES_HOME / "hermes-agent/venv/Scripts/hermes.exe"):
        if c and Path(c).exists():
            return str(c)
    return None


def hermes_enabled_edit(enable: bool) -> bool:
    """在 config.yaml 的 plugins.enabled 里加上 / 去掉 crosspet。只认常见写法，认不出返回 False"""
    text = HERMES_CONFIG.read_text(encoding="utf-8") if HERMES_CONFIG.exists() else ""
    lines = [("plugins:" if re.match(r"^plugins:\s*\{\s*\}\s*$", l) else l) for l in text.splitlines()]   # plugins: {} 当成空的一段
    top = next((i for i, l in enumerate(lines) if re.match(r"^plugins:\s*(#.*)?$", l)), None)
    if top is None:
        if re.search(r"^plugins:", text, re.M):
            return False   # plugins: 后面跟着行内写法，不碰
        if enable:
            lines += ["plugins:", "  enabled:", "    - crosspet"]
    else:
        end = next((i for i in range(top + 1, len(lines)) if lines[i].strip() and not lines[i].startswith((" ", "\t", "#"))), len(lines))
        en = next((i for i in range(top + 1, end) if re.match(r"^\s+enabled:", lines[i])), None)
        if en is None:
            if enable:
                lines[top + 1:top + 1] = ["  enabled:", "    - crosspet"]
        else:
            m = re.match(r"^(\s+)enabled:\s*(.*?)\s*(#.*)?$", lines[en])
            rest = m.group(2)
            if rest in ("", "[]"):
                items_end = next((i for i in range(en + 1, end) if lines[i].strip() and not re.match(r"^\s+-\s", lines[i])), end)
                items = [i for i in range(en + 1, items_end) if re.match(r"^\s+-\s*['\"]?crosspet['\"]?\s*$", lines[i])]
                if enable and not items:
                    indent = re.match(r"^(\s*)", lines[en + 1]).group(1) if en + 1 < items_end else m.group(1) + "  "
                    lines[en] = f"{m.group(1)}enabled:"
                    lines.insert(en + 1, f"{indent}- crosspet")
                if not enable and items:
                    for i in reversed(items):
                        del lines[i]
                    if not any(re.match(r"^\s+-\s", lines[i]) for i in range(en + 1, min(items_end - len(items), len(lines)))):
                        lines[en] = f"{m.group(1)}enabled: []"   # 删空了：写成空列表
            else:
                return False   # enabled: [a, b] 这类行内写法，不碰
    new = "\n".join(lines) + "\n"
    if new != (text if text.endswith("\n") else text + "\n"):
        backup(HERMES_CONFIG)
        HERMES_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        HERMES_CONFIG.write_text(new, encoding="utf-8")
    return True


def hermes(install: bool) -> None:
    if install and not found(HERMES_HOME, "Hermes Agent"):
        return
    cli = hermes_cli()
    if install:
        if os.name == "nt":
            SUPPORT.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / "integrations/crosspet-hook.py", SUPPORT / MARK)
        if HERMES_PLUGIN.exists():
            shutil.rmtree(HERMES_PLUGIN)
        shutil.copytree(REPO / "integrations/hermes/crosspet", HERMES_PLUGIN, ignore=shutil.ignore_patterns("__pycache__"))
        save_json(HERMES_PLUGIN / "crosspet.json", {"hook": str(SUPPORT / MARK)})
        print(f"  已装插件到 {HERMES_PLUGIN}")
    ok = False
    if cli:
        import subprocess
        try:
            r = subprocess.run([cli, "plugins", "enable" if install else "disable", "crosspet"], capture_output=True, text=True, timeout=60)
            ok = r.returncode == 0
        except Exception:
            ok = False
    if not ok:
        ok = hermes_enabled_edit(install)
    if not install and HERMES_PLUGIN.exists():
        shutil.rmtree(HERMES_PLUGIN)
        print(f"  已删除 {HERMES_PLUGIN}")
    if install:
        if ok:
            print(f"  已在 {HERMES_CONFIG} 里启用插件 crosspet → 新开的 Hermes 会话生效；按当前模型换角色，没有对应角色的模型由当前角色来演")
        else:
            print("  ！没能自动启用插件，请运行一次：hermes plugins enable crosspet")


def has_hermes() -> bool:
    return HERMES_PLUGIN.is_dir() and (HERMES_PLUGIN / "plugin.yaml").exists()


TARGETS = {"claude-hooks": claude_hooks, "claude-mod": claude_mod, "codex": codex, "deepseek": deepseek, "gemini": gemini, "antigravity": antigravity, "workbuddy": workbuddy, "zcode": zcode, "hermes": hermes}


def has_hooks(p: Path) -> bool:
    try:
        return any(ours(g) for gs in load_json(p).get("hooks", {}).values() for g in gs)
    except Exception:
        return False


def installed() -> list:
    dsh = DSH_PROFILE / "cordis.patch.yml"
    # 只算这个 AI 真装过的：旧版接入工具在没装的电脑上凭空建过配置，那些不算「已接入」
    claude = found(CLAUDE_HOME, "", CLAUDE_OURS, quiet=True)
    result = []
    if claude and has_hooks(CLAUDE_SETTINGS): result.append("claude-hooks")
    if claude and claude_mod_ok(): result.append("claude-mod")
    if has_hooks(CODEX_HOOKS) and found(CODEX_HOOKS.parent, "", ("hooks.json",), quiet=True): result.append("codex")
    if dsh.exists() and DSH_BLOCK_START in dsh.read_text(encoding="utf-8"): result.append("deepseek")
    if has_hooks(GEMINI_SETTINGS) and found(GEMINI_SETTINGS.parent, "", ("settings.json", "config"), quiet=True): result.append("gemini")
    if has_antigravity() and (ANTIGRAVITY_HOOKS.parent.parent / "antigravity").is_dir(): result.append("antigravity")
    if any(has_hooks(d / "settings.json") for d in workbuddy_dirs()): result.append("workbuddy")
    if has_zcode() and found(ZCODE_HOME, "", ("cli",), quiet=True): result.append("zcode")
    if has_hermes(): result.append("hermes")
    return result


def status() -> None:
    print("Claude Code 标准钩子:", "已接入" if has_hooks(CLAUDE_SETTINGS) else "未接入")
    print("Claude Code mod     :", "已接入" if claude_mod_ok() else "被别的工具改掉了（桌宠开着时会自动接回去）" if CLAUDE_MOD_DIR.exists() else "未接入")
    print("Codex               :", "已接入" if has_hooks(CODEX_HOOKS) else "未接入")
    dsh = (DSH_PROFILE / "cordis.patch.yml")
    print("DeepSeek Harness    :", "已接入" if dsh.exists() and DSH_BLOCK_START in dsh.read_text(encoding="utf-8") else "未接入")
    print("Gemini CLI          :", "已接入" if has_hooks(GEMINI_SETTINGS) else "未接入")
    print("Antigravity         :", "已接入" if has_antigravity() else "未接入")
    print("WorkBuddy           :", "已接入" if any(has_hooks(d / "settings.json") for d in workbuddy_dirs()) else "未接入")
    print("ZCode               :", "已接入" if has_zcode() else "未接入")
    print("Hermes Agent        :", "已接入" if has_hermes() else "未接入")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "installed":  # 给设置窗口用：已接入的目标，JSON 数组
        print(json.dumps(installed()))
    elif len(sys.argv) == 2 and sys.argv[1] == "status":
        status()
    elif len(sys.argv) == 2 and sys.argv[1] == "refresh":
        for t in installed():
            print(f"更新 {t}：")
            TARGETS[t](True)
    elif len(sys.argv) == 2 and sys.argv[1] == "heal":   # 给桌宠用：被别的工具冲掉的接回去，输出接回去的目标（JSON 数组）
        print(json.dumps(heal()))
    elif len(sys.argv) == 3 and sys.argv[1] in ("install", "uninstall") and sys.argv[2] in TARGETS:
        target, install = sys.argv[2], sys.argv[1] == "install"
        print(f"{'接入' if install else '撤销'} {target}：")
        TARGETS[target](install)
        if target in HEALABLE:
            set_wanted(target, install and HEALABLE[target]())
            if install:
                ccswitch_note()
    else:
        print(__doc__)
        sys.exit(1)
