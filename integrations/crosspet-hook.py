#!/usr/bin/env python3
"""CrossPet 通用钩子脚本：把 AI 的工作状态写给桌宠。

用法（在各 AI 的钩子配置里）：
    python3 crosspet-hook.py <角色id>          # 角色id：claude / gpt / deepseek / gemini
    python3 crosspet-hook.py <角色id> <事件名>  # 事件 JSON 里不带事件名的（Antigravity）
    python3 crosspet-hook.py workbuddy          # 一个程序里能用好几家模型（WorkBuddy、ZCode、Hermes Agent）：按模型选角色
    python3 crosspet-hook.py --ensure           # 只确保桌宠在跑（没开着就打开；用户手动退出过或关了这个功能就不管）
钩子事件 JSON 从 stdin 传入。认得 Claude Code、Codex、DeepSeek Harness、Gemini CLI、Antigravity 的事件。

只写状态目录（默认 /tmp/crosspet，可用环境变量 CROSSPET_STATE_DIR 改）里的两个小文件：
    <角色id>-state.json   当前状态，桌宠读取
    <角色id>-turn.json    本轮用了几次工具（判断「大活」用）
不影响 AI 本身的行为：一般不向 stdout 输出；Antigravity 要求回一个 JSON，就回空的 {}。
用 /tmp 是因为有的 AI（比如 DeepSeek Harness）的钩子跑在沙箱里，只允许写 /tmp。
"""
import json
import os
import sys
import time
from pathlib import Path

BIG_JOB_TOOLS = 8  # 一轮里用了这么多次工具，结束时「得意」一下

character = sys.argv[1] if len(sys.argv) > 1 else "claude"
default_data = Path(os.environ.get("CROSSPET_DATA_DIR") or str(Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "CrossPet"))
state_dir = Path(os.environ.get("CROSSPET_STATE_DIR") or (str(default_data / "state") if os.name == "nt" else "/tmp/crosspet"))

# 跟着 AI 出现：开始干活（会话开始 / 发消息 / 调模型）时桌宠没开着就把它打开。
# 用户从菜单手动退出过（user-quit）就先不管，直到这个 AI 程序关掉重开、或者重启电脑：
# 看 AI 程序（钩子往上找到的顶层进程）是在退出之后才打开的，记号就作废。设置里关掉了（ai-autostart-off）就不管。
# 也可以单独调用：crosspet-hook.py --ensure（不读事件、不写状态，只确保桌宠在跑；Windows 上 Claude Code 的 mod 用它）
LAUNCH_EVENTS = ("SessionStart", "UserPromptSubmit", "BeforeAgent", "PreInvocation")


