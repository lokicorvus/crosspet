"""Paths, persistent config, atomic ledger, logging, and bundled resource sync for CrossPet Linux."""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def data_dir() -> Path:
    override = os.environ.get("CROSSPET_DATA_DIR")
    if override:
        return Path(override)
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else (Path.home() / ".local" / "share")
    return base / "crosspet"


def state_dir() -> Path:
    override = os.environ.get("CROSSPET_STATE_DIR")
    if override:
        return Path(override)
    return Path("/tmp/crosspet")


def runtime_socket_path() -> Path:
    override = os.environ.get("CROSSPET_SOCKET")
    if override:
        return Path(override)
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        return Path(xdg) / "crosspet.sock"
    return state_dir() / "control.sock"


def log_path() -> Path:
    return data_dir() / "linux.log"


def repo_root() -> Path:
    override = os.environ.get("CROSSPET_REPO_ROOT")
    if override:
        return Path(override)
    return REPO_ROOT


def current_version() -> str:
    vf = repo_root() / "VERSION"
    try:
        v = vf.read_text(encoding="utf-8").strip()
        if v:
            return v
    except OSError:
        pass
    return "0"


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


class ConfigStore:
    """Thread-safe JSON config store backed by <data_dir>/config.json."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (data_dir() / "config.json")
        self._lock = threading.Lock()
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        try:
            text = self.path.read_text(encoding="utf-8").strip()
            if not text:
                return {}
            obj = json.loads(text)
            return obj if isinstance(obj, dict) else {}
        except (OSError, ValueError):
            return {}

    def reload(self) -> None:
        with self._lock:
            self._data = self._load()

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)

    def get_bool(self, key: str, default: bool = False) -> bool:
        v = self.get(key, None)
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return bool(v)
        return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        v = self.get(key, None)
        if isinstance(v, bool):
            return default
        if isinstance(v, (int, float)):
            return float(v)
        return default

    def get_int(self, key: str, default: int = 0) -> int:
        v = self.get(key, None)
        if isinstance(v, bool):
            return default
        if isinstance(v, (int, float)):
            return int(v)
        return default

    def get_str(self, key: str, default: str | None = None) -> str | None:
        v = self.get(key, None)
        return v if isinstance(v, str) else default

    def get_dict(self, key: str) -> dict[str, Any]:
        v = self.get(key, None)
        return dict(v) if isinstance(v, dict) else {}

    def get_list(self, key: str) -> list[Any]:
        v = self.get(key, None)
        return list(v) if isinstance(v, list) else []

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._save_locked()

    def remove(self, key: str) -> None:
        with self._lock:
            if key in self._data:
                del self._data[key]
                self._save_locked()

    def _save_locked(self) -> None:
        try:
            text = json.dumps(self._data, ensure_ascii=False, indent=2) + "\n"
            _atomic_write_text(self.path, text)
        except OSError:
            pass


class Ledger:
    """Append-only JSONL ledger trimmed to keep recent lines (feedback diagnostics)."""

    _lock = threading.Lock()

    @classmethod
    def append(cls, url: Path, row: dict[str, Any], keep: int = 200) -> None:
        entry = dict(row)
        entry["t"] = round(time.time(), 2)
        try:
            line = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            return
        with cls._lock:
            try:
                url.parent.mkdir(parents=True, exist_ok=True)
                with open(url, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
                rows = url.read_text(encoding="utf-8").splitlines()
                if len(rows) > 240:
                    _atomic_write_text(url, "\n".join(rows[-keep:]) + "\n")
            except OSError:
                pass

    @staticmethod
    def tail(url: Path, n: int) -> str:
        try:
            lines = url.read_text(encoding="utf-8").split("\n")
        except OSError:
            return ""
        return "\n".join(lines[-n:]) if n > 0 else ""


_log_lock = threading.Lock()


def app_log(text: str, path: Path | None = None) -> None:
    target = path or log_path()
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{stamp} {text}\n"
    with _log_lock:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and target.stat().st_size > 1_000_000:
                target.unlink()
            with open(target, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass


def _copy_replace(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.is_symlink() or dst.is_file():
        dst.unlink()
    elif dst.is_dir():
        shutil.rmtree(dst)
    if src.is_dir():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", "raw"))
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def sync_bundled_resources(root: Path | None = None, src_root: Path | None = None) -> None:
    """Sync web/, hook scripts, bundled characters, and installed plugins into data_dir()."""
    dst_root = root or data_dir()
    src = src_root or repo_root()
    dst_root.mkdir(parents=True, exist_ok=True)
    chars_dir = dst_root / "characters"
    chars_dir.mkdir(parents=True, exist_ok=True)

    _copy_replace(src / "app" / "web", dst_root / "web")
    _copy_replace(src / "integrations" / "crosspet-hook.py", dst_root / "crosspet-hook.py")

    apps_dst = dst_root / "linux-apps.json"
    apps_src = src / "app" / "linux" / "apps.json"
    if not apps_dst.exists() and apps_src.exists():
        shutil.copy2(apps_src, apps_dst)

    cursor_dst = dst_root / "crosspet-cursor-bridge.py"
    cursor_src = src / "integrations" / "cursor" / "crosspet-cursor-bridge.py"
    if cursor_dst.exists() and cursor_src.exists():
        _copy_replace(cursor_src, cursor_dst)

    claude_cfg = Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude"))
    mods_dst = claude_cfg / "mods" / "crosspet"
    mod_src = src / "integrations" / "claude-code" / "mod"
    if mods_dst.exists() and mod_src.exists():
        _copy_replace(mod_src, mods_dst)

    dsh_dst = dst_root / "dsh-plugin-crosspet"
    dsh_src = src / "integrations" / "deepseek" / "dsh-plugin-crosspet"
    if dsh_dst.exists() and dsh_src.exists():
        _copy_replace(dsh_src, dsh_dst)

    bundled_chars = src / "characters"
    if bundled_chars.is_dir():
        for entry in sorted(bundled_chars.iterdir()):
            if entry.is_dir():
                _copy_replace(entry, chars_dir / entry.name)
