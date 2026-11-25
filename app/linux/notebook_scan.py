"""Notebook backfill scanner: extract minimal timestamps and model names from local Claude/Codex logs."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping

_USER_TAG = b'"type":"user"'
_ASSISTANT_TAG = b'"type":"assistant"'
_TOOL_RESULT_TAG = b'"tool_result"'


def _millis(s: Any) -> int | None:
    if not isinstance(s, str) or not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        return int(round(dt.timestamp() * 1000))
    except ValueError:
        return None


def claude_wanted(line: bytes) -> bool:
    if _ASSISTANT_TAG in line:
        return True
    return _USER_TAG in line and _TOOL_RESULT_TAG not in line


def claude_event(d: dict[str, Any]) -> dict[str, Any] | None:
    if d.get("isSidechain") is True or d.get("isMeta") is True:
        return None
    t = _millis(d.get("timestamp"))
    msg = d.get("message")
    if t is None or not isinstance(msg, dict):
        return None
    ev_type = d.get("type")
    if ev_type == "user":
        content = msg.get("content")
        if isinstance(content, str):
            return None if content.startswith("<") else {"t": t, "k": "p"}
        if isinstance(content, list):
            if any(isinstance(p, dict) and p.get("type") == "tool_result" for p in content):
                return None
            texts = [
                p.get("text")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str)
            ]
            return {"t": t, "k": "p"} if any(not tx.startswith("<") for tx in texts) else None
        return None
    if ev_type == "assistant":
        model = msg.get("model")
        if not isinstance(model, str) or not model or model == "<synthetic>":
            return None
        return {"t": t, "k": "a", "m": model}
    return None


def claude_events(lines: list[bytes]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in lines:
        if not claude_wanted(line):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            ev = claude_event(obj)
            if ev is not None:
                out.append(ev)
    return out


def codex_events(lines: list[bytes]) -> list[dict[str, Any]]:
    model = ""
    out: list[dict[str, Any]] = []
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict):
            continue
        p = d.get("payload")
        if not isinstance(p, dict):
            continue
        ev_type = d.get("type")
        if ev_type == "turn_context":
            m = p.get("model")
            if isinstance(m, str):
                model = m
            continue
        if ev_type == "event_msg" and p.get("type") in ("task_complete", "turn_aborted"):
            end = _millis(d.get("timestamp"))
            dur = p.get("duration_ms")
            if end is None or not isinstance(dur, (int, float)) or isinstance(dur, bool):
                continue
            out.append({"t": end - int(dur), "k": "r", "m": model, "end": end})
    return out


def jsonl_files(dir_path: Path, recursive: bool) -> list[Path]:
    if not dir_path.is_dir():
        return []
    out: list[Path] = []
    if recursive:
        for root, _, files in os.walk(dir_path):
            for name in files:
                if name.endswith(".jsonl"):
                    out.append(Path(root) / name)
    else:
        try:
            for proj in dir_path.iterdir():
                if not proj.is_dir():
                    continue
                for f in proj.iterdir():
                    if f.is_file() and f.suffix == ".jsonl":
                        out.append(f)
        except OSError:
            pass
    out.sort(key=lambda p: str(p))
    return out


def _read_events(files: list[Path], parse: Callable[[list[bytes]], list[dict[str, Any]]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in files:
        try:
            with open(f, "rb") as fh:
                lines = [l.rstrip(b"\r\n") for l in fh if l.strip(b"\r\n")]
            out.extend(parse(lines))
        except OSError:
            continue
    return out


def scan_all(home: Path | None = None, env: Mapping[str, str] | None = None) -> list[dict[str, Any]]:
    h = home or Path.home()
    e = env if env is not None else os.environ
    claude_dir = Path(e["CLAUDE_CONFIG_DIR"]) if e.get("CLAUDE_CONFIG_DIR") else (h / ".claude")
    codex_dir = Path(e["CODEX_HOME"]) if e.get("CODEX_HOME") else (h / ".codex")
    return [
        {"source": "claude-code", "events": _read_events(jsonl_files(claude_dir / "projects", recursive=False), claude_events)},
        {"source": "codex", "events": _read_events(jsonl_files(codex_dir / "sessions", recursive=True), codex_events)},
    ]
