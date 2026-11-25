"""Companion pet window for CrossPet Linux multi-pet mode."""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GLib, Gtk

from .placement import (
    Rect,
    dock_busy,
    dock_clamp_y,
    dock_edge_x,
    dock_side,
    place_window,
    tuck_x,
    yield_next,
)
from .window import PetSurface

if TYPE_CHECKING:
    from .app import CrossPetApp


def _js_quote(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


class Companion:
    """Extra desktop pet window sharing the same process & WebContext as main pet."""

    def __init__(self, app: CrossPetApp, pet: dict[str, Any]) -> None:
        self.app = app
        self.id = str(pet.get("id") or "")
        self.character = str(pet.get("character") or "")
        self.key = str(pet.get("key") or self.id)
        self.client: str | None = pet.get("client") if isinstance(pet.get("client"), str) else None
        self.quota = bool(pet.get("quota", False))
        self.label = str(pet.get("label") or "")

        self.ready = False
        self.leaving = False
        self.closed = False
        self.last_pose: tuple[str, float] | None = None
        self.page_size = (app.page_size[0], app.page_size[1])
        self.page_foot = app.page_foot
        self.shown_foot_pt = app.shown_foot_pt
        self.hit_rects: list[Rect] = []
        self.hit_rects_at = 0.0
        self.yielding = False

        self.dock: str | None = None
        self.dock_out = False
        self.dock_hover = False
        self.dock_tucked = False
        self.docked_at = 0.0
        self.dock_enter_at: float | None = None
        self.dock_leave_at: float | None = None
        self.dock_cut: dict[str, float] = {}
        self._crashes = 0

        w, h = app.surface.rect.w, app.surface.rect.h
        ox, oy = app.companion_origin(self.key, w, h)
        self.surface = PetSurface(
            context=app.web_context,
            handler_name="pet",
            on_message=self.handle_message,
            wm=app.wm,
            initial_rect=Rect(ox, oy, w, h),
            namespace="crosspet-companion",
            keyboard_mode="none",
            on_click=self._on_click,
            on_menu=self._on_menu,
            on_drag_start=self._on_drag_start,
            on_drag_end=self._on_drag_end,
            on_shake=lambda: self.js("shaken()"),
            on_load_started=self._on_load_started,
            on_load_finished=self._on_load_finished,
            on_crash=self._on_crash,
            top_room=self._top_room,
        )
        self.surface.set_zoom(app.pet_scale)
        self.save_origin()
        self.surface.show()
        self.sync_with_main()
        self.surface.load_uri((app.root / "web" / "index.html").as_uri())

    @property
    def origin_key(self) -> str:
        return f"origin-{self.key}"

    @property
    def dock_key(self) -> str:
        return f"dock-{self.key}"

    def save_origin(self) -> None:
        if self.key.endswith("@gather"):
            return
        self.app.config.set(self.origin_key, [self.surface.rect.x, self.surface.rect.y])

    def _top_room(self) -> float:
        if not self.hit_rects:
            return 0.0
        return min(r.min_y for r in self.hit_rects) * self.surface.zoom

    def js(self, code: str) -> None:
        if not self.ready or self.closed:
            return
        self.surface.js(code)

    @property
    def role_info_json(self) -> str:
        return json.dumps(
            {
                "id": self.id,
                "key": self.key,
                "character": self.character,
                "client": self.client,
                "label": self.label,
            },
            ensure_ascii=False,
        )

    def _on_load_started(self) -> None:
        self.ready = False

    def _on_load_finished(self) -> None:
        if self.closed:
            return
        self.ready = True
        self.js(f"setRole('companion', {self.role_info_json})")
        self.js(f"init({self.app.manifest_json})")
        self.js(self.app.companion_look_js)
        self.js(f"setCharacter({_js_quote(self.character)})")
        self.apply_sizes(anchor="corner")
        self.update_page_hidden()
        self.app.feed_companion(self)
        if self.leaving:
            self.surface.js("leaveNow()")
        saved_dock = self.app.config.get_str(self.dock_key)
        if saved_dock and self.app.edge_dock_enabled:
            GLib.timeout_add(1500, lambda: (self._restore_dock(saved_dock), False)[1])

    def _restore_dock(self, side: str) -> None:
        if not self.closed and self.dock is None:
            self.set_dock(side)

    def _on_crash(self) -> None:
        self.ready = False
        if self.closed:
            return
        self._crashes += 1
        if self._crashes > 3:
            self.close()
        else:
            self.surface.reload()

    def handle_message(self, d: Any) -> None:
        if not isinstance(d, dict):
            return
        if d.get("patted") is True:
            self.app.js(f"notePat({_js_quote(self.character)})")
        if d.get("poked") is True:
            self.app.js(f"notePoke({_js_quote(self.character)})")
        if d.get("angered") is True:
            self.app.js(f"noteAngry({_js_quote(self.character)})")
        if d.get("slept") is True:
            self.app.js(f"friendEvent({_js_quote(self.character)}, 'sleep')")
        if d.get("gone") is True:
            self.close()

    def update(self, pet: dict[str, Any]) -> None:
        new_key = str(pet.get("key") or self.key)
        new_client = pet.get("client") if isinstance(pet.get("client"), str) else None
        new_quota = bool(pet.get("quota", False))
        new_label = str(pet.get("label") or "")
        new_char = str(pet.get("character") or self.character)

        char_changed = new_char != self.character
        role_changed = new_key != self.key or new_client != self.client or new_label != self.label or char_changed
        client_changed = new_client != self.client or char_changed
        quota_changed = new_quota != self.quota

        self.character = new_char
        if new_key != self.key:
            self.key = new_key
            self.save_origin()
            if self.dock:
                self.app.config.set(self.dock_key, self.dock)
        self.client = new_client
        self.quota = new_quota
        self.label = new_label

        if not self.ready:
            return
        if role_changed:
            self.js(f"setRole('companion', {self.role_info_json})")
        if char_changed:
            self.js(f"setCharacter({_js_quote(self.character)})")
        if client_changed:
            self.app.feed_companion(self)
        elif quota_changed:
            if self.quota:
                for code in self.app.quota_codes(self.character):
                    self.js(code)
            else:
                self.js(f"setQuota({_js_quote(self.character)}, null)")

    def leave(self) -> None:
        if self.leaving or self.closed:
            return
        self.leaving = True
        if self.app.notebook_owner == self.id:
            self.app.close_notebook()
        self.js("leaveNow()")
        GLib.timeout_add(3000, lambda: (self.close(), False)[1])

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.ready = False
        self.surface.close()
        self.app.companion_closed(self)

    def apply_state(self, text: str, at: float) -> None:
        try:
            s = json.loads(text)
            if isinstance(s, dict) and isinstance(s.get("pose"), str):
                self.last_pose = (s["pose"], at)
        except ValueError:
            pass
        self.js(f"applyCharState({_js_quote(self.character)}, {text})")

    # ---- Sizing ----

    def apply_sizes(self, anchor: str = "feet") -> None:
        if self.shown_foot_pt == 0.0 and self.page_size[0] > 0:
            self.shown_foot_pt = self.page_foot * (self.surface.rect.w / self.page_size[0])

        def finish() -> None:
            if self.closed:
                return
            self.apply_scale(self.app.pet_scale, anchor=anchor)
            if anchor == "feet" and self.dock is not None:
                self.apply_dock()

        if not self.ready:
            finish()
            return

        def on_res(val: Any) -> None:
            if self.closed:
                return
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

        self.surface.js(
            f"setSizes({self.app.pet_scale}, {self.app.text_scale}, {str(self.app.text_linked).lower()})",
            on_res,
        )

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
        self.save_origin()

    # ---- Layer / Visibility / Click-through ----

    def sync_with_main(self) -> None:
        hidden = self.app.user_hidden or self.app.hidden_for_fullscreen
        self.surface.set_hidden(hidden)
        if not hidden:
            self.surface.set_layer(self.app.effective_layer())
        self.update_page_hidden()

    def update_page_hidden(self) -> None:
        if not self.ready:
            return
        hidden = self.app.user_hidden or self.app.hidden_for_fullscreen or self.app.screens_asleep
        self.js(f"setPageHidden({str(hidden).lower()})")

    def update_click_through(self, cursor: tuple[float, float] | None, yield_key: bool) -> None:
        if self.closed or not self.ready:
            return
        if self.app.user_hidden or self.app.hidden_for_fullscreen:
            self.surface.set_hidden(True)
            self._set_yield(False)
            return
        if self.surface.is_dragging:
            return

        now = time.monotonic()
        interval = 0.08 if self.dock is not None else 0.25
        if now - self.hit_rects_at > interval:
            self.hit_rects_at = now

            def on_rects(val: Any) -> None:
                if self.closed:
                    return
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
            over = self.surface.pointer_over

        self._set_yield(yield_next(self.yielding, over=over and bool(self.hit_rects), key=yield_key))
        self.update_dock_hover(over and bool(self.hit_rects))

    def _set_yield(self, on: bool) -> None:
        if on == self.yielding:
            return
        self.yielding = on
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
        self.app.config.remove(self.dock_key)
        self.js("setTucked(null)")

    def check_dock(self) -> None:
        if not self.app.edge_dock_enabled:
            return
        mon = self.surface.current_monitor()
        if mon is None:
            return
        f = self.surface.rect
        mons = self.app.wm.monitors()
        left_nb = any(
            m != mon and m.frame.min_y < f.max_y and m.frame.max_y > f.min_y and abs(m.frame.max_x - mon.frame.min_x) < 2
            for m in mons
        )
        right_nb = any(
            m != mon and m.frame.min_y < f.max_y and m.frame.max_y > f.min_y and abs(m.frame.min_x - mon.frame.max_x) < 2
            for m in mons
        )
        reach = f.w * (self.app.BASE_W / max(1.0, self.page_size[0])) * 0.3
        side = dock_side(f, mon.work_area, reach, left_nb, right_nb)
        if side:
            self.set_dock(side)

    def set_dock(self, side: str) -> None:
        self.dock = side
        self.docked_at = time.time()
        self.app.config.set(self.dock_key, side)
        self.dock_out = self._dock_busy()
        self.apply_dock()

    def _dock_busy(self) -> bool:
        poses = [self.last_pose] if self.last_pose is not None else []
        return dock_busy(poses, since=self.docked_at, now=time.time())

    def update_dock(self) -> None:
        if self.dock is None:
            return
        busy = self._dock_busy()
        if busy != self.dock_out:
            self.dock_out = busy
            self.dock_hover = False
            self.apply_dock()

    def apply_dock(self) -> None:
        if self.dock is None or self.closed:
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
        if self.closed or self.dock != side or self.dock_out:
            return
        self.dock_tucked = True
        peek = self.dock_hover
        self.js(f"setTucked({_js_quote(side)}, {str(peek).lower()})")
        key = f"{side}{'-peek' if peek else ''}{self.character}"
        f = dock_clamp_y(self.surface.rect, vf)

        def place(cut: float) -> None:
            if self.closed or self.dock != side or self.dock_out or self.dock_hover != peek:
                return
            zoom = f.w / max(1.0, self.page_size[0])
            tx = tuck_x(side, cut, zoom, vf)
            if abs(tx - self.surface.rect.x) > 1:
                self.surface.slide_to(tx, f.y)

        if key in self.dock_cut:
            place(self.dock_cut[key])
            return

        def measure() -> bool:
            if self.closed or self.dock != side or self.dock_out or self.dock_hover != peek:
                return False

            def on_cut(val: Any) -> None:
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    self.dock_cut[key] = float(val)
                    place(float(val))

            self.surface.js(f"dockCut({_js_quote(side)})", on_cut)
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

    # ---- Pointer & Menu ----

    def _on_click(self, cx: float, cy: float) -> None:
        self.js(f"handleClick('pat', {cx:.1f}, {cy:.1f})")

    def _on_drag_start(self) -> None:
        self.app.close_notebook()
        self.undock()

    def _on_drag_end(self, shook: bool) -> None:
        self.save_origin()
        if not shook:
            self.check_dock()

    def _on_menu(self, ev: Gdk.EventButton, _shift: bool) -> None:
        menu = Gtk.Menu()
        for label, cb in (
            ("摸摸头", lambda _i: self.js("handleClick('pat')")),
            ("戳一下", lambda _i: self.js("handleClick('poke')")),
            ("我们的小本子", lambda _i: self.app.open_notebook(self.character, self.surface.rect, self.id)),
            ("让她先回去", lambda _i: self.app.js(f"sendCompanionHome({_js_quote(self.id)})")),
        ):
            item = Gtk.MenuItem(label=label)
            item.connect("activate", cb)
            menu.append(item)

        skins = self.app.skin_choices.get(self.character) or []
        if skins:
            worn = self.app.config.get_dict("skins").get(self.character, "")
            outfit_item = Gtk.MenuItem(label="换衣服")
            sub = Gtk.Menu()
            outfits = [("", self.app.base_outfit.get(self.character) or "原版")] + skins
            for sid, sname in outfits:
                it = Gtk.CheckMenuItem(label=sname)
                it.set_active(worn == sid)
                it.connect("activate", lambda _i, skin=sid: (self.app.wear(self.character, skin), self.app.push_settings()))
                sub.append(it)
            outfit_item.set_submenu(sub)
            menu.append(outfit_item)

        menu.append(Gtk.SeparatorMenuItem())
        settings_item = Gtk.MenuItem(label="设置…")
        settings_item.connect("activate", lambda _i: self.app.open_settings_at(None))
        menu.append(settings_item)
        menu.show_all()
        menu.popup_at_pointer(ev)