def app_started_at():
    """调用这个钩子的 AI 程序是哪个、什么时候打开的：顺着父进程往上找，到系统进程下面那一层为止
    （macOS：launchd；Windows：系统目录里的程序，比如 explorer、svchost，或者虚拟机工具的常驻进程）。
    中间的命令行外壳（cmd、PowerShell）会跳过去。终端里跑的命令行工具找到的是终端程序。返回 (时间, 程序名)"""
    now = time.time()
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        k32.OpenProcess.restype = wintypes.HANDLE

        class Entry(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                        ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                        ("szExeFile", ctypes.c_wchar * 260)]
        procs = {}
        snap = k32.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS
        entry = Entry()
        entry.dwSize = ctypes.sizeof(Entry)
        ok = k32.Process32FirstW(wintypes.HANDLE(snap), ctypes.byref(entry))
        while ok:
            procs[entry.th32ProcessID] = entry.th32ParentProcessID
            ok = k32.Process32NextW(wintypes.HANDLE(snap), ctypes.byref(entry))
        k32.CloseHandle(wintypes.HANDLE(snap))

        def info(pid: int):
            """(打开时间, 程序完整路径)；打不开（权限不够、已经退出）返回 (0, "")"""
            h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return 0, ""
            h = wintypes.HANDLE(h)
            times = [wintypes.FILETIME() for _ in range(4)]
            path = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            try:
                if not k32.GetProcessTimes(h, *[ctypes.byref(t) for t in times]):
                    return 0, ""
                k32.QueryFullProcessImageNameW(h, 0, path, ctypes.byref(size))
            finally:
                k32.CloseHandle(h)
            ft = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            return ft / 1e7 - 11644473600, path.value  # 1601 年起的 100 纳秒 → Unix 秒

        windows = os.environ.get("SystemRoot", r"C:\Windows").lower().rstrip("\\") + "\\"
        shells = ("cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "bash.exe", "sh.exe", "wsl.exe")
        tools = ("\\parallels\\", "\\vmware\\", "\\oracle\\virtualbox")

        def system(path: str) -> bool:
            p = path.lower()
            name = p.rsplit("\\", 1)[-1]
            return not p or (p.startswith(windows) and name not in shells) or any(t in p for t in tools)

        pid = os.getpid()
        start, path = info(pid)
        while pid in procs:
            parent = procs[pid]
            if parent not in procs:
                break
            parent_start, parent_path = info(parent)
            if system(parent_path) or not parent_start or parent_start > start:  # 后者：进程号被重用了，真正的父进程早没了
                break
            pid, start, path = parent, parent_start, parent_path
        return start, path.rsplit("\\", 1)[-1]
    import subprocess
    out = subprocess.run(["/bin/ps", "-A", "-o", "pid=,ppid=,etime=,comm="], capture_output=True, text=True, timeout=5).stdout
    procs = {}
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            days, _, clock = parts[2].rpartition("-")
            secs = 0
            for piece in clock.split(":"):
                secs = secs * 60 + int(piece)
            procs[int(parts[0])] = (int(parts[1]), secs + int(days or 0) * 86400, parts[3])
    pid = os.getpid()
    while pid in procs and procs[pid][0] > 1 and procs[pid][0] in procs:
        pid = procs[pid][0]
    if pid not in procs:
        return 0, ""
    name = procs[pid][2]
    return now - procs[pid][1], (name.split(".app/")[0].rsplit("/", 1)[-1] if ".app/" in name else name.rsplit("/", 1)[-1])


def ensure_pet() -> str:
    """返回这次的结果（写进 <状态目录>/autostart.txt，排查「为什么没出来」用）"""
    data = default_data if os.name == "nt" else Path.home() / "Library/Application Support/CrossPet"
    quit_flag = data / "user-quit"
    if quit_flag.exists():
        quit_at = quit_flag.stat().st_mtime
        try:
            started, app = app_started_at()
            note = f"（{app or '没找到 AI 程序'} 打开于 {time.strftime('%H:%M:%S', time.localtime(started))}，退出于 {time.strftime('%H:%M:%S', time.localtime(quit_at))}）"
        except Exception as e:
            started, note = 0, f"（查 AI 启动时间出错 {e!r}）"
        if started <= quit_at:
            return "不打开：从菜单手动退出过，这个 AI 是在那之前就开着的" + note
        fresh_note = "手动退出后重新打开过 AI" + note + "，"
    else:
        fresh_note = ""
    if (data / "ai-autostart-off").exists():
        return "不打开：设置里关掉了「AI 开始工作时自动出现」"
    import subprocess
    quiet = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    if os.name == "nt":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        # 桌宠在跑时握着这个互斥量（单实例）；能打开就是在跑
        handle = kernel32.OpenMutexW(0x00100000, False, "Local\\CrossPet-" + os.environ.get("USERNAME", ""))
        if handle:
            kernel32.CloseHandle(handle)
            return "已经在跑"
        exe = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Programs/CrossPet/CrossPet.exe"
        if not exe.exists():
            return f"不打开：没找到 {exe}"
        # 独立进程：不挂在 AI 进程下面，AI 退出时桌宠不会被一起关掉
        detached = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen([str(exe)], cwd=str(exe.parent), creationflags=detached | 0x01000000, **quiet)  # + CREATE_BREAKAWAY_FROM_JOB
        except OSError:
            # 有的 AI（WorkBuddy）把钩子放进不许脱离的作业对象，一轮结束就把里面的进程全关掉，直接打开的桌宠会跟着闪退。
            # 交给已经在跑的资源管理器去打开（和从开始菜单打开一样），桌宠就不在这个作业对象里了
            explorer = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "explorer.exe"
            subprocess.Popen([str(explorer), str(exe)], creationflags=detached, **quiet)
            return fresh_note + "已打开（由资源管理器打开）"
        return fresh_note + "已打开"
    else:
        try:
            os.kill(int((state_dir / "pet.pid").read_text().strip()), 0)
            return "已经在跑"
        except PermissionError:
            return "已经在跑"
        except Exception:
            pass
        # -g：在后台打开，不抢你正在用的窗口的焦点
        subprocess.Popen(["/usr/bin/open", "-g", "-b", "io.github.crosspet"], start_new_session=True, **quiet)
        return fresh_note + "已打开"


def ensure_pet_logged(source: str) -> None:
    try:
        result = ensure_pet()
    except Exception as e:
        result = f"出错：{e!r}"
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        # Windows 上带 BOM：系统自带的 PowerShell 5 没有 BOM 就按 GBK 读，中文会乱码
        (state_dir / "autostart.txt").write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {source}：{result}\n",
                                                 encoding="utf-8-sig" if os.name == "nt" else "utf-8")
    except Exception:
        pass


