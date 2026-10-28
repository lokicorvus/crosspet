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
    <宿主id>-turn-tools.json  按会话和轮次记录用了几次工具（判断「大活」用）
不影响 AI 本身的行为：一般不向 stdout 输出；Antigravity 要求回一个 JSON，就回空的 {}。
用 /tmp 是因为有的 AI（比如 DeepSeek Harness）的钩子跑在沙箱里，只允许写 /tmp。
"""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

BIG_JOB_TOOLS = 8  # 一轮里用了这么多次工具，结束时「得意」一下

character = sys.argv[1] if len(sys.argv) > 1 else "claude"
default_data = Path(os.environ.get("CROSSPET_DATA_DIR") or str(Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "CrossPet"))
# 桌宠的数据目录（角色、退出记号）：设了 CROSSPET_DATA_DIR 就用它（测试也靠它），没设时 Windows 在 %LOCALAPPDATA%\CrossPet，macOS 在 Application Support
app_data = default_data if (os.name == "nt" or os.environ.get("CROSSPET_DATA_DIR")) else Path.home() / "Library/Application Support/CrossPet"
state_dir = Path(os.environ.get("CROSSPET_STATE_DIR") or (str(default_data / "state") if os.name == "nt" else "/tmp/crosspet"))

# ---- 事件记录（反馈「AI 干活时她没反应」用）：数据目录 events/<接入名>.jsonl，每条事件一行，记处理结果 ----
# 只记事件名、工具名、会话 id 的哈希前 6 位、有没有轮次号、结果（shown 演了 / dropped 被哪条规则丢了 / error 出错）。
# 绝不记内容：prompt、工具参数和结果、AI 的回答、对话记录路径、工作目录。只留最近 200 行（超过 240 行时截回 200）。
# 格式和 DeepSeek Harness 插件、Claude Code mod 写的一样，见 docs/架构.md「记录」
LEDGER_KEEP, LEDGER_MAX = 200, 240
ledger_info = {"ev": "", "tool": "", "sid": "", "turn": False}


def integration_name(argv) -> str:
    """接入名（和 integrate.py、反馈里「最近收到消息」用的一样）：钩子的第一个参数是角色 / 宿主名，不完全一样"""
    host = argv[1] if len(argv) > 1 else "claude"
    if host == "claude":
        return "claude-hooks"
    if host == "gpt":
        return "codex"
    if host == "gemini" and len(argv) > 2:   # Antigravity 多带一个事件名参数
        return "antigravity"
    return host


def _lock(f) -> None:
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX)
    except Exception:
        pass


def ledger(result: str, detail: str) -> None:
    try:
        d = app_data / "events"
        d.mkdir(parents=True, exist_ok=True)
        stem = integration_name(sys.argv)
        path = d / f"{stem}.jsonl"
        line = json.dumps({"t": round(time.time(), 2), **ledger_info, "result": result, "detail": detail}, ensure_ascii=False)
        with open(d / f".{stem}.lock", "a+") as lock:   # 好几个钩子进程可能同时写：排队
            _lock(lock)
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            rows = path.read_text(encoding="utf-8").splitlines()
            if len(rows) > LEDGER_MAX:
                tmp = d / f".{stem}.{os.getpid()}.tmp"
                tmp.write_text("\n".join(rows[-LEDGER_KEEP:]) + "\n", encoding="utf-8")
                tmp.replace(path)
            if os.name == "nt":
                try:
                    import msvcrt
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                except Exception:
                    pass
    except Exception:
        pass   # 记录写不了不能影响钩子本身

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
    data = app_data
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

IDLE_SECONDS = 1.5      # 这么久没有新数据进来就不等了（宿主都是一口气写完的）
MAX_SECONDS = 15        # 最多读这么久
MAX_BYTES = 64 << 20    # 最多读这么多（Claude Code 的 PostToolUse 带着工具输出，可能有好几 MB）


def read_chunk(fd: int, timeout: float):
    """读一块：有数据返回 bytes，输入关了返回 b""，等了 timeout 还没数据返回 None"""
    if os.name == "nt":
        # Windows 的管道不能 select：先看管道里有没有数据（PeekNamedPipe），有了再读，读就不会卡住
        import ctypes
        import msvcrt
        from ctypes import wintypes
        try:
            handle = msvcrt.get_osfhandle(fd)
        except OSError:
            return b""
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        avail = wintypes.DWORD()
        end = time.monotonic() + timeout
        while True:
            if not k32.PeekNamedPipe(wintypes.HANDLE(handle), None, 0, None, ctypes.byref(avail), None):
                if ctypes.get_last_error() == 109:   # ERROR_BROKEN_PIPE：写的那头关了
                    return b""
                return os.read(fd, 1 << 16)       # 不是管道（重定向的文件）：直接读，读到头就是 EOF
            if avail.value:
                return os.read(fd, min(avail.value, 1 << 16))
            if time.monotonic() >= end:
                return None
            time.sleep(0.01)
    import select
    ready, _, _ = select.select([fd], [], [], timeout)
    return os.read(fd, 1 << 16) if ready else None


def read_event():
    """从 stdin 读一个事件 JSON。读到一个完整的就返回，不等输入关闭（#19：Windows 上 Codex 的 app-server
    写完事件不关输入，以前在这里一直等，钩子进程挂着不退，每次留下一个空白终端）。
    没有输入（交互终端）、超时、内容不是 JSON 时返回 None"""
    if sys.stdin is None or sys.stdin.isatty():
        return None
    fd = sys.stdin.fileno()
    buf = b""
    start = time.monotonic()
    decoder = json.JSONDecoder()
    while len(buf) < MAX_BYTES and time.monotonic() - start < MAX_SECONDS:
        chunk = read_chunk(fd, IDLE_SECONDS)
        if not chunk:   # 输入关了（b""）或一阵子没数据（None）：拿读到的试最后一次
            break
        buf += chunk
        if buf.rstrip()[-1:] != b"}":   # 还没到对象的结尾：接着读（不每块都解析，几 MB 的事件也不慢）
            continue
        try:
            # 严格按 UTF-8 解：汉字被切在两块之间时先接着读，凑齐了再解
            return decoder.raw_decode(buf.decode("utf-8").lstrip())[0]
        except (ValueError, UnicodeDecodeError):
            continue
    try:
        # 按 UTF-8 读：Windows 上 Python 默认用系统编码（中文系统是 GBK），事件里一有中文就会解码失败
        return json.loads(buf.decode("utf-8", errors="replace"))
    except ValueError:
        return None


try:
    event = read_event()
except Exception:
    event = None
if not isinstance(event, dict):
    ledger("dropped", "bad-json")
    sys.exit(0)

_sid = str(event.get("session_id") or event.get("sessionId") or event.get("conversationId") or "")
_call = event.get("toolCall") if isinstance(event.get("toolCall"), dict) else {}
ledger_info.update(ev=str(event.get("hook_event_name") or (sys.argv[2] if len(sys.argv) > 2 else ""))[:60],
                   tool=str(event.get("tool_name") or _call.get("name", "")).lower()[:60],
                   sid=hashlib.sha1(_sid.encode("utf-8")).hexdigest()[:6] if _sid else "",
                   turn=bool(event.get("turn_id")))
_prev_excepthook = sys.excepthook


def _ledger_excepthook(kind, value, tb):
    ledger("error", kind.__name__)
    _prev_excepthook(kind, value, tb)


sys.excepthook = _ledger_excepthook

def cursor_bridge_installed() -> bool:
    """只在 Cursor 确实配置了独立桥时，跳过它导入的 Claude 钩子。卸载后自然恢复旧接入。"""
    try:
        config = json.loads((Path.home() / ".cursor/hooks.json").read_text(encoding="utf-8-sig"))
        hooks = config.get("hooks") if isinstance(config, dict) else None
        if not isinstance(hooks, dict):
            return False
        return any(isinstance(entry, dict) and isinstance(entry.get("command"), str)
                   and any(mark in entry["command"] for mark in ("crosspet-cursor-bridge.py", "crosspet_cursor_bridge.py"))
                   for entries in hooks.values() if isinstance(entries, list) for entry in entries)
    except (OSError, ValueError):
        return False  # 正在写配置 / 未安装时，保留已有 observer 的行为。


# Cursor 会导入 Claude hooks；只在它另有独立桥接时去重，不能让未迁移的用户升级后断联。
if event.get("cursor_version") and cursor_bridge_installed():
    ledger("dropped", "cursor-imported-claude-hook")
    sys.exit(0)

# Grok Build：每个钩子进程都带 GROK_HOOK_EVENT。它还会读 ~/.claude/settings.json 的钩子，那边的 CrossPet 钩子
# 就会以 claude 的名义被它触发：单独接入了 Grok（~/.grok/hooks/crosspet.json）时丢掉，免得同一件事演两遍；
# 没接入时改成 Grok 来演，不能让 Grok 的活算到 Claude 头上
if os.environ.get("GROK_HOOK_EVENT") and character != "grok":
    grok_home = Path(os.environ.get("GROK_HOME") or Path.home() / ".grok")
    if (grok_home / "hooks" / "crosspet.json").exists():
        ledger("dropped", "grok-imported-claude-hook")
        sys.exit(0)
    character = "grok"
# Grok Build 关闭会话时，在 SessionEnd 之后还会补发一个 reason=shutdown 的 Stop（不是一轮做完）：
# 演了会把刚睡着的她拉回「开心」（10-27 实测）
if os.environ.get("GROK_HOOK_EVENT") and event.get("hook_event_name") == "Stop" and event.get("reason") == "shutdown":
    ledger("dropped", "grok-shutdown-stop")
    sys.exit(0)
# Grok Build 的字段是驼峰写法；事件名（hook_event_name）已经是 Claude 的写法
if os.environ.get("GROK_HOOK_EVENT"):
    for camel, snake in (("toolName", "tool_name"), ("toolInput", "tool_input"), ("notificationType", "notification_type")):
        if camel in event and snake not in event:
            event[snake] = event[camel]

# Codex 会在对话结束后自己在后台整理记忆（工作目录在 ~/.codex/memories），也会调工具，但不是你让它干的活，
# 而且没有开始 / 结束事件，演了会一直停在思考：工作目录在 Codex 自己的配置目录里的事件都不管
if character == "gpt":
    try:
        codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex").resolve()
        cwd = Path(str(event.get("cwd") or "")).resolve() if event.get("cwd") else None
        if cwd and (cwd == codex_home or codex_home in cwd.parents):
            ledger("dropped", "codex-memory")
            sys.exit(0)
    except (OSError, ValueError):
        pass

# Codex 桌面版首页的「主动建议」：它在后台开临时对话翻你的文件、邮件、日历来写建议卡片，一打开 Codex、或者隔一阵就跑一次，
# 不是你让它干的活，演了就是「啥都没输入她就开工」，还常常一次开两个、直接进手忙脚乱。
# 这种临时对话不存档：你自己开的对话从一开始就有会话记录文件（事件里的 transcript_path），它们没有。
# 刚开的对话记录文件可能晚一点点才写出来：开头两个事件等一下再判断
if character == "gpt" and "transcript_path" in event:
    tp = str(event.get("transcript_path") or "")
    tries = 6 if event.get("hook_event_name") in ("SessionStart", "UserPromptSubmit") else 1
    for i in range(tries):
        try:
            if tp and Path(tp).exists():
                break
        except (OSError, ValueError):
            pass
        if i + 1 < tries:
            time.sleep(0.1)
    else:
        ledger("dropped", "codex-suggestion")
        sys.exit(0)

arg_event = sys.argv[2] if len(sys.argv) > 2 else ""
name = event.get("hook_event_name") or arg_event
source_host = character  # 不能用按模型换过的角色来分会话 / 工具计数


# 从门禁到状态、模型路由、会话卡片写完共用一把宿主锁。只锁 turn_gate 会留下
# 「工具已获准 → Stop 写完 → 旧工具才替换状态」的窗口。写完会话再关句柄；异常退出也会释放。
def event_lock(owner: str):
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = open(state_dir / f".{owner}-events.lock", "a+b")
    try:
        deadline = time.monotonic() + .75
        while True:
            try:
                lock.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("observer event lock busy")
                time.sleep(.005)
        return lock
    except BaseException:
        lock.close()
        raise


try:
    _event_lock = event_lock(source_host)
except OSError:
    # 观察者写不了状态时安静退出，不绕过锁写共享文件，也不影响 AI。
    ledger("dropped", "event-lock-busy")
    if arg_event:
        print("{}")
    sys.exit(0)


# ---- 按轮次丢掉迟到的事件（Codex：事件带 turn_id；PR #26 @KQYaili 报的）----
# 沿用上游的会话 + 轮次账本。子任务另记首次看到时所属的主轮次，换轮后不重新归属。
TURN_END = ("Stop", "StopFailure", "StopCancelled", "Interrupt", "SessionEnd")
TURN_KEEP = 24 * 3600


def turn_gate(owner: str, sid: str, tid: str, name: str, child: bool) -> tuple:
    """返回 (这条事件要不要演, 工具计数所属的主轮次)。调用者持有整条事件的锁。"""
    path = state_dir / f"{owner}-turns.json"
    try:
        book = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(book, dict):
            book = {}
    except Exception:
        book = {}
    now = time.time()
    book = {k: v for k, v in book.items() if isinstance(v, dict) and now - float(v.get("ts", 0)) < TURN_KEEP}
    rec = book.get(sid) or {"turn": "", "done": False, "finished": []}
    finished = rec.get("finished") or []
    children = rec.get("children")
    children = children if isinstance(children, dict) else {}
    if child:
        key = json.dumps([str(event.get("agent_id")), tid])
        binding = children.get(key)
        binding = binding if isinstance(binding, dict) else {}
        explicit_parent = str(event.get("parent_turn_id") or event.get("root_turn_id") or "")
        parent = str(binding.get("turn") or explicit_parent or rec.get("turn") or "")
        allow = not rec.get("done") and not binding.get("done") and parent == rec.get("turn", "")
        if explicit_parent and explicit_parent != rec.get("turn"):
            allow = False
        children[key] = {"turn": parent, "done": bool(binding.get("done") or name in TURN_END or name == "SubagentStop")}
    elif tid in finished:
        allow = False
    else:
        allow = True
        # compact / resume 的 SessionStart 不是新轮次，不能退休正在工作的主轮次。
        metadata = name == "SessionStart" and str(event.get("source", "")).lower() in ("compact", "resume")
        if tid != rec.get("turn") and not metadata:
            if rec.get("turn") and rec["turn"] not in finished:
                finished = (finished + [rec["turn"]])[-128:]
            rec = {"turn": tid, "done": False, "finished": finished}
        ends = name in TURN_END or (name == "PostCompact" and str(event.get("trigger", "")).lower() == "manual")
        if ends:
            rec["done"] = True
            rec["finished"] = (finished + [tid])[-128:]
    rec["children"] = dict(list(children.items())[-128:])
    rec["ts"] = now
    book[sid] = rec
    tmp = state_dir / f".{owner}-turns.{os.getpid()}.json"
    tmp.write_text(json.dumps(book))
    tmp.replace(path)
    return allow, str(rec.get("turn") or tid)


turn_id = str(event.get("turn_id") or "")
turn_sid = str(event.get("session_id") or event.get("sessionId") or event.get("conversationId") or "")
effective_turn = turn_id
if turn_id and turn_sid:
    is_child = bool(event.get("agent_id"))
    try:
        allowed, effective_turn = turn_gate(source_host, turn_sid, turn_id, name, is_child)
    except Exception:
        # 记账失败不能让旧事件绕过门禁去改模型路由或可见状态；下一条消息再试。
        allowed = False
    if not allowed:
        ledger("dropped", "turn-finished")
        if arg_event:
            print("{}")
        sys.exit(0)
    if is_child:
        if name == "UserPromptSubmit":
            name = "SubagentStart"
        elif name in TURN_END:
            name = "SubagentStop"


# 心跳：「最近一次收到这个 AI 的消息」，桌宠记下来，设置里能看出「接上了但从没收到过消息」，反馈里也带着。
# 文件名按接入的是哪个 AI 分（Antigravity 和 Gemini CLI 都用 gemini 角色，Antigravity 多带一个事件名参数）
try:
    seen_key = "antigravity" if character == "gemini" and len(sys.argv) > 2 else character
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / f"seen-{seen_key}").write_text(str(int(time.time())))
except Exception:
    pass

# 多模型宿主（WorkBuddy、ZCode、Hermes Agent、Qwen Code）：事件里带当前模型名就按它选角色；认不出的模型（混元、Kimi、GLM……）
# 写给「当前角色」（current），桌宠用正在显示的角色演，不换人。当前角色另外记在 <宿主>-host.json，
# 桌宠切到这个程序的窗口时按它换角色
MULTI_MODEL_HOSTS = ("workbuddy", "zcode", "hermes", "qwen")
# ZCode 默认用智谱的 GLM；Qwen Code 默认用自家的千问。它们只在会话开始时告诉模型名，
# 之后的事件按会话 id 查当时记下的模型
HOST_DEFAULT_MODEL = {"zcode": "glm", "qwen": "qwen"}
characters_dir = app_data / "characters"


def character_for_model(model: str):
    m = model.lower()
    if "glm" in m or "zhipu" in m or "chatglm" in m or "z.ai" in m or "zai-" in m:
        return "glm"
    # coder-model：Qwen Code 用千问账号登录时报的模型别名（实为 Qwen 3.7 Max）
    if "qwen" in m or "dashscope" in m or "bailian" in m or "tongyi" in m or m == "coder-model":
        return "qwen"
    if "kimi" in m or "moonshot" in m:
        return "kimi"
    if "grok" in m:   # xAI 的 grok-4.7、OpenRouter 的 x-ai/grok-…
        return "grok"
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
    # 宿主名本身就是角色名时（claude / gpt / qwen），<名字>-sessions.json 已经被多会话状态占用了（见 update_sessions），
    # 模型得另记一个文件：不然记模型会把会话状态当模型名读回来（character_for_model 收到 dict 直接崩）
    path = state_dir / (f"{host}-models.json" if host in NAMED_HOSTS else f"{host}-sessions.json")
    model = str(event.get("model") or "")
    if model and sid:
        try:
            state_dir.mkdir(parents=True, exist_ok=True)
            # 同一宿主的几个会话会同时启动：锁住「读旧表 → 加新项 → 替换」整段。
            # 临时文件也按目标文件命名，不能与 update_sessions 的 .qwen-sessions.json 抢同一路径。
            with open(state_dir / f".{host}-models.lock", "a+b") as lock:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    try:
                        known = json.loads(path.read_text())
                    except Exception:
                        known = {}
                    if not isinstance(known, dict):
                        known = {}
                    known[sid] = model
                    known = dict(list(known.items())[-50:])  # 只留最近的会话
                    tmp = state_dir / f".{path.stem}.{os.getpid()}.json"
                    tmp.write_text(json.dumps(known))
                    tmp.replace(path)
                finally:
                    if os.name == "nt":
                        lock.seek(0)
                        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
    try:
        known = json.loads(path.read_text())
    except Exception:
        known = {}
    saved = known.get(sid, "") if isinstance(known, dict) else ""
    if not isinstance(saved, str):
        saved = ""
    return model or saved or fallback or HOST_DEFAULT_MODEL.get(host, "")


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
    if "x.ai" in u:   # api.x.ai
        return "grok"
    return None


def installed(c) -> bool:
    return bool(c) and (characters_dir / c / "character.json").exists() and \
        any((characters_dir / c / f"idle.{ext}").exists() for ext in ("webp", "png"))


# 自己就有角色、但也能接别家接口的：Claude Code（ANTHROPIC_BASE_URL + 别家模型名）、Codex（换了 model_provider）。
# 按模型换成对应的角色，认不出的模型还是由自己来演。Codex 每条事件都带模型名；Claude Code 只在会话开始时给，
# 另外看环境变量里的模型名和接口地址
SELF_HOSTS = ("claude", "gpt")
# 宿主名同时也是角色名的：它们的 <名字>-sessions.json 被多会话状态占用，记模型要另开一个文件（见 remember_session_model）
NAMED_HOSTS = SELF_HOSTS + ("qwen",)
if character in SELF_HOSTS:
    host = character
    # 先看事件里的模型名（Claude Code 会话开始时给的、Codex 每条都给的，是实际要用的那个）；
    # 环境变量只在事件里没有时兜底：CC Switch 之类会把它们写进 settings.json，但 Claude 桌面 App 登录的账号照样走 Anthropic
    env_model = os.environ.get("ANTHROPIC_MODEL", "") if host == "claude" else ""
    model = remember_session_model(host, env_model)
    mapped = character_for_model(model) \
        or (character_for_url(os.environ.get("ANTHROPIC_BASE_URL", "")) if host == "claude" else None)
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
    if "view_image" in t or t in ("find_by_name", "zoom_image"):   # zoom_image：Qwen Code 放大看图
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


# 计数跟原始宿主 + 会话 + 主轮次走，不能让另一段对话的发消息 / Stop 把它清零。
# 没有会话 id 的旧宿主保留一份共享计数；有 id 的宿主即使不带 turn_id 也按会话分开。
turn_file = state_dir / f"{source_host}-turn-tools.json"
turn_key = json.dumps([turn_sid, effective_turn])


def read_tool_counts() -> dict:
    try:
        known = json.loads(turn_file.read_text())
        return known if isinstance(known, dict) else {}
    except Exception:
        return {}


def turn_tools() -> int:
    entry = read_tool_counts().get(turn_key)
    try:
        return int(entry.get("tools", 0)) if isinstance(entry, dict) else 0
    except (TypeError, ValueError):
        return 0


def set_turn_tools(n: int) -> None:
    known = read_tool_counts()
    now = time.time()
    known = {k: v for k, v in known.items() if isinstance(v, dict) and now - float(v.get("ts", 0)) < TURN_KEEP}
    known[turn_key] = {"tools": n, "ts": now}
    known = dict(sorted(known.items(), key=lambda item: item[1].get("ts", 0))[-256:])
    tmp = state_dir / f".{source_host}-turn-tools.{os.getpid()}.json"
    tmp.write_text(json.dumps(known))
    tmp.replace(turn_file)


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
elif name in ("Interrupt", "StopCancelled"):
    # 被你打断（Codex 的 Interrupt、Grok Build 的 StopCancelled）：吓一跳，然后回去待机；网页把 Stop + surprised 当成「被打断」
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

state = {"pose": pose, "event": name, "tool": tool, "ts": time.time(),
         "host": source_host, "session": turn_sid, "turn": effective_turn}
if pose == "thinking" and name in ("PreInvocation", "PostToolUse", "AfterTool"):
    # 快的工具（ls、读文件、grep）从开始到结束常常不到 0.3 秒，桌宠每 0.3 秒才读一次，
    # 刚写的工具动作会被「回去思考」直接盖掉（Antigravity 甚至几毫秒内就开始下一轮思考）。
    # 所以把它捎带上：桌宠先演完那个动作再进入思考；已经演过的（同一个 afterTs）桌宠会跳过。
    try:
        prev = json.loads((state_dir / f"{character}-state.json").read_text())
        if (prev.get("event") == "PreToolUse" and time.time() - float(prev.get("ts", 0)) < 3
                and (prev.get("host"), prev.get("session"), prev.get("turn")) == (source_host, turn_sid, effective_turn)):
            state.update(after=prev.get("pose"), afterTs=prev.get("ts"), tool=prev.get("tool", ""))
    except Exception:
        pass

if name == "SessionStart" and str(event.get("source", "")).lower() in ("compact", "resume"):
    # 压缩 / 恢复不是新的一轮。丢掉它，免得把正在做的动作盖成待机。
    ledger("dropped", "session-restart")
    sys.exit(0)

if pose:
    # 临时文件名带进程号：同一个角色的几个钩子同时写（好几个对话一起干活）时不会抢同一个临时文件
    tmp = state_dir / f".{character}-state.{os.getpid()}.json"
    tmp.write_text(json.dumps(state))
    for attempt in range(8):
        try:
            tmp.replace(state_dir / f"{character}-state.json")
            break
        except PermissionError:
            # Windows 上桌宠可能正读着上一份状态。等一下再换，不要让观察者钩子报错退出。
            if attempt == 7:
                raise
            time.sleep(0.05)


# 同一个 AI 同时开着好几个对话在干活：按会话另外记一份 <角色>-sessions.json（{会话id: {pose, event, ts}}），
# 桌宠看到两个以上同时在干活时演「手忙脚乱」，每个对话一张小卡片。几个钩子可能同时写，用文件锁排队
SESSION_KEEP = 10 * 60   # 多久没动静的会话不再记


def update_sessions(sid: str, entry) -> None:
    path = state_dir / f"{character}-sessions.json"
    with open(state_dir / f".{character}-sessions.lock", "a+") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
        except Exception:
            raise  # 没拿到共享会话锁时不能继续读改写，避免覆盖 Cursor 的卡片。
        try:
            known = json.loads(path.read_text())
        except Exception:
            known = {}
        if not isinstance(known, dict):
            known = {}
        known = {k: v for k, v in known.items() if isinstance(v, dict)}
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

ledger("shown", f"{character} {pose}") if pose else ledger("dropped", "unknown-event")

_event_lock.close()  # 自动启动可能查父进程 / 等系统响应，不让下一条钩子等这一步。

if name in LAUNCH_EVENTS:
    ensure_pet_logged(f"{character} {name}")

if arg_event:
    print("{}")
sys.exit(0)
