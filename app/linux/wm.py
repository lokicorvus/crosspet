"""Window manager integration (Hyprland, Sway, Niri, X11, Generic) and control IPC server."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import struct
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .paths import runtime_socket_path
from .placement import Rect

TERMINAL_CLASSES = frozenset({
    "kitty",
    "alacritty",
    "foot",
    "footclient",
    "wezterm",
    "org.wezfurlong.wezterm",
    "ghostty",
    "com.mitchellh.ghostty",
    "gnome-terminal",
    "gnome-terminal-server",
    "org.gnome.terminal",
    "org.gnome.console",
    "kgx",
    "konsole",
    "xfce4-terminal",
    "xterm",
    "urxvt",
    "rxvt",
    "st",
    "st-256color",
    "tilix",
    "terminator",
    "rio",
    "warp",
    "dev.warp.warp",
    "code",
    "code-oss",
    "vscodium",
    "zed",
    "dev.zed.zed",
    "tmux",
})


@dataclass(frozen=True)
class MonitorRect:
    name: str
    x: float
    y: float
    w: float
    h: float
    work_x: float
    work_y: float
    work_w: float
    work_h: float
    scale: float = 1.0
    focused: bool = False
    monitor_id: int = 0
    active_workspace_id: int | None = None

    @property
    def frame(self) -> Rect:
        return Rect(self.x, self.y, self.w, self.h)

    @property
    def work_area(self) -> Rect:
        return Rect(self.work_x, self.work_y, self.work_w, self.work_h)


@dataclass(frozen=True)
class ActiveWindow:
    win_class: str
    initial_class: str = ""
    title: str = ""
    pid: int = 0
    fullscreen: bool = False
    monitor_name: str = ""

    @property
    def identifiers(self) -> list[str]:
        out: list[str] = []
        for raw in (self.win_class, self.initial_class):
            s = raw.strip().lower()
            if s and s not in out:
                out.append(s)
        if self.pid > 0:
            comm = _proc_comm(self.pid)
            if comm and comm not in out:
                out.append(comm)
        return out


def _proc_comm(pid: int) -> str:
    try:
        return Path(f"/proc/{pid}/comm").read_text(encoding="utf-8", errors="ignore").strip().lower()
    except OSError:
        return ""


def scan_proc_names() -> set[str]:
    """Return lowercase process names from /proc/*/comm (ignoring errors)."""
    names: set[str] = set()
    try:
        for entry in os.scandir("/proc"):
            if not entry.name.isdigit():
                continue
            try:
                comm = (Path(entry.path) / "comm").read_text(encoding="utf-8", errors="ignore").strip().lower()
                if comm:
                    names.add(comm)
            except OSError:
                continue
    except OSError:
        pass
    return names


def _idle_dispatch(fn: Callable[[], None]) -> None:
    try:
        from gi.repository import GLib

        GLib.idle_add(lambda: (fn(), False)[1])
    except Exception:
        fn()


class WMBackend:
    """Base interface for compositor / window manager integrations."""

    name = "generic"

    def active_window(self) -> ActiveWindow | None:
        return None

    def is_fullscreen_on(self, monitor_name: str | None = None) -> bool:
        win = self.active_window()
        if not win or not win.fullscreen:
            return False
        if monitor_name and win.monitor_name:
            return win.monitor_name == monitor_name
        return True

    def monitors(self) -> list[MonitorRect]:
        try:
            import gi

            gi.require_version("Gdk", "3.0")
            from gi.repository import Gdk

            display = Gdk.Display.get_default()
            if display is None:
                return []
            out: list[MonitorRect] = []
            for i in range(display.get_n_monitors()):
                m = display.get_monitor(i)
                g = m.get_geometry()
                wa = m.get_workarea()
                out.append(
                    MonitorRect(
                        name=m.get_model() or f"monitor-{i}",
                        x=float(g.x),
                        y=float(g.y),
                        w=float(g.width),
                        h=float(g.height),
                        work_x=float(wa.x),
                        work_y=float(wa.y),
                        work_w=float(wa.width),
                        work_h=float(wa.height),
                        scale=float(m.get_scale_factor() or 1.0),
                        focused=m.is_primary(),
                        monitor_id=i,
                    )
                )
            return out
        except Exception:
            return []

    def cursor_pos(self) -> tuple[float, float] | None:
        try:
            import gi

            gi.require_version("Gdk", "3.0")
            from gi.repository import Gdk

            display = Gdk.Display.get_default()
            if display is None:
                return None
            seat = display.get_default_seat()
            if seat is None:
                return None
            ptr = seat.get_pointer()
            if ptr is None:
                return None
            _, x, y = ptr.get_position()
            return float(x), float(y)
        except Exception:
            return None

    def running_classes(self) -> set[str]:
        return scan_proc_names()

    def start_events(self, on_change: Callable[[str], None]) -> None:
        pass

    def stop(self) -> None:
        pass

    def register_hotkey(self, hotkey_id: str, callback: Callable[[], None]) -> bool:
        """Register native global hotkey if supported (returns True on success)."""
        return False

    def unregister_hotkey(self) -> None:
        pass


class HyprlandBackend(WMBackend):
    """Native Hyprland IPC backend via .socket.sock and .socket2.sock."""

    name = "hyprland"

    def __init__(
        self,
        signature: str | None = None,
        socket_path: Path | None = None,
        event_socket_path: Path | None = None,
        dispatcher: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        self.signature = signature or os.environ.get("HYPRLAND_INSTANCE_SIGNATURE", "")
        self._sock_path = socket_path
        self._ev_sock_path = event_socket_path
        self._dispatch = dispatcher or _idle_dispatch
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _resolve_socket(self, filename: str) -> Path | None:
        if filename == ".socket.sock" and self._sock_path is not None:
            return self._sock_path
        if filename == ".socket2.sock" and self._ev_sock_path is not None:
            return self._ev_sock_path
        if not self.signature:
            return None
        candidates = []
        xdg = os.environ.get("XDG_RUNTIME_DIR")
        if xdg:
            candidates.append(Path(xdg) / "hypr" / self.signature / filename)
        candidates.append(Path("/tmp/hypr") / self.signature / filename)
        for p in candidates:
            if p.exists():
                return p
        return candidates[0] if candidates else None

    def _query(self, command: str, timeout: float = 1.0) -> str | None:
        sock_path = self._resolve_socket(".socket.sock")
        if sock_path is None or not sock_path.exists():
            return None
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                s.connect(str(sock_path))
                s.sendall(command.encode("utf-8"))
                chunks: list[bytes] = []
                while True:
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                return b"".join(chunks).decode("utf-8", errors="replace")
        except OSError:
            return None

    def _query_json(self, command: str, timeout: float = 1.0) -> Any:
        raw = self._query(command, timeout=timeout)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def monitors(self) -> list[MonitorRect]:
        data = self._query_json("j/monitors")
        if not isinstance(data, list):
            return super().monitors()
        out: list[MonitorRect] = []
        for idx, m in enumerate(data):
            if not isinstance(m, dict) or m.get("disabled"):
                continue
            scale = float(m.get("scale") or 1.0)
            if scale <= 0:
                scale = 1.0
            raw_w = float(m.get("width") or 0)
            raw_h = float(m.get("height") or 0)
            transform = int(m.get("transform") or 0)
            if transform in (1, 3, 5, 7):
                raw_w, raw_h = raw_h, raw_w
            w = raw_w / scale
            h = raw_h / scale
            x = float(m.get("x") or 0)
            y = float(m.get("y") or 0)
            res = m.get("reserved") or [0, 0, 0, 0]
            rl = float(res[0]) if len(res) > 0 else 0.0
            rt = float(res[1]) if len(res) > 1 else 0.0
            rr = float(res[2]) if len(res) > 2 else 0.0
            rb = float(res[3]) if len(res) > 3 else 0.0
            ws = m.get("activeWorkspace")
            ws_id = int(ws["id"]) if isinstance(ws, dict) and isinstance(ws.get("id"), int) else None
            out.append(
                MonitorRect(
                    name=str(m.get("name") or f"monitor-{idx}"),
                    x=x,
                    y=y,
                    w=w,
                    h=h,
                    work_x=x + rl,
                    work_y=y + rt,
                    work_w=max(1.0, w - rl - rr),
                    work_h=max(1.0, h - rt - rb),
                    scale=scale,
                    focused=bool(m.get("focused", False)),
                    monitor_id=int(m.get("id") if isinstance(m.get("id"), int) else idx),
                    active_workspace_id=ws_id,
                )
            )
        return out or super().monitors()

    def active_window(self) -> ActiveWindow | None:
        data = self._query_json("j/activewindow")
        if not isinstance(data, dict) or not data:
            return None
        win_class = str(data.get("class") or "")
        init_class = str(data.get("initialClass") or "")
        title = str(data.get("title") or "")
        pid = int(data.get("pid") or 0)
        full = bool(data.get("fullscreen") or data.get("fullscreenClient"))
        mon = data.get("monitor")
        mon_name = ""
        if isinstance(mon, str):
            mon_name = mon
        elif isinstance(mon, int):
            for m in self.monitors():
                if m.monitor_id == mon:
                    mon_name = m.name
                    break
        if not (win_class or init_class or pid):
            return None
        return ActiveWindow(
            win_class=win_class,
            initial_class=init_class,
            title=title,
            pid=pid,
            fullscreen=full,
            monitor_name=mon_name,
        )

    def is_fullscreen_on(self, monitor_name: str | None = None) -> bool:
        mons = self.monitors()
        target_mon: MonitorRect | None = None
        if monitor_name:
            target_mon = next((m for m in mons if m.name == monitor_name), None)
        if target_mon is None:
            target_mon = next((m for m in mons if m.focused), mons[0] if mons else None)

        if target_mon is not None and target_mon.active_workspace_id is not None:
            workspaces = self._query_json("j/workspaces")
            if isinstance(workspaces, list):
                for ws in workspaces:
                    if isinstance(ws, dict) and ws.get("id") == target_mon.active_workspace_id:
                        if ws.get("hasfullscreen"):
                            return True
                        # Even if activeworkspace matches, fallback check false unless activewindow says fullscreen
                        break
        win = self.active_window()
        if not win or not win.fullscreen:
            return False
        if target_mon and win.monitor_name:
            return win.monitor_name == target_mon.name
        return True

    def cursor_pos(self) -> tuple[float, float] | None:
        raw = self._query("cursorpos")
        if raw:
            m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", raw.strip())
            if m:
                return float(m.group(1)), float(m.group(2))
        return super().cursor_pos()

    def running_classes(self) -> set[str]:
        out = scan_proc_names()
        clients = self._query_json("j/clients")
        if isinstance(clients, list):
            for c in clients:
                if not isinstance(c, dict):
                    continue
                for k in ("class", "initialClass"):
                    val = str(c.get(k) or "").strip().lower()
                    if val:
                        out.add(val)
                pid = int(c.get("pid") or 0)
                if pid > 0:
                    comm = _proc_comm(pid)
                    if comm:
                        out.add(comm)
        return out

    def start_events(self, on_change: Callable[[str], None]) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()

        def loop() -> None:
            interesting = (
                "activewindow>>",
                "activewindowv2>>",
                "fullscreen>>",
                "workspace>>",
                "focusedmon>>",
                "openwindow>>",
                "closewindow>>",
                "monitoradded>>",
                "monitorremoved>>",
            )
            backoff = 0.5
            while not self._stop_event.is_set():
                ev_path = self._resolve_socket(".socket2.sock")
                if ev_path is None or not ev_path.exists():
                    self._stop_event.wait(1.0)
                    continue
                try:
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                        s.settimeout(2.0)
                        s.connect(str(ev_path))
                        backoff = 0.5
                        buf = ""
                        while not self._stop_event.is_set():
                            try:
                                chunk = s.recv(4096)
                            except socket.timeout:
                                continue
                            if not chunk:
                                break
                            buf += chunk.decode("utf-8", errors="replace")
                            while "\n" in buf:
                                line, buf = buf.split("\n", 1)
                                line = line.strip()
                                if line.startswith(interesting):
                                    ev_name = line.split(">>", 1)[0]
                                    self._dispatch(lambda ev=ev_name: on_change(ev))
                except OSError:
                    pass
                self._stop_event.wait(backoff)
                backoff = min(5.0, backoff * 1.5)

        self._thread = threading.Thread(target=loop, name="crosspet-hypr-events", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()


class SwayBackend(WMBackend):
    """Native Sway / i3 IPC backend via SWAYSOCK / I3SOCK."""

    name = "sway"
    _MAGIC = b"i3-ipc"

    def __init__(
        self,
        sock_path: Path | None = None,
        dispatcher: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        raw = os.environ.get("SWAYSOCK") or os.environ.get("I3SOCK") or ""
        self._sock_path = sock_path or (Path(raw) if raw else None)
        self._dispatch = dispatcher or _idle_dispatch
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _ipc(self, msg_type: int, payload: bytes = b"", timeout: float = 1.0) -> Any:
        if self._sock_path is None or not self._sock_path.exists():
            return None
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                s.connect(str(self._sock_path))
                s.sendall(self._MAGIC + struct.pack("<II", len(payload), msg_type) + payload)
                hdr = self._recv_exact(s, 14)
                if not hdr or not hdr.startswith(self._MAGIC):
                    return None
                length, _ = struct.unpack("<II", hdr[6:14])
                body = self._recv_exact(s, length)
                return json.loads(body.decode("utf-8", errors="replace")) if body else None
        except (OSError, ValueError):
            return None

    @staticmethod
    def _recv_exact(s: socket.socket, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = s.recv(n - len(buf))
            if not chunk:
                return b""
            buf.extend(chunk)
        return bytes(buf)

    @staticmethod
    def _walk_nodes(node: dict[str, Any]):
        yield node
        for key in ("nodes", "floating_nodes"):
            for child in node.get(key) or []:
                if isinstance(child, dict):
                    yield from SwayBackend._walk_nodes(child)

    def monitors(self) -> list[MonitorRect]:
        outputs = self._ipc(3)  # GET_OUTPUTS
        if not isinstance(outputs, list):
            return super().monitors()
        out: list[MonitorRect] = []
        for idx, o in enumerate(outputs):
            if not isinstance(o, dict) or not o.get("active", True):
                continue
            rect = o.get("rect") or {}
            x = float(rect.get("x") or 0)
            y = float(rect.get("y") or 0)
            w = float(rect.get("width") or 0)
            h = float(rect.get("height") or 0)
            if w <= 0 or h <= 0:
                continue
            out.append(
                MonitorRect(
                    name=str(o.get("name") or f"output-{idx}"),
                    x=x,
                    y=y,
                    w=w,
                    h=h,
                    work_x=x,
                    work_y=y,
                    work_w=w,
                    work_h=h,
                    scale=float(o.get("scale") or 1.0),
                    focused=bool(o.get("focused", False)),
                    monitor_id=idx,
                )
            )
        return out or super().monitors()

    def active_window(self) -> ActiveWindow | None:
        tree = self._ipc(4)  # GET_TREE
        if not isinstance(tree, dict):
            return None
        current_output = ""
        for node in self._walk_nodes(tree):
            if node.get("focused"):
                app_id = str(node.get("app_id") or "")
                wp = node.get("window_properties") or {}
                w_class = str(wp.get("class") or "")
                title = str(node.get("name") or "")
                pid = int(node.get("pid") or 0)
                full = bool(node.get("fullscreen_mode") or 0)
                if not (app_id or w_class or pid):
                    return None
                return ActiveWindow(
                    win_class=app_id or w_class,
                    initial_class=w_class or app_id,
                    title=title,
                    pid=pid,
                    fullscreen=full,
                    monitor_name=current_output,
                )
            if node.get("type") == "output":
                current_output = str(node.get("name") or "")
        return None

    def running_classes(self) -> set[str]:
        out = scan_proc_names()
        tree = self._ipc(4)
        if isinstance(tree, dict):
            for node in self._walk_nodes(tree):
                app_id = str(node.get("app_id") or "").strip().lower()
                if app_id:
                    out.add(app_id)
                wp = node.get("window_properties") or {}
                w_class = str(wp.get("class") or "").strip().lower()
                if w_class:
                    out.add(w_class)
        return out

    def start_events(self, on_change: Callable[[str], None]) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()

        def loop() -> None:
            while not self._stop_event.is_set():
                if self._sock_path is None or not self._sock_path.exists():
                    self._stop_event.wait(1.0)
                    continue
                try:
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                        s.settimeout(2.0)
                        s.connect(str(self._sock_path))
                        payload = b'["window","workspace"]'
                        s.sendall(self._MAGIC + struct.pack("<II", len(payload), 2) + payload)
                        _ = self._recv_exact(s, 14)
                        while not self._stop_event.is_set():
                            try:
                                hdr = self._recv_exact(s, 14)
                            except socket.timeout:
                                continue
                            if not hdr or not hdr.startswith(self._MAGIC):
                                break
                            length, _ = struct.unpack("<II", hdr[6:14])
                            _ = self._recv_exact(s, length)
                            self._dispatch(lambda: on_change("sway-event"))
                except OSError:
                    pass
                self._stop_event.wait(1.0)

        self._thread = threading.Thread(target=loop, name="crosspet-sway-events", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()


class NiriBackend(WMBackend):
    """Native Niri IPC backend via NIRI_SOCKET."""

    name = "niri"

    def __init__(self, sock_path: Path | None = None) -> None:
        raw = os.environ.get("NIRI_SOCKET", "")
        self._sock_path = sock_path or (Path(raw) if raw else None)

    def _request(self, req: str, timeout: float = 1.0) -> Any:
        if self._sock_path is None or not self._sock_path.exists():
            return None
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                s.connect(str(self._sock_path))
                s.sendall((json.dumps(req) + "\n").encode("utf-8"))
                line = s.makefile("r", encoding="utf-8", errors="replace").readline()
                if not line:
                    return None
                resp = json.loads(line)
                return resp.get("Ok") if isinstance(resp, dict) else None
        except (OSError, ValueError):
            return None

    def active_window(self) -> ActiveWindow | None:
        ok = self._request("FocusedWindow")
        win = ok.get("FocusedWindow") if isinstance(ok, dict) else None
        if not isinstance(win, dict):
            return None
        app_id = str(win.get("app_id") or "")
        title = str(win.get("title") or "")
        pid = int(win.get("pid") or 0)
        if not (app_id or pid):
            return None
        return ActiveWindow(win_class=app_id, initial_class=app_id, title=title, pid=pid)

    def running_classes(self) -> set[str]:
        out = scan_proc_names()
        ok = self._request("Windows")
        wins = ok.get("Windows") if isinstance(ok, dict) else None
        if isinstance(wins, list):
            for w in wins:
                if isinstance(w, dict):
                    app_id = str(w.get("app_id") or "").strip().lower()
                    if app_id:
                        out.add(app_id)
        return out


class X11Backend(WMBackend):
    """X11 EWMH backend (i3, bspwm, dwm, XFCE, KDE-X11) with optional XGrabKey global hotkeys."""

    name = "x11"

    def __init__(self, dispatcher: Callable[[Callable[[], None]], None] | None = None) -> None:
        self._has_xprop = shutil.which("xprop") is not None
        self._dispatch = dispatcher or _idle_dispatch
        self._hk_stop = threading.Event()
        self._hk_thread: threading.Thread | None = None

    @staticmethod
    def _run_xprop(args: list[str]) -> str:
        try:
            res = subprocess.run(["xprop", *args], capture_output=True, text=True, timeout=0.6)
            return res.stdout if res.returncode == 0 else ""
        except Exception:
            return ""

    def active_window(self) -> ActiveWindow | None:
        if not self._has_xprop:
            return None
        root_out = self._run_xprop(["-root", "_NET_ACTIVE_WINDOW"])
        m = re.search(r"0x[0-9a-fA-F]+", root_out)
        if not m or m.group(0) == "0x0":
            return None
        wid = m.group(0)
        info = self._run_xprop(["-id", wid, "WM_CLASS", "_NET_WM_PID", "_NET_WM_STATE", "_NET_WM_NAME"])
        if not info:
            return None
        classes = re.findall(r'"([^"]+)"', next((l for l in info.splitlines() if "WM_CLASS" in l), ""))
        win_class = classes[-1] if classes else ""
        init_class = classes[0] if classes else ""
        pid_m = re.search(r"_NET_WM_PID.*?=\s*(\d+)", info)
        pid = int(pid_m.group(1)) if pid_m else 0
        full = "_NET_WM_STATE_FULLSCREEN" in info
        if not (win_class or init_class or pid):
            return None
        return ActiveWindow(win_class=win_class, initial_class=init_class, pid=pid, fullscreen=full)

    def running_classes(self) -> set[str]:
        out = scan_proc_names()
        if not self._has_xprop:
            return out
        clist = self._run_xprop(["-root", "_NET_CLIENT_LIST"])
        for wid in re.findall(r"0x[0-9a-fA-F]+", clist)[:64]:
            info = self._run_xprop(["-id", wid, "WM_CLASS"])
            for c in re.findall(r'"([^"]+)"', info):
                if c.strip():
                    out.add(c.strip().lower())
        return out

    def unregister_hotkey(self) -> None:
        self._hk_stop.set()
        if self._hk_thread is not None and self._hk_thread.is_alive():
            self._hk_thread.join(timeout=0.5)
        self._hk_thread = None

    def register_hotkey(self, hotkey_id: str, callback: Callable[[], None]) -> bool:
        self.unregister_hotkey()
        if hotkey_id not in ("p", "h"):
            return True
        if not os.environ.get("DISPLAY"):
            return False
        try:
            import ctypes
            import ctypes.util

            lib_name = ctypes.util.find_library("X11")
            if not lib_name:
                return False
            x11 = ctypes.CDLL(lib_name)

            class XKeyEvent(ctypes.Structure):
                _fields_ = [
                    ("type", ctypes.c_int),
                    ("serial", ctypes.c_ulong),
                    ("send_event", ctypes.c_int),
                    ("display", ctypes.c_void_p),
                    ("window", ctypes.c_ulong),
                    ("root", ctypes.c_ulong),
                    ("subwindow", ctypes.c_ulong),
                    ("time", ctypes.c_ulong),
                    ("x", ctypes.c_int),
                    ("y", ctypes.c_int),
                    ("x_root", ctypes.c_int),
                    ("y_root", ctypes.c_int),
                    ("state", ctypes.c_uint),
                    ("keycode", ctypes.c_uint),
                    ("same_screen", ctypes.c_int),
                ]

            class XEvent(ctypes.Union):
                _fields_ = [("type", ctypes.c_int), ("xkey", XKeyEvent), ("pad", ctypes.c_long * 24)]

            x11.XOpenDisplay.restype = ctypes.c_void_p
            x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
            x11.XDefaultRootWindow.restype = ctypes.c_ulong
            x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            x11.XKeysymToKeycode.restype = ctypes.c_uint
            x11.XGrabKey.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_int]
            x11.XPending.argtypes = [ctypes.c_void_p]
            x11.XPending.restype = ctypes.c_int
            x11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
            x11.XCloseDisplay.argtypes = [ctypes.c_void_p]

            dpy = x11.XOpenDisplay(None)
            if not dpy:
                return False
            root = x11.XDefaultRootWindow(dpy)
            keysym = 0x0070 if hotkey_id == "p" else 0x0068  # XK_p / XK_h
            keycode = x11.XKeysymToKeycode(dpy, keysym)
            if not keycode:
                x11.XCloseDisplay(dpy)
                return False
            mod_ctrl_alt = (1 << 2) | (1 << 3)  # ControlMask | Mod1Mask
            for extra in (0, 1 << 1, 1 << 4, (1 << 1) | (1 << 4)):  # ignore LockMask / Mod2Mask
                x11.XGrabKey(dpy, int(keycode), mod_ctrl_alt | extra, root, 1, 1, 1)

            self._hk_stop.clear()

            def loop() -> None:
                ev = XEvent()
                try:
                    while not self._hk_stop.is_set():
                        if x11.XPending(dpy) > 0:
                            x11.XNextEvent(dpy, ctypes.byref(ev))
                            if ev.type == 2:  # KeyPress
                                self._dispatch(callback)
                        else:
                            self._hk_stop.wait(0.05)
                finally:
                    x11.XCloseDisplay(dpy)

            self._hk_thread = threading.Thread(target=loop, name="crosspet-x11-hotkey", daemon=True)
            self._hk_thread.start()
            return True
        except Exception:
            return False

    def stop(self) -> None:
        self.unregister_hotkey()


class GenericBackend(WMBackend):
    name = "generic"


def detect_wm_backend(dispatcher: Callable[[Callable[[], None]], None] | None = None) -> WMBackend:
    """Detect active compositor / WM backend."""
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        return HyprlandBackend(dispatcher=dispatcher)
    if os.environ.get("SWAYSOCK") or os.environ.get("I3SOCK"):
        return SwayBackend(dispatcher=dispatcher)
    if os.environ.get("NIRI_SOCKET"):
        return NiriBackend()
    session = os.environ.get("XDG_SESSION_TYPE", "").lower()
    if session == "x11" or (os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY")):
        return X11Backend(dispatcher=dispatcher)
    return GenericBackend()


class ControlServer:
    """Single-instance Unix domain socket control server for CLI flags & Hyprland binds."""

    def __init__(
        self,
        handler: Callable[[str], dict[str, Any]],
        sock_path: Path | None = None,
        dispatcher: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        self.sock_path = sock_path or runtime_socket_path()
        self._handler = handler
        self._dispatch = dispatcher or _idle_dispatch
        self._stop = threading.Event()
        self._sock: socket.socket | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self.sock_path.parent.mkdir(parents=True, exist_ok=True)
        if self.sock_path.exists():
            try:
                self.sock_path.unlink()
            except OSError:
                pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(str(self.sock_path))
        srv.listen(8)
        srv.settimeout(0.5)
        self._sock = srv
        self._stop.clear()

        def serve() -> None:
            while not self._stop.is_set():
                try:
                    conn, _ = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                with conn:
                    try:
                        conn.settimeout(2.0)
                        raw = conn.recv(4096).decode("utf-8", errors="replace").strip()
                        cmd = raw.splitlines()[0].strip() if raw else "ping"
                        done = threading.Event()
                        result: dict[str, Any] = {"ok": False}

                        def run_on_main() -> None:
                            try:
                                result.clear()
                                result.update(self._handler(cmd))
                            except Exception as exc:
                                result.clear()
                                result.update({"ok": False, "error": str(exc)})
                            finally:
                                done.set()

                        self._dispatch(run_on_main)
                        done.wait(timeout=3.0)
                        conn.sendall((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
                    except OSError:
                        pass

        self._thread = threading.Thread(target=serve, name="crosspet-ipc", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        try:
            if self.sock_path.exists():
                self.sock_path.unlink()
        except OSError:
            pass


def send_control_command(cmd: str, sock_path: Path | None = None, timeout: float = 1.5) -> dict[str, Any] | None:
    """Send a control command to a running CrossPet instance; returns None if not running."""
    path = sock_path or runtime_socket_path()
    if not path.exists():
        return None
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(str(path))
            s.sendall((cmd.strip() + "\n").encode("utf-8"))
            data = s.makefile("r", encoding="utf-8", errors="replace").readline()
            if not data:
                return {"ok": True}
            obj = json.loads(data)
            return obj if isinstance(obj, dict) else {"ok": True}
    except (OSError, ValueError):
        return None