if character == "--ensure":
    ensure_pet_logged("--ensure")
    sys.exit(0)

try:
    # 按 UTF-8 读：Windows 上 Python 默认用系统编码（中文系统是 GBK），事件里一有中文就会解码失败
    event = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace"))
except Exception:
    sys.exit(0)

# Codex 会在对话结束后自己在后台整理记忆（工作目录在 ~/.codex/memories），也会调工具，但不是你让它干的活，
# 而且没有开始 / 结束事件，演了会一直停在思考：工作目录在 Codex 自己的配置目录里的事件都不管
if character == "gpt":
    try:
        codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex").resolve()
        cwd = Path(str(event.get("cwd") or "")).resolve() if event.get("cwd") else None
        if cwd and (cwd == codex_home or codex_home in cwd.parents):
            sys.exit(0)
    except (OSError, ValueError):
        pass

# 多模型宿主（WorkBuddy、ZCode、Hermes Agent）：每条事件都带当前模型名，按它选角色；认不出的模型（混元、Kimi、GLM……）
# 写给「当前角色」（current），桌宠用正在显示的角色演，不换人。当前角色另外记在 <宿主>-host.json，
# 桌宠切到这个程序的窗口时按它换角色
MULTI_MODEL_HOSTS = ("workbuddy", "zcode", "hermes")
# ZCode 默认用智谱的 GLM；它只在会话开始时告诉模型名，之后的事件按会话 id 查当时记下的模型
HOST_DEFAULT_MODEL = {"zcode": "glm"}
characters_dir = (default_data if os.name == "nt" else Path.home() / "Library/Application Support/CrossPet") / "characters"


def character_for_model(model: str):
    m = model.lower()
    if "glm" in m or "zhipu" in m or "chatglm" in m or "z.ai" in m or "zai-" in m:
        return "glm"
    if "kimi" in m or "moonshot" in m:
        return "kimi"
    if "deepseek" in m:
        return "deepseek"
    if "claude" in m or "anthropic" in m:
        return "claude"
    if "gemini" in m:
        return "gemini"
    if m.startswith(("gpt", "o1", "o3", "o4", "codex", "chatgpt")) or "openai" in m:
        return "gpt"
    return None


def remember_session_model(host: str, fallback: str = "") -> str:
    """有的宿主只在会话开始时给模型名：记下来（按会话 id），之后的事件查它"""
    sid = str(event.get("session_id") or event.get("sessionId") or "")
    # claude / gpt 是角色名，<角色>-sessions.json 已经是多会话状态文件了，模型另记一个文件
    path = state_dir / (f"{host}-models.json" if host in SELF_HOSTS else f"{host}-sessions.json")
    try:
        known = json.loads(path.read_text())
    except Exception:
        known = {}
    model = str(event.get("model") or "")
    if model and sid:
        known[sid] = model
        known = dict(list(known.items())[-50:])  # 只留最近的会话
        try:
            state_dir.mkdir(parents=True, exist_ok=True)
            tmp = state_dir / f".{host}-sessions.json"
            tmp.write_text(json.dumps(known))
            tmp.replace(path)
        except Exception:
            pass
    return model or known.get(sid, "") or fallback or HOST_DEFAULT_MODEL.get(host, "")


