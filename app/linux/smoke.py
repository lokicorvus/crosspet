"""真实 X11 / WebKit 冒烟测试。只使用 main 创建的隔离目录，不修改用户 AI 配置。"""
import ctypes as C
import json
import os
from pathlib import Path
import subprocess
import time

import gi
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2, Gdk
from core import ROOT, Store, write_json


class Rectangle(C.Structure):
    _fields_ = [("x", C.c_short), ("y", C.c_short), ("width", C.c_ushort), ("height", C.c_ushort)]


class Smoke:
    def __init__(self, pet, output, native_input=True):
        self.pet, self.output = pet, output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.exit_code, self.results, self.done = 1, [], False
        self.use_native_input = native_input
        self.deadline = GLib.timeout_add_seconds(50, lambda: self.fail("GUI 验证超时"))
        GLib.timeout_add(100, self.wait_ready)

    def later(self, ms, fn):
        def run():
            if self.done:
                return False
            try:
                fn()
            except Exception as error:
                self.fail(str(error))
            return False
        GLib.timeout_add(ms, run)

    def expect(self, name, condition, detail=None):
        self.results.append({"check": name, "passed": bool(condition), "detail": detail})
        if not condition:
            raise AssertionError(f"{name}: {detail}")

    def evaluate(self, code, fn, web=None):
        def callback(value):
            if self.done:
                return
            try:
                fn(value)
            except Exception as error:
                self.fail(str(error))
        self.pet.js(code, callback, web)

    def wait_ready(self):
        if self.done:
            return False
        if not self.pet.ready:
            return True
        self.pet.s.update(eggs=False, followApps=False)
        self.pet.apply_settings()
        self.pet.switch("gpt", True)
        self.later(1800, self.images)
        return False

    def images(self):
        self.evaluate("""({status:devStatus(), viewport:[innerWidth,innerHeight,devicePixelRatio], loaded:[...document.images].filter(i=>i.naturalWidth>0).length,
            failed:[...document.images].filter(i=>i.src && i.complete && !i.naturalWidth).map(i=>i.src),
            bg:getComputedStyle(document.body).backgroundColor})""", self.image_result)

    def image_result(self, value):
        self.expect("original_web_and_sprites", value["loaded"] > 0 and not value["failed"], value)
        self.expect("transparent_webview", self.pet.web.get_background_color().alpha == 0, value["bg"])
        self.expect("native_rgba_window", self.pet.window.get_window().get_visual().get_depth() == 32)
        lib, display = self.pet.hotkey.lib, self.pet.hotkey.display
        lib.XGetImage.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_ulong, C.c_int]
        lib.XGetImage.restype = C.c_void_p
        lib.XGetPixel.argtypes, lib.XGetPixel.restype = [C.c_void_p, C.c_int, C.c_int], C.c_ulong
        lib.XDestroyImage.argtypes = [C.c_void_p]
        image = lib.XGetImage(display, self.pet.window.get_window().get_xid(), 0, 0, 1, 1, C.c_ulong(-1), 2)
        if not image:
            raise RuntimeError("无法读取原生窗口像素")
        try:
            alpha = (lib.XGetPixel(image, 0, 0) >> 24) & 255
            self.expect("native_transparent_corner", alpha == 0, alpha)
        finally:
            lib.XDestroyImage(image)
        self.expect("non_focusable_window", not self.pet.window.get_accept_focus())
        self.snapshot("pet.png")
        env = dict(os.environ, CROSSPET_STATE_DIR=str(self.pet.store.state), CROSSPET_DATA_DIR=str(self.pet.store.data))
        event = {"hook_event_name": "PreToolUse", "session_id": "linux-smoke",
                 "tool_name": "Bash", "cwd": "/tmp"}
        result = subprocess.run(["/usr/bin/python3", str(ROOT / "integrations/crosspet-hook.py"), "gpt"],
                                input=json.dumps(event), text=True, capture_output=True, env=env, timeout=5)
        self.expect("real_hook_process", result.returncode == 0, result.stderr)
        self.later(1200, lambda: self.evaluate("({state:charState.gpt,status:devStatus()})", self.event_result))

    def event_result(self, value):
        self.expect("hook_to_web_state", value["state"]["pose"] == "running" and value["status"]["charId"] == "gpt", value)
        self.expect("x11_input_shape", self.input_rectangles() > 0 and bool(self.pet.rects), self.pet.rects)
        self.pet.toggle()
        self.later(350, self.hidden)

    def input_rectangles(self):
        xext = C.CDLL("libXext.so.6")
        xext.XShapeGetRectangles.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int)]
        xext.XShapeGetRectangles.restype = C.POINTER(Rectangle)
        count, order = C.c_int(), C.c_int()
        ptr = xext.XShapeGetRectangles(self.pet.hotkey.display, self.pet.window.get_window().get_xid(),
                                      2, C.byref(count), C.byref(order))
        self.pet.hotkey.lib.XFree.argtypes = [C.c_void_p]
        self.pet.hotkey.lib.XFree(ptr)
        return count.value

    def hidden(self):
        self.expect("hidden_window_no_input", self.pet.window.get_opacity() == 0 and self.input_rectangles() == 0)
        self.pet.toggle()
        self.pet.open_page("settings")
        self.later(1200, self.settings)

    def settings(self):
        web = self.pet.pages["settings"][1]
        self.evaluate("""({platform:state.platform,characters:state.characters.length,
            peakStyle:document.querySelector('#peakStyle .on')?.dataset.v,
            qwen:state.integrations.find(i=>i.id==='qwen'),
            qwenVisible:document.getElementById('integrations').textContent.includes('Qwen Code')})""", self.settings_result, web)

    def settings_result(self, value):
        self.expect("shared_settings_page", value["platform"] == "linux" and value["characters"] >= 5, value)
        self.expect("peak_style_default_in_settings", value["peakStyle"] == "bar", value)
        self.expect("qwen_settings_entry", bool(value.get("qwen")) and value["qwenVisible"], value)
        self.snapshot("settings.png", self.pet.pages["settings"][1])
        self.evaluate("""(() => {
            document.querySelector('#peakStyle [data-v=text]').click();
            const c = state.characters.find(c=>c.id==='deepseek');
            const sel = [...document.querySelectorAll('#peakOutfits select')].find(s=>s.getAttribute('aria-label') === c.name+'高峰穿');
            sel.value = 'deepseek-pajamas'; sel.dispatchEvent(new Event('change')); return true;
        })()""", lambda _: self.later(400, self.peak_settings), self.pet.pages["settings"][1])

    def peak_settings(self):
        expected = {"deepseek": {"peak": "deepseek-pajamas"}}
        saved = Store().settings
        self.expect("peak_settings_persisted", saved["peakStyle"] == "text" and saved["peakSkins"] == expected, saved)
        self.evaluate("({style:peakStyle,skins:peakSkins,current:charId,worn:manifest.characters.deepseek.skin || ''})", self.peak_settings_result)

    def peak_settings_result(self, value):
        self.expect("peak_settings_to_pet_web", value["style"] == "text" and
                    value["skins"] == {"deepseek": {"peak": "deepseek-pajamas"}} and value["worn"] == "", value)
        # 使用网页真实的峰谷判定和 wear 桥接；模拟周一高峰，后台角色应换衣但不能抢走当前角色。
        self.evaluate("""devPeakApplied = {}; devPeakShift = Date.parse('2026-10-19T10:00:00+08:00') - Date.now();
            checkPeakOutfits(); true""", lambda _: self.later(400, self.peak_worn))

    def peak_worn(self):
        self.expect("peak_outfit_persisted", Store().settings["skins"].get("deepseek") == "deepseek-pajamas")
        self.evaluate("({current:charId,worn:manifest.characters.deepseek.skin})", self.peak_worn_result)

    def peak_worn_result(self, value):
        self.expect("peak_outfit_bridge_keeps_current_character", value["current"] == "gpt" and
                    value["worn"] == "deepseek-pajamas", value)
        self.pet.set_setting("peakSkins", {})
        self.pet.pet_message({"wear": {"id": "deepseek", "skin": ""}})
        self.pet.set_setting("peakStyle", "bar")
        self.evaluate("devPeakShift = 0; devPeakApplied = null; true", lambda _: None)
        self.evaluate("post({cmd:'set',key:'size',value:1.25}); true", lambda _: self.later(800, self.resized),
                      self.pet.pages["settings"][1])

    def resized(self):
        self.expect("settings_to_native_bridge", self.pet.s["size"] == 1.25 and self.pet.web.get_zoom_level() == 1.25)
        self.evaluate("({w:innerWidth,h:innerHeight})", self.geometry)

    def geometry(self, value):
        expected = self.pet.page_size
        self.expect("webview_css_size", abs(value["w"]-expected[0]) <= 2 and abs(value["h"]-expected[1]) <= 2, value)
        self.pet.set_setting("size", 1)
        self.later(600, self.dock_at_window_edge)

    def dock_at_window_edge(self):
        # 真实 GTK 窗口先到工作区边缘，再走松开拖动时的检测，不能直接注入 dock。
        # 多显示器时取最右侧的外边缘，屏幕之间的接缝本来就不应吸附。
        display = self.pet.window.get_display()
        monitor = max((display.get_monitor(i) for i in range(display.get_n_monitors())),
                      key=lambda m: m.get_geometry().x+m.get_geometry().width)
        r = monitor.get_workarea()
        w, h = self.pet.window.get_size()
        y = r.y+(r.height-h)//2
        self.pet.window.move(r.x+r.width-w, y)
        self.later(250, self.detect_dock)

    def detect_dock(self):
        self.pet.check_dock()
        self.expect("window_edge_triggers_dock", self.pet.dock == "right",
                    {"position": list(self.pet.window.get_position()), "size": list(self.pet.window.get_size())})
        self.later(1000, self.docked)

    def docked(self):
        self.evaluate("({tucked,pose,cut:dockCut('right')})", self.dock_result)

    def dock_result(self, value):
        self.expect("edge_dock_shared_animation", value["tucked"] == "right" and value["pose"].startswith("edge_right"), value)
        x, _ = self.pet.window.get_position()
        r = self.pet.monitor().get_workarea()
        self.expect("edge_dock_position", abs(x + value["cut"] * self.pet.actual_scale - r.x-r.width) < 3)
        self.pet.reset_position()
        self.pet.open_page("dev")
        self.later(1000, self.dev)

    def dev(self):
        self.evaluate("typeof onPetStatus === 'function'", lambda value: self.dev_result(value), self.pet.pages["dev"][1])

    def dev_result(self, value):
        self.expect("shared_developer_console", value)
        self.pet.dev_message({"cmd": "status"})
        self.later(400, self.native_input if self.use_native_input else self.finish)

    def native_input(self):
        # 只向我们创建的窗口发送输入；保存并恢复指针位置。
        # 关闭开发者控制台，恢复它默认暂停的真实 AI 事件。
        for window, _ in list(self.pet.pages.values()):
            window.destroy()
        self.underlay = Gtk.Window(title="CrossPet input test")
        self.underlay.set_decorated(False)
        self.underlay.set_accept_focus(False)
        self.underlay.set_focus_on_map(False)
        self.underlay.set_default_size(*self.pet.window.get_size())
        self.clicks = 0
        def clicked(*_):
            self.clicks += 1
            return True
        self.underlay.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
        self.underlay.connect("button-press-event", clicked)
        self.underlay.show_all()
        self.underlay.move(*self.pet.window.get_position())
        self.pet.window.get_window().raise_()
        self.xtest = C.CDLL("libXtst.so.6")
        self.xtest.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
        self.xtest.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        self.xtest.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        _, x, y = self.pet.window.get_display().get_default_seat().get_pointer().get_position()
        self.pointer_before = (x, y)
        self.later(400, self.click_transparent)

    def move_pointer(self, x, y):
        z = self.pet.window.get_scale_factor()
        self.xtest.XTestFakeMotionEvent(self.pet.hotkey.display, -1, round(x*z), round(y*z), 0)
        self.pet.hotkey.lib.XSync(self.pet.hotkey.display, False)

    def button(self, down):
        self.xtest.XTestFakeButtonEvent(self.pet.hotkey.display, 1, down, 0)
        self.pet.hotkey.lib.XSync(self.pet.hotkey.display, False)

    def click_transparent(self):
        x, y = self.pet.window.get_position()
        self.move_pointer(x+5, y+5)
        self.button(True)
        self.button(False)
        self.later(350, self.click_body)

    def click_body(self):
        self.expect("real_click_through", self.clicks == 1, self.clicks)
        # 从网页读取稳定的本体中央，按 GTK 的显示缩放映射到 X11 物理坐标。
        self.evaluate("(()=>{const r=document.getElementById('body').getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]})()",
                      self.body_point)

    def body_point(self, value):
        x, y = self.pet.window.get_position()
        self.body = (x+value[0]*self.pet.actual_scale, y+value[1]*self.pet.actual_scale)
        self.move_pointer(*self.body)
        self.button(True)
        self.button(False)
        self.later(500, lambda: self.evaluate("devStatus().pose", self.pat))

    def pat(self, value):
        self.expect("real_pet_click", value == "pat" and self.clicks == 1, value)
        self.origin = tuple(self.pet.window.get_position())
        self.button(True)
        self.later(200, lambda: self.move_pointer(self.body[0]-45, self.body[1]-25))
        self.later(450, lambda: self.button(False))
        self.later(700, self.dragged)

    def dragged(self):
        x, y = self.pet.window.get_position()
        self.expect("real_drag", abs(x-self.origin[0]+45) < 3 and abs(y-self.origin[1]+25) < 3,
                    {"before": self.origin, "after": [x, y]})
        self.move_pointer(*self.pointer_before)
        self.underlay.destroy()
        self.drag_to_edge("left")

    def drag_to_edge(self, side):
        self.drag_side = side
        self.pet.undock()
        r = self.pet.monitor().get_workarea()
        w, h = self.pet.window.get_size()
        self.pet.window.move(r.x+(r.width-w)//2, r.y+(r.height-h)//2)
        self.later(650, lambda: self.evaluate(
            "(()=>{const r=document.getElementById('body').getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]})()",
            self.edge_drag_point))

    def edge_drag_point(self, value):
        x, y = self.pet.window.get_position()
        r = self.pet.monitor().get_workarea()
        w, _ = self.pet.window.get_size()
        bx, by = value[0]*self.pet.actual_scale, value[1]*self.pet.actual_scale
        edge_x = r.x if self.drag_side == "left" else r.x+r.width-w
        self.move_pointer(x+bx, y+by)
        self.button(True)
        self.later(150, lambda: self.move_pointer(edge_x+bx, y+by))
        self.later(350, lambda: self.button(False))
        self.later(450, lambda: self.move_pointer(r.x+r.width//2, r.y+30))
        self.later(1600, lambda: self.evaluate("({tucked,tuckedPeek,pose})", self.edge_drag_result))

    def edge_drag_result(self, value):
        self.expect("real_drag_dock_" + self.drag_side,
                    self.pet.dock == self.drag_side and value["tucked"] == self.drag_side and not value["tuckedPeek"], value)
        self.snapshot("edge-" + self.drag_side + ".png")
        if self.drag_side == "left":
            self.drag_to_edge("right")
        else:
            # 将指针放到真正可点击的露出部分，验证探头和移开后的回缩。
            x, y = self.pet.window.get_position()
            r = self.pet.monitor().get_workarea()
            for rx, ry, rw, rh in self.pet.rects:
                z = self.pet.actual_scale
                left, right = max(r.x, x+rx*z), min(r.x+r.width, x+(rx+rw)*z)
                if right-left > 4:
                    self.move_pointer((left+right)/2, y+(ry+rh/2)*z)
                    break
            else:
                raise AssertionError("贴边后没有可点击的露出区域")
            self.later(1100, lambda: self.evaluate("({tucked,tuckedPeek,pose})", self.peek_result))

    def peek_result(self, value):
        self.expect("real_dock_hover_peek", value["tucked"] == "right" and value["tuckedPeek"], value)
        r = self.pet.monitor().get_workarea()
        self.move_pointer(r.x+r.width//2, r.y+30)
        self.later(1300, lambda: self.evaluate("({tucked,tuckedPeek,pose})", self.unpeek_result))

    def unpeek_result(self, value):
        self.expect("real_dock_pointer_leave_retracts", value["tucked"] == "right" and not value["tuckedPeek"], value)
        self.pet.last_pose.clear()
        write_json(self.pet.store.state / "gpt-state.json", {"pose": "running", "ts": time.time(), "event": "PreToolUse"})
        self.later(1000, lambda: self.evaluate("({tucked,pose})", self.busy_dock_result))

    def busy_dock_result(self, value):
        self.expect("dock_emerges_for_ai_work", self.pet.dock_out and value["tucked"] is None, value)
        write_json(self.pet.store.state / "gpt-state.json", {"pose": "idle", "ts": time.time(), "event": "Stop"})
        self.later(1200, lambda: self.evaluate("({tucked,pose})", self.idle_dock_result))

    def idle_dock_result(self, value):
        self.expect("dock_retracts_after_ai_idle", not self.pet.dock_out and value["tucked"] == "right", value)
        self.move_pointer(*self.pointer_before)
        self.pet.reset_position()
        self.expect("global_hotkey_registered", self.pet.hotkey.bind("ctrl-alt-h"))
        lib, display = self.pet.hotkey.lib, self.pet.hotkey.display
        codes = [lib.XKeysymToKeycode(display, lib.XStringToKeysym(key)) for key in (b"Control_L", b"Alt_L", b"h")]
        for code in codes:
            self.xtest.XTestFakeKeyEvent(display, code, True, 0)
        for code in reversed(codes):
            self.xtest.XTestFakeKeyEvent(display, code, False, 0)
        lib.XSync(display, False)
        self.later(400, self.hotkey_result)

    def hotkey_result(self):
        self.expect("real_global_hotkey", self.pet.hidden)
        self.pet.hotkey.bind("off")
        self.pet.toggle()
        self.later(300, self.finish)

    def snapshot(self, filename, web=None):
        view = web or self.pet.web
        def ready(view, result, *_):
            try:
                surface = view.get_snapshot_finish(result)
                surface.write_to_png(str(self.output / filename))
            except Exception as error:
                self.fail("截图失败: " + str(error))
        view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.TRANSPARENT_BACKGROUND, None, ready, None)

    def finish(self):
        if self.done:
            return
        self.expect("screenshots_written", all((self.output / p).exists() for p in ("pet.png", "settings.png")))
        self.exit_code = 0
        self.report(None)
        self.pet.quit(False)

    def fail(self, error):
        if not self.done:
            self.report(error)
            self.pet.quit(False)
        return False

    def report(self, error):
        if hasattr(self, "pointer_before"):
            self.move_pointer(*self.pointer_before)
        if hasattr(self, "underlay"):
            self.underlay.destroy()
        self.done = True
        write_json(self.output / "report.json", {"passed": error is None, "error": error,
                   "checks": self.results, "data_dir": str(self.pet.store.data)})
        print("CROSSPET_LINUX_SMOKE_OK" if error is None else f"CROSSPET_LINUX_SMOKE_FAILED: {error}", flush=True)
