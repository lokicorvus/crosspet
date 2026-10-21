"""小范围 Xlib 封装：GTK 没有全局快捷键 API，单独的连接避免抢 GTK 的事件。"""
import ctypes as C
from gi.repository import GLib


class XEvent(C.Union):
    _fields_ = [("type", C.c_int), ("pad", C.c_long * 24)]


class Hotkey:
    def __init__(self, callback):
        self.lib = C.CDLL("libX11.so.6")
        signatures = {
            "XOpenDisplay": (C.c_void_p, [C.c_char_p]),
            "XDefaultRootWindow": (C.c_ulong, [C.c_void_p]),
            "XStringToKeysym": (C.c_ulong, [C.c_char_p]),
            "XKeysymToKeycode": (C.c_uint, [C.c_void_p, C.c_ulong]),
            "XGrabKey": (C.c_int, [C.c_void_p, C.c_int, C.c_uint, C.c_ulong, C.c_int, C.c_int, C.c_int]),
            "XUngrabKey": (C.c_int, [C.c_void_p, C.c_int, C.c_uint, C.c_ulong]),
            "XSync": (C.c_int, [C.c_void_p, C.c_int]),
            "XPending": (C.c_int, [C.c_void_p]),
            "XNextEvent": (C.c_int, [C.c_void_p, C.POINTER(XEvent)]),
            "XCloseDisplay": (C.c_int, [C.c_void_p]),
            "XSetErrorHandler": (C.c_void_p, [C.c_void_p]),
        }
        for name, (restype, args) in signatures.items():
            fn = getattr(self.lib, name)
            fn.restype, fn.argtypes = restype, args
        self.display = self.lib.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("无法连接 X11")
        self.root = self.lib.XDefaultRootWindow(self.display)
        self.callback, self.code, self.error = callback, 0, False
        self.error_handler = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)(self.on_error)
        self.timer = GLib.timeout_add(60, self.poll)

    def on_error(self, *_):
        self.error = True
        return 0

    def bind(self, name):
        if self.code:
            for extra in (0, 2, 16, 18):  # CapsLock / NumLock 不改变快捷键
                self.lib.XUngrabKey(self.display, self.code, 12 | extra, self.root)
        self.code, self.error = 0, False
        if name == "off":
            self.lib.XSync(self.display, False)
            return True
        self.code = self.lib.XKeysymToKeycode(self.display, self.lib.XStringToKeysym(b"h" if name == "ctrl-alt-h" else b"p"))
        self.lib.XSync(self.display, False)
        old = self.lib.XSetErrorHandler(C.cast(self.error_handler, C.c_void_p))
        try:
            for extra in (0, 2, 16, 18):
                self.lib.XGrabKey(self.display, self.code, 12 | extra, self.root, False, 1, 1)
            self.lib.XSync(self.display, False)
            if self.error:
                for extra in (0, 2, 16, 18):
                    self.lib.XUngrabKey(self.display, self.code, 12 | extra, self.root)
                self.lib.XSync(self.display, False)
                self.code = 0
        finally:
            self.lib.XSetErrorHandler(old)
        return not self.error

    def poll(self):
        while self.display and self.lib.XPending(self.display):
            event = XEvent()
            self.lib.XNextEvent(self.display, C.byref(event))
            if event.type == 2:
                self.callback()
        return True

    def close(self):
        GLib.source_remove(self.timer)
        if self.display:
            self.lib.XCloseDisplay(self.display)
            self.display = None