def character_for_url(url: str):
    """Claude Code 走别家的兼容接口（ANTHROPIC_BASE_URL）：看接口地址是谁家的。
    DeepSeek、智谱的 Anthropic 兼容接口也收 Claude 的模型名（会换成自家模型），所以地址比模型名可信"""
    u = url.lower()
    if "deepseek.com" in u:
        return "deepseek"
    if "bigmodel.cn" in u or "z.ai" in u or "zhipu" in u:
        return "glm"
    if "moonshot" in u or "kimi" in u:
        return "kimi"
    return None


def installed(c) -> bool:
    return bool(c) and (characters_dir / c / "character.json").exists() and \
        any((characters_dir / c / f"idle.{ext}").exists() for ext in ("webp", "png"))


# 自己就有角色、但也能接别家接口的：Claude Code（ANTHROPIC_BASE_URL + 别家模型名）、Codex（换了 model_provider）。
# 按模型换成对应的角色，认不出的模型还是由自己来演。Codex 每条事件都带模型名；Claude Code 只在会话开始时给，
# 另外看环境变量里的模型名和接口地址
SELF_HOSTS = ("claude", "gpt")
if character in SELF_HOSTS:
    host = character
    env_model = os.environ.get("ANTHROPIC_MODEL", "") if host == "claude" else ""
    model = remember_session_model(host, env_model)
    mapped = (character_for_url(os.environ.get("ANTHROPIC_BASE_URL", "")) if host == "claude" else None) \
        or character_for_model(model)
    if not installed(mapped):
        mapped = host
    character = mapped
    event["model"] = model
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        hp = state_dir / f".{host}-host.json"
        hp.write_text(json.dumps({"character": mapped, "model": model, "ts": time.time()}))
        hp.replace(state_dir / f"{host}-host.json")
    except Exception:
        pass

if character in MULTI_MODEL_HOSTS:
    host = character
    model = remember_session_model(host)
    mapped = character_for_model(model)
    # 对应的角色还没装（比如还没画立绘的新角色）：当成认不出的模型，由当前角色来演
    if mapped and not installed(mapped):
        mapped = None
    character = mapped or "current"
    event["model"] = model
    if model:
        try:
            state_dir.mkdir(parents=True, exist_ok=True)
            hp = state_dir / f".{host}-host.json"
            hp.write_text(json.dumps({"character": mapped, "model": str(event.get("model")), "ts": time.time()}))
            hp.replace(state_dir / f"{host}-host.json")
        except Exception:
            pass

arg_event = sys.argv[2] if len(sys.argv) > 2 else ""
name = event.get("hook_event_name") or arg_event
call = event.get("toolCall") if isinstance(event.get("toolCall"), dict) else {}  # Antigravity
tool = str(event.get("tool_name") or call.get("name", "")).lower()
tool_input = json.dumps(event.get("tool_input") or call.get("args", ""), ensure_ascii=False).lower()


# Antigravity 的工具名（文档里的名字和内部步骤名都可能出现）
ANTIGRAVITY_TOOLS = {
    "reading": ("view_file", "view_file_outline", "view_code_item", "view_content_chunk", "list_dir", "list_directory",
                "find_by_name", "find", "grep_search", "code_search", "find_all_references", "read_notebook", "read_resource"),
    "writing": ("write_to_file", "replace_file_content", "multi_replace_file_content", "code_action", "file_change",
                "propose_code", "edit_notebook", "write_blob", "delete_directory", "move"),
    "running": ("run_command", "command_status", "send_command_input", "read_terminal", "shell_exec", "execute_notebook"),
    "searching": ("search_web", "read_url_content", "open_browser_url", "read_browser_page", "browser_subagent"),
    "drawing": ("generate_image",),
    "delegating": ("invoke_subagent",),
}
# 这些是 Antigravity 内部的记账 / 提问步骤，不算干活
ANTIGRAVITY_IGNORE = ("task_boundary", "notify_user", "planner_response", "ask_question", "ask_permission",
                      "manage_task", "checkpoint", "ephemeral_message", "system_message", "finish", "wait")


