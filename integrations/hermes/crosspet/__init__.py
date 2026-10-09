"""CrossPet 桌宠联动（Hermes Agent 插件）。

把 Hermes 的生命周期事件翻译成 CrossPet 钩子脚本认识的事件（Claude Code 那套名字），交给 crosspet-hook.py：
    on_session_start → SessionStart        pre_llm_call（每轮一次）→ UserPromptSubmit
    pre_tool_call → PreToolUse             post_tool_call → PostToolUse
    pre_approval_request / on_human_input_request → 等你回答（Notification permission_prompt）
    post_approval_response / on_human_input_resolved → 回去接着干（PostToolUse）
    subagent_start / subagent_stop → SubagentStart / SubagentStop
    on_session_end（每轮结束）→ Stop；被打断 → Interrupt；出错 → StopFailure
    agent_loop_stopped（网关里 /stop）→ Interrupt
子任务（delegate_task 派出去的）自己的事件不算：只演主对话。
只把事件名、工具名、模型名、会话 id 交给钩子脚本，不传对话内容、命令参数。
钩子脚本在后台线程里按顺序跑，Hermes 不会等它（pre_tool_call 超时会拦下工具，所以绝不能卡住）。
"""
import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _hook_path() -> str:
    """接入工具装插件时把钩子脚本的位置写在 crosspet.json；没有就用各平台的默认位置"""
    try:
        p = json.loads((_HERE / "crosspet.json").read_text(encoding="utf-8")).get("hook")
        if p:
            return p
    except Exception:
        pass
    if os.name == "nt":
        return str(Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "CrossPet" / "crosspet-hook.py")
    return str(Path.home() / "Library/Application Support/CrossPet/crosspet-hook.py")


_queue: "queue.Queue[dict]" = queue.Queue(maxsize=500)
_children: set = set()   # 子任务的会话 id
_models: dict = {}       # 会话 id → 模型名（工具事件不带模型名）
_worker = None


def _run():
    hook = _hook_path()
    flags = 0x08000000 if os.name == "nt" else 0   # CREATE_NO_WINDOW：Windows 上别弹黑框
    while True:
        event = _queue.get()
        try:
            if os.path.exists(hook):
                subprocess.run([sys.executable, hook, "hermes"], input=json.dumps(event).encode("utf-8"),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8, creationflags=flags)
        except Exception:
            pass


def _send(name: str, session_id=None, **fields):
    global _worker
    sid = str(session_id or "")
    if sid and sid in _children:
        return
    model = fields.pop("model", None)
    if model and sid:
        _models[sid] = str(model)
        if len(_models) > 100:
            _models.pop(next(iter(_models)))
    event = {"hook_event_name": name, "session_id": sid, "model": str(model or _models.get(sid, "")), "cwd": os.getcwd()}
    event.update(fields)
    try:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="crosspet-hook", daemon=True)
            _worker.start()
        _queue.put_nowait(event)
    except Exception:
        pass


def _quiet(fn):
    """回调里出什么错都不能影响 Hermes"""
    def wrapper(**kwargs):
        try:
            fn(**kwargs)
        except Exception:
            pass
        return None
    wrapper.__name__ = fn.__name__
    return wrapper


@_quiet
def on_session_start(session_id=None, model=None, **_):
    _send("SessionStart", session_id, model=model)


@_quiet
def pre_llm_call(session_id=None, model=None, **_):
    _send("UserPromptSubmit", session_id, model=model)


@_quiet
def pre_tool_call(tool_name=None, session_id=None, **_):
    _send("PreToolUse", session_id, tool_name=str(tool_name or ""))


@_quiet
def post_tool_call(tool_name=None, session_id=None, result=None, **_):
    failed = False
    try:   # 工具结果是 JSON 字符串，只看有没有 error / success:false，不传内容
        r = json.loads(result) if isinstance(result, str) else result
        failed = isinstance(r, dict) and (bool(r.get("error")) or r.get("success") is False)
    except Exception:
        pass
    _send("PostToolUse", session_id, tool_name=str(tool_name or ""), tool_response={"is_error": failed})


@_quiet
def asking(session_id=None, session_key=None, **_):
    _send("Notification", session_id or session_key, notification_type="permission_prompt")


@_quiet
def answered(session_id=None, session_key=None, **_):
    _send("PostToolUse", session_id or session_key, tool_name="")


@_quiet
def subagent_start(parent_session_id=None, child_session_id=None, **_):
    if child_session_id:
        _children.add(str(child_session_id))
    _send("SubagentStart", parent_session_id)


@_quiet
def subagent_stop(parent_session_id=None, **_):
    _send("SubagentStop", parent_session_id)


@_quiet
def on_session_end(session_id=None, interrupted=False, failed=False, model=None, **_):
    _send("Interrupt" if interrupted else "StopFailure" if failed else "Stop", session_id, model=model)


@_quiet
def agent_loop_stopped(session_key=None, **_):
    _send("Interrupt", session_key)


def register(ctx):
    for name, fn in (("on_session_start", on_session_start), ("pre_llm_call", pre_llm_call),
                     ("pre_tool_call", pre_tool_call), ("post_tool_call", post_tool_call),
                     ("pre_approval_request", asking), ("on_human_input_request", asking),
                     ("post_approval_response", answered), ("on_human_input_resolved", answered),
                     ("subagent_start", subagent_start), ("subagent_stop", subagent_stop),
                     ("on_session_end", on_session_end), ("agent_loop_stopped", agent_loop_stopped)):
        ctx.register_hook(name, fn)
