"""Transparent overlay window (Wayland gtk-layer-shell & X11 fallback) and WebKit2GTK helpers."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any, Callable

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
gi.require_version("GtkLayerShell", "0.1")

import cairo
from gi.repository import Gdk, GLib, Gtk, GtkLayerShell, WebKit2

from .placement import Rect
from .wm import MonitorRect, WMBackend


def create_shared_web_context(root: Path) -> WebKit2.WebContext:
    """Create a shared WebContext so main pet, companions, and notebook share localStorage."""
    data_dir = root / "webkit-data"
    cache_dir = root / "webkit-cache"
    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    mgr = WebKit2.WebsiteDataManager(
        base_data_directory=str(data_dir),
        base_cache_directory=str(cache_dir),
    )
    return WebKit2.WebContext.new_with_website_data_manager(mgr)


def create_webview(
    context: WebKit2.WebContext,
    handler_name: str,
    on_message: Callable[[Any], None],
    transparent: bool = False,
) -> WebKit2.WebView:
    """Create a WebKit2.WebView configured for local file access and JS-to-Python messaging."""
    ucm = WebKit2.UserContentManager()
    ucm.register_script_message_handler(handler_name)

    def _on_msg(_ucm: WebKit2.UserContentManager, js_result: WebKit2.JavascriptResult) -> None:
        try:
            val = js_result.get_js_value()
            raw = val.to_json(0)
            obj = json.loads(raw) if raw else None
        except Exception:
            obj = None
        if obj is not None:
            on_message(obj)

    ucm.connect(f"script-message-received::{handler_name}", _on_msg)
    wv = WebKit2.WebView(web_context=context, user_content_manager=ucm)
    settings = wv.get_settings()
    settings.set_allow_file_access_from_file_urls(True)
    settings.set_allow_universal_access_from_file_urls(True)
    settings.set_javascript_can_access_clipboard(True)
    settings.set_enable_developer_extras(True)
    if transparent:
        wv.set_background_color(Gdk.RGBA(0.0, 0.0, 0.0, 0.0))
    return wv


def eval_js(webview: WebKit2.WebView | None, code: str, callback: Callable[[Any], None] | None = None) -> None:
    """Evaluate JavaScript in a WebKit2.WebView and optionally pass decoded Python value to callback."""
    if webview is None:
        if callback:
            callback(None)
        return

    def _done(wv: WebKit2.WebView, res: Any) -> None:
        out: Any = None
        try:
            val = wv.evaluate_javascript_finish(res)
            if val is not None and not val.is_null() and not val.is_undefined():
                if val.is_boolean():
                    out = val.to_boolean()
                elif val.is_number():
                    out = val.to_double()
                elif val.is_string():
                    out = val.to_string()
                else:
                    raw = val.to_json(0)
                    out = json.loads(raw) if raw else None
        except Exception:
            out = None
        if callback:
            callback(out)

    webview.evaluate_javascript(code, -1, None, None, None, _done if callback else None)


def _draw_transparent(_widget: Gtk.Widget, cr: cairo.Context) -> bool:
    cr.save()
    cr.set_operator(cairo.OPERATOR_SOURCE)
    cr.set_source_rgba(0.0, 0.0, 0.0, 0.0)
    cr.paint()
    cr.restore()
    return False


class PetSurface:
    """Transparent desktop pet / notebook overlay window supporting Wayland Layer-Shell and X11."""

    def __init__(
        self,
        context: WebKit2.WebContext,
        handler_name: str,
        on_message: Callable[[Any], None],
        wm: WMBackend,
        initial_rect: Rect,
        namespace: str = "crosspet",
        keyboard_mode: str = "none",
        interactive_bridge: bool = True,
        on_click: Callable[[float, float], None] | None = None,
        on_menu: Callable[[Gdk.EventButton, bool], None] | None = None,
        on_drag_start: Callable[[], None] | None = None,
        on_drag_end: Callable[[bool], None] | None = None,
        on_shake: Callable[[], None] | None = None,
        on_load_finished: Callable[[], None] | None = None,
        on_load_started: Callable[[], None] | None = None,
        on_crash: Callable[[], None] | None = None,
        top_room: Callable[[], float] | None = None,
    ) -> None:
        self.wm = wm
        self.rect = initial_rect
        self.zoom = 1.0
        self.hidden = False
        self.yielding = False
        self.layer_mode = "overlay"  # "overlay" | "top" | "bottom"
        self._has_hit_rects = False
        self._hit_rects: list[Rect] = []
        self._slide_timer: int | None = None
        self._current_monitor_name: str | None = None

        self._on_click = on_click
        self._on_menu = on_menu
        self._on_drag_start = on_drag_start
        self._on_drag_end = on_drag_end
        self._on_shake = on_shake
        self._top_room = top_room

        # Drag / shake state
        self._down_local: tuple[float, float] | None = None
        self._down_global: tuple[float, float] | None = None
        self._origin_at: tuple[float, float] = (initial_rect.x, initial_rect.y)
        self._dragged = False
        self._shook = False
        self._swing_x = 0.0
        self._swing_dir = 0.0
        self._swings: list[float] = []
        self._shake_said = 0.0
        self._last_fallback_drag = 0.0
        self._pointer_over = False

        self.win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.win.set_title("CrossPet")
        self.win.set_wmclass(namespace, "CrossPet")
        self.win.set_decorated(False)
        self.win.set_resizable(False)
        self.win.set_skip_taskbar_hint(True)
        self.win.set_skip_pager_hint(True)
        self.win.set_accept_focus(keyboard_mode != "none")

        screen = self.win.get_screen()
        visual = screen.get_rgba_visual()
        if visual is not None:
            self.win.set_visual(visual)
        self.win.set_app_paintable(True)
        self.win.connect("draw", _draw_transparent)

        self.use_layer_shell = bool(GtkLayerShell.is_supported())
        if self.use_layer_shell:
            GtkLayerShell.init_for_window(self.win)
            GtkLayerShell.set_namespace(self.win, namespace)
            GtkLayerShell.set_exclusive_zone(self.win, -1)
            GtkLayerShell.set_anchor(self.win, GtkLayerShell.Edge.TOP, True)
            GtkLayerShell.set_anchor(self.win, GtkLayerShell.Edge.LEFT, True)
            kb = (
                GtkLayerShell.KeyboardMode.ON_DEMAND
                if keyboard_mode == "on_demand"
                else GtkLayerShell.KeyboardMode.NONE
            )
            GtkLayerShell.set_keyboard_mode(self.win, kb)
            GtkLayerShell.set_layer(self.win, GtkLayerShell.Layer.OVERLAY)
        else:
            self.win.set_type_hint(Gdk.WindowTypeHint.UTILITY)
            self.win.stick()
            self.win.set_keep_above(True)

        self.webview = create_webview(context, handler_name, on_message, transparent=True)
        self.win.add(self.webview)

        def _on_load_changed(_wv: WebKit2.WebView, ev: WebKit2.LoadEvent) -> None:
            if ev == WebKit2.LoadEvent.STARTED and on_load_started:
                on_load_started()
            elif ev == WebKit2.LoadEvent.FINISHED and on_load_finished:
                on_load_finished()

        self.webview.connect("load-changed", _on_load_changed)
        if on_crash:
            self.webview.connect("web-process-terminated", lambda _wv, _reason: on_crash())

        if interactive_bridge:
            self.webview.add_events(
                Gdk.EventMask.BUTTON_PRESS_MASK
                | Gdk.EventMask.BUTTON_RELEASE_MASK
                | Gdk.EventMask.POINTER_MOTION_MASK
                | Gdk.EventMask.ENTER_NOTIFY_MASK
                | Gdk.EventMask.LEAVE_NOTIFY_MASK
            )
            self.webview.connect("context-menu", lambda *_args: True)
            self.webview.connect("button-press-event", self._on_button_press)
            self.webview.connect("motion-notify-event", self._on_motion)
            self.webview.connect("button-release-event", self._on_button_release)
            self.webview.connect("enter-notify-event", self._on_enter)
            self.webview.connect("leave-notify-event", self._on_leave)

        self.set_geometry(initial_rect.x, initial_rect.y, initial_rect.w, initial_rect.h)

    def show(self) -> None:
        self.win.show_all()
        self.set_geometry(self.rect.x, self.rect.y, self.rect.w, self.rect.h)
        self._apply_input_region()

    def close(self) -> None:
        self.cancel_slide()
        try:
            self.webview.stop_loading()
        except Exception:
            pass
        try:
            self.win.destroy()
        except Exception:
            pass

    def load_uri(self, uri: str) -> None:
        self.webview.load_uri(uri)

    def reload(self) -> None:
        self.webview.reload()

    def set_zoom(self, zoom: float) -> None:
        self.zoom = max(0.01, float(zoom))
        self.webview.set_zoom_level(self.zoom)

    def js(self, code: str, callback: Callable[[Any], None] | None = None) -> None:
        eval_js(self.webview, code, callback)

    def set_layer(self, mode: str) -> None:
        """Set layer mode: 'overlay' (always-on-top), 'top' (normal/top), or 'bottom' (behind windows)."""
        if mode == self.layer_mode:
            return
        self.layer_mode = mode
        if self.use_layer_shell:
            layer_map = {
                "overlay": GtkLayerShell.Layer.OVERLAY,
                "top": GtkLayerShell.Layer.TOP,
                "bottom": GtkLayerShell.Layer.BOTTOM,
            }
            GtkLayerShell.set_layer(self.win, layer_map.get(mode, GtkLayerShell.Layer.OVERLAY))
        else:
            if mode == "overlay":
                self.win.set_keep_below(False)
                self.win.set_keep_above(True)
            elif mode == "bottom":
                self.win.set_keep_above(False)
                self.win.set_keep_below(True)
            else:
                self.win.set_keep_above(False)
                self.win.set_keep_below(False)

    def set_hidden(self, hidden: bool) -> None:
        if hidden == self.hidden:
            return
        self.hidden = hidden
        self.win.set_opacity(0.0 if hidden else 1.0)
        self._apply_input_region()

    def set_yielding(self, yielding: bool) -> None:
        if yielding == self.yielding:
            return
        self.yielding = yielding
        self._apply_input_region()

    def set_hit_rects(self, rects: list[Rect]) -> None:
        self._hit_rects = list(rects)
        if rects:
            self._has_hit_rects = True
        self._apply_input_region()

    def _apply_input_region(self) -> None:
        gdk_win = self.win.get_window()
        if gdk_win is None:
            return
        if self.hidden or self.yielding:
            gdk_win.input_shape_combine_region(cairo.Region(), 0, 0)
            return
        if not self._has_hit_rects:
            return
        region = cairo.Region()
        z = self.zoom
        for r in self._hit_rects:
            rx = int(math.floor(r.x * z))
            ry = int(math.floor(r.y * z))
            rw = max(1, int(math.ceil((r.x + r.w) * z)) - rx)
            rh = max(1, int(math.ceil((r.y + r.h) * z)) - ry)
            region.union(cairo.RectangleInt(rx, ry, rw, rh))
        gdk_win.input_shape_combine_region(region, 0, 0)

    def _find_monitor_and_gdk(self, x: float, y: float, w: float, h: float) -> tuple[MonitorRect | None, Gdk.Monitor | None]:
        mons = self.wm.monitors()
        cx, cy = x + w / 2.0, y + h / 2.0
        target = next((m for m in mons if m.frame.contains_point(cx, cy)), None)
        if target is None and mons:
            target = next((m for m in mons if m.focused), mons[0])

        gdk_mon: Gdk.Monitor | None = None
        display = Gdk.Display.get_default()
        if display is not None and display.get_n_monitors() > 0:
            if target is not None:
                best_dist = float("inf")
                for i in range(display.get_n_monitors()):
                    gm = display.get_monitor(i)
                    gg = gm.get_geometry()
                    dist = abs(gg.x - target.x) + abs(gg.y - target.y)
                    if dist < best_dist:
                        best_dist = dist
                        gdk_mon = gm
            if gdk_mon is None:
                gdk_mon = display.get_monitor(0)
        return target, gdk_mon

    def current_monitor(self) -> MonitorRect | None:
        mon, _ = self._find_monitor_and_gdk(self.rect.x, self.rect.y, self.rect.w, self.rect.h)
        return mon

    def set_geometry(self, x: float, y: float, w: float, h: float) -> None:
        self.rect = Rect(x, y, w, h)
        iw = max(1, int(round(w)))
        ih = max(1, int(round(h)))
        self.win.set_size_request(iw, ih)
        self.win.resize(iw, ih)
        if self.use_layer_shell:
            mon, gdk_mon = self._find_monitor_and_gdk(x, y, w, h)
            if gdk_mon is not None:
                mname = mon.name if mon else ""
                if mname != self._current_monitor_name:
                    self._current_monitor_name = mname
                    GtkLayerShell.set_monitor(self.win, gdk_mon)
            ox = mon.x if mon else 0.0
            oy = mon.y if mon else 0.0
            GtkLayerShell.set_margin(self.win, GtkLayerShell.Edge.LEFT, int(round(x - ox)))
            GtkLayerShell.set_margin(self.win, GtkLayerShell.Edge.TOP, int(round(y - oy)))
        else:
            self.win.move(int(round(x)), int(round(y)))

    def cancel_slide(self) -> None:
        if self._slide_timer is not None:
            GLib.source_remove(self._slide_timer)
            self._slide_timer = None

    def slide_to(self, x: float, y: float, duration: float = 0.35) -> None:
        self.cancel_slide()
        start_x, start_y = self.rect.x, self.rect.y
        if abs(x - start_x) < 1.0 and abs(y - start_y) < 1.0:
            self.set_geometry(x, y, self.rect.w, self.rect.h)
            return
        t0 = time.monotonic()

        def step() -> bool:
            k = min(1.0, (time.monotonic() - t0) / max(0.01, duration))
            eased = 0.5 - 0.5 * math.cos(math.pi * k)
            nx = start_x + (x - start_x) * eased
            ny = start_y + (y - start_y) * eased
            self.set_geometry(nx, ny, self.rect.w, self.rect.h)
            if k >= 1.0:
                self._slide_timer = None
                return False
            return True

        self._slide_timer = GLib.timeout_add(16, step)

    def _global_cursor(self, ev: Any) -> tuple[float, float] | None:
        pos = self.wm.cursor_pos()
        if pos is not None:
            return pos
        if self.wm.name == "x11" and hasattr(ev, "x_root") and hasattr(ev, "y_root"):
            return float(ev.x_root), float(ev.y_root)
        return None

    def _on_enter(self, _w: Gtk.Widget, _ev: Any) -> bool:
        self._pointer_over = True
        return False

    def _on_leave(self, _w: Gtk.Widget, _ev: Any) -> bool:
        self._pointer_over = False
        return False

    def _on_button_press(self, _w: Gtk.Widget, ev: Gdk.EventButton) -> bool:
        if ev.button == 3:
            shift = bool(ev.state & Gdk.ModifierType.SHIFT_MASK)
            if self._on_menu:
                self._on_menu(ev, shift)
            return True
        if ev.button == 1:
            self._down_local = (float(ev.x), float(ev.y))
            self._down_global = self._global_cursor(ev)
            self._origin_at = (self.rect.x, self.rect.y)
            self._dragged = False
            self._shook = False
            self._swing_x = 0.0
            self._swing_dir = 0.0
            self._swings = []
            return True
        return False

    def _on_motion(self, _w: Gtk.Widget, ev: Gdk.EventMotion) -> bool:
        self._pointer_over = True
        if self._down_local is None or not (ev.state & Gdk.ModifierType.BUTTON1_MASK):
            return False

        cur = self._global_cursor(ev)
        if cur is not None and self._down_global is not None:
            gx, gy = cur
            dx = gx - self._down_global[0]
            dy = gy - self._down_global[1]
            nx = self._origin_at[0] + dx
            ny = self._origin_at[1] + dy
        else:
            now = time.monotonic()
            if now - self._last_fallback_drag < 0.016:
                return True
            self._last_fallback_drag = now
            dx = float(ev.x) - self._down_local[0]
            dy = float(ev.y) - self._down_local[1]
            gx = self.rect.x + float(ev.x)
            nx = self.rect.x + dx
            ny = self.rect.y + dy

        if not self._dragged:
            if abs(dx) + abs(dy) <= 3.0:
                return True
            self._dragged = True
            self._swing_x = gx
            self._swing_dir = 0.0
            self._swings = []
            if self._on_drag_start:
                self._on_drag_start()

        now = time.monotonic()
        if self._swing_dir == 0.0:
            if abs(gx - self._swing_x) > 18.0:
                self._swing_dir = 1.0 if gx > self._swing_x else -1.0
                self._swing_x = gx
        elif (gx - self._swing_x) * self._swing_dir > 0.0:
            self._swing_x = gx
        elif (self._swing_x - gx) * self._swing_dir > 18.0:
            self._swing_dir = -self._swing_dir
            self._swing_x = gx
            self._swings.append(now)
            self._swings = [t for t in self._swings if now - t < 0.9]
            if len(self._swings) >= 2 and now - self._shake_said > 0.3:
                self._shook = True
                self._shake_said = now
                if self._on_shake:
                    self._on_shake()

        mon, _ = self._find_monitor_and_gdk(nx, ny, self.rect.w, self.rect.h)
        if mon is not None:
            room = max(0.0, self._top_room() if self._top_room else 0.0)
            ny = max(mon.work_y - room, ny)
        self.set_geometry(nx, ny, self.rect.w, self.rect.h)
        return True

    def _on_button_release(self, _w: Gtk.Widget, ev: Gdk.EventButton) -> bool:
        if ev.button != 1 or self._down_local is None:
            return False
        was_dragged = self._dragged
        was_shook = self._shook
        self._down_local = None
        self._down_global = None
        self._dragged = False
        if was_dragged:
            if self._on_drag_end:
                self._on_drag_end(was_shook)
        else:
            if self._on_click:
                self._on_click(float(ev.x) / self.zoom, float(ev.y) / self.zoom)
        return True

    @property
    def is_dragging(self) -> bool:
        return self._down_local is not None

    @property
    def pointer_over(self) -> bool:
        return self._pointer_over
