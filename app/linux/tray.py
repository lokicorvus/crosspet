"""System tray icon (StatusNotifierItem via AyatanaAppIndicator3 / AppIndicator3) for CrossPet Linux."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

_INDICATOR_CLS = None
_STATUS_ACTIVE = None
_CATEGORY_APP = None

for _ns in ("AyatanaAppIndicator3", "AppIndicator3"):
    try:
        gi.require_version(_ns, "0.1")
        _mod = __import__(f"gi.repository.{_ns}", fromlist=[_ns])
        _INDICATOR_CLS = _mod.Indicator
        _STATUS_ACTIVE = _mod.IndicatorStatus.ACTIVE
        _CATEGORY_APP = _mod.IndicatorCategory.APPLICATION_STATUS
        break
    except Exception:
        continue


class TrayIcon:
    """Tray icon exposing the CrossPet context menu and bring-to-front action."""

    def __init__(
        self,
        icon_path: Path,
        build_menu: Callable[[], Gtk.Menu],
        on_activate: Callable[[], None],
    ) -> None:
        self._build_menu = build_menu
        self._on_activate = on_activate
        self._indicator = None
        self._status_icon = None
        self._menu: Gtk.Menu | None = None

        icon_str = str(icon_path) if icon_path.exists() else "face-smile"
        if _INDICATOR_CLS is not None:
            try:
                ind = _INDICATOR_CLS.new("crosspet", icon_str, _CATEGORY_APP)
                ind.set_status(_STATUS_ACTIVE)
                ind.set_title("CrossPet")
                self._indicator = ind
                self.refresh_menu()
                return
            except Exception:
                self._indicator = None

        # Fallback to Gtk.StatusIcon (X11 / older panels)
        try:
            si = Gtk.StatusIcon()
            if icon_path.exists():
                si.set_from_file(icon_str)
            else:
                si.set_from_icon_name("face-smile")
            si.set_tooltip_text("CrossPet：左键叫到最前面，右键打开菜单")
            si.connect("activate", lambda _si: self._on_activate())
            si.connect("popup-menu", self._on_status_popup)
            self._status_icon = si
        except Exception:
            self._status_icon = None

    def _on_status_popup(self, _si: Gtk.StatusIcon, button: int, act_time: int) -> None:
        menu = self._build_menu()
        menu.show_all()
        menu.popup(None, None, Gtk.StatusIcon.position_menu, self._status_icon, button, act_time)

    def refresh_menu(self) -> None:
        if self._indicator is None:
            return
        menu = self._build_menu()
        front_item = Gtk.MenuItem(label="叫到最前面")
        front_item.connect("activate", lambda _i: self._on_activate())
        menu.prepend(Gtk.SeparatorMenuItem())
        menu.prepend(front_item)
        menu.show_all()
        self._menu = menu
        self._indicator.set_menu(menu)
        try:
            self._indicator.set_secondary_activate_target(front_item)
        except Exception:
            pass
