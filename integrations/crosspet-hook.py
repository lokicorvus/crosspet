#!/usr/bin/env python3
"""CrossPet 通用钩子脚本：把 AI 的工作状态写给桌宠。

用法（在各 AI 的钩子配置里）：
    python3 crosspet-hook.py <角色id>          # 角色id：claude / gpt / deepseek / gemini
钩子事件 JSON 从 stdin 传入。认得 Claude Code、Codex、DeepSeek Harness、Gemini CLI 的事件名。

只写状态目录（默认 /tmp/crosspet，可用环境变量 CROSSPET_STATE_DIR 改）里的两个小文件：
    <角色id>-state.json   当前状态，桌宠读取
    <角色id>-turn.json    本轮用了几次工具（判断「大活」用）
不向 stdout 输出任何东西，不影响 AI 本身的行为。
用 /tmp 是因为有的 AI（比如 DeepSeek Harness）的钩子跑在沙箱里，只允许写 /tmp。
"""
import json
import os
import sys
import time
from pathlib import Path

BIG_JOB_TOOLS = 8  # 一轮里用了这么多次工具，结束时「得意」一下

character = sys.argv[1] if len(sys.argv) > 1 else "claude"
state_dir = Path(os.environ.get("CROSSPET_STATE_DIR", "/tmp/crosspet"))

try:
    event = json.load(sys.stdin)
except Exception:
    sys.exit(0)

name = event.get("hook_event_name", "")
tool = str(event.get("tool_name", "")).lower()
tool_input = json.dumps(event.get("tool_input", ""), ensure_ascii=False).lower()


def pose_for_tool(t: str) -> str:
    # 画图：Codex 内置 image_gen 工具，或用脚本 image_gen.py 生成
    if any(k in t for k in ("image_gen", "imagegen", "generate_image", "draw", "paint")) or "image_gen" in tool_input:
        return "drawing"
    if "view_image" in t:
        return "reading"
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
if name in ("SessionStart",):
    pose = "idle"
elif name in ("UserPromptSubmit", "BeforeAgent"):
    set_turn_tools(0)
    pose = "listening"
elif name in ("PreToolUse", "BeforeTool"):
    set_turn_tools(turn_tools() + 1)
    pose = pose_for_tool(tool)
elif name in ("PostToolUse", "AfterTool"):
    pose = "oops" if tool_failed() else "thinking"
elif name in ("Stop", "AfterAgent"):
    pose = "proud" if turn_tools() >= BIG_JOB_TOOLS else "happy"
    set_turn_tools(0)
elif name in ("SubagentStart",):
    pose = "delegating"
elif name in ("SubagentStop",):
    pose = "thinking"
elif name in ("BeforeModel",):
    pose = "thinking"
elif name in ("SessionEnd",):
    pose = "sleeping"

if pose:
    tmp = state_dir / f".{character}-state.json"
    tmp.write_text(json.dumps({"pose": pose, "event": name, "tool": tool, "ts": time.time()}))
    tmp.replace(state_dir / f"{character}-state.json")
sys.exit(0)
