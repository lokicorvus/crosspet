#!/usr/bin/env python3
"""CrossPet Ubuntu 24.04 / X11 外壳，画面和 AI 事件协议与 Mac / Windows 共用。"""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback

from core import ROOT, DEFAULTS, Store, clean_peak_skins, desktop_entry, query_codex, read_json, write_json


def dependencies():
    import gi
    for name, version in (("Gtk", "3.0"), ("Gdk", "3.0"), ("GdkX11", "3.0"),
                          ("WebKit2", "4.1"), ("Wnck", "3.0")):
        gi.require_version(name, version)
    import cairo
    from gi.repository import Gtk, Gdk, GdkX11, WebKit2, Wnck, GLib, Gio
    globals().update(Gtk=Gtk, Gdk=Gdk, GdkX11=GdkX11, WebKit2=WebKit2,
                     Wnck=Wnck, GLib=GLib, Gio=Gio, cairo=cairo)


class Pet:
    def __init__(self, store, lock, smoke=False):
        self.store, self.s, self.lock, self.smoke = store, store.settings, lock, smoke
        self.ready = self.closing = self.hidden = self.fullscreen = self.paused = False
        self.rects, self.last_pose, self.pages = [], {}, {}
        self.integrated, self.plugins = [], []
        self.current = self.s.get("character", "")
        self.dock = self.s.get("dock")
        self.dock_out = self.peek = False
        self.dock_since = time.time()
        self.dock_hover_since = None
        self.dock_transition_until = 0
        self.drag = None
        self.cut_generation = self.size_generation = 0
        self.page_size, self.foot = (260, 362), 62
        self.actual_scale = self.s["size"]
        self.front_id = None
        self.front_signature = None
        self.quota_last, self.quota_at, self.quota_busy, self.quota_note = None, 0, False, ""
        self.quota_process = None
        self.last_control = None
        self.started_at = time.time()
        self.window = Gtk.Window(title="CrossPet")
        self.window.set_wmclass("crosspet", "CrossPet")
        self.window.set_decorated(False)
        self.window.set_resizable(False)
        self.window.set_app_paintable(True)
        self.window.set_accept_focus(False)
        self.window.set_focus_on_map(False)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        self.window.stick()
        screen = self.window.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.window.set_visual(visual)
        self.window.connect("draw", self.clear)
        self.window.connect("delete-event", lambda *_: self.quit(True) or True)
        self.window.connect("notify::scale-factor", lambda *_: self.update_input())
        self.window.connect("screen-changed", lambda *_: self.reset_position())
        self.web = self.make_web("pet", self.pet_message)
        transparent = Gdk.RGBA(0, 0, 0, 0)
        self.web.set_background_color(transparent)
        # 原生 EventBox 吃掉鼠标输入，网页只负责画；防止 WebView 点击抢走编辑器焦点。
        overlay = Gtk.EventBox()
        overlay.set_visible_window(False)
        overlay.set_above_child(True)
        overlay.add(self.web)
        overlay.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.POINTER_MOTION_MASK)
        overlay.connect("button-press-event", self.button_down)
        overlay.connect("motion-notify-event", self.motion)
        overlay.connect("button-release-event", self.button_up)
        self.window.add(overlay)
        self.window.set_default_size(round(260 * self.actual_scale), round(362 * self.actual_scale))
        self.window.set_size_request(round(260 * self.actual_scale), round(362 * self.actual_scale))
        self.window.show_all()
        if not screen.is_composited():
            self.log("当前 X11 桌面未启用合成，透明效果可能不可用")
        self.restore_position()
        self.screen = Wnck.Screen.get_default()
        self.screen.force_update()
        self.screen.connect("active-window-changed", lambda *_: self.foreground_changed())
        self.window.get_display().connect("monitor-removed", lambda *_: self.reset_position())
        from x11 import Hotkey
        self.hotkey = Hotkey(self.toggle)
        self.hotkey_failed = not self.hotkey.bind("off" if smoke else self.s["hideHotkey"])
        self.indicator = None
        if not smoke:
            self.setup_indicator()
        self.web.connect("load-changed", self.loaded)
        self.web.connect("web-process-terminated", lambda _w, why: self.log(f"WebKit 进程退出: {why}"))
        self.web.load_uri((store.data / "web/index.html").as_uri())
        (store.state / "pet.pid").write_text(str(os.getpid()))
        (store.data / "user-quit").unlink(missing_ok=True)
        GLib.timeout_add(300, self.poll)
        GLib.timeout_add(120, self.update_input)
        GLib.timeout_add_seconds(60, self.quota_tick)
        GLib.timeout_add_seconds(5, self.refresh_settings_tick)
        for sig in (signal.SIGTERM, signal.SIGINT):
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, self.quit, False)

    def log(self, message):
        text = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
        print(text, flush=True)
        path = self.store.data / "linux.log"
        try:
            if path.exists() and path.stat().st_size > 1_000_000:
                path.replace(path.with_suffix(".previous.log"))
            with path.open("a") as log:
                log.write(text + "\n")
        except OSError:
            pass

    @staticmethod
    def clear(_window, context):
        context.set_operator(cairo.OPERATOR_SOURCE)
        context.set_source_rgba(0, 0, 0, 0)
        context.paint()
        context.set_operator(cairo.OPERATOR_OVER)
        return False

    def make_web(self, channel, handler):
        manager = WebKit2.UserContentManager()
        def received(_manager, result):
            try:
                value = json.loads(result.get_js_value().to_json(0))
                if isinstance(value, dict):
                    handler(value)
            except Exception as error:
                self.log(f"{channel} 消息失败: {error}")
        manager.connect(f"script-message-received::{channel}", received)
        manager.register_script_message_handler(channel)
        web = WebKit2.WebView.new_with_user_content_manager(manager)
        web.get_settings().set_enable_write_console_messages_to_stdout(True)
        web.get_settings().set_allow_file_access_from_file_urls(True)
        web.connect("context-menu", lambda *_: True)
        web.connect("decide-policy", self.navigation)
        return web

    def navigation(self, _web, decision, kind):
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri()
            allowed = [(self.store.data / "web" / f).as_uri() for f in
                       ("index.html", "settings.html", "devconsole.html")]
            if uri not in allowed:
                decision.ignore()
                return True
        return False

    def js(self, code, callback=None, web=None):
        web = web or self.web
        def done(view, result, *_):
            try:
                value = view.evaluate_javascript_finish(result)
                if callback:
                    callback(None if value.is_undefined() else json.loads(value.to_json(0)))
            except Exception as error:
                if not self.closing:
                    self.log(f"网页执行失败: {error}")
        if not self.closing:
            web.evaluate_javascript(code, -1, None, None, None, done, None)

    def call(self, name, *args, callback=None, web=None):
        self.js(f"{name}({','.join(json.dumps(a, ensure_ascii=False) for a in args)})", callback, web)

    def loaded(self, _web, event):
        if event != WebKit2.LoadEvent.FINISHED:
            return
        self.manifest, self.choices = self.store.manifest()
        if not self.choices:
            self.log("没有可用角色")
            self.quit(False)
            return
        self.ids = [c["id"] for c in self.choices]
        self.ready = True
        self.call("init", self.manifest)
        self.switch(self.current if self.current in self.ids else self.ids[0], True)
        self.apply_settings()
        self.call("setPeakSkins", self.s["peakSkins"])
        self.apply_size("corner")
        self.store.stamps.clear()
        self.foreground_changed()
        self.log("CROSSPET_LINUX_READY：X11 + GTK3 + WebKitGTK 4.1")
        if self.dock:
            GLib.timeout_add(1500, lambda: self.apply_dock() or False)
        if not self.smoke:
            self.refresh_integrations()
            self.quota_tick()

    def switch(self, id, instant=False):
        if id not in self.ids:
            return
        self.current = self.s["character"] = id
        self.call("setCharacter", id, instant)
        self.store.save()
        self.push_settings()
        if self.dock:
            GLib.timeout_add(800, lambda: self.apply_dock() or False)

    def apply_settings(self):
        for key, name in (("showName", "setShowName"), ("aura", "setAuraMode"),
                          ("eggs", "setEggsEnabled"), ("powerSave", "setPowerSave"),
                          ("quotaAggregate", "setQuotaAggregate"), ("codexResets", "setCodexResets"),
                          ("peakStyle", "setPeakStyle")):
            self.call(name, self.s[key])
        flag = self.store.data / "ai-autostart-off"
        if self.s["aiAutostart"]:
            flag.unlink(missing_ok=True)
        else:
            flag.write_text("1")
        self.apply_layer()

    def monitor(self):
        return self.window.get_display().get_monitor_at_window(self.window.get_window())

    def restore_position(self):
        saved = self.s.get("origin")
        if isinstance(saved, list) and len(saved) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in saved):
            display = self.window.get_display()
            if any(self.point_in(display.get_monitor(i).get_workarea(), saved[0] + 130, saved[1] + 180)
                   for i in range(display.get_n_monitors())):
                self.window.move(*map(round, saved))
                return
        self.reset_position()

    @staticmethod
    def point_in(r, x, y):
        return r.x <= x < r.x + r.width and r.y <= y < r.y + r.height

    def reset_position(self):
        display = self.window.get_display()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        r = monitor.get_workarea()
        width, height = self.window.get_size()
        self.window.move(r.x + r.width - width - 30, r.y + r.height - height - 70)
        self.undock()
        self.hidden = self.fullscreen = False
        self.apply_layer()

    def save_position(self):
        self.s["origin"] = list(self.window.get_position())
        self.store.save()

    def apply_size(self, anchor="feet"):
        self.size_generation += 1
        generation = self.size_generation
        def sized(value):
            if generation != self.size_generation or not value:
                return
            layout = json.loads(value)
            x, y = self.window.get_position()
            oldw, oldh = self.window.get_size()
            scale = self.s["size"]
            w, h = round(layout["w"] * scale), round(layout["h"] * scale)
            if anchor != "corner":
                x += (oldw - w) / 2
                y += oldh - h
                if anchor == "feet":
                    y += layout["foot"] * scale - self.foot * self.actual_scale
            self.page_size, self.foot, self.actual_scale = (layout["w"], layout["h"]), layout["foot"], scale
            self.web.set_zoom_level(scale)
            self.window.set_size_request(w, h)
            self.window.resize(w, h)
            self.window.move(round(x), round(y))
            self.rects = []
            if self.dock:
                self.apply_dock()
        self.call("setSizes", self.s["size"], self.s["textSize"], self.s["textLinked"], callback=sized)

    def button_down(self, _widget, event):
        if event.button == 3:
            self.menu = self.make_menu()
            self.menu.popup_at_pointer(event)
        elif event.button == 1:
            self.drag = {"start": (event.x_root, event.y_root), "origin": tuple(self.window.get_position()),
                         "moved": False, "swing": event.x_root, "direction": 0, "turns": [], "shook": False}
        return True

    def motion(self, _widget, event):
        if not self.drag:
            return True
        d = self.drag
        dx, dy = event.x_root - d["start"][0], event.y_root - d["start"][1]
        if not d["moved"] and abs(dx) + abs(dy) < 4:
            return True
        if not d["moved"]:
            d["moved"] = True
            self.undock()
        distance = event.x_root - d["swing"]
        if abs(distance) > 18:
            direction = 1 if distance > 0 else -1
            if d["direction"] and direction != d["direction"]:
                now = time.monotonic()
                d["turns"] = [t for t in d["turns"] if now - t < 0.9] + [now]
                if len(d["turns"]) >= 2:
                    self.call("shaken")
                    d["shook"] = True
                    d["turns"] = []
            d["direction"], d["swing"] = direction, event.x_root
        self.window.move(round(d["origin"][0] + dx), round(d["origin"][1] + dy))
        return True

    def button_up(self, _widget, event):
        if event.button == 1 and self.drag:
            drag, self.drag = self.drag, None
            if drag["moved"]:
                self.save_position()
                if not drag["shook"]:
                    self.check_dock()
            else:
                x, y = self.window.get_position()
                self.call("handleClick", "pat", (event.x_root - x) / self.actual_scale,
                          (event.y_root - y) / self.actual_scale)
        return True

    def update_input(self):
        if self.closing:
            return False
        if not self.ready or self.drag:
            return True
        def apply(value):
            if self.closing or self.drag:
                return
            self.rects = json.loads(value or "[]")
            region = cairo.Region()
            if not (self.hidden or self.fullscreen):
                for x, y, w, h in self.rects:
                    z = self.actual_scale
                    region.union(cairo.RectangleInt(math.floor(x*z), math.floor(y*z),
                                                    math.ceil(w*z), math.ceil(h*z)))
            self.window.get_window().input_shape_combine_region(region, 0, 0)
            if self.dock and not self.dock_out and not self.hidden and not self.fullscreen:
                _, px, py = self.window.get_display().get_default_seat().get_pointer().get_position()
                x, y = self.window.get_position()
                over = any(x+rx*self.actual_scale <= px < x+(rx+rw)*self.actual_scale and
                           y+ry*self.actual_scale <= py < y+(ry+rh)*self.actual_scale
                           for rx, ry, rw, rh in self.rects)
                self.update_dock_hover(over)
        self.call("hitRects", callback=apply)
        return True

    def undock(self):
        self.dock = None
        self.dock_out = self.peek = False
        self.dock_hover_since = None
        self.dock_transition_until = 0
        self.s.pop("dock", None)
        self.cut_generation += 1
        if self.ready:
            self.call("setTucked", None)

    def check_dock(self):
        if not self.s["edgeDock"]:
            return
        monitor, display = self.monitor(), self.window.get_display()
        r, bounds = monitor.get_workarea(), monitor.get_geometry()
        x, y = self.window.get_position()
        w, h = self.window.get_size()
        # GNOME 会把移动中的普通窗口限制在工作区附近。按中心判定需要先把
        # 半个窗口拖出屏幕，窗口已贴到边缘时仍不会触发；按窗口边缘吸附。
        reach = 24 * self.actual_scale
        side = "left" if x-r.x <= reach else "right" if r.x+r.width-x-w <= reach else None
        if not side:
            return
        for i in range(display.get_n_monitors()):
            other = display.get_monitor(i)
            if other == monitor:
                continue
            g = other.get_geometry()
            edge = bounds.x if side == "left" else bounds.x+bounds.width
            if g.y < y+h and g.y+g.height > y and abs((g.x+g.width if side == "left" else g.x)-edge) < 2:
                return
        self.dock = self.s["dock"] = side
        self.dock_since, self.dock_out, self.peek = time.time(), False, False
        self.store.save()
        self.apply_dock()

    def update_dock_hover(self, over):
        now = time.monotonic()
        # 换图和对齐切口时的旧点击区域不能触发反向切换。
        if now < self.dock_transition_until or over == self.peek:
            self.dock_hover_since = None
            return
        if self.dock_hover_since is None:
            self.dock_hover_since = now
        elif now - self.dock_hover_since >= (0.15 if over else 0.3):
            self.peek = over
            self.dock_hover_since = None
            self.apply_dock()

    def apply_dock(self):
        if not self.dock or not self.ready:
            return
        r, side = self.monitor().get_workarea(), self.dock
        _, y = self.window.get_position()
        w, h = self.window.get_size()
        y = max(r.y, min(y, r.y+r.height-h))
        self.cut_generation += 1
        generation = self.cut_generation
        self.dock_hover_since = None
        self.dock_transition_until = time.monotonic() + 0.6
        if self.dock_out:
            self.call("setTucked", None)
            self.window.move(r.x if side == "left" else r.x+r.width-w, y)
            return
        self.call("setTucked", side, self.peek)
        def place(value):
            if generation == self.cut_generation and value is not None:
                self.window.move(round((r.x if side == "left" else r.x+r.width) - value*self.actual_scale), y)
        def measure():
            self.call("dockCut", side, callback=place)
            return False
        GLib.timeout_add(450, measure)

    def host_character(self, id):
        file = self.store.state / f"{id}-host.json"
        obj = read_json(file, {})
        try:
            if time.time() - file.stat().st_mtime < 86400 and obj.get("character") in self.ids:
                return obj["character"]
        except (OSError, AttributeError):
            pass
        return "glm" if id == "zcode" else id

    def foreground_changed(self):
        if not self.ready:
            return
        front = self.screen.get_active_window()
        self.front_id = None
        if front:
            name = (front.get_class_group_name() or "").lower()
            mapping = {"codex": "gpt", "chatgpt": "gpt", "claude": "claude", "antigravity": "gemini",
                       "deepseek": "deepseek", "deepseek-harness": "deepseek", "zcode": "zcode", "workbuddy": "workbuddy"}
            mapping.update(read_json(self.store.config / "apps.json", {}) or {})
            self.front_id = mapping.get(name)
            signature = (front.get_xid(), self.host_character(self.front_id) if self.front_id else None)
            changed = signature != self.front_signature
            self.front_signature = signature
            if changed and self.front_id and self.s["followApps"]:
                id = self.host_character(self.front_id)
                if id in self.ids and id != self.current:
                    self.switch(id)
        else:
            self.front_signature = None
        self.apply_layer()

    def apply_layer(self):
        front = self.screen.get_active_window() if hasattr(self, "screen") else None
        full = False
        if front and self.s["hideFullscreen"] and front.is_fullscreen():
            x, y, w, h = front.get_geometry()
            # libwnck 返回 X11 物理像素，GDK 的屏幕 / 窗口使用逻辑像素。
            scale = self.window.get_scale_factor()
            x, y, w, h = x/scale, y/scale, w/scale, h/scale
            r = self.monitor().get_geometry()
            full = x < r.x+r.width and x+w > r.x and y < r.y+r.height and y+h > r.y
        self.fullscreen = full
        hidden = self.hidden or full
        self.window.set_opacity(0 if hidden else 1)
        active = self.front_id is not None or any(
            (p == "asking" and time.time()-t < 600) or (p in ("happy", "proud") and time.time()-t < 8)
            for p, t in self.last_pose.values())
        self.window.set_keep_above(self.s["layer"] == "always" or (self.s["layer"] == "ai" and active))
        if self.ready and getattr(self, "page_hidden", None) != hidden:
            self.page_hidden = hidden
            self.call("setPageHidden", hidden)
            self.update_input()

    def toggle(self):
        self.hidden = not self.hidden
        self.apply_layer()

    def poll(self):
        if self.closing:
            return False
        control = read_json(self.store.data / "control.json", {})
        if isinstance(control, dict) and control.get("ts", 0) > self.started_at and control != self.last_control:
            self.last_control = control
            action = control.get("action")
            if action == "quit":
                self.quit(True)
                return False
            if action == "toggle":
                self.toggle()
            elif action in ("show", "settings"):
                self.reset_position()
                if action == "settings":
                    self.open_page("settings")
        if not self.ready:
            return True
        latest = (0, None)
        if not self.paused:
            for id, kind, obj in self.store.changes(self.ids):
                if kind == "state":
                    pose, ts = obj.get("pose", ""), obj.get("ts", 0)
                    if not isinstance(ts, (int, float)):
                        continue
                    self.last_pose[id] = (pose, time.time())
                    self.call("applyCharState", id, obj)
                    if id != "current" and pose not in ("idle", "sleeping") and 0 <= time.time()-ts < 30 and ts > latest[0]:
                        latest = (ts, id)
                elif kind == "sessions":
                    self.call("setSessions", id, obj)
                elif id != "deepseek" or self.s["dsQuota"]:
                    self.call("setQuota", id, obj)
                if "dev" in self.pages:
                    self.call("logEvent", id, kind, obj, False, web=self.pages["dev"][1])
            if self.s["followEvents"] and latest[1] and latest[1] != self.current:
                self.switch(latest[1])
        self.foreground_changed()
        if self.dock:
            now = time.time()
            busy = any(t > self.dock_since and now-t < (600 if p == "asking" else 10 if p in ("happy", "proud", "oops", "surprised") else 180)
                       for p, t in self.last_pose.values() if p not in ("idle", "sleeping", "tired"))
            if busy != self.dock_out:
                self.dock_out, self.peek = busy, False
                self.apply_dock()
        return True

    def make_menu(self):
        menu = Gtk.Menu()
        def add(parent, label, action):
            item = Gtk.MenuItem(label=label)
            item.connect("activate", lambda *_: action())
            parent.append(item)
            return item
        add(menu, "显示 / 回到右下角", self.reset_position)
        add(menu, "摸摸头", lambda: self.call("handleClick", "pat"))
        add(menu, "戳一下", lambda: self.call("handleClick", "poke"))
        add(menu, "召唤彩蛋", lambda: self.call("playEgg", True))
        chars = Gtk.Menu()
        for choice in getattr(self, "choices", []):
            add(chars, choice["name"], lambda id=choice["id"]: self.switch(id))
        item = Gtk.MenuItem(label="换角色")
        item.set_submenu(chars)
        menu.append(item)
        layers = Gtk.Menu()
        for mode, label in (("always", "始终置顶"), ("ai", "跟着 AI"), ("normal", "普通窗口")):
            add(layers, label, lambda mode=mode: self.set_setting("layer", mode))
        item = Gtk.MenuItem(label="显示层级")
        item.set_submenu(layers)
        menu.append(item)
        add(menu, "设置…", lambda: self.open_page("settings"))
        add(menu, "开发者控制台…", lambda: self.open_page("dev"))
        add(menu, "暂时隐藏 / 显示", self.toggle)
        add(menu, "退出", lambda: self.quit(True))
        menu.show_all()
        return menu

    def setup_indicator(self):
        try:
            import gi
            gi.require_version("AyatanaAppIndicator3", "0.1")
            from gi.repository import AyatanaAppIndicator3 as Indicator
            self.indicator = Indicator.Indicator.new("crosspet", str(ROOT / "app/icon/AppIcon.png"),
                                                     Indicator.IndicatorCategory.APPLICATION_STATUS)
            self.indicator.set_status(Indicator.IndicatorStatus.ACTIVE)
            self.indicator.set_menu(self.make_menu())
        except (ImportError, ValueError):
            self.log("未安装 Ayatana AppIndicator；可用右键菜单、Ctrl+Alt+P 或 crosspet --show")

    def pet_message(self, msg):
        if isinstance(msg.get("openSettings"), str):
            self.open_page("settings", msg["openSettings"])
        wear = msg.get("wear")
        if isinstance(wear, dict):
            self.wear(wear.get("id"), wear.get("skin"))

    def wear(self, id, skin):
        """只换这个角色已有的衣服；峰谷自动换装不能切换当前角色。"""
        if not isinstance(id, str) or id not in self.ids or not isinstance(skin, str):
            return False
        choice = next(c for c in self.choices if c["id"] == id)
        if skin and not any(s["id"] == skin for s in choice.get("skins", [])):
            return False
        if self.s["skins"].get(id, "") == skin:
            return True
        if skin:
            self.s["skins"][id] = skin
        else:
            self.s["skins"].pop(id, None)
        self.store.save()
        self.manifest, self.choices = self.store.manifest()
        self.call("init", self.manifest)
        self.call("refreshLook", id)
        self.push_settings()
        return True

    def open_page(self, kind, tab=None):
        if kind in self.pages:
            self.pages[kind][0].present()
            if tab:
                self.call("showTab", tab, web=self.pages[kind][1])
            return
        title, filename = ("设置", "settings.html") if kind == "settings" else ("开发者控制台", "devconsole.html")
        window = Gtk.Window(title="CrossPet " + title)
        window.set_default_size(560 if kind == "settings" else 960, 720)
        window.set_position(Gtk.WindowPosition.CENTER)
        web = self.make_web(kind, self.settings_message if kind == "settings" else self.dev_message)
        self.pages[kind] = (window, web)
        def loaded(_web, event):
            if event != WebKit2.LoadEvent.FINISHED:
                return
            if kind == "settings":
                self.push_settings()
                if tab:
                    self.call("showTab", tab, web=web)
                self.refresh_integrations()
            else:
                self.call("setAppInfo", {"version": self.store.version, "platform": "linux", "root": str(self.store.data)}, web=web)
                self.call("boot", self.manifest, web=web)
        web.connect("load-changed", loaded)
        def closed(*_):
            self.pages.pop(kind, None)
            if kind == "dev":
                self.paused = False
                self.call("devRelease")
        window.connect("destroy", closed)
        window.add(web)
        window.show_all()
        web.load_uri((self.store.data / "web" / filename).as_uri())

    def settings_state(self):
        state = dict(self.s)
        state.update(
            version=self.store.version + " · Ubuntu X11", appVersion=self.store.version,
            whatsNewSeen=self.s.get("whatsNewSeen", self.store.version), platform="linux",
            characters=self.choices, character=self.current, plugins=self.plugins,
            login=self.autostart_file().exists(), hotkeyFailed=self.hotkey_failed,
            hotkeys=[{"id": "off", "label": "不用快捷键"}, {"id": "ctrl-alt-p", "label": "Ctrl+Alt+P"},
                     {"id": "ctrl-alt-h", "label": "Ctrl+Alt+H"}],
            gptQuotaNote=self.quota_note, unavailable={"agyQuota": "Linux 版暂未接入 Antigravity 额度采集"},
        )
        targets = [("claude-hooks", "Claude Code 标准钩子"), ("claude-mod", "Claude Code 增强版 mod"),
                   ("codex", "Codex"), ("deepseek", "DeepSeek Harness"), ("gemini", "Gemini CLI"),
                   ("antigravity", "Antigravity"), ("workbuddy", "WorkBuddy"), ("zcode", "ZCode"), ("hermes", "Hermes Agent"),
                   ("qwen", "Qwen Code（阿里）")]
        state["integrations"] = []
        for id, label in targets:
            key = {"claude-hooks": "claude", "codex": "gpt"}.get(id, id)
            path = self.store.state / ("seen-" + key)
            try:
                seen = max(0, time.time() - path.stat().st_mtime)
            except OSError:
                seen = None
            state["integrations"].append(dict(id=id, label=label, installed=id in self.integrated, lastSeen=seen,
                note="需要已安装对应 Linux 宿主；接入后新开会话生效"))
        return state

    def push_settings(self):
        if "settings" in self.pages and self.ready:
            self.call("setState", self.settings_state(), web=self.pages["settings"][1])
        if self.indicator and self.ready:
            self.indicator.set_menu(self.make_menu())

    def refresh_settings_tick(self):
        self.push_settings()
        return not self.closing

    def notice(self, text):
        if "settings" in self.pages:
            self.call("notice", text, web=self.pages["settings"][1])
        self.log(text)

    def background(self, work, done):
        def run():
            try:
                value, error = work(), None
            except Exception as ex:
                value, error = None, str(ex)
            def complete():
                if not self.closing:
                    done(value, error)
                return False
            GLib.idle_add(complete)
        threading.Thread(target=run, daemon=True).start()

    def integrate_command(self, *args):
        env = dict(os.environ, CROSSPET_DATA_DIR=str(self.store.data), CROSSPET_STATE_DIR=str(self.store.state))
        result = subprocess.run(["/usr/bin/python3", str(ROOT / "tools/integrate.py"), *args],
                                env=env, capture_output=True, text=True, timeout=70)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return result.stdout

    def refresh_integrations(self):
        def work():
            return json.loads(self.integrate_command("installed")), json.loads(self.integrate_command("plugins"))
        def done(value, error):
            if error:
                self.log("读取接入信息失败: " + error)
            else:
                self.integrated, self.plugins = value
                self.call("setPluginUpdates", self.plugins)
                self.push_settings()
        self.background(work, done)

    def settings_message(self, msg):
        cmd = msg.get("cmd")
        if cmd == "get":
            self.push_settings()
        elif cmd == "set":
            self.set_setting(msg.get("key"), msg.get("value"))
        elif cmd in ("skin", "rename") and msg.get("id") in self.ids:
            id = msg["id"]
            if cmd == "skin":
                if self.wear(id, msg.get("skin", "")):
                    self.switch(id)
                return
            self.s["names"][id] = str(msg.get("name", ""))[:40].strip()
            self.store.save()
            self.manifest, self.choices = self.store.manifest()
            self.call("init", self.manifest)
            self.call("refreshLook", self.current)
            self.push_settings()
        elif cmd == "integrate":
            target, action = msg.get("target"), msg.get("action")
            allowed = {i["id"] for i in self.settings_state()["integrations"]}
            if target in allowed and action in ("install", "uninstall"):
                def done(value, error):
                    self.notice(error or value.strip() or "操作完成")
                    self.refresh_integrations()
                self.background(lambda: self.integrate_command(action, target), done)
        elif cmd == "action":
            action = msg.get("name")
            if action == "devConsole":
                self.open_page("dev")
            else:
                urls = {"openCharacters": (self.store.data / "characters").as_uri(),
                        "openData": self.store.data.as_uri(),
                        "openReleases": "https://github.com/lokicorvus/crosspet/releases",
                        "openCodexResets": "https://codex-resets.com",
                        "feedback": "https://github.com/lokicorvus/crosspet/issues/new"}
                if action in ("checkUpdate", "update"):
                    self.notice("Linux 源码版：更新仓库后重新运行安装器；发布记录已打开")
                    action = "openReleases"
                if action in urls:
                    Gio.AppInfo.launch_default_for_uri(urls[action], None)

    def set_setting(self, key, value):
        if key == "character":
            self.switch(value)
            return
        if key in ("size", "textSize"):
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.6 <= value <= 1.6:
                return
        elif key in DEFAULTS and isinstance(DEFAULTS[key], bool):
            if not isinstance(value, bool) or key == "agyQuota":
                return
        elif key in ("aura", "layer", "hideHotkey", "peakStyle"):
            allowed = {"aura": ("auto", "on", "off"), "layer": ("always", "ai", "normal"),
                       "hideHotkey": ("off", "ctrl-alt-p", "ctrl-alt-h"), "peakStyle": ("bar", "text", "off")}
            if value not in allowed[key]:
                return
        elif key == "peakSkins":
            value = clean_peak_skins(value)
        elif key == "login":
            if not isinstance(value, bool):
                return
            self.set_autostart(value)
            self.push_settings()
            return
        elif key != "whatsNewSeen" or not isinstance(value, str):
            return
        self.s[key] = value
        if key == "textSize":
            self.s["textLinked"] = False
        if key in ("size", "textSize", "textLinked"):
            self.apply_size("bottom" if key == "size" else "feet")
        if key == "hideHotkey":
            self.hotkey_failed = not self.hotkey.bind(value)
        if key == "followApps":
            self.front_signature = None
        if key == "edgeDock" and not value:
            self.undock()
        if key == "dsQuota":
            self.store.stamps.clear()
            if not value:
                self.call("setQuota", "deepseek", None)
        if key == "gptQuota":
            if value:
                self.quota_at = 0
                self.quota_tick()
            else:
                self.call("setCodexQuota", None)
        self.store.save()
        if key == "peakSkins":
            # 网页会将当前时段标记为已处理，只在改换装配置时调用，避免其他设置吞掉待换装请求。
            self.call("setPeakSkins", value)
        self.apply_settings()
        self.push_settings()

    @staticmethod
    def autostart_file():
        return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "autostart/crosspet.desktop"

    def set_autostart(self, on):
        path = self.autostart_file()
        if on:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(desktop_entry(["/usr/bin/env", f"CROSSPET_DATA_DIR={self.store.data}",
                f"CROSSPET_CONFIG_DIR={self.store.config}", f"CROSSPET_STATE_DIR={self.store.state}",
                "/usr/bin/python3", str(ROOT / "app/linux/main.py")]))
        else:
            path.unlink(missing_ok=True)

    def dev_message(self, msg):
        cmd = msg.get("cmd")
        if cmd == "pet" and isinstance(msg.get("code"), str):
            self.js(msg["code"])
        elif cmd == "pause":
            self.paused = bool(msg.get("on"))
        elif cmd == "reload":
            self.ready = False
            self.web.reload()
        elif cmd == "status":
            self.js("devStatus()", lambda result: self.call("onPetStatus", result, web=self.pages["dev"][1]) if "dev" in self.pages else None)
        elif cmd == "reveal":
            Gio.AppInfo.launch_default_for_uri(self.store.data.as_uri(), None)
        elif cmd == "save":
            text = str(msg.get("text", ""))
            (self.store.data / "feedback.txt").write_text(text)
            Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(text, -1)
            self.call("onSaved", str(self.store.data / "feedback.txt"), web=self.pages["dev"][1])

    def quota_tick(self):
        if self.closing:
            return False
        if self.smoke or not self.s["gptQuota"] or self.quota_busy or self.hidden or self.fullscreen:
            return True
        busy = self.last_pose.get("gpt", ("idle", 0))
        gap = 60 if busy[0] not in ("idle", "sleeping", "happy", "proud") and time.time()-busy[1] < 180 else 120
        if time.time()-self.quota_at < gap:
            return True
        self.quota_at, self.quota_busy = time.time(), True
        def work():
            binary = os.environ.get("CROSSPET_CODEX_BIN") or shutil.which("codex")
            if not binary:
                raise RuntimeError("未找到 Codex CLI；可用 CROSSPET_CODEX_BIN 指定绝对路径后启动桌宠")
            def track(process):
                self.quota_process = process
                if process and self.closing:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            return query_codex(binary, on_process=track)
        def done(value, error):
            self.quota_busy = False
            if value:
                self.quota_last = value
            self.quota_note = error or ""
            if self.s["gptQuota"]:
                payload = self.quota_last
                if error and payload:
                    payload = {**payload, "source": "stale"}
                self.call("setCodexQuota", payload)
            self.push_settings()
        self.background(work, done)
        return True

    def quit(self, user=False):
        if self.closing:
            return False
        if user:
            (self.store.data / "user-quit").write_text(str(time.time()))
        self.save_position()
        self.closing = True
        if self.quota_process:
            try:
                os.killpg(self.quota_process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        self.hotkey.close()
        pidfile = self.store.state / "pet.pid"
        try:
            if pidfile.read_text().strip() == str(os.getpid()):
                pidfile.unlink()
        except OSError:
            pass
        self.window.destroy()
        for window, _web in list(self.pages.values()):
            window.destroy()
        self.lock.close()
        self.log("CROSSPET_LINUX_EXIT_OK")
        Gtk.main_quit()
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只检查运行依赖")
    actions = parser.add_mutually_exclusive_group()
    for name in ("show", "toggle", "quit", "settings"):
        actions.add_argument("--" + name, action="store_true")
    parser.add_argument("--smoke-test", metavar="REPORT_DIR", help="使用隔离数据目录执行本机 GUI 验证")
    parser.add_argument("--smoke-no-input", action="store_true", help="GUI 验证时不模拟鼠标和键盘")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("此入口只支持 Linux")
    try:
        dependencies()
    except (ImportError, ValueError) as error:
        print(f"缺少依赖: {error}\n请先按 docs/linux.md 安装系统包。", file=sys.stderr)
        return 1
    if args.check:
        print("依赖可用：Python + GTK3 + WebKitGTK 4.1 + libwnck")
        return 0
    if args.smoke_test:
        import tempfile
        root = Path(tempfile.mkdtemp(prefix="crosspet-smoke-"))
        os.environ.update(CROSSPET_DATA_DIR=str(root / "data"), CROSSPET_CONFIG_DIR=str(root / "config"),
                          CROSSPET_STATE_DIR=str(root / "state"))
    store = Store()
    store.data.mkdir(parents=True, exist_ok=True)
    lock = (store.data / "instance.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        action = next((name for name in ("toggle", "quit", "settings") if getattr(args, name)), "show")
        write_json(store.data / "control.json", {"action": action, "ts": time.time()})
        print("已通知正在运行的 CrossPet：" + action)
        return 0
    if args.quit:
        return 0
    if os.environ.get("XDG_SESSION_TYPE") == "wayland":
        print("Linux 首版支持 X11：请在登录界面选择「Ubuntu on Xorg」。", file=sys.stderr)
        return 2
    ok, _argv = Gtk.init_check([])
    if not ok or not isinstance(Gdk.Display.get_default(), GdkX11.X11Display):
        print("无法连接 X11 桌面，请在图形会话中运行。", file=sys.stderr)
        return 2
    store.prepare()
    pet = Pet(store, lock, bool(args.smoke_test))
    if args.settings:
        GLib.timeout_add(1200, lambda: pet.open_page("settings") or False)
    if args.smoke_test:
        from smoke import Smoke
        probe = Smoke(pet, Path(args.smoke_test), not args.smoke_no_input)
    Gtk.main()
    return probe.exit_code if args.smoke_test else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
