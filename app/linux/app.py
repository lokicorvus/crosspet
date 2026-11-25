"""Main CrossPet Linux application controller."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

from .companion import Companion
from .notebook_scan import scan_all as scan_notebook_history
from .paths import (
    ConfigStore,
    Ledger,
    app_log,
    current_version,
    data_dir,
    log_path,
    repo_root,
    state_dir,
    sync_bundled_resources,
)
from .placement import (
    HEAD_ROOM,
    Rect,
    companion_pick,
    dock_busy,
    dock_clamp_y,
    dock_edge_x,
    dock_side,
    is_newer,
    notebook_frame,
    place_window,
    tuck_x,
    yield_next,
)
from .quota import AntigravityQuota, CodexQuotaSource
from .tray import TrayIcon
from .window import PetSurface, create_shared_web_context, create_webview, eval_js
from .wm import (
    TERMINAL_CLASSES,
    ActiveWindow,
    ControlServer,
    MonitorRect,
    detect_wm_backend,
)


def _js_quote(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def _hm(ts: float) -> str:
    return time.strftime("%H:%M", time.localtime(ts))


def _clock(ts: float | None = None) -> str:
    return time.strftime("%m-%d %H:%M", time.localtime(ts if ts is not None else time.time()))


def _ago_text(ts: float | None) -> str:
    if ts is None:
        return "从没收到"
    d = time.time() - ts
    if d >= 86400:
        return f"{int(d / 86400)} 天前"
    if d >= 3600:
        return f"{int(d / 3600)} 小时前"
    if d >= 60:
        return f"{int(d / 60)} 分钟前"
    return "刚刚"


def _os_summary() -> str:
    pretty = ""
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("PRETTY_NAME="):
                pretty = line.split("=", 1)[1].strip().strip('"')
                break
    except OSError:
        pass
    arch = platform.machine() or "x86_64"
    return f"{pretty or 'Linux'} {arch}"


class CrossPetApp:
    """Main Linux shell matching macOS App.swift + Windows Pet.cs feature-for-feature."""

    BASE_W = 260.0
    BASE_H = 362.0
    REPO_SLUG = "lokicorvus/crosspet"
    FEEDBACK_ENDPOINT = "https://open.feishu.cn/open-apis/bot/v2/hook/854f8a9a-d3f4-4705-b6f8-15cc007f714b"
    BREAK_CHOICES = (30, 45, 60, 90, 120)
    HOST_DEFAULTS = {"zcode": "glm", "qwen": "qwen", "trae": "doubao"}
    CLAUDE_DESKTOP_CLASSES = frozenset({"claude", "claude-desktop", "com.anthropic.claudefordesktop"})
    CODEX_CLASSES = frozenset({"codex", "chatgpt", "openai-codex"})
    AGY_CLASSES = frozenset({"antigravity", "google-antigravity"})
    INTEGRATION_TARGETS = [
        ("claude-mod", "Claude Code 增强版 mod", "能显示额度；终端里要 2.1.287 以上，桌面 App 2.1.286 以上"),
        ("claude-hooks", "Claude Code 标准钩子", "所有版本可用，不显示额度；和增强版二选一"),
        ("codex", "Codex", "接入后要在 Codex 里用 /hooks 信任一次"),
        ("deepseek", "DeepSeek Harness", "工作状态 + 余额；完全退出再打开 Harness 生效"),
        ("antigravity", "Antigravity", "桌面版和命令行都有效"),
        ("gemini", "Gemini CLI", "Gemini 桌面 App 没有接口"),
        ("workbuddy", "WorkBuddy", "按当前模型换角色"),
        ("zcode", "ZCode（智谱）", "按会话的模型换角色"),
        ("hermes", "Hermes Agent", "按当前模型换角色；新开的会话生效"),
        ("cursor", "Cursor", "按当前模型换角色；认不出的模型由当前角色来演"),
        ("ccgui", "CC GUI", "一次接入所有 CLI；按当前模型换角色；完全退出再打开 CC GUI 生效"),
        ("qwen", "Qwen Code（阿里）", "按当前模型换角色；新开的会话生效"),
        ("kimi", "Kimi Code（月之暗面）", "按会话的模型换角色；新开的会话生效。Kimi 客户端没有接口，切到它时换成 Kimi"),
        ("grok", "Grok Build（xAI）", "新开的会话生效；新文件夹第一次用要在 Grok 里 /hooks-trust 信任一次"),
        ("opencode", "OpenCode V2", "按当前模型换角色；重开或重载插件后生效"),
        ("trae", "TRAE（字节）", "默认由豆包来演；还要在 TRAE 设置 → Hooks 里打开「已配置的 Hooks」"),
    ]
    SEEN_KEYS = {
        "claude-hooks": "claude",
        "claude-mod": "claude-mod",
        "codex": "gpt",
        "deepseek": "deepseek",
        "gemini": "gemini",
        "antigravity": "antigravity",
        "workbuddy": "workbuddy",
        "zcode": "zcode",
        "hermes": "hermes",
        "qwen": "qwen",
        "kimi": "kimi",
        "cursor": "cursor",
        "grok": "grok",
        "opencode": "opencode",
        "trae": "trae",
        "ccgui": "ccgui",
    }

    def __init__(self) -> None:
        self.root = data_dir()
        self.src_root = repo_root()
        self.state_dir = state_dir()
        self.config = ConfigStore(self.root / "config.json")
        self.version = current_version()
        self.launched_at = time.time()

        sync_bundled_resources(self.root, self.src_root)
        self._mark_launched()
        self.events_dir.mkdir(parents=True, exist_ok=True)
        app_log(f"启动 {self.version}，{_os_summary()}")

        self.wm = detect_wm_backend()
        app_log(f"窗口管理器后端：{self.wm.name}")

        self.web_context = create_shared_web_context(self.root)

        self.ready = False
        self.follow_event_gen = 0
        self.current_id: str | None = None
        self.character_ids: list[str] = []
        self.skin_choices: dict[str, list[tuple[str, str]]] = {}
        self.base_outfit: dict[str, str] = {}
        self.display_names: dict[str, str] = {}
        self.default_names: dict[str, str] = {}
        self.accents: dict[str, str] = {}
        self.app_to_character: dict[str, str] = {}
        self.linux_apps_map: dict[str, str] = self._load_linux_apps_map()
        self.manifest_json = "{}"
        self.pause_real_events = False

        self.stamps: dict[str, float] = {}
        self._pending_switch_source: int | None = None
        self.latest_release: tuple[str, str] | None = None
        self.last_update_check = "还没查过"
        self.updating = False

        # Quota state
        self.codex_live_at = 0.0
        self.codex_busy_at: float | None = None
        self.codex_in_flight = False
        self.codex_last: tuple[dict[str, Any], float] | None = None
        self.codex_note = ""
        self.last_gpt_quota = "还没读过"

        self.agy_port: tuple[int, int] | None = None
        self.agy_last: tuple[dict[str, Any], float] | None = None
        self.last_agy_note = "还没查过"

        # Visibility / Layer / Fullscreen
        self.user_hidden = False
        self.hidden_for_fullscreen = False
        self.fullscreen_override = False
        self.fullscreen_checked_at = 0.0
        self.screens_asleep = False
        self.was_away = False
        self.hotkey_failed = False
        self._last_active_sig: tuple[str, ...] | None = None
        self._last_fullscreen_flag: bool | None = None

        # Pose / Dock / Click-through
        self.last_pose: dict[str, tuple[str, float]] = {}
        self.dock: str | None = None
        self.dock_out = False
        self.dock_hover = False
        self.dock_tucked = False
        self.docked_at = 0.0
        self.dock_enter_at: float | None = None
        self.dock_leave_at: float | None = None
        self.dock_cut: dict[str, float] = {}

        self.hit_rects: list[Rect] = []
        self.hit_rects_at = 0.0
        self.yielding = False
        self._yield_started_at = 0.0
        self._yield_key_held = False

        # Sizing
        self.page_size = (self.BASE_W, self.BASE_H)
        self.page_foot = 62.0
        self.shown_foot_pt = 0.0
        self.shown_scale = 0.0
        self._scale_timer: int | None = None

        # Integrations
        self.integrated: list[str] | None = None
        self.plugin_status = "[]"
        self._claude_config_stamp: float | None = None
        self._heal_times: list[float] = []
        self._heal_pending: int | None = None
        self.diag_text = ""

        # Multi-pets
        self.companions: dict[str, Companion] = {}
        self.leaving_companions: list[Companion] = []
        self.page_gathering = False
        self.companion_expected = 0
        self.companion_target = 0
        self.egg_allowed = True
        self.friendship_rows: list[Any] = []
        self.client_state_seen: set[str] = set()
        self.client_states: dict[str, tuple[str, float]] = {}
        self.char_states: dict[str, tuple[str, float]] = {}
        self.sessions_text: dict[str, str] = {}
        self.quota_code: dict[str, tuple[int, str]] = {}
        self.quota_seq = 0
        self.sent_running: str | None = None

        # Secondary windows & Notebook
        self.settings_win: Gtk.Window | None = None
        self.settings_web: WebKit2.WebView | None = None
        self.characters_win: Gtk.Window | None = None
        self.characters_web: WebKit2.WebView | None = None
        self.pending_settings_tab: str | None = None
        self.feedback_win: Gtk.Window | None = None
        self.feedback_web: WebKit2.WebView | None = None
        self.dev_win: Gtk.Window | None = None
        self.dev_web: WebKit2.WebView | None = None

        self.notebook_surface: PetSurface | None = None
        self.notebook_character: str | None = None
        self.notebook_owner: str | None = None
        self.notebook_near = Rect(0, 0, 260, 362)
        self.notebook_closing = False
        self.notebook_backfilling = False

        # Initial window geometry
        scale = self.pet_scale
        init_w = self.BASE_W * scale
        init_h = self.BASE_H * scale
        ox, oy = self._initial_origin(init_w, init_h)

        self.surface = PetSurface(
            context=self.web_context,
            handler_name="pet",
            on_message=self.handle_pet,
            wm=self.wm,
            initial_rect=Rect(ox, oy, init_w, init_h),
            namespace="crosspet",
            keyboard_mode="none",
            on_click=self._on_pet_click,
            on_menu=self._on_pet_menu,
            on_drag_start=self._on_pet_drag_start,
            on_drag_end=self._on_pet_drag_end,
            on_shake=lambda: self.js("shaken()"),
            on_load_started=self._on_main_load_started,
            on_load_finished=self._on_main_load_finished,
            on_crash=self._on_main_crash,
            top_room=self._top_room,
        )
        self.surface.set_zoom(scale)
        self.surface.win.connect("key-press-event", self._on_modifier_event)
        self.surface.webview.connect("motion-notify-event", self._on_pet_motion_modifiers)
        self.surface.show()

        self.tray = TrayIcon(
            icon_path=self.src_root / "app" / "icon" / "AppIcon.png",
            build_menu=self.build_menu,
            on_activate=self.bring_to_front,
        )
        self._register_hotkey()

        self.ipc = ControlServer(self._handle_ipc_command)
        self.ipc.start()
        self.wm.start_events(self._on_wm_event)

        self.surface.load_uri((self.root / "web" / "index.html").as_uri())

        # Timers
        GLib.timeout_add(300, self._timer_poll_states)
        GLib.timeout_add(50, self._timer_click_through)
        GLib.timeout_add(500, self._timer_wm_poll)
        GLib.timeout_add(5000, self._timer_push_running)
        GLib.timeout_add(60000, self._timer_quota)
        GLib.timeout_add(3000, self._timer_watch_claude)
        GLib.timeout_add(3 * 3600 * 1000, self._timer_update_check)
        GLib.timeout_add(20000, lambda: (self.check_for_update(manual=False), False)[1])

    # ---- Paths & Config Properties ----

    @property
    def characters_dir(self) -> Path:
        return self.root / "characters"

    @property
    def events_dir(self) -> Path:
        return self.root / "events"

    @property
    def pet_events_url(self) -> Path:
        return self.events_dir / "pet.jsonl"

    @property
    def switches_url(self) -> Path:
        return self.root / "switches.jsonl"

    def _note_pet(self, cid: str, state: dict[str, Any] | None, result: str, detail: str = "") -> None:
        ev = state.get("event") if isinstance(state, dict) and isinstance(state.get("event"), str) else ""
        pose = state.get("pose") if isinstance(state, dict) and isinstance(state.get("pose"), str) else ""
        Ledger.append(
            self.pet_events_url,
            {"char": cid, "ev": ev, "pose": pose, "result": result, "detail": detail},
        )

    @property
    def feedback_file(self) -> Path:
        return self.root / "dev-feedback.md"

    @property
    def friendship_file(self) -> Path:
        return self.root / "friendship.json"

    @property
    def notebook_file(self) -> Path:
        return self.root / "notebook.json"

    @property
    def user_quit_flag(self) -> Path:
        return self.root / "user-quit"

    @property
    def ai_autostart_off_flag(self) -> Path:
        return self.root / "ai-autostart-off"

    @property
    def ai_autostart(self) -> bool:
        return not self.ai_autostart_off_flag.exists()

    def set_ai_autostart(self, on: bool) -> None:
        if on:
            try:
                self.ai_autostart_off_flag.unlink()
            except OSError:
                pass
        else:
            try:
                self.ai_autostart_off_flag.write_bytes(b"")
            except OSError:
                pass

    @property
    def pet_scale(self) -> float:
        v = self.config.get_float("size", 1.0)
        return v if 0.6 <= v <= 1.6 else 1.0

    @property
    def text_scale(self) -> float:
        v = self.config.get_float("textSize", 1.0)
        return v if 0.6 <= v <= 1.6 else 1.0

    @property
    def text_linked(self) -> bool:
        return self.config.get_bool("textLinked", True)

    @property
    def show_name(self) -> bool:
        return self.config.get_bool("showName", True)

    @property
    def show_minis(self) -> bool:
        return self.config.get_bool("showMinis", True)

    @property
    def agy_quota_mode(self) -> str:
        return "cg" if self.config.get_str("agyQuotaMode") == "cg" else "week"

    @property
    def minis_from(self) -> str:
        return "own" if self.config.get_str("minisFrom") == "own" else "all"

    @property
    def follow_apps(self) -> bool:
        return self.config.get_bool("followApps", True)

    @property
    def follow_events(self) -> bool:
        return self.config.get_bool("followEvents", True)

    @property
    def eggs_enabled(self) -> bool:
        return self.config.get_bool("eggs", True)

    @property
    def layer_mode(self) -> str:
        v = self.config.get_str("layer", "always")
        return v if v in ("always", "ai", "normal") else "always"

    @property
    def hide_in_fullscreen(self) -> bool:
        return self.config.get_bool("hideFullscreen", True)

    @property
    def edge_dock_enabled(self) -> bool:
        return self.config.get_bool("edgeDock", True)

    @property
    def ds_quota_enabled(self) -> bool:
        return self.config.get_bool("dsQuota", True)

    @property
    def quota_aggregate(self) -> bool:
        return self.config.get_bool("quotaAggregate", False)

    @property
    def quota_style(self) -> str:
        return "bars" if self.config.get_str("quotaStyle") == "bars" else "text"

    @property
    def peak_style(self) -> str:
        v = self.config.get_str("peakStyle", "bar")
        return v if v in ("text", "off") else "bar"

    @staticmethod
    def clean_peak_skins(v: Any) -> dict[str, dict[str, str]]:
        if not isinstance(v, dict):
            return {}
        out: dict[str, dict[str, str]] = {}
        for cid, d in v.items():
            if not isinstance(cid, str) or not isinstance(d, dict):
                continue
            entry = {k: d[k] for k in ("peak", "valley") if isinstance(d.get(k), str)}
            if entry:
                out[cid] = entry
        return out

    @property
    def peak_skins(self) -> dict[str, dict[str, str]]:
        return self.clean_peak_skins(self.config.get("peakSkins"))

    @property
    def peak_skins_json(self) -> str:
        return json.dumps(self.peak_skins, ensure_ascii=False)

    @property
    def codex_resets(self) -> bool:
        return self.config.get_bool("codexResets", False)

    @property
    def power_save(self) -> bool:
        return self.config.get_bool("powerSave", False)

    @property
    def no_sleep(self) -> bool:
        return self.config.get_bool("noSleep", False)

    @property
    def aura_mode(self) -> str:
        v = self.config.get_str("auraMode", "auto")
        return v if v in ("auto", "on", "off") else "auto"

    def break_every(self, key: str, fallback: int) -> int:
        v = self.config.get_int(key, fallback)
        return v if v in self.BREAK_CHOICES else fallback

    @property
    def break_reminders_js(self) -> str:
        sit = str(self.config.get_bool("sitRemind", False)).lower()
        water = str(self.config.get_bool("waterRemind", False)).lower()
        return (
            f"setBreakReminders({{ sit: {sit}, sitEvery: {self.break_every('sitEvery', 45)}, "
            f"water: {water}, waterEvery: {self.break_every('waterEvery', 60)} }})"
        )

    @property
    def multi_pets_on(self) -> bool:
        return self.config.get_bool("multiPets", False)

    @property
    def pets_rest(self) -> str:
        r = self.config.get_str("petsRest", "auto")
        return r if r in ("stay", "open") else "auto"

    @property
    def main_pet(self) -> str:
        v = self.config.get_str("mainPet", "") or ""
        return v if v in self.character_ids else ""

    @property
    def companions_forwarding(self) -> bool:
        return self.multi_pets_on or self.page_gathering

    @property
    def hide_hotkey(self) -> str:
        return self.config.get_str("hideHotkey", "p") or "p"

    # ---- Startup & Lifecycle ----

    def _mark_launched(self) -> None:
        try:
            self.user_quit_flag.unlink()
        except OSError:
            pass
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            (self.state_dir / "pet.pid").write_text(str(os.getpid()), encoding="utf-8")
        except OSError:
            pass
        launcher = self.root / "launcher"
        if not launcher.exists():
            for cand in (self.src_root / "crosspet", self.src_root / "app" / "linux" / "crosspet"):
                if cand.is_file() and os.access(cand, os.X_OK):
                    try:
                        launcher.parent.mkdir(parents=True, exist_ok=True)
                        if launcher.is_symlink():
                            launcher.unlink()
                        launcher.symlink_to(cand)
                    except OSError:
                        pass
                    break

    def _cleanup_on_exit(self) -> None:
        try:
            (self.state_dir / "pet.pid").unlink()
        except OSError:
            pass
        self.wm.stop()
        self.ipc.stop()

    def quit(self, _item: Any = None) -> None:
        try:
            self.user_quit_flag.write_bytes(b"")
        except OSError:
            pass
        hint = self.ai_autostart and not self.config.get_bool("quitHinted", False)
        if hint:
            self.config.set("quitHinted", True)
        ms = 5000 if hint else 2000
        if self.ready:
            if hint:
                self.js("farewell('我先走啦～下次重新打开 AI 我再出来', 5000)")
            else:
                self.js("farewell(null, 2000)")
            self.companions_js(f"farewell(null, {ms})")
        else:
            ms = 50

        def finish() -> bool:
            self._cleanup_on_exit()
            Gtk.main_quit()
            return False

        GLib.timeout_add(ms, finish)

    def _initial_origin(self, w: float, h: float) -> tuple[float, float]:
        saved = self.config.get_list("origin")
        if len(saved) == 2 and all(isinstance(v, (int, float)) for v in saved):
            x, y = float(saved[0]), float(saved[1])
            mons = self.wm.monitors()
            r = Rect(x, y, w, h).inset(40, 40)
            if not mons or any(m.work_area.intersects(r) for m in mons):
                return x, y
        wa = self._primary_work_area()
        return wa.max_x - w - 40.0, wa.max_y - h - 100.0

    def _primary_work_area(self) -> Rect:
        mons = self.wm.monitors()
        if mons:
            focused = next((m for m in mons if m.focused), mons[0])
            return focused.work_area
        return Rect(0, 0, 1920, 1080)

    def _top_room(self) -> float:
        if not self.hit_rects:
            return 0.0
        return min(r.min_y for r in self.hit_rects) * self.surface.zoom

    def js(self, code: str, callback: Callable[[Any], None] | None = None) -> None:
        self.surface.js(code, callback)

    def dev_js(self, code: str) -> None:
        eval_js(self.dev_web, code)

    # ---- Linux App Map & Characters ----

    def _load_linux_apps_map(self) -> dict[str, str]:
        p = self.root / "linux-apps.json"
        if not p.exists():
            p = self.src_root / "app" / "linux" / "apps.json"
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(obj, dict):
                return {str(k).lower(): str(v) for k, v in obj.items() if isinstance(v, str)}
        except (OSError, ValueError):
            pass
        return {}

    def card_images(self, char_id: str) -> dict[str, str]:
        d = self.characters_dir / char_id
        out: dict[str, str] = {}
        for stem in ("portrait", "portrait-card", "avatar", "idle"):
            for ext in ("webp", "png"):
                f = d / f"{stem}.{ext}"
                if f.exists():
                    out[stem] = f.as_uri()
                    break
        return out

    def load_characters(self) -> None:
        self.follow_event_gen += 1
        chars: dict[str, Any] = {}
        self.app_to_character = dict(self.linux_apps_map)
        self.character_ids = []
        self.display_names = {}
        self.default_names = {}
        self.base_outfit = {}
        self.accents = {}
        self.skin_choices = {}

        if not self.characters_dir.is_dir():
            return
        dirs = sorted(p for p in self.characters_dir.iterdir() if p.is_dir())
        renamed = self.config.get_dict("names")

        def load_sprites(d: Path) -> tuple[dict[str, list[str]], str | None, str | None]:
            poses: dict[str, list[str]] = {}
            blink: str | None = None
            blink_base: str | None = None
            files = sorted(f for f in d.iterdir() if f.is_file() and f.suffix in (".webp", ".png"))
            for f in files:
                stem = f.stem
                if stem in ("portrait", "portrait-card", "avatar"):
                    continue
                uri = f.as_uri()
                if stem == "idle-blink":
                    blink = uri
                    continue
                if stem == "idle":
                    blink_base = uri
                pose = stem.split("-", 1)[0]
                poses.setdefault(pose, []).append(uri)
            return poses, blink, blink_base

        skin_sprites: dict[str, tuple[dict[str, list[str]], str | None, str | None]] = {}
        skin_info: dict[str, dict[str, Any]] = {}
        for d in dirs:
            cfg = d / "character.json"
            if not cfg.exists():
                continue
            try:
                info = json.loads(cfg.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(info, dict) or not isinstance(info.get("skinOf"), str):
                continue
            sp = load_sprites(d)
            if "idle" not in sp[0]:
                continue
            base = info["skinOf"]
            sname = info.get("skinName") if isinstance(info.get("skinName"), str) else d.name
            self.skin_choices.setdefault(base, []).append((d.name, sname))
            skin_sprites[d.name] = sp
            skin_info[d.name] = info

        chosen_skins = self.config.get_dict("skins")
        for d in dirs:
            cfg = d / "character.json"
            if not cfg.exists():
                continue
            try:
                info = json.loads(cfg.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(info, dict) or info.get("skinOf") is not None:
                continue
            cid = d.name
            sp = load_sprites(d)
            skin = chosen_skins.get(cid)
            if isinstance(skin, str) and skin in skin_sprites and any(s[0] == skin for s in self.skin_choices.get(cid, [])):
                sp = skin_sprites[skin]
                info["skin"] = skin
                own_lines = skin_info[skin].get("lines")
                if isinstance(own_lines, dict):
                    merged = dict(info.get("lines") or {})
                    merged.update(own_lines)
                    info["lines"] = merged
                if "greeting" in skin_info[skin]:
                    info["greeting"] = skin_info[skin]["greeting"]

            poses, blink, blink_base = sp
            is_egg = info.get("egg") is True
            if is_egg and "pop" not in poses:
                continue
            if not is_egg and ("idle" not in poses and "default" not in poses):
                continue
            if not is_egg:
                self.default_names[cid] = str(info.get("name") or cid)
                if isinstance(info.get("outfit"), str):
                    self.base_outfit[cid] = info["outfit"]
                if isinstance(info.get("accent"), str):
                    self.accents[cid] = info["accent"]
                custom = renamed.get(cid)
                if isinstance(custom, str) and custom:
                    info["name"] = custom

            info["poses"] = poses
            info["blink"] = blink
            info["blinkBase"] = blink_base
            chars[cid] = info
            if is_egg:
                continue
            self.character_ids.append(cid)
            self.display_names[cid] = str(info.get("name") or cid)
            for app_name in info.get("apps") or []:
                if isinstance(app_name, str) and app_name:
                    self.app_to_character.setdefault(app_name.lower(), cid)

        self.manifest_json = json.dumps({"characters": chars}, ensure_ascii=False)
        self.js(f"init({self.manifest_json})")
        self.companions_js(f"init({self.manifest_json})")
        self.dev_js(f"boot({self.manifest_json})")

        last = self.config.get_str("lastVersion")
        if self.config.get_str("whatsNewSeen") is None:
            self.config.set("whatsNewSeen", last or self.version)
        if last != self.version:
            self.config.set("lastVersion", self.version)
            if last is not None and is_newer(self.version, last):
                self.js(f"justUpdated({_js_quote('v' + self.version)}, {_js_quote(last)})")
        self.tray.refresh_menu()

    def switch_to(self, cid: str, why: str, via: str = "") -> None:
        skins = self.config.get_dict("skins")
        Ledger.append(
            self.switches_url,
            {
                "from": self.current_id or "",
                "to": cid,
                "skin": skins.get(cid, ""),
                "why": why,
                "via": via,
            },
        )
        if cid != self.current_id:
            extra = f" {via}" if via else ""
            app_log(f"换角色 {self.current_id or '-'} → {cid}（{why}{extra}）")
        if cid != self.current_id and self.notebook_owner == "main":
            self.close_notebook()
        self.current_id = cid
        self.config.set("character", cid)
        if self.dock is not None and not self.dock_out:
            GLib.timeout_add(800, lambda: (self.apply_dock(), False)[1])
        self.js(f"setCharacter({_js_quote(cid)})")
        self.push_settings()
        self.tray.refresh_menu()

    def wear(self, cid: str, skin: str) -> None:
        skins = self.config.get_dict("skins")
        if skins.get(cid, "") == skin:
            return
        if not skin:
            skins.pop(cid, None)
        else:
            skins[cid] = skin
        self.config.set("skins", skins)
        self.load_characters()
        self.js(f"refreshLook({_js_quote(cid)})")
        self.companions_js(f"refreshLook({_js_quote(cid)})")
        self.push_settings()

    # ---- Host / Window Matching ----

    def host_app(self, ident: str) -> str | None:
        s = ident.lower()
        if s in ("workbuddy", "workbuddy-ai", "workbuddy ai") or s.startswith("com.workbuddy."):
            return "workbuddy"
        if s in ("zcode", "dev.zcode.app"):
            return "zcode"
        if s in ("cursor", "cursor-url-handler", "com.todesktop.230313mzl4w4u92"):
            return "cursor"
        if s in ("trae", "trae-cn", "cn.trae.app"):
            return "trae"
        if s in ("ccgui", "ccgui-next", "com.zhukunpenglinyutong.ccgui"):
            return "ccgui"
        return None

    def _map_window_to_target(self, win: ActiveWindow | None) -> tuple[str | None, str]:
        if win is None:
            return None, ""
        for ident in win.identifiers:
            mapped = self.app_to_character.get(ident) or self.host_app(ident)
            if mapped:
                return mapped, ident
        return None, win.identifiers[0] if win.identifiers else ""

    def host_character(self, mapped: str) -> str:
        url = self.state_dir / f"{mapped}-host.json"
        try:
            st = url.stat()
            if time.time() - st.st_mtime < 86400:
                obj = json.loads(url.read_text(encoding="utf-8"))
                c = obj.get("character") if isinstance(obj, dict) else None
                if isinstance(c, str) and c in self.character_ids:
                    return c
                return mapped
        except (OSError, ValueError):
            pass
        d = self.HOST_DEFAULTS.get(mapped)
        if d and d in self.character_ids:
            return d
        return mapped

    @property
    def front_is_ai(self) -> bool:
        win = self.wm.active_window()
        mapped, _ = self._map_window_to_target(win)
        return mapped is not None

    @property
    def ai_active(self) -> bool:
        if self.front_is_ai:
            return True
        now = time.time()
        for pose, at in self.last_pose.values():
            age = now - at
            if pose == "asking" and age < 600:
                return True
            if pose in ("happy", "proud") and age < 8:
                return True
        return False

    def effective_layer(self) -> str:
        if self.layer_mode == "normal":
            return "bottom"
        if self.layer_mode == "ai":
            return "overlay" if self.ai_active else "bottom"
        return "overlay"

    # ---- Main WebView Lifecycle ----

    def _on_main_load_started(self) -> None:
        self.follow_event_gen += 1
        self.ready = False
        self.page_gathering = False

    def _on_main_crash(self) -> None:
        if self.multi_pets_on or self.companions or self.leaving_companions:
            app_log("桌宠页面的网页进程退出了，关掉额外的桌宠、重新载入")
            for c in list(self.companions.values()) + list(self.leaving_companions):
                c.close()
            self.page_gathering = False
            self.egg_allowed = True
        self.surface.reload()

    def _on_main_load_finished(self) -> None:
        self.ready = True
        self.js(f"restoreFriendship({self._saved_friendship_json()})")
        self.js(f"restoreNotebook({self._saved_notebook_json()})")
        self.load_characters()

        saved = self.config.get_str("character")
        if saved and saved in self.character_ids:
            self.current_id = saved
            self.js(f"setCharacter({_js_quote(saved)}, true)")

        self._companions_main_reloaded()
        self.push_multi_pets()
        self.apply_main_pet()

        saved_dock = self.config.get_str("dock")
        if saved_dock and self.edge_dock_enabled:
            GLib.timeout_add(1500, lambda: (self.set_dock(saved_dock), False)[1])

        self.js(
            f"setAuraMode({_js_quote(self.aura_mode)}); "
            f"setShowName({str(self.show_name).lower()}); "
            f"setShowMinis({str(self.show_minis).lower()}); "
            f"setMinisFrom({_js_quote(self.minis_from)}); "
            f"setAgyQuotaMode({_js_quote(self.agy_quota_mode)}); "
            f"setEggsEnabled({str(self.eggs_enabled).lower()}); "
            f"setPowerSave({str(self.power_save).lower()}); "
            f"setNeverSleep({str(self.no_sleep).lower()}); "
            f"setQuotaAggregate({str(self.quota_aggregate).lower()}); "
            f"setCodexResets({str(self.codex_resets).lower()}); "
            f"setPeakStyle({_js_quote(self.peak_style)}); "
            f"setQuotaStyle({_js_quote(self.quota_style)}); "
            f"setPeakSkins({self.peak_skins_json}); "
            f"{self.break_reminders_js}"
        )
        self.apply_sizes(anchor="corner")
        self.update_page_hidden()
        self.stamps = {}
        try:
            self.poll_states()
        except Exception as exc:
            app_log(f"首次读取状态出错：{exc!r}")
        self.refresh_codex_quota("now")
        self.refresh_antigravity_quota()
        self.refresh_plugins(tell_pet=True)
        if self.companions_forwarding:
            self.start_forwarding()

        win = self.wm.active_window()
        mapped, ident = self._map_window_to_target(win)
        if self.follow_apps and mapped:
            target = self.host_character(mapped)
            if target in self.character_ids:
                self.follow_foreground(target, why="startup", via=ident)

    # ---- Polling & WM Events ----

    def _on_wm_event(self, ev_name: str) -> None:
        if ev_name in ("fullscreen", "workspace", "focusedmon"):
            self.fullscreen_override = False
            self.check_fullscreen()
        elif ev_name in ("activewindow", "activewindowv2"):
            self._handle_active_window_change()
        elif ev_name in ("openwindow", "closewindow"):
            self.push_running()
        elif ev_name in ("monitoradded", "monitorremoved"):
            self.apply_dock()

    def _timer_wm_poll(self) -> bool:
        try:
            win = self.wm.active_window()
            sig = tuple(win.identifiers) if win else ()
            full = bool(win and win.fullscreen)
            if sig != self._last_active_sig:
                self._last_active_sig = sig
                self._handle_active_window_change(win)
            elif full != self._last_fullscreen_flag:
                self._last_fullscreen_flag = full
                self.check_fullscreen()
        except Exception as exc:
            app_log(f"定时任务出错（wm_poll）：{exc!r}")
        return True

    def _handle_active_window_change(self, win: ActiveWindow | None = None) -> None:
        self.follow_event_gen += 1
        self.fullscreen_override = False
        self.check_fullscreen()
        if not self.ready:
            return
        if self._pending_switch_source is not None:
            GLib.source_remove(self._pending_switch_source)
            self._pending_switch_source = None
        if win is None:
            win = self.wm.active_window()
        self.push_foreground(win)
        if not self.follow_apps:
            return
        mapped, ident = self._map_window_to_target(win)
        if not mapped:
            return
        cid = self.host_character(mapped)
        if cid == self.current_id or cid not in self.character_ids:
            return

        def do_switch() -> bool:
            self._pending_switch_source = None
            cur_win = self.wm.active_window()
            cur_mapped, cur_ident = self._map_window_to_target(cur_win)
            if cur_ident != ident or not cur_mapped:
                return False
            self.follow_foreground(
                cid,
                why="front",
                via=ident,
                still=lambda: self._map_window_to_target(self.wm.active_window())[1] == ident,
            )
            return False

        self._pending_switch_source = GLib.timeout_add(500, do_switch)

    def _timer_poll_states(self) -> bool:
        try:
            self.poll_states()
        except Exception as exc:
            app_log(f"定时任务出错（poll_states）：{exc!r}")
        return True

    def poll_states(self) -> None:
        if not self.ready:
            return
        latest_active: tuple[str | None, float] = (None, 0.0)
        now = time.time()
        for cid in self.character_ids + ["current"]:
            for kind in ("state", "quota", "sessions"):
                if cid == "current" and kind == "quota":
                    continue
                if cid == "deepseek" and kind == "quota" and not self.ds_quota_enabled:
                    continue
                url = self.state_dir / f"{cid}-{kind}.json"
                key = f"{cid}-{kind}"
                try:
                    stamp = url.stat().st_mtime
                except OSError:
                    continue
                if stamp == self.stamps.get(key):
                    continue
                self.stamps[key] = stamp
                if kind == "state" and now - stamp > 600:
                    self._note_pet(cid, None, "skipped", "stale")
                    continue
                try:
                    text = url.read_text(encoding="utf-8")
                except OSError:
                    continue

                parsed: dict[str, Any] | None = None
                if kind == "state":
                    try:
                        obj = json.loads(text)
                        if isinstance(obj, dict):
                            parsed = obj
                    except ValueError:
                        parsed = None
                    if parsed and isinstance(parsed.get("pose"), str):
                        pose = parsed["pose"]
                        self.last_pose[cid] = (pose, stamp)
                        ts = parsed.get("ts")
                        if (
                            cid != "current"
                            and pose not in ("idle", "sleeping")
                            and isinstance(ts, (int, float))
                            and now - float(ts) < 30.0
                            and float(ts) > latest_active[1]
                        ):
                            latest_active = (cid, float(ts))

                if kind == "sessions":
                    if not self.pause_real_events:
                        self.js(f"setSessions({_js_quote(cid)}, {text})")
                    self.note_sessions(cid, text)
                    continue

                self.dev_js(f"logEvent({_js_quote(cid)}, {_js_quote(kind)}, {text}, {str(self.pause_real_events).lower()})")
                if self.pause_real_events:
                    if kind == "state":
                        self._note_pet(cid, parsed, "skipped", "paused")
                    continue
                if kind == "state":
                    self._note_pet(cid, parsed, "played")
                    self.js(f"applyCharState({_js_quote(cid)}, {text})")
                    if cid != "current":
                        self.note_char_state(cid, text, stamp)
                else:
                    self.quota_js(cid, f"setQuota({_js_quote(cid)}, {text})")

                if kind == "state" and cid == "gpt":
                    if '"event": "Stop"' in text or '"event":"Stop"' in text:
                        self.codex_busy_at = None
                        GLib.timeout_add(1500, lambda: (self.refresh_codex_quota("turnEnd"), False)[1])
                    else:
                        self.codex_busy_at = stamp

        if latest_active[0] is not None:
            self.follow_event(latest_active[0])

        self.poll_client_states()
        self.apply_layer()
        self.update_dock()
        for c in list(self.companions.values()):
            c.update_dock()

        for host in ("deepseek", "workbuddy", "zcode", "claude", "gpt", "qwen", "kimi", "cursor", "opencode", "trae", "ccgui"):
            url = self.state_dir / f"{host}-host.json"
            try:
                stamp = url.stat().st_mtime
            except OSError:
                continue
            skey = f"{host}-host"
            if stamp == self.stamps.get(skey):
                continue
            self.stamps[skey] = stamp
            if not self.follow_apps or self.pause_real_events:
                continue
            win = self.wm.active_window()
            mapped, ident = self._map_window_to_target(win)
            if mapped != host:
                continue
            cid = self.host_character(host)
            if cid != self.current_id and cid in self.character_ids:
                self.follow_foreground(
                    cid,
                    why="host",
                    via=host,
                    still=lambda i=ident: self._map_window_to_target(self.wm.active_window())[1] == i,
                )

    def follow_event(self, cid: str) -> None:
        self.follow_event_gen += 1
        gen = self.follow_event_gen
        if not self.ready or self.pause_real_events or not self.follow_events or cid == self.current_id:
            return
        win = self.wm.active_window()
        host, ident = self._map_window_to_target(win)
        fg_id = self.host_character(host) if host else None
        cur_at = self.current_id
        apps = self.follow_apps
        events = self.follow_events
        mine = self.last_pose.get(cur_at) if cur_at else None
        payload = {
            "eventId": cid,
            "foregroundId": fg_id,
            "followApps": apps,
            "followEvents": events,
            "characters": self.character_ids,
            "multiPets": self.multi_pets_on,
            "currentPose": mine[0] if mine else None,
            "currentAge": (time.time() - mine[1]) if mine else None,
        }
        js_arg = json.dumps(payload, ensure_ascii=False)

        def on_verdict(verdict: Any) -> None:
            if (
                self.follow_event_gen != gen
                or not self.ready
                or self.pause_real_events
                or self.current_id != cur_at
                or self.follow_apps != apps
                or self.follow_events != events
            ):
                self._note_pet(cid, None, "skipped", "answer-stale")
                return
            now_host, now_ident = self._map_window_to_target(self.wm.active_window())
            now_fg = self.host_character(now_host) if now_host else None
            if now_ident != ident or now_host != host or now_fg != fg_id or cid not in self.character_ids:
                self._note_pet(cid, None, "skipped", "answer-stale")
                return
            if verdict != "ok":
                self._note_pet(cid, None, "skipped", str(verdict or "policy"))
                return
            if cid != self.current_id:
                self.switch_to(cid, why="event")

        self.js(f"FollowPolicy.eventSkip({js_arg}) || 'ok'", on_verdict)

    # ---- Layer, Fullscreen, Click-Through & Yield ----

    def apply_layer(self) -> None:
        try:
            if self.user_hidden:
                return
            if time.monotonic() - self.fullscreen_checked_at >= 0.25:
                self.check_fullscreen()
            if self.hidden_for_fullscreen:
                return
            target = self.effective_layer()
            if self.surface.layer_mode != target:
                self.surface.set_layer(target)
        finally:
            self.sync_companion_windows()

    def check_fullscreen(self) -> None:
        self.fullscreen_checked_at = time.monotonic()
        if self.user_hidden:
            return
        mon = self.surface.current_monitor()
        mon_name = mon.name if mon else None
        full = bool(
            self.hide_in_fullscreen
            and not self.fullscreen_override
            and not self.front_is_ai
            and self.wm.is_fullscreen_on(mon_name)
        )
        if full == self.hidden_for_fullscreen:
            return
        self.hidden_for_fullscreen = full
        app_log("全屏中，先藏起来" if full else "退出全屏，出来了")
        self.apply_hidden_state()
        self.sync_companion_windows()

    def apply_hidden_state(self) -> None:
        hidden = self.user_hidden or self.hidden_for_fullscreen
        self.surface.set_hidden(hidden)
        self.update_page_hidden()

    def update_page_hidden(self) -> None:
        if not self.ready:
            return
        hidden = self.screens_asleep or self.user_hidden or self.hidden_for_fullscreen
        self.js(f"setPageHidden({str(hidden).lower()})")
        for c in list(self.companions.values()):
            c.update_page_hidden()
        away = self.screens_asleep or self.user_hidden
        if self.was_away and not away:
            self.refresh_codex_quota("tick")
        self.was_away = away

    def _on_modifier_event(self, _w: Gtk.Widget, ev: Gdk.EventKey) -> bool:
        self._update_yield_key_from_state(ev.state)
        return False

    def _on_pet_motion_modifiers(self, _w: Gtk.Widget, ev: Gdk.EventMotion) -> bool:
        self._update_yield_key_from_state(ev.state)
        return False

    def _update_yield_key_from_state(self, state: Gdk.ModifierType) -> None:
        ctrl = bool(state & Gdk.ModifierType.CONTROL_MASK)
        alt = bool(state & Gdk.ModifierType.MOD1_MASK)
        shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
        sup = bool(state & Gdk.ModifierType.SUPER_MASK)
        self._yield_key_held = (ctrl or alt) and not (shift or sup)

    def _timer_click_through(self) -> bool:
        try:
            cursor = self.wm.cursor_pos()
            if self.wm.name == "x11":
                try:
                    gdk_win = self.surface.win.get_window()
                    display = Gdk.Display.get_default()
                    seat = display.get_default_seat() if display else None
                    ptr = seat.get_pointer() if seat else None
                    if gdk_win and ptr:
                        _, _, _, mod = ptr.get_state(gdk_win)
                        self._update_yield_key_from_state(mod)
                except Exception:
                    pass

            self._update_main_click_through(cursor, self._yield_key_held)
            for c in list(self.companions.values()):
                c.update_click_through(cursor, self._yield_key_held)
        except Exception as exc:
            app_log(f"定时任务出错（click_through）：{exc!r}")
        return True

    def _update_main_click_through(self, cursor: tuple[float, float] | None, yield_key: bool) -> None:
        if self.user_hidden or self.hidden_for_fullscreen:
            self._set_yield(False)
            return
        if self.surface.is_dragging:
            return

        now = time.monotonic()
        interval = 0.08 if self.dock is not None else 0.25
        if now - self.hit_rects_at > interval:
            self.hit_rects_at = now

            def on_rects(val: Any) -> None:
                if isinstance(val, str):
                    try:
                        val = json.loads(val)
                    except ValueError:
                        return
                if isinstance(val, list):
                    rects: list[Rect] = []
                    for item in val:
                        if isinstance(item, list) and len(item) == 4:
                            rects.append(Rect(float(item[0]), float(item[1]), float(item[2]), float(item[3])))
                    self.hit_rects = rects
                    self.surface.set_hit_rects(rects)

            self.surface.js("hitRects()", on_rects)

        over = False
        if cursor is not None and self.surface.rect.contains_point(cursor[0], cursor[1]):
            z = self.surface.rect.w / max(1.0, self.page_size[0])
            px = (cursor[0] - self.surface.rect.x) / z
            py = (cursor[1] - self.surface.rect.y) / z
            over = not self.hit_rects or any(r.contains_point(px, py) for r in self.hit_rects)
        elif cursor is None:
            if self.yielding and now - self._yield_started_at > 2.5:
                over = False
            else:
                over = self.surface.pointer_over

        self._set_yield(yield_next(self.yielding, over=over and bool(self.hit_rects), key=yield_key))
        self.update_dock_hover(over and bool(self.hit_rects))

    def _set_yield(self, on: bool) -> None:
        if on == self.yielding:
            return
        self.yielding = on
        if on:
            self._yield_started_at = time.monotonic()
        self.surface.set_yielding(on)
        self.js(f"setYield({str(on).lower()})")

    # ---- Edge Docking ----

    def undock(self) -> None:
        if self.dock is None:
            return
        self.dock = None
        self.dock_out = False
        self.dock_hover = False
        self.dock_tucked = False
        self.config.remove("dock")
        self.js("setTucked(null)")

    def check_dock(self) -> None:
        if not self.edge_dock_enabled:
            return
        mon = self.surface.current_monitor()
        if mon is None:
            return
        f = self.surface.rect
        mons = self.wm.monitors()
        left_nb = any(
            m != mon and m.frame.min_y < f.max_y and m.frame.max_y > f.min_y and abs(m.frame.max_x - mon.frame.min_x) < 2
            for m in mons
        )
        right_nb = any(
            m != mon and m.frame.min_y < f.max_y and m.frame.max_y > f.min_y and abs(m.frame.min_x - mon.frame.max_x) < 2
            for m in mons
        )
        reach = f.w * (self.BASE_W / max(1.0, self.page_size[0])) * 0.3
        side = dock_side(f, mon.work_area, reach, left_nb, right_nb)
        if side:
            self.set_dock(side)

    def set_dock(self, side: str) -> None:
        self.dock = side
        self.docked_at = time.time()
        self.config.set("dock", side)
        self.dock_out = self._dock_busy()
        self.apply_dock()

    def _dock_busy(self) -> bool:
        return dock_busy(list(self.last_pose.values()), since=self.docked_at, now=time.time())

    def update_dock(self) -> None:
        if self.dock is None:
            return
        busy = self._dock_busy()
        if busy != self.dock_out:
            self.dock_out = busy
            self.dock_hover = False
            self.apply_dock()

    def apply_dock(self) -> None:
        if self.dock is None:
            return
        mon = self.surface.current_monitor()
        if mon is None:
            return
        side = self.dock
        self.hit_rects = []
        self.hit_rects_at = 0.0
        vf = mon.work_area
        f = dock_clamp_y(self.surface.rect, vf)
        if self.dock_out:
            self.dock_tucked = False
            self.js("setTucked(null)")
            gx = dock_edge_x(side, f.w, vf)
            self.surface.slide_to(gx, f.y)
            return
        if not self.dock_tucked:
            gx = dock_edge_x(side, f.w, vf)
            if abs(self.surface.rect.x - gx) > 1 or abs(self.surface.rect.y - f.y) > 1:
                self.surface.slide_to(gx, f.y)
                GLib.timeout_add(370, lambda: (self._tuck(side, vf), False)[1])
                return
        self._tuck(side, vf)

    def _tuck(self, side: str, vf: Rect) -> None:
        if self.dock != side or self.dock_out:
            return
        self.dock_tucked = True
        peek = self.dock_hover
        self.js(f"setTucked({_js_quote(side)}, {str(peek).lower()})")
        key = f"{side}{'-peek' if peek else ''}{self.current_id or ''}"
        f = dock_clamp_y(self.surface.rect, vf)

        def place(cut: float) -> None:
            if self.dock != side or self.dock_out or self.dock_hover != peek:
                return
            zoom = f.w / max(1.0, self.page_size[0])
            tx = tuck_x(side, cut, zoom, vf)
            if abs(tx - self.surface.rect.x) > 1:
                self.surface.slide_to(tx, f.y)

        if key in self.dock_cut:
            place(self.dock_cut[key])
            return

        def measure() -> bool:
            if self.dock != side or self.dock_out or self.dock_hover != peek:
                return False

            def on_cut(val: Any) -> None:
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    self.dock_cut[key] = float(val)
                    place(float(val))

            self.js(f"dockCut({_js_quote(side)})", on_cut)
            return False

        GLib.timeout_add(450, measure)

    def update_dock_hover(self, inside: bool) -> None:
        if self.dock is None or self.dock_out:
            return
        now = time.monotonic()
        if inside:
            self.dock_leave_at = None
            if self.dock_hover:
                return
            if self.dock_enter_at is None:
                self.dock_enter_at = now
            elif now - self.dock_enter_at > 0.15:
                self.dock_enter_at = None
                self.dock_hover = True
                self.apply_dock()
        else:
            self.dock_enter_at = None
            if self.dock_hover:
                if self.dock_leave_at is None:
                    self.dock_leave_at = now
                elif now - self.dock_leave_at > 0.3:
                    self.dock_hover = False
                    self.dock_leave_at = None
                    self.apply_dock()

    # ---- Sizing ----

    def apply_scale(self, scale: float, anchor: str = "bottom") -> None:
        w = self.page_size[0] * scale
        h = self.page_size[1] * scale
        mon = self.surface.current_monitor()
        vis_max_y = mon.work_area.max_y if mon else None
        r = place_window(
            self.surface.rect,
            w,
            h,
            self.shown_foot_pt,
            self.page_foot * scale,
            anchor,
            vis_max_y,
        )
        self.surface.set_geometry(r.x, r.y, r.w, r.h)
        self.surface.set_zoom(scale)
        self.shown_foot_pt = self.page_foot * scale
        self.config.set("origin", [r.x, r.y])

    def apply_sizes(self, animate_to: float | None = None, anchor: str = "feet") -> None:
        if self.shown_foot_pt == 0.0 and self.page_size[0] > 0:
            self.shown_foot_pt = self.page_foot * (self.surface.rect.w / self.page_size[0])

        def finish() -> None:
            if animate_to is not None:
                self.animate_scale(animate_to)
                return
            s = self.shown_scale if self.shown_scale > 0 else self.pet_scale
            self.apply_scale(s, anchor=anchor)
            if anchor == "feet" and self.dock is not None:
                self.apply_dock()

        if not self.ready:
            finish()
            return

        def on_res(val: Any) -> None:
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except ValueError:
                    val = None
            if isinstance(val, dict) and all(k in val for k in ("w", "h", "foot")):
                page = (float(val["w"]), float(val["h"]))
                foot = float(val["foot"])
                if page != self.page_size or foot != self.page_foot:
                    self.dock_cut = {}
                self.page_size = page
                self.page_foot = foot
            finish()

        target = animate_to if animate_to is not None else self.pet_scale
        self.js(f"setSizes({target}, {self.text_scale}, {str(self.text_linked).lower()})", on_res)

    def animate_scale(self, target: float) -> None:
        if self._scale_timer is not None:
            GLib.source_remove(self._scale_timer)
            self._scale_timer = None
        frm = self.shown_scale if self.shown_scale > 0 else self.pet_scale
        if abs(target - frm) <= 0.06:
            self.shown_scale = target
            self.apply_scale(target)
            return
        start = time.monotonic()

        def tick() -> bool:
            k = min(1.0, (time.monotonic() - start) / 0.2)
            eased = 1.0 - (1.0 - k) ** 3
            self.shown_scale = frm + (target - frm) * eased
            self.apply_scale(self.shown_scale)
            if k >= 1.0:
                self._scale_timer = None
                if self.dock is not None:
                    self.apply_dock()
                return False
            return True

        self._scale_timer = GLib.timeout_add(16, tick)

    # ---- Multi-Pets (Companions) ----

    def companion_origin(self, key: str, w: float, h: float) -> tuple[float, float]:
        others = [c.surface.rect for c in list(self.companions.values()) + list(self.leaving_companions)]
        mons = self.wm.monitors()
        saved_rect: Rect | None = None
        saved = self.config.get_list(f"origin-{key}")
        if len(saved) == 2 and all(isinstance(v, (int, float)) for v in saved):
            r = Rect(float(saved[0]), float(saved[1]), w, h)
            match_mon = next((m for m in mons if m.work_area.intersects(r.inset(40, 40))), None)
            if match_mon is not None:
                vf = match_mon.work_area
                x = min(max(r.min_x, vf.min_x), max(vf.min_x, vf.max_x - w))
                y = min(max(r.min_y, vf.min_y - h * HEAD_ROOM), max(vf.min_y, vf.max_y - h))
                saved_rect = Rect(x, y, w, h)

        cur_mon = self.surface.current_monitor()
        vf = cur_mon.work_area if cur_mon else self._primary_work_area()
        picked = companion_pick(self.surface.rect, others, saved_rect, self.companion_target, w, h, vf)
        return picked.x, picked.y

    def handle_pet(self, body: Any) -> None:
        if not isinstance(body, dict):
            return
        self.handle_companion_message(body)
        tab = body.get("openSettings")
        if isinstance(tab, str):
            if tab == "character":
                self.open_character_page()
            else:
                self.open_settings_at(tab)
        wear = body.get("wear")
        if isinstance(wear, dict):
            cid = wear.get("id")
            skin = wear.get("skin")
            if (
                isinstance(cid, str)
                and isinstance(skin, str)
                and cid in self.character_ids
                and (not skin or any(s[0] == skin for s in self.skin_choices.get(cid, [])))
            ):
                self.wear(cid, skin)

    def handle_companion_message(self, d: dict[str, Any]) -> None:
        if isinstance(d.get("companionLeave"), str):
            self.companion_leave(d["companionLeave"])
        if isinstance(d.get("companions"), list):
            was = self.companions_forwarding
            self.page_gathering = bool(d.get("gathering", False))
            self.companion_expected = int(d.get("expected") or 0)
            self.sync_companions(d["companions"])
            if self.companions_forwarding and not was:
                self.start_forwarding()
        if isinstance(d.get("companionCall"), dict):
            self.companion_call(d["companionCall"])
        if isinstance(d.get("eggAllowed"), bool):
            self.egg_allowed = d["eggAllowed"]
        if isinstance(d.get("friendship"), list):
            self.friendship_rows = d["friendship"]
            self.push_settings()
        if isinstance(d.get("friendshipStore"), dict):
            self._save_json_file(self.friendship_file, d["friendshipStore"])
        if isinstance(d.get("notebookStore"), dict):
            self._save_json_file(self.notebook_file, d["notebookStore"])
        if d.get("notebookBackfill") is True:
            self.run_notebook_backfill()

    def _save_json_file(self, path: Path, obj: dict[str, Any]) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(obj, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            pass

    def _saved_friendship_json(self) -> str:
        try:
            obj = json.loads(self.friendship_file.read_text(encoding="utf-8"))
            if isinstance(obj, dict):
                return json.dumps(obj, ensure_ascii=False)
        except (OSError, ValueError):
            pass
        return "null"

    def _saved_notebook_json(self) -> str:
        try:
            obj = json.loads(self.notebook_file.read_text(encoding="utf-8"))
            if isinstance(obj, dict):
                return json.dumps(obj, ensure_ascii=False)
        except (OSError, ValueError):
            pass
        return "null"

    def sync_companions(self, lst: list[Any]) -> None:
        seen: set[str] = set()
        self.companion_target = max(len(lst), self.companion_expected)
        for pet in lst:
            if not isinstance(pet, dict):
                continue
            pid = pet.get("id")
            ch = pet.get("character")
            if not isinstance(pid, str) or not pid or pid in seen or ch not in self.character_ids:
                continue
            seen.add(pid)
            if pid in self.companions:
                self.companions[pid].update(pet)
            else:
                self.companions[pid] = Companion(self, pet)
        for pid, comp in list(self.companions.items()):
            if pid not in seen:
                comp.close()
        self.tray.refresh_menu()

    def companion_leave(self, pid: str) -> None:
        comp = self.companions.pop(pid, None)
        if comp is None:
            return
        self.leaving_companions.append(comp)
        comp.leave()
        self.tray.refresh_menu()

    def companion_call(self, call: dict[str, Any]) -> None:
        pid = call.get("id")
        fn = call.get("fn")
        args = call.get("args")
        if (
            not isinstance(pid, str)
            or fn not in ("celebrate", "chat", "answerRoll", "miniGift")
            or not isinstance(args, list)
            or pid not in self.companions
        ):
            return
        self.companions[pid].js(f"{fn}.apply(null, {json.dumps(args, ensure_ascii=False)})")

    def companion_closed(self, comp: Companion) -> None:
        if self.companions.get(comp.id) is comp:
            del self.companions[comp.id]
        self.leaving_companions = [c for c in self.leaving_companions if c is not comp]
        self.tray.refresh_menu()

    def _companions_main_reloaded(self) -> None:
        self.page_gathering = False
        if self.multi_pets_on:
            return
        for c in list(self.companions.values()) + list(self.leaving_companions):
            c.close()
        self.egg_allowed = True

    def gather_companions(self, _item: Any = None) -> None:
        if not self.ready:
            return

        def on_res(r: Any) -> None:
            if r is True:
                was = self.companions_forwarding
                self.page_gathering = True
                if not was:
                    self.start_forwarding()

        self.js("gather()", on_res)

    def call_companion(self, cid: str) -> None:
        if not self.ready:
            return

        def on_res(r: Any) -> None:
            if r is True:
                was = self.companions_forwarding
                self.page_gathering = True
                if not was:
                    self.start_forwarding()

        self.js(f"callCompanion({_js_quote(cid)})", on_res)

    def dismiss_companions(self, _item: Any = None) -> None:
        if self.ready:
            self.js("dismiss()")

    def push_multi_pets(self) -> None:
        obj = {"on": self.multi_pets_on, "rest": self.pets_rest, "mainPet": self.main_pet}
        self.js(f"setMultiPets({json.dumps(obj, ensure_ascii=False)})")

    def set_companion_setting(self, key: str, value: Any) -> bool:
        if key == "multiPets":
            was = self.companions_forwarding
            self.config.set("multiPets", bool(value))
            self.push_multi_pets()
            self.apply_main_pet()
            if self.companions_forwarding and not was:
                self.start_forwarding()
            return True
        if key == "petsRest":
            if value in ("auto", "stay", "open"):
                self.config.set("petsRest", value)
                self.push_multi_pets()
            return True
        if key == "mainPet":
            if isinstance(value, str) and (not value or value in self.character_ids):
                self.config.set("mainPet", value)
                self.push_multi_pets()
                self.apply_main_pet()
            return True
        return False

    def apply_main_pet(self) -> None:
        mid = self.main_pet
        if self.multi_pets_on and mid and mid != self.current_id:
            self.switch_to(mid, why="manual", via="mainPet")

    def companions_setting_changed(self, key: str) -> None:
        if not self.companions:
            return
        if key == "size":
            for c in self.companions.values():
                c.apply_sizes(anchor="bottom")
        elif key in ("textSize", "textLinked"):
            for c in self.companions.values():
                c.apply_sizes(anchor="feet")
        elif key in ("showName", "showMinis", "minisFrom", "agyQuotaMode", "aura", "powerSave", "noSleep", "quotaStyle", "peakStyle"):
            self.companions_js(self.companion_look_js)
        elif key == "edgeDock" and not self.edge_dock_enabled:
            for c in self.companions.values():
                c.undock()

    @property
    def companion_look_js(self) -> str:
        return (
            f"setAuraMode({_js_quote(self.aura_mode)}); "
            f"setShowName({str(self.show_name).lower()}); "
            f"setShowMinis({str(self.show_minis).lower()}); "
            f"setMinisFrom({_js_quote(self.minis_from)}); "
            f"setAgyQuotaMode({_js_quote(self.agy_quota_mode)}); "
            f"setPowerSave({str(self.power_save).lower()}); "
            f"setNeverSleep({str(self.no_sleep).lower()}); "
            f"setQuotaAggregate(false); "
            f"setPeakStyle({_js_quote(self.peak_style)}); "
            f"setQuotaStyle({_js_quote(self.quota_style)})"
        )

    def companions_js(self, code: str) -> None:
        for c in list(self.companions.values()) + list(self.leaving_companions):
            c.js(code)

    def sync_companion_windows(self) -> None:
        for c in list(self.companions.values()) + list(self.leaving_companions):
            c.sync_with_main()

    def start_forwarding(self) -> None:
        for k in list(self.stamps.keys()):
            if "@" in k:
                del self.stamps[k]
        self.push_foreground()
        self.push_running(force=True)

    def poll_client_states(self) -> None:
        if not self.companions_forwarding or not self.state_dir.is_dir():
            return
        now = time.time()
        try:
            entries = list(self.state_dir.iterdir())
        except OSError:
            return
        for entry in entries:
            name = entry.name
            if not (name.endswith("-state.json") and "@" in name):
                continue
            key = name[: -len("-state.json")]
            ch, _, client = key.partition("@")
            if ch not in self.character_ids or not client:
                continue
            try:
                stamp = entry.stat().st_mtime
            except OSError:
                continue
            skey = key + "-state"
            if stamp == self.stamps.get(skey):
                continue
            self.stamps[skey] = stamp
            if now - stamp > 600:
                continue
            try:
                text = entry.read_text(encoding="utf-8")
                obj = json.loads(text)
                if not isinstance(obj, dict):
                    continue
            except (OSError, ValueError):
                continue
            self.client_state_seen.add(ch)
            self.client_states[key] = (text, stamp)
            if self.pause_real_events:
                continue
            self.js(f"applyClientState({_js_quote(ch)}, {_js_quote(client)}, {text})")
            for c in self.companions.values():
                if c.key == key:
                    c.apply_state(text, stamp)

    def note_char_state(self, cid: str, text: str, stamp: float) -> None:
        self.char_states[cid] = (text, stamp)
        if not self.companions_forwarding or self.pause_real_events or cid in self.client_state_seen:
            return
        for c in self.companions.values():
            if c.character == cid and c.client is not None:
                c.apply_state(text, stamp)

    def note_sessions(self, cid: str, text: str) -> None:
        self.sessions_text[cid] = text
        if not self.companions_forwarding or self.pause_real_events:
            return
        for c in self.companions.values():
            if c.character == cid:
                c.js(f"setSessions({_js_quote(cid)}, {self.sessions_for(c)})")

    def sessions_for(self, comp: Companion) -> str:
        if comp.client is None:
            return "{}"
        text = self.sessions_text.get(comp.character)
        if not text:
            return "{}"
        try:
            mp = json.loads(text)
            if not isinstance(mp, dict):
                return "{}"
        except ValueError:
            return "{}"
        mine = {
            k: v
            for k, v in mp.items()
            if ((v.get("client") if isinstance(v, dict) else None) or comp.character) == comp.client
        }
        return json.dumps(mine, ensure_ascii=False)

    def quota_js(self, character: str, code: str) -> None:
        self.js(code)
        fn = code.split("(", 1)[0]
        self.quota_seq += 1
        self.quota_code[f"{character}|{fn}"] = (self.quota_seq, code)
        for c in self.companions.values():
            if c.character == character and c.quota:
                c.js(code)

    def quota_codes(self, character: str) -> list[str]:
        items = [v for k, v in self.quota_code.items() if k.startswith(character + "|")]
        items.sort(key=lambda x: x[0])
        return [x[1] for x in items]

    def feed_companion(self, comp: Companion) -> None:
        if self.pause_real_events:
            return
        comp.js(f"setSessions({_js_quote(comp.character)}, {self.sessions_for(comp)})")
        now = time.time()
        if comp.client is not None:
            cs = self.client_states.get(comp.key)
            if cs and now - cs[1] < 600:
                comp.apply_state(cs[0], cs[1])
            elif comp.character not in self.client_state_seen:
                chs = self.char_states.get(comp.character)
                if chs and now - chs[1] < 600:
                    comp.apply_state(chs[0], chs[1])
        if comp.quota:
            for code in self.quota_codes(comp.character):
                comp.js(code)
        else:
            comp.js(f"setQuota({_js_quote(comp.character)}, null)")

    def foreground_info(self, win: ActiveWindow | None = None) -> dict[str, Any]:
        if win is None:
            win = self.wm.active_window()
        if win is None:
            return {"kind": "other"}
        if win.pid == os.getpid():
            return {"kind": "ours"}
        mapped, ident = self._map_window_to_target(win)
        if mapped:
            info: dict[str, Any] = {"kind": "ai", "character": self.host_character(mapped)}
            if any(i in self.CLAUDE_DESKTOP_CLASSES for i in win.identifiers):
                info["client"] = "claude-desktop"
            return info
        if any(i in TERMINAL_CLASSES for i in win.identifiers) or ident in TERMINAL_CLASSES:
            return {"kind": "terminal"}
        return {"kind": "other"}

    def push_foreground(self, win: ActiveWindow | None = None) -> None:
        if not self.ready or not self.companions_forwarding:
            return
        self.js(f"setForeground({json.dumps(self.foreground_info(win), ensure_ascii=False)})")

    def running_keys(self) -> list[str]:
        clients: set[str] = set()
        for ident in self.wm.running_classes():
            if ident in self.CLAUDE_DESKTOP_CLASSES:
                clients.add("claude-desktop")
            elif ident in self.CODEX_CLASSES:
                clients.add("codex")
            elif ident in self.AGY_CLASSES:
                clients.add("antigravity")
            else:
                host = self.host_app(ident)
                if host:
                    clients.add(host)
                elif ident in self.app_to_character:
                    clients.add(self.app_to_character[ident])
        return sorted(f"{cid}@{cl}" for cl in clients for cid in self.character_ids)

    def _timer_push_running(self) -> bool:
        try:
            self.push_running()
        except Exception as exc:
            app_log(f"定时任务出错（push_running）：{exc!r}")
        return True

    def push_running(self, force: bool = False) -> None:
        if not self.ready or not self.companions_forwarding:
            self.sent_running = None
            return
        payload = json.dumps(self.running_keys(), ensure_ascii=False)
        if not force and payload == self.sent_running:
            return
        self.sent_running = payload
        self.js(f"setRunning({payload})")

    def follow_foreground(self, cid: str, why: str, via: str, still: Callable[[], bool] | None = None) -> None:
        if not self.multi_pets_on:
            self.switch_to(cid, why=why, via=via)
            return
        standing = sorted({c.character for c in self.companions.values()})
        inp = {"foregroundId": cid, "current": self.current_id, "mainPet": self.main_pet, "standing": standing}
        arg = json.dumps(inp, ensure_ascii=False)

        def on_res(r: Any) -> None:
            if r == cid and cid != self.current_id and cid in self.character_ids and (still is None or still()):
                self.switch_to(cid, why=why, via=via)

        self.js(f"FollowPolicy.foregroundTarget(Object.assign({arg}, {{ mainClaimed: mainClaimed() }}))", on_res)

    # ---- Notebook ----

    def run_notebook_backfill(self) -> None:
        if self.notebook_backfilling:
            return
        self.notebook_backfilling = True

        def worker() -> None:
            t0 = time.monotonic()
            try:
                created = self.root.stat().st_ctime
            except OSError:
                created = time.time()
            files = scan_notebook_history(Path.home(), os.environ)
            count = sum(len(f.get("events") or []) for f in files)
            payload = {"installedAt": int(created * 1000), "files": files}
            js_payload = json.dumps(payload, ensure_ascii=False)
            took = time.monotonic() - t0

            def finish() -> bool:
                self.notebook_backfilling = False
                app_log(f"小本子补算：{count} 个事件，用时 {took:.1f}s")
                self.js(f"applyNotebookBackfill({js_payload})")
                return False

            GLib.idle_add(finish)

        threading.Thread(target=worker, name="crosspet-notebook-backfill", daemon=True).start()

    def open_own_notebook(self, _item: Any = None) -> None:
        if self.current_id:
            self.open_notebook(self.current_id, self.surface.rect, "main")

    def open_notebook(self, character: str, near: Rect, owner: str) -> None:
        self.close_notebook(animated=False)
        if not self.ready:
            return
        self.notebook_character = character
        self.notebook_owner = owner
        self.notebook_near = near
        self.notebook_closing = False
        surf = PetSurface(
            context=self.web_context,
            handler_name="notebook",
            on_message=self.handle_notebook,
            wm=self.wm,
            initial_rect=Rect(near.max_x, near.min_y, 408, 720),
            namespace="crosspet-notebook",
            keyboard_mode="on_demand",
            interactive_bridge=False,
        )
        surf.set_layer("overlay")
        surf.win.connect("focus-out-event", lambda _w, _e: (self.close_notebook(), False)[1])
        self.notebook_surface = surf
        surf.set_hidden(True)
        surf.show()
        surf.load_uri((self.root / "web" / "notebook.html").as_uri())

    def handle_notebook(self, body: Any) -> None:
        if not isinstance(body, dict) or self.notebook_surface is None or not self.notebook_character:
            return
        surf = self.notebook_surface
        ch = self.notebook_character
        if body.get("ready") is True:
            def on_view(val: Any) -> None:
                if self.notebook_surface is not surf or not isinstance(val, str):
                    self.close_notebook(animated=False)
                    return
                surf.js(f"render({val})")

            self.js(f"JSON.stringify(notebookFor({_js_quote(ch)}))", on_view)

        size = body.get("size")
        if isinstance(size, dict) and isinstance(size.get("w"), (int, float)) and isinstance(size.get("h"), (int, float)):
            w, h = float(size["w"]), float(size["h"])
            mons = self.wm.monitors()
            mon = next((m for m in mons if m.frame.intersects(self.notebook_near)), None)
            vf = mon.work_area if mon else self._primary_work_area()
            r = notebook_frame(self.notebook_near, w, h, vf)
            surf.set_geometry(r.x, r.y, r.w, r.h)
            if surf.hidden:
                surf.set_hidden(False)
                surf.win.present()
                GLib.timeout_add(50, lambda: (surf.js("openBook()") if self.notebook_surface is surf else None, False)[1])

        if body.get("closed") is True:
            self.close_notebook(animated=False)

    def close_notebook(self, animated: bool = True) -> None:
        surf = self.notebook_surface
        if surf is None:
            return
        if animated and surf.win.get_visible() and not self.notebook_closing:
            self.notebook_closing = True
            surf.js("closeBook()")
            GLib.timeout_add(1000, lambda: (self.close_notebook(animated=False) if self.notebook_surface is surf else None, False)[1])
            return
        self.notebook_surface = None
        self.notebook_character = None
        self.notebook_owner = None
        self.notebook_closing = False
        surf.close()

    # ---- Quota ----

    def _timer_quota(self) -> bool:
        try:
            self.refresh_codex_quota("tick")
            self.refresh_antigravity_quota()
        except Exception as exc:
            app_log(f"定时任务出错（quota）：{exc!r}")
        return True

    def refresh_codex_quota(self, why: str) -> None:
        if not self.ready or not self.config.get_bool("gptQuota", False) or self.codex_in_flight:
            return
        if why == "tick" and (self.screens_asleep or self.user_hidden):
            return
        since = time.monotonic() - self.codex_live_at
        if why == "now":
            due = True
        elif why == "turnEnd":
            due = since >= 20.0
        else:
            busy_ago = (time.time() - self.codex_busy_at) if self.codex_busy_at is not None else None
            due = CodexQuotaSource.codex_tick_due(since, busy_ago)
        if not due:
            return

        self.codex_live_at = time.monotonic()
        self.codex_in_flight = True

        def worker() -> None:
            binary = CodexQuotaSource.find_binary()
            if not binary:
                rl, err, ms = None, "没找到 codex 程序", 0
            else:
                rl, err, ms = CodexQuotaSource.query_live(binary)

            def finish() -> bool:
                self.codex_in_flight = False
                self._apply_codex(rl, err, ms)
                return False

            GLib.idle_add(finish)

        threading.Thread(target=worker, name="crosspet-codex-quota", daemon=True).start()

    def _apply_codex(self, rl: dict[str, Any] | None, err: str | None, ms: int) -> None:
        if not self.config.get_bool("gptQuota", False):
            return
        now = time.time()
        if rl is not None:
            self.codex_last = (rl, now)
            self.codex_note = ""
        elif self.codex_last is None:
            self.codex_note = f"问不到 Codex：{err or '原因不明'}"
        if rl is None:
            app_log(f"GPT 额度查询失败：{err or '原因不明'}")
        tag = f"Codex 服务，{ms / 1000:.1f} 秒" if rl is not None else f"没问到：{err or '原因不明'}"
        extra = ""
        if self.codex_last is not None:
            prefix = f"沿用 {_hm(self.codex_last[1])} 的数：" if rl is None else ""
            extra = prefix + CodexQuotaSource.brief(self.codex_last[0])
        self.last_gpt_quota = f"{_clock()} （{tag}）{extra}"
        self.push_settings()
        if self.codex_last is None:
            self.quota_js("gpt", "setCodexQuota(null)")
            return
        payload = CodexQuotaSource.payload("live" if rl is not None else "stale", self.codex_last[0], err, ms)
        payload["at"] = self.codex_last[1]
        self.quota_js("gpt", f"setCodexQuota({json.dumps(payload, ensure_ascii=False)})")

    def refresh_antigravity_quota(self) -> None:
        if not self.ready or not self.config.get_bool("agyQuota", False):
            return

        def worker() -> None:
            hub = AntigravityQuota.antigravity_hub(AntigravityQuota.daemon_dir())
            if hub is not None:
                pid, token, port = hub
                ports = [self.agy_port[1]] if (self.agy_port and self.agy_port[0] == pid) else ([port] if port else AntigravityQuota.listening_ports(pid))
                src_note = "daemon 文件"
            else:
                srv = AntigravityQuota.antigravity_server()
                if srv is None:
                    def no_srv() -> bool:
                        self._push_agy_stale()
                        self.last_agy_note = f"{_clock()} 没找到 Antigravity 的服务进程（daemon/hub_*.json 和启动参数里都没有令牌）"
                        return False

                    GLib.idle_add(no_srv)
                    return
                pid, token = srv
                ports = [self.agy_port[1]] if (self.agy_port and self.agy_port[0] == pid) else AntigravityQuota.listening_ports(pid)
                src_note = "启动参数"

            note = f"{_clock()} 找到服务进程（令牌来自{src_note}），端口 {len(ports)} 个"
            parsed, ok_port = AntigravityQuota.query_ports(pid, token, ports)

            def finish() -> bool:
                self.last_agy_note = note
                if parsed is not None and ok_port is not None:
                    self.agy_port = (pid, ok_port)
                    self.agy_last = (parsed, time.time())
                    self.quota_js("gemini", f"setQuota('gemini', {json.dumps(parsed, ensure_ascii=False)})")
                else:
                    self.agy_port = None
                    self._push_agy_stale()
                return False

            GLib.idle_add(finish)

        threading.Thread(target=worker, name="crosspet-agy-quota", daemon=True).start()

    def _push_agy_stale(self) -> None:
        if not self.config.get_bool("agyQuota", False):
            return
        if self.agy_last is None:
            self.quota_js("gemini", "setQuota('gemini', null)")
            return
        q = dict(self.agy_last[0])
        q["source"] = "stale"
        q["at"] = self.agy_last[1]
        self.quota_js("gemini", f"setQuota('gemini', {json.dumps(q, ensure_ascii=False)})")

    # ---- Integrations ----

    @property
    def integrate_script(self) -> Path | None:
        p = self.src_root / "tools" / "integrate.py"
        return p if p.exists() else None

    def run_integrate(self, args: list[str], done: Callable[[str, int], None]) -> None:
        script = self.integrate_script
        if script is None:
            done("App 里没有接入工具", -1)
            return

        def worker() -> None:
            env = dict(os.environ)
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            try:
                res = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, env=env, timeout=15)
                out = (res.stdout or "") + (res.stderr or "")
                code = res.returncode
            except Exception as exc:
                out = str(exc)
                code = -1
            GLib.idle_add(lambda: (done(out, code), False)[1])

        threading.Thread(target=worker, name="crosspet-integrate", daemon=True).start()

    @property
    def last_seen(self) -> dict[str, float]:
        raw = self.config.get_dict("seen")
        return {k: float(v) for k, v in raw.items() if isinstance(v, (int, float))}

    def refresh_seen(self) -> None:
        seen = self.last_seen
        changed = False
        for key in set(self.SEEN_KEYS.values()):
            p = self.state_dir / f"seen-{key}"
            try:
                txt = p.read_text(encoding="utf-8").strip().strip('"')
                ts = float(txt)
            except (OSError, ValueError):
                continue
            if ts > seen.get(key, 0.0):
                seen[key] = ts
                changed = True
        if changed:
            self.config.set("seen", seen)
            if self.settings_web is not None:
                self.push_settings()

    def _timer_watch_claude(self) -> bool:
        try:
            self.refresh_seen()
            if not self.ready:
                return True
            claude_cfg = Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude")) / "settings.json"
            try:
                stamp = claude_cfg.stat().st_mtime
            except OSError:
                return True
            if stamp != self._claude_config_stamp:
                self._claude_config_stamp = stamp
                if self._heal_pending is not None:
                    GLib.source_remove(self._heal_pending)
                self._heal_pending = GLib.timeout_add(2000, lambda: (self._heal_integrations(), False)[1])
        except Exception as exc:
            app_log(f"定时任务出错（watch_claude）：{exc!r}")
        return True

    def _heal_integrations(self) -> None:
        self._heal_pending = None
        now = time.time()
        self._heal_times = [t for t in self._heal_times if now - t < 3600]
        if len(self._heal_times) >= 6 or self.integrate_script is None:
            return

        def done(out: str, code: int) -> None:
            if code != 0:
                return
            last = out.strip().splitlines()[-1] if out.strip() else "[]"
            try:
                healed = json.loads(last)
            except ValueError:
                return
            if isinstance(healed, list) and healed:
                self._heal_times.append(time.time())
                app_log(f"接回被冲掉的接入 {healed}")
                self.js("configHealed()")
                self.refresh_integrated()

        self.run_integrate(["heal"], done)

    def refresh_integrated(self) -> None:
        def done(out: str, _code: int) -> None:
            last = out.strip().splitlines()[-1] if out.strip() else "[]"
            try:
                lst = json.loads(last)
                self.integrated = lst if isinstance(lst, list) else []
            except ValueError:
                self.integrated = []
            self.push_settings()

        self.run_integrate(["installed"], done)
        self.refresh_plugins()

    def refresh_plugins(self, tell_pet: bool = False) -> None:
        def done(out: str, code: int) -> None:
            if code != 0:
                return
            last = out.strip().splitlines()[-1] if out.strip() else ""
            try:
                obj = json.loads(last)
            except ValueError:
                return
            if isinstance(obj, list):
                self.plugin_status = last
                if tell_pet:
                    self.js(f"setPluginUpdates({last})")
                self.push_settings()

        self.run_integrate(["plugins"], done)

    def integrate(self, action: str, target: str) -> None:
        t = next((x for x in self.INTEGRATION_TARGETS if x[0] == target), None)
        if t is None or action not in ("install", "uninstall"):
            return

        def done(out: str, code: int) -> None:
            missing = "没找到" in out
            title = f"{t[1]}：" + (
                "没有完成" if code != 0 else "没有接入：没找到这个 AI 的配置" if missing else "已接入" if action == "install" else "已撤销"
            )
            detail = "\n".join(line for line in out.strip().splitlines() if "已备份" not in line)
            self._show_dialog(title, detail, is_warning=(code != 0 or missing))
            self.refresh_integrated()

        self.run_integrate([action, target], done)

    # ---- Hotkey & Autostart ----

    def _register_hotkey(self) -> None:
        self.hotkey_failed = False
        if self.wm.name != "x11":
            self.tray.refresh_menu()
            return
        hk = self.hide_hotkey
        if hk == "off":
            self.wm.unregister_hotkey()
        else:
            ok = self.wm.register_hotkey(hk, self.toggle_hidden)
            self.hotkey_failed = not ok
        self.tray.refresh_menu()

    @property
    def _autostart_desktop_path(self) -> Path:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg) if xdg else (Path.home() / ".config")
        return base / "autostart" / "crosspet.desktop"

    def is_login_autostart(self) -> bool:
        return self._autostart_desktop_path.exists()

    def toggle_login(self) -> None:
        p = self._autostart_desktop_path
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass
            return
        local_bin = Path.home() / ".local" / "bin" / "crosspet"
        exec_cmd = str(local_bin) if local_bin.exists() else (shutil.which("crosspet") or f"{sys.executable} -m app.linux.main")
        content = (
            "[Desktop Entry]\n"
            "Type=Application\n"
            "Name=CrossPet\n"
            "Comment=Cross-AI Desktop Pet\n"
            f"Exec={exec_cmd}\n"
            "Icon=crosspet\n"
            "Terminal=false\n"
            "Categories=Utility;\n"
            "X-GNOME-Autostart-enabled=true\n"
        )
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
        except OSError as exc:
            self._show_dialog("设置失败", str(exc), is_warning=True)

    # ---- Context Menu & Actions ----

    def _on_pet_click(self, cx: float, cy: float) -> None:
        self.js(f"handleClick('pat', {cx:.1f}, {cy:.1f})")

    def _on_pet_drag_start(self) -> None:
        self.close_notebook()
        self.undock()

    def _on_pet_drag_end(self, shook: bool) -> None:
        self.config.set("origin", [self.surface.rect.x, self.surface.rect.y])
        if not shook:
            self.check_dock()

    def _on_pet_menu(self, ev: Gdk.EventButton, shift: bool) -> None:
        menu = self.build_menu(show_dev=shift)
        menu.show_all()
        menu.popup_at_pointer(ev)

    def build_menu(self, show_dev: bool = False) -> Gtk.Menu:
        menu = Gtk.Menu()
        if self.latest_release is not None:
            tag, _url = self.latest_release
            it = Gtk.MenuItem(label=f"⬆️ 有新版本 {tag}，点这里下载")
            it.connect("activate", lambda _i: self.open_release())
            menu.append(it)
            menu.append(Gtk.SeparatorMenuItem())

        for label, cb in (
            ("摸摸头", lambda _i: self.js("handleClick('pat')")),
            ("戳一下", lambda _i: self.js("handleClick('poke')")),
            ("我们的小本子", self.open_own_notebook),
        ):
            it = Gtk.MenuItem(label=label)
            it.connect("activate", cb)
            menu.append(it)

        egg_item = Gtk.MenuItem(label="召唤彩蛋")
        if self.egg_allowed:
            egg_item.connect("activate", lambda _i: self.js("playEgg(true)"))
        else:
            egg_item.set_sensitive(False)
        menu.append(egg_item)

        gather_item = Gtk.MenuItem(label="集合！")
        gather_item.connect("activate", self.gather_companions)
        menu.append(gather_item)

        if self.page_gathering:
            dismiss_item = Gtk.MenuItem(label="解散")
            dismiss_item.connect("activate", self.dismiss_companions)
            menu.append(dismiss_item)

        others = [cid for cid in self.character_ids if cid != self.current_id]
        if others:
            standing = {c.character for c in self.companions.values()}
            call_item = Gtk.MenuItem(label="叫她出来")
            sub = Gtk.Menu()
            for cid in others:
                it = Gtk.CheckMenuItem(label=self.display_names.get(cid, cid))
                if cid in standing:
                    it.set_active(True)
                    it.set_sensitive(False)
                else:
                    it.connect("activate", lambda _i, c=cid: self.call_companion(c))
                sub.append(it)
            call_item.set_submenu(sub)
            menu.append(call_item)

        if self.codex_resets and self.current_id == "gpt":
            rst = Gtk.MenuItem(label="会重置吗？")
            rst.connect("activate", lambda _i: self.js("askReset()"))
            menu.append(rst)

        if len(self.character_ids) > 1:
            menu.append(Gtk.SeparatorMenuItem())
            sw_item = Gtk.MenuItem(label="换角色")
            sub = Gtk.Menu()
            worn = self.config.get_dict("skins")
            for cid in self.character_ids:
                cname = self.display_names.get(cid, cid)
                skins = self.skin_choices.get(cid) or []
                outfits = [("", f"{cname} · {self.base_outfit.get(cid) or '原版'}")] + [(s[0], f"{cname} · {s[1]}") for s in skins] if skins else [("", cname)]
                for sid, title in outfits:
                    it = Gtk.CheckMenuItem(label=title)
                    it.set_active(cid == self.current_id and worn.get(cid, "") == sid)
                    it.connect("activate", lambda _i, c=cid, s=sid: self._menu_switch_character(c, s))
                    sub.append(it)
            sub.append(Gtk.SeparatorMenuItem())
            cards_item = Gtk.MenuItem(label="看图选…")
            cards_item.connect("activate", lambda _i: self.open_character_page())
            sub.append(cards_item)
            sw_item.set_submenu(sub)
            menu.append(sw_item)

        menu.append(Gtk.SeparatorMenuItem())
        layer_item = Gtk.MenuItem(label="显示层级")
        layer_sub = Gtk.Menu()
        for mode, title in (
            ("always", "始终在最上层"),
            ("ai", "跟着 AI（用 AI 时才浮在最上层）"),
            ("normal", "普通窗口（不置顶）"),
        ):
            it = Gtk.CheckMenuItem(label=title)
            it.set_active(self.layer_mode == mode)
            it.connect("activate", lambda _i, m=mode: self._set_layer_mode(m))
            layer_sub.append(it)
        layer_item.set_submenu(layer_sub)
        menu.append(layer_item)

        for label, cb in (
            ("设置…", lambda _i: self.open_settings_at(None)),
            ("反馈问题…", lambda _i: self.open_feedback()),
        ):
            it = Gtk.MenuItem(label=label)
            it.connect("activate", cb)
            menu.append(it)

        if show_dev:
            dev_item = Gtk.MenuItem(label="开发者控制台…")
            dev_item.connect("activate", lambda _i: self.open_dev_console())
            menu.append(dev_item)

        reset_item = Gtk.MenuItem(label="回到右下角")
        reset_item.connect("activate", lambda _i: self.reset_position())
        menu.append(reset_item)

        hide_label = "显示桌宠" if self.user_hidden else ("暂时隐藏（Ctrl+Alt+" + self.hide_hotkey.upper() + "）" if self.wm.name == "x11" and self.hide_hotkey != "off" else "暂时隐藏")
        hide_item = Gtk.MenuItem(label=hide_label)
        hide_item.connect("activate", lambda _i: self.toggle_hidden())
        menu.append(hide_item)

        menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem(label="退出 CrossPet")
        quit_item.connect("activate", self.quit)
        menu.append(quit_item)
        return menu

    def _menu_switch_character(self, cid: str, skin: str) -> None:
        if self.skin_choices.get(cid):
            self.wear(cid, skin)
            self.switch_to(cid, why="skin", via=skin)
        else:
            self.switch_to(cid, why="manual", via="menu")
        self.push_settings()

    def _set_layer_mode(self, mode: str) -> None:
        self.config.set("layer", mode)
        app_log(f"显示层级改成 {mode}")
        self.apply_layer()
        self.tray.refresh_menu()

    def reset_position(self) -> None:
        self.undock()
        wa = self._primary_work_area()
        nx = wa.max_x - self.surface.rect.w - 40.0
        ny = wa.max_y - self.surface.rect.h - 100.0
        self.surface.set_geometry(nx, ny, self.surface.rect.w, self.surface.rect.h)
        self.config.remove("origin")

    def bring_to_front(self) -> None:
        mons = self.wm.monitors()
        r = self.surface.rect.inset(40, 40)
        if mons and not any(m.work_area.intersects(r) for m in mons):
            self.reset_position()
        self.set_user_hidden(False)
        self.fullscreen_override = True
        self.hidden_for_fullscreen = False
        self.apply_hidden_state()
        self.apply_layer()
        self.js("handleClick('pat')")

    def toggle_hidden(self) -> None:
        self.set_user_hidden(not self.user_hidden)

    def set_user_hidden(self, hidden: bool) -> None:
        if hidden == self.user_hidden:
            return
        self.user_hidden = hidden
        if hidden:
            self.close_notebook()
        else:
            self.fullscreen_override = True
            self.hidden_for_fullscreen = False
        self.apply_hidden_state()
        self.sync_companion_windows()
        self.apply_layer()
        self.tray.refresh_menu()

    # ---- Secondary Windows (Settings, Characters, Feedback, DevConsole) ----

    def _fit_height(self, desired: int) -> int:
        wa = self._primary_work_area()
        return min(desired, max(400, int(wa.h) - 60))

    def _open_secondary(
        self,
        title: str,
        wm_class: str,
        width: int,
        height: int,
        html_rel: str,
        handler_name: str,
        on_msg: Callable[[Any], None],
        on_load: Callable[[WebKit2.WebView], None],
        on_close: Callable[[], None],
    ) -> tuple[Gtk.Window, WebKit2.WebView]:
        win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        win.set_title(title)
        win.set_wmclass(wm_class, "CrossPet")
        win.set_default_size(width, height)
        win.set_position(Gtk.WindowPosition.CENTER)
        icon = self.src_root / "app" / "icon" / "AppIcon.png"
        if icon.exists():
            try:
                win.set_icon_from_file(str(icon))
            except Exception:
                pass
        wv = create_webview(self.web_context, handler_name, on_msg, transparent=False)
        wv.connect("load-changed", lambda w, ev: on_load(w) if ev == WebKit2.LoadEvent.FINISHED else None)
        win.add(wv)
        win.connect("delete-event", lambda *_a: (on_close(), False)[1])
        win.show_all()
        win.present()
        wv.load_uri((self.root / html_rel).as_uri())
        return win, wv

    def open_settings_at(self, tab: str | None) -> None:
        if self.settings_win is not None:
            if tab:
                eval_js(self.settings_web, f"showTab({_js_quote(tab)})")
            self.settings_win.present()
            return
        self.pending_settings_tab = tab

        def on_load(wv: WebKit2.WebView) -> None:
            self.push_settings()
            if self.pending_settings_tab:
                t = self.pending_settings_tab
                self.pending_settings_tab = None
                eval_js(wv, f"showTab({_js_quote(t)})")

        def on_close() -> None:
            self.settings_win = None
            self.settings_web = None

        self.settings_win, self.settings_web = self._open_secondary(
            "CrossPet 设置",
            "crosspet-settings",
            560,
            self._fit_height(780),
            "web/settings.html",
            "settings",
            self.handle_settings,
            on_load,
            on_close,
        )

    def open_character_page(self) -> None:
        if self.characters_win is not None:
            self.characters_win.present()
            return

        def on_close() -> None:
            self.characters_win = None
            self.characters_web = None

        self.characters_win, self.characters_web = self._open_secondary(
            "CrossPet 换角色",
            "crosspet-characters",
            760,
            self._fit_height(740),
            "web/characters.html",
            "settings",
            self.handle_settings,
            lambda _w: self.push_settings(),
            on_close,
        )

    def open_feedback(self) -> None:
        if self.feedback_win is not None:
            self.feedback_win.present()
            return

        def on_close() -> None:
            self.feedback_win = None
            self.feedback_web = None

        self.feedback_win, self.feedback_web = self._open_secondary(
            "CrossPet 反馈问题",
            "crosspet-feedback",
            560,
            self._fit_height(700),
            "web/feedback.html",
            "feedback",
            self.handle_feedback,
            lambda _w: None,
            on_close,
        )

    def open_dev_console(self) -> None:
        if self.dev_win is not None:
            self.dev_win.present()
            return

        def on_load(wv: WebKit2.WebView) -> None:
            info = json.dumps({"version": self.version, "feedbackPath": str(self.feedback_file)}, ensure_ascii=False)
            eval_js(wv, f"setAppInfo({info}); boot({self.manifest_json})")

        def on_close() -> None:
            self.pause_real_events = False
            self.js("devRelease()")
            self.dev_win = None
            self.dev_web = None

        self.dev_win, self.dev_web = self._open_secondary(
            "CrossPet 开发者控制台",
            "crosspet-devconsole",
            1060,
            760,
            "web/devconsole.html",
            "dev",
            self.handle_dev,
            on_load,
            on_close,
        )

    def _show_dialog(self, title: str, message: str, is_warning: bool = False) -> None:
        dlg = Gtk.MessageDialog(
            transient_for=self.settings_win,
            flags=0,
            message_type=Gtk.MessageType.WARNING if is_warning else Gtk.MessageType.INFO,
            buttons=Gtk.ButtonsType.OK,
            text=title,
        )
        if message:
            dlg.format_secondary_text(message)
        dlg.run()
        dlg.destroy()

    @staticmethod
    def _open_external(target: str) -> None:
        try:
            subprocess.Popen(["xdg-open", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # ---- Settings Bridge ----

    def settings_state(self) -> dict[str, Any]:
        names = self.config.get_dict("names")
        skins_cfg = self.config.get_dict("skins")
        is_x11 = self.wm.name == "x11"
        hotkeys = (
            [{"id": "off", "label": "不用快捷键"}, {"id": "p", "label": "Ctrl+Alt+P"}, {"id": "h", "label": "Ctrl+Alt+H"}]
            if is_x11
            else [{"id": "wayland", "label": "由窗口管理器绑定（crosspet --toggle）"}]
        )
        hotkey_note = (
            None
            if is_x11
            else f"Wayland（{self.wm.name}）请在窗口管理器配置中绑定 crosspet --toggle（如 Hyprland：bind = CTRL ALT, P, exec, crosspet --toggle）"
        )
        try:
            plugins_obj = json.loads(self.plugin_status)
        except ValueError:
            plugins_obj = []

        chars_list = []
        for cid in self.character_ids:
            c: dict[str, Any] = {
                "id": cid,
                "name": self.display_names.get(cid, cid),
                "defaultName": self.default_names.get(cid, cid),
                "custom": names.get(cid, ""),
                "images": self.card_images(cid),
            }
            if cid in self.accents:
                c["accent"] = self.accents[cid]
            skins = self.skin_choices.get(cid) or []
            if skins:
                c["skins"] = [{"id": "", "name": self.base_outfit.get(cid) or "原版", "images": self.card_images(cid)}] + [
                    {"id": sid, "name": sname, "images": self.card_images(sid)} for sid, sname in skins
                ]
                c["skin"] = skins_cfg.get(cid, "")
            chars_list.append(c)

        state: dict[str, Any] = {
            "version": self.version,
            "appVersion": self.version,
            "whatsNewSeen": self.config.get_str("whatsNewSeen", self.version),
            "platform": "linux",
            "size": self.pet_scale,
            "textSize": self.text_scale,
            "textLinked": self.text_linked,
            "showName": self.show_name,
            "showMinis": self.show_minis,
            "minisFrom": self.minis_from,
            "eggs": self.eggs_enabled,
            "hideFullscreen": self.hide_in_fullscreen,
            "aura": self.aura_mode,
            "followApps": self.follow_apps,
            "followEvents": self.follow_events,
            "gptQuota": self.config.get_bool("gptQuota", False),
            "agyQuota": self.config.get_bool("agyQuota", False),
            "agyQuotaMode": self.agy_quota_mode,
            "gptQuotaNote": self.codex_note,
            "login": self.is_login_autostart(),
            "edgeDock": self.edge_dock_enabled,
            "dsQuota": self.ds_quota_enabled,
            "quotaAggregate": self.quota_aggregate,
            "codexResets": self.codex_resets,
            "peakStyle": self.peak_style,
            "quotaStyle": self.quota_style,
            "peakSkins": self.peak_skins,
            "powerSave": self.power_save,
            "noSleep": self.no_sleep,
            "sitRemind": self.config.get_bool("sitRemind", False),
            "sitEvery": self.break_every("sitEvery", 45),
            "waterRemind": self.config.get_bool("waterRemind", False),
            "waterEvery": self.break_every("waterEvery", 60),
            "hideHotkey": self.hide_hotkey if is_x11 else "wayland",
            "hotkeyFailed": self.hotkey_failed,
            "hotkeys": hotkeys,
            "aiAutostart": self.ai_autostart,
            "multiPets": self.multi_pets_on,
            "petsRest": self.pets_rest,
            "mainPet": self.main_pet,
            "friendship": self.friendship_rows,
            "character": self.current_id or (self.character_ids[0] if self.character_ids else ""),
            "characters": chars_list,
            "updating": self.updating,
            "plugins": plugins_obj,
        }
        if hotkey_note:
            state["hotkeyNote"] = hotkey_note
        if self.latest_release is not None:
            state["update"] = self.latest_release[0]
        if self.integrated is not None and self.integrate_script is not None:
            seen = self.last_seen
            now = time.time()
            state["integrations"] = [
                {
                    "id": tid,
                    "label": label,
                    "note": note,
                    "installed": tid in self.integrated,
                    "lastSeen": (now - seen[self.SEEN_KEYS[tid]]) if self.SEEN_KEYS.get(tid) in seen else None,
                }
                for tid, label, note in self.INTEGRATION_TARGETS
            ]
        return state

    def push_settings(self) -> None:
        if self.settings_web is None and self.characters_web is None:
            return

        def on_char_id(val: Any) -> None:
            if self.current_id is None and isinstance(val, str) and val in self.character_ids:
                self.current_id = val
            text = json.dumps(self.settings_state(), ensure_ascii=False)
            for wv in (self.settings_web, self.characters_web):
                if wv is not None:
                    eval_js(wv, f"setState({text})")

        self.js("charId", on_char_id)

    def handle_settings(self, msg: Any) -> None:
        if not isinstance(msg, dict) or not isinstance(msg.get("cmd"), str):
            return
        cmd = msg["cmd"]
        if cmd == "set":
            key = msg.get("key")
            if not isinstance(key, str):
                return
            val = msg.get("value")
            if self.set_companion_setting(key, val):
                self.push_settings()
                return
            if key == "size" and isinstance(val, (int, float)):
                v = min(1.6, max(0.6, round(float(val) * 100.0) / 100.0))
                self.config.set("size", v)
                self.apply_sizes(animate_to=v)
            elif key == "textSize" and isinstance(val, (int, float)):
                v = min(1.6, max(0.6, round(float(val) * 100.0) / 100.0))
                self.config.set("textSize", v)
                self.config.set("textLinked", False)
                self.apply_sizes()
            elif key == "textLinked":
                self.config.set("textLinked", bool(val))
                self.apply_sizes()
            elif key == "showName":
                on = bool(val)
                self.config.set("showName", on)
                self.js(f"setShowName({str(on).lower()})")
            elif key == "showMinis":
                on = bool(val)
                self.config.set("showMinis", on)
                self.js(f"setShowMinis({str(on).lower()})")
            elif key == "agyQuotaMode" and val in ("week", "cg"):
                self.config.set("agyQuotaMode", val)
                self.js(f"setAgyQuotaMode({_js_quote(val)})")
            elif key == "minisFrom" and val in ("own", "all"):
                self.config.set("minisFrom", val)
                self.js(f"setMinisFrom({_js_quote(val)})")
            elif key == "aura" and val in ("auto", "on", "off"):
                self.config.set("auraMode", val)
                self.js(f"setAuraMode({_js_quote(val)})")
            elif key == "followApps":
                self.config.set("followApps", bool(val))
            elif key == "followEvents":
                self.config.set("followEvents", bool(val))
            elif key == "hideFullscreen":
                self.config.set("hideFullscreen", bool(val))
                self.check_fullscreen()
            elif key == "eggs":
                on = bool(val)
                self.config.set("eggs", on)
                self.js(f"setEggsEnabled({str(on).lower()})")
            elif key == "gptQuota":
                if bool(val) != self.config.get_bool("gptQuota", False):
                    on = not self.config.get_bool("gptQuota", False)
                    self.config.set("gptQuota", on)
                    if on:
                        self.refresh_codex_quota("now")
                    else:
                        self.quota_js("gpt", "setCodexQuota(null)")
            elif key == "agyQuota":
                if bool(val) != self.config.get_bool("agyQuota", False):
                    on = not self.config.get_bool("agyQuota", False)
                    self.config.set("agyQuota", on)
                    if on:
                        self.refresh_antigravity_quota()
                    else:
                        self.agy_last = None
                        self.quota_js("gemini", "setQuota('gemini', null)")
            elif key == "hideHotkey" and isinstance(val, str) and val in ("off", "p", "h"):
                self.config.set("hideHotkey", val)
                self._register_hotkey()
            elif key == "powerSave":
                on = bool(val)
                self.config.set("powerSave", on)
                self.js(f"setPowerSave({str(on).lower()})")
            elif key == "noSleep":
                on = bool(val)
                self.config.set("noSleep", on)
                self.js(f"setNeverSleep({str(on).lower()})")
            elif key in ("sitRemind", "waterRemind"):
                self.config.set(key, bool(val))
                self.js(self.break_reminders_js)
            elif key in ("sitEvery", "waterEvery") and isinstance(val, (int, float)) and int(val) in self.BREAK_CHOICES:
                self.config.set(key, int(val))
                self.js(self.break_reminders_js)
            elif key == "quotaAggregate":
                on = bool(val)
                self.config.set("quotaAggregate", on)
                self.js(f"setQuotaAggregate({str(on).lower()})")
            elif key == "whatsNewSeen" and isinstance(val, str):
                self.config.set("whatsNewSeen", val)
            elif key == "codexResets":
                on = bool(val)
                self.config.set("codexResets", on)
                self.js(f"setCodexResets({str(on).lower()})")
            elif key == "peakSkins":
                self.config.set("peakSkins", self.clean_peak_skins(val))
                self.js(f"setPeakSkins({self.peak_skins_json})")
            elif key == "quotaStyle" and val in ("text", "bars"):
                self.config.set("quotaStyle", val)
                self.js(f"setQuotaStyle({_js_quote(val)})")
            elif key == "peakStyle" and val in ("bar", "text", "off"):
                self.config.set("peakStyle", val)
                self.js(f"setPeakStyle({_js_quote(val)})")
            elif key == "dsQuota":
                on = bool(val)
                self.config.set("dsQuota", on)
                self.stamps.pop("deepseek-quota", None)
                if not on:
                    self.quota_js("deepseek", "setQuota('deepseek', null)")
            elif key == "edgeDock":
                on = bool(val)
                self.config.set("edgeDock", on)
                if not on:
                    self.undock()
            elif key == "aiAutostart":
                self.set_ai_autostart(bool(val))
            elif key == "login":
                if bool(val) != self.is_login_autostart():
                    self.toggle_login()
            elif key == "character" and isinstance(val, str) and val in self.character_ids:
                self.switch_to(val, why="manual", via="settings")
            self.companions_setting_changed(key)
            self.push_settings()
        elif cmd == "integrate":
            target, action = msg.get("target"), msg.get("action")
            if isinstance(target, str) and isinstance(action, str):
                self.integrate(action, target)
        elif cmd == "skin":
            cid, skin = msg.get("id"), msg.get("skin")
            if isinstance(cid, str) and cid in self.character_ids and isinstance(skin, str):
                self.wear(cid, skin)
                self.switch_to(cid, why="skin", via=skin)
                self.push_settings()
        elif cmd == "rename":
            cid = msg.get("id")
            if isinstance(cid, str) and cid in self.character_ids:
                names = self.config.get_dict("names")
                val = str(msg.get("name") or "").strip()
                if not val:
                    names.pop(cid, None)
                else:
                    names[cid] = val
                self.config.set("names", names)
                self.load_characters()
                new_name = self.display_names.get(cid, cid)
                self.js(f"setName({_js_quote(cid)}, {_js_quote(new_name)})")
                self.companions_js(f"setName({_js_quote(cid)}, {_js_quote(new_name)})")
                self.push_settings()
        elif cmd == "action":
            name = msg.get("name")
            if name == "update":
                self.open_release()
            elif name == "checkUpdate":
                self.check_for_update(manual=True)
            elif name == "openCharacters":
                self._open_external(str(self.characters_dir))
            elif name == "openCodexResets":
                self._open_external("https://codex-resets.com")
            elif name == "openData":
                self._open_external(str(self.root))
            elif name == "openReleases":
                self._open_external(f"https://github.com/{self.REPO_SLUG}/releases")
            elif name == "devConsole":
                self.open_dev_console()
            elif name == "feedback":
                self.open_feedback()
            elif name == "characterWindow":
                self.open_character_page()
            self.push_settings()
        else:
            if self.integrated is None:
                self.refresh_integrated()
            self.push_settings()

    # ---- Dev Console ----

    def handle_dev(self, msg: Any) -> None:
        if not isinstance(msg, dict) or not isinstance(msg.get("cmd"), str):
            return
        cmd = msg["cmd"]
        if cmd == "pet":
            if isinstance(msg.get("code"), str):
                self.js(msg["code"])
        elif cmd == "status":
            self.js("JSON.stringify(devStatus())", lambda r: self.dev_js(f"onPetStatus({r})") if isinstance(r, str) else None)
        elif cmd == "pause":
            self.pause_real_events = bool(msg.get("on", False))
        elif cmd == "save":
            text = str(msg.get("text") or "")
            try:
                self.feedback_file.write_text(text, encoding="utf-8")
            except OSError:
                pass
            try:
                cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
                cb.set_text(text, -1)
            except Exception:
                pass
            self.dev_js(f"onSaved({_js_quote(str(self.feedback_file))})")
        elif cmd == "reveal":
            self._open_external(str(self.root))
        elif cmd == "reload":
            self.surface.reload()

    # ---- Feedback ----

    @property
    def install_id(self) -> str:
        iid = self.config.get_str("installId")
        if iid:
            return iid
        iid = str(uuid.uuid4())
        self.config.set("installId", iid)
        return iid

    @staticmethod
    def redact(text: str) -> str:
        s = text.replace(str(Path.home()), "~")
        s = re.sub(r"\x1B\[[0-9;]*[A-Za-z]", "", s)
        s = re.sub(r"(/home/|/Users/|\\Users\\)[^/\\\s]+", r"\1<user>", s)
        s = re.sub(r"sk-[A-Za-z0-9_\-]{8,}", "sk-***", s)
        s = re.sub(r"(?i)(bearer|token|key|secret|password)([\s\"':=]+)[A-Za-z0-9_\-\.]{8,}", r"\1\2***", s)
        return s

    def feedback_facts(self, sections: dict[str, str], key: str | None = None) -> dict[str, Any]:
        skins = self.config.get_dict("skins")
        quotas = []
        if self.config.get_bool("gptQuota", False):
            quotas.append("gpt")
        if self.config.get_bool("agyQuota", False):
            quotas.append("gemini")
        if self.ds_quota_enabled:
            quotas.append("deepseek")
        header = {
            "version": self.version,
            "platform": "linux",
            "os": f"{_os_summary()} ({self.wm.name})",
            "install": self.install_id,
            "character": self.current_id or "",
            "skin": skins.get(self.current_id or "", ""),
            "uptimeMin": int((time.time() - self.launched_at) / 60),
        }
        chars = [{"id": cid, "name": self.display_names.get(cid, cid)} for cid in self.character_ids]
        facts: dict[str, Any] = {
            "header": header,
            "integrations": self.integrated or [],
            "characters": chars,
            "quotas": quotas,
            "sections": {k: self.redact(v) for k, v in sections.items()},
        }
        if key is not None:
            facts["key"] = key
        return facts

    def displays_summary(self) -> str:
        mons = self.wm.monitors()
        if not mons:
            return f"WM：{self.wm.name}；层级 {self.layer_mode}"
        cur = self.surface.current_monitor()
        parts = []
        for i, m in enumerate(mons):
            here = "（桌宠在这）" if cur and m.name == cur.name else ""
            parts.append(f"{m.name} {int(m.w)}×{int(m.h)}@{m.scale:g}x{here}")
        flags = [f"WM {self.wm.name}", f"层级 {self.layer_mode}", "全屏隐藏" if self.hide_in_fullscreen else "全屏不隐藏"]
        if self.dock:
            flags.append(f"贴{'左' if self.dock == 'left' else '右'}边")
        return f"{len(mons)} 块：" + "、".join(parts) + "；" + "，".join(flags)

    def collect_feedback(self, want: list[str], done: Callable[[dict[str, str]], None]) -> None:
        out: dict[str, str] = {}
        pending: set[str] = set()
        finished = False

        def finish_if_ready() -> None:
            nonlocal finished
            if not finished and not pending:
                finished = True
                done(out)

        def read_file(p: Path) -> str:
            try:
                return p.read_text(encoding="utf-8")
            except OSError:
                return ""

        for sid in want:
            if sid == "window":
                f = self.surface.rect
                mons = self.wm.monitors()
                on_screen = not mons or any(m.work_area.intersects(f.inset(40, 40)) for m in mons)
                out[sid] = (
                    f"位置 {int(f.x)},{int(f.y)} {int(f.w)}×{int(f.h)}"
                    f"{'' if on_screen else '（不在任何屏幕里）'}；"
                    f"层级 {self.layer_mode}（现在 {self.surface.layer_mode}）；"
                    f"贴边 {self.dock or '无'}"
                    f"{('·跑出来了' if self.dock_out else '·缩着') if self.dock else ''}；"
                    f"大小 {int(self.pet_scale * 100)}%"
                )
            elif sid == "displays":
                out[sid] = self.displays_summary()
            elif sid == "dpi":
                out[sid] = self.displays_summary() + f"\n人物大小 {int(self.pet_scale * 100)}%，文字大小 {int(self.text_scale * 100)}%"
            elif sid == "front":
                win = self.wm.active_window()
                out[sid] = f"前台 {win.win_class if win else '-'}（{win.title if win else '-'}）；WM {self.wm.name}"
            elif sid == "hidden":
                out[sid] = (
                    f"因全屏收着 {'是' if self.hidden_for_fullscreen else '否'}，"
                    f"快捷键藏着 {'是' if self.user_hidden else '否'}，"
                    f"从菜单退出的标记 {'有' if self.user_quit_flag.exists() else '无'}，"
                    f"全屏时被叫出来 {'是' if self.fullscreen_override else '否'}"
                )
            elif sid == "install":
                missing = [x for x in ("web", "characters") if not (self.root / x).exists()]
                out[sid] = (
                    f"数据目录 {self.root}；源码 {self.src_root}；缺少 {'、'.join(missing) if missing else '无'}；"
                    f"检查更新 {self.last_update_check}"
                )
            elif sid == "log":
                out[sid] = Ledger.tail(log_path(), 400)
            elif sid == "seen":
                seen = self.last_seen
                out[sid] = json.dumps({k: seen.get(v, 0) for k, v in self.SEEN_KEYS.items()}, ensure_ascii=False)
            elif sid == "petEvents":
                out[sid] = Ledger.tail(self.pet_events_url, 200)
            elif sid == "switches":
                out[sid] = Ledger.tail(self.switches_url, 200)
            elif sid == "settings":
                skins = self.config.get_dict("skins")
                out[sid] = (
                    f"跟随前台 {'开' if self.follow_apps else '关'}，跟随事件 {'开' if self.follow_events else '关'}，"
                    f"AI 干活自动出现 {'开' if self.ai_autostart else '关'}，衣服 {skins or '无'}，"
                    f"省电 {'开' if self.power_save else '关'}，彩蛋 {'开' if self.eggs_enabled else '关'}"
                )
            elif sid == "quota:gpt":
                out[sid] = f"最近一次 {self.last_gpt_quota}\n额度文件 {read_file(self.state_dir / 'gpt-quota.json')}"
            elif sid == "quota:gemini":
                out[sid] = f"找服务 {self.last_agy_note}\n额度文件 {read_file(self.state_dir / 'gemini-quota.json')}"
            elif sid == "quota:deepseek":
                out[sid] = (
                    f"插件自检 {read_file(self.state_dir / 'deepseek-plugin.json')}\n"
                    f"余额文件 {read_file(self.state_dir / 'deepseek-quota.json')}"
                )
            elif sid == "page":
                pending.add("page")
                def on_page(val: Any) -> None:
                    if "page" in pending:
                        pending.remove("page")
                        out["page"] = val if isinstance(val, str) else "网页没有回应"
                        finish_if_ready()

                self.js("JSON.stringify(diagnoseDisplay())", on_page)
                GLib.timeout_add(2000, lambda: (on_page("网页没有回应"), False)[1])
            elif sid == "pets":
                pending.add("pets")
                wins = [{"id": k, "character": v.character} for k, v in self.companions.items()]
                def on_pets(val: Any) -> None:
                    if "pets" in pending:
                        pending.remove("pets")
                        out["pets"] = val if isinstance(val, str) else "网页没有回应"
                        finish_if_ready()

                self.js(f"JSON.stringify(diagnosePets({json.dumps(wins, ensure_ascii=False)}))", on_pets)
                GLib.timeout_add(2000, lambda: (on_pets("网页没有回应"), False)[1])
            elif sid == "diag":
                if not self.diag_text and self.integrate_script is not None:
                    pending.add("diag")
                    def on_diag(txt: str, _code: int) -> None:
                        if "diag" in pending:
                            pending.remove("diag")
                            self.diag_text = txt.strip()
                            out["diag"] = self.diag_text
                            finish_if_ready()

                    self.run_integrate(["diagnose"], on_diag)
                    GLib.timeout_add(3000, lambda: (on_diag("诊断超时（3 秒内没跑完）", 0), False)[1])
                else:
                    out[sid] = self.diag_text
            elif sid.startswith("events:"):
                out[sid] = Ledger.tail(self.events_dir / f"{sid[7:]}.jsonl", 200)
            elif sid.startswith("state:"):
                c, _, host = sid[6:].partition("|")
                host = host or c
                parts = []
                for kind in ("state", "sessions", "turns", "host"):
                    stem = host if kind in ("turns", "host") else c
                    t = read_file(self.state_dir / f"{stem}-{kind}.json").strip()
                    if t:
                        parts.append(f"{kind}：{t[:800]}")
                out[sid] = "\n".join(parts)

        finish_if_ready()

    def push_facts(self, sections: dict[str, str], key: str | None = None) -> None:
        if self.feedback_web is None:
            return
        eval_js(self.feedback_web, f"setFacts({json.dumps(self.feedback_facts(sections, key), ensure_ascii=False)})")

    def handle_feedback(self, msg: Any) -> None:
        if not isinstance(msg, dict) or not isinstance(msg.get("cmd"), str):
            return
        cmd = msg["cmd"]

        def on_done(ok: bool, text: str) -> None:
            if self.feedback_web is not None:
                eval_js(self.feedback_web, f"onSent({str(ok).lower()}, {_js_quote(text)})")
            if ok:
                self.js("show('happy', true); say('收到反馈啦，谢谢你！')")

        if cmd == "send":
            endpoint = self.config.get_str("feedbackURL") or self.FEEDBACK_ENDPOINT
            body_text = msg.get("body")
            if not isinstance(body_text, str) or len(body_text.encode("utf-8")) > 20_000:
                on_done(False, "内容太长了，删短一点再发")
                return
            now = time.time()
            recent = [float(t) for t in self.config.get_list("feedbackTimes") if isinstance(t, (int, float)) and now - float(t) < 3600]
            if len(recent) >= 5:
                on_done(False, "发得有点多啦，过一会儿再发")
                return

            def worker() -> None:
                req = urllib.request.Request(
                    endpoint,
                    data=body_text.encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json"},
                )
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        reply = json.loads(resp.read().decode("utf-8", errors="replace"))
                        code = reply.get("code", -1) if isinstance(reply, dict) else -1
                except Exception:
                    GLib.idle_add(lambda: (on_done(False, "连不上网络，稍后再试试"), False)[1])
                    return
                if code == 0:
                    def ok_cb() -> bool:
                        self.config.set("feedbackTimes", recent + [now])
                        on_done(True, "")
                        return False
                    GLib.idle_add(ok_cb)
                elif code == 11232:
                    GLib.idle_add(lambda: (on_done(False, "反馈的人有点多，过一会儿再发"), False)[1])
                else:
                    GLib.idle_add(lambda: (on_done(False, f"没发出去（{code}），稍后再试试"), False)[1])

            threading.Thread(target=worker, name="crosspet-feedback", daemon=True).start()
        elif cmd == "collect":
            want = [str(w) for w in (msg.get("want") or [])]
            key = str(msg.get("key") or "")
            self.collect_feedback(want, lambda sections: self.push_facts(sections, key))
        else:
            self.push_facts({})
            self.diag_text = ""
            if self.integrated is None and self.integrate_script is not None:
                self.refresh_integrated()

    # ---- Update Check ----

    def _timer_update_check(self) -> bool:
        try:
            self.check_for_update(manual=False)
        except Exception as exc:
            app_log(f"定时任务出错（update_check）：{exc!r}")
        return True

    def check_for_update(self, manual: bool = False) -> None:
        def worker() -> None:
            tag = ""
            page = f"https://github.com/{self.REPO_SLUG}/releases"
            try:
                req = urllib.request.Request(
                    f"https://api.github.com/repos/{self.REPO_SLUG}/releases/latest",
                    headers={"Accept": "application/vnd.github+json", "User-Agent": "CrossPet-Linux"},
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    obj = json.loads(resp.read().decode("utf-8"))
                    if isinstance(obj, dict) and isinstance(obj.get("tag_name"), str):
                        tag = obj["tag_name"]
                        page = obj.get("html_url") or page
            except Exception:
                pass
            GLib.idle_add(lambda: (self._got_latest(tag, page, manual), False)[1])

        threading.Thread(target=worker, name="crosspet-update", daemon=True).start()

    def _got_latest(self, tag: str, page: str, manual: bool) -> None:
        self.last_update_check = f"{_clock()} " + (f"最新 {tag}" if tag else "没拿到版本号")
        if tag and is_newer(tag, self.version):
            fresh = (self.latest_release is None) or (self.latest_release[0] != tag)
            self.latest_release = (tag, page)
            if fresh or manual:
                self.js(f"notifyUpdate({_js_quote(tag)})")
            self.push_settings()
            self.tray.refresh_menu()
        elif manual:
            self._show_dialog("检查更新", "暂时连不上 GitHub" if not tag else f"已经是最新版（{self.version}）")

    def open_release(self) -> None:
        url = self.latest_release[1] if self.latest_release else f"https://github.com/{self.REPO_SLUG}/releases"
        self._open_external(url)

    # ---- IPC Commands ----

    def _handle_ipc_command(self, cmd: str) -> dict[str, Any]:
        c = cmd.strip().lower()
        if c == "toggle":
            self.toggle_hidden()
            return {"ok": True, "hidden": self.user_hidden}
        if c == "show":
            self.set_user_hidden(False)
            return {"ok": True, "hidden": self.user_hidden}
        if c == "hide":
            self.set_user_hidden(True)
            return {"ok": True, "hidden": self.user_hidden}
        if c == "bring-to-front":
            self.bring_to_front()
            return {"ok": True}
        if c == "settings":
            self.open_settings_at(None)
            return {"ok": True}
        if c == "quit":
            self.quit()
            return {"ok": True}
        if c == "status":
            return {
                "ok": True,
                "pid": os.getpid(),
                "wm": self.wm.name,
                "character": self.current_id,
                "hidden": self.user_hidden,
                "fullscreen_hidden": self.hidden_for_fullscreen,
                "layer": self.surface.layer_mode,
            }
        return {"ok": True, "pid": os.getpid()}