# AI 停下来问你问题、让你选选项的工具：Claude Code 的 AskUserQuestion、Codex 的 request_user_input、
# DeepSeek Harness 的 ask_user_question 等
ASKING_TOOLS = ("askuserquestion", "request_user_input", "ask_user_question", "ask_user", "ask_question", "clarify")
# Notification 里表示「在等你授权 / 等你填」的类型（Claude Code、Gemini CLI、WorkBuddy）；idle_prompt 是一轮做完后闲着，不算
ASKING_NOTIFICATIONS = ("permission_prompt", "elicitation_dialog", "toolpermission", "agent_needs_input")


def pose_for_tool(t: str) -> str:
    if t in ASKING_TOOLS:
        return "asking"
    # 画图：Codex 内置 image_gen 工具，或用脚本 image_gen.py 生成
    if any(k in t for k in ("image_gen", "imagegen", "generate_image", "video_gen", "draw", "paint")) or "image_gen" in tool_input:
        return "drawing"
    # Hermes Agent：在本地找文件 / 翻历史会话 / 看终端输出 / 看图，都算看资料（名字里带 search，别当成上网搜）
    if t in ("search_files", "session_search", "read_terminal", "vision_analyze"):
        return "reading"
    if "view_image" in t or t == "find_by_name":
        return "reading"
    if t in ("read_url_content",) or t.startswith("browser"):
        return "searching"
    if any(k in t for k in ("read", "grep", "glob", "list", "view", "cat")):
        return "reading"
    if any(k in t for k in ("write", "edit", "patch", "replace", "create")):
        return "writing"
    if any(k in t for k in ("web", "fetch", "browse", "search", "http")):
        return "searching"
    if any(k in t for k in ("agent", "task", "subagent", "delegate")):
        return "delegating"
    return "running"


def tool_failed() -> bool:
    if event.get("error"):  # Antigravity
        return True
    resp = event.get("tool_response")
    if isinstance(resp, dict):
        if resp.get("is_error") is True or resp.get("success") is False:
            return True
        if resp.get("error"):
            return True
    return False


turn_file = state_dir / f"{character}-turn.json"


def turn_tools() -> int:
    try:
        return int(json.loads(turn_file.read_text()).get("tools", 0))
    except Exception:
        return 0


def set_turn_tools(n: int) -> None:
    turn_file.write_text(json.dumps({"tools": n}))


state_dir.mkdir(parents=True, exist_ok=True)

pose = None
if arg_event and name == "PostToolUse":
    # Antigravity：不挂 PreToolUse（它要求钩子回答「放行 / 拦截」，会干扰正常的权限确认），
    # 工具跑完时再按工具名显示动作，下一次调用模型（PreInvocation）时回到思考
    agy = next((p for p, names in ANTIGRAVITY_TOOLS.items() if tool in names), None)
    if tool_failed():
        pose = "oops"
    elif not tool or tool in ANTIGRAVITY_IGNORE:
        pose = None
    else:
        set_turn_tools(turn_tools() + 1)
        pose = agy or ("searching" if tool.startswith("browser") else pose_for_tool(tool))
    name = "PreToolUse"  # 让桌宠当作「正在用这个工具」显示，而不是「工具结束、回去思考」
elif name in ("PermissionRequest",):
    pose = "asking"  # 等你授权（Codex）
elif name in ("Notification",):
    kind = str(event.get("notification_type", "")).lower()
    message = str(event.get("message", "")).lower()
    if kind in ASKING_NOTIFICATIONS or (not kind and "permission" in message):
        pose = "asking"
elif name in ("SessionStart",):
    pose = "idle"
elif name in ("UserPromptSubmit", "BeforeAgent"):
    set_turn_tools(0)
    pose = "listening"
elif name in ("PreToolUse", "BeforeTool"):
    set_turn_tools(turn_tools() + 1)
    pose = pose_for_tool(tool)
elif name in ("PostToolUse", "AfterTool"):
    pose = "oops" if tool_failed() else "thinking"
elif name in ("PostToolUseFailure",):
    pose = "oops"
