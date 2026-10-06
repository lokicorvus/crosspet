#!/usr/bin/env python3
"""CrossPet 通用钩子脚本：把 AI 的工作状态写给桌宠。

用法（在各 AI 的钩子配置里）：
    python3 crosspet-hook.py <角色id>          # 角色id：claude / gpt / deepseek / gemini
    python3 crosspet-hook.py <角色id> <事件名>  # 事件 JSON 里不带事件名的（Antigravity）
    python3 crosspet-hook.py workbuddy          # 一个程序里能用好几家模型（WorkBuddy、ZCode）：按模型选角色
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

try:
    # 按 UTF-8 读：Windows 上 Python 默认用系统编码（中文系统是 GBK），事件里一有中文就会解码失败
    event = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace"))
except Exception:
    sys.exit(0)

# 多模型宿主（WorkBuddy）：每条事件都带当前模型名，按它选角色；认不出的模型（混元、Kimi、GLM……）
# 写给「当前角色」（current），桌宠用正在显示的角色演，不换人。当前角色另外记在 <宿主>-host.json，
# 桌宠切到这个程序的窗口时按它换角色
MULTI_MODEL_HOSTS = ("workbuddy", "zcode")
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


def remember_session_model(host: str) -> str:
    """有的宿主只在会话开始时给模型名：记下来（按会话 id），之后的事件查它"""
    sid = str(event.get("session_id") or event.get("sessionId") or "")
    path = state_dir / f"{host}-sessions.json"
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
    return model or known.get(sid, "") or HOST_DEFAULT_MODEL.get(host, "")


if character in MULTI_MODEL_HOSTS:
    host = character
    model = remember_session_model(host)
    mapped = character_for_model(model)
    # 对应的角色还没装（比如还没画立绘的新角色）：当成认不出的模型，由当前角色来演
    if mapped and not ((characters_dir / mapped / "character.json").exists()
                       and any((characters_dir / mapped / f"idle.{ext}").exists() for ext in ("webp", "png"))):
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
ASKING_TOOLS = ("askuserquestion", "request_user_input", "ask_user_question", "ask_user", "ask_question")
# Notification 里表示「在等你授权 / 等你填」的类型（Claude Code、Gemini CLI、WorkBuddy）；idle_prompt 是一轮做完后闲着，不算
ASKING_NOTIFICATIONS = ("permission_prompt", "elicitation_dialog", "toolpermission", "agent_needs_input")


def pose_for_tool(t: str) -> str:
    if t in ASKING_TOOLS:
        return "asking"
    # 画图：Codex 内置 image_gen 工具，或用脚本 image_gen.py 生成
    if any(k in t for k in ("image_gen", "imagegen", "generate_image", "draw", "paint")) or "image_gen" in tool_input:
        return "drawing"
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
elif name in ("PreCompact", "PreCompress"):
    pose = "compact"  # 压缩上下文：把一大堆东西往小箱子里塞
elif name in ("PostCompact",):
    pose = "thinking"
elif name in ("SubagentStart",):
    pose = "delegating"
elif name in ("SubagentStop",):
    pose = "thinking"
elif name in ("BeforeModel", "PreInvocation"):
    pose = "thinking"
elif name in ("SessionEnd",):
    pose = "sleeping"

state = {"pose": pose, "event": name, "tool": tool, "ts": time.time()}
if pose and name == "PreInvocation":
    # Antigravity 工具一结束就（几毫秒内）开始下一轮思考，桌宠每 0.3 秒才读一次，
    # 刚写的工具动作会被直接盖掉。所以把它捎带上：桌宠先演完那个动作再进入思考。
    try:
        prev = json.loads((state_dir / f"{character}-state.json").read_text())
        if prev.get("event") == "PreToolUse" and time.time() - float(prev.get("ts", 0)) < 3:
            state.update(after=prev.get("pose"), afterTs=prev.get("ts"), tool=prev.get("tool", ""))
    except Exception:
        pass

if pose:
    tmp = state_dir / f".{character}-state.json"
    tmp.write_text(json.dumps(state))
    tmp.replace(state_dir / f"{character}-state.json")
if arg_event:
    print("{}")
sys.exit(0)