elif name in ("Stop", "AfterAgent"):
    if event.get("error"):  # Antigravity：出错停下
        pose = "oops"
    else:
        pose = "proud" if turn_tools() >= BIG_JOB_TOOLS else "happy"
    set_turn_tools(0)
elif name in ("StopFailure",):
    # 这一轮因为出错停下（接口报错、超限……；Claude Code、WorkBuddy）
    pose = "oops"
    name = "Stop"
    set_turn_tools(0)
elif name in ("Interrupt",):
    # 被你打断（Codex 的 Interrupt）：吓一跳，然后回去待机；网页把 Stop + surprised 当成「被打断」
    pose = "surprised"
    name = "Stop"
    set_turn_tools(0)
elif name in ("PreCompact", "PreCompress"):
    pose = "compact"  # 压缩上下文：把一大堆东西往小箱子里塞
elif name in ("PostCompact",):
    if str(event.get("trigger", "")).lower() == "manual":
        # 手动 /compact：压完这一轮就结束了，后面不会再有 Stop
        pose = "happy"
        name = "Stop"
        set_turn_tools(0)
    else:
        pose = "thinking"  # 自动压缩发生在一轮中途，压完接着干活
elif name in ("SubagentStart",):
    pose = "delegating"
elif name in ("SubagentStop",):
    pose = "thinking"
elif name in ("BeforeModel", "PreInvocation"):
    pose = "thinking"
elif name in ("SessionEnd",):
    pose = "sleeping"

state = {"pose": pose, "event": name, "tool": tool, "ts": time.time()}
if pose == "thinking" and name in ("PreInvocation", "PostToolUse", "AfterTool"):
    # 快的工具（ls、读文件、grep）从开始到结束常常不到 0.3 秒，桌宠每 0.3 秒才读一次，
    # 刚写的工具动作会被「回去思考」直接盖掉（Antigravity 甚至几毫秒内就开始下一轮思考）。
    # 所以把它捎带上：桌宠先演完那个动作再进入思考；已经演过的（同一个 afterTs）桌宠会跳过。
    try:
        prev = json.loads((state_dir / f"{character}-state.json").read_text())
        if prev.get("event") == "PreToolUse" and time.time() - float(prev.get("ts", 0)) < 3:
            state.update(after=prev.get("pose"), afterTs=prev.get("ts"), tool=prev.get("tool", ""))
    except Exception:
        pass

if pose:
    # 临时文件名带进程号：同一个角色的几个钩子同时写（好几个对话一起干活）时不会抢同一个临时文件
    tmp = state_dir / f".{character}-state.{os.getpid()}.json"
    tmp.write_text(json.dumps(state))
    tmp.replace(state_dir / f"{character}-state.json")


# 同一个 AI 同时开着好几个对话在干活：按会话另外记一份 <角色>-sessions.json（{会话id: {pose, event, ts}}），
# 桌宠看到两个以上同时在干活时演「手忙脚乱」，每个对话一张小卡片。几个钩子可能同时写，用文件锁排队
SESSION_KEEP = 10 * 60   # 多久没动静的会话不再记


def update_sessions(sid: str, entry) -> None:
    path = state_dir / f"{character}-sessions.json"
    with open(state_dir / f".{character}-sessions.lock", "a+") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
        except Exception:
            pass
        try:
            known = json.loads(path.read_text())
        except Exception:
            known = {}
        now = time.time()
        if entry is None:
            known.pop(sid, None)
        else:
            known[sid] = entry
        known = {k: v for k, v in known.items() if now - float(v.get("ts", 0)) < SESSION_KEEP}
        tmp = state_dir / f".{character}-sessions.json"
        tmp.write_text(json.dumps(known))
        tmp.replace(path)
        if os.name == "nt":
            try:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            except Exception:
                pass


session_id = str(event.get("session_id") or event.get("sessionId") or event.get("conversationId") or "")
if session_id and (pose or name == "SessionEnd"):
    try:
        update_sessions(session_id, None if name == "SessionEnd" else
                        {"pose": state.get("after") or pose if pose == "thinking" else pose, "event": name, "ts": time.time()})
    except Exception:
        pass


if name in LAUNCH_EVENTS:
    ensure_pet_logged(f"{character} {name}")

if arg_event:
    print("{}")
sys.exit(0)
