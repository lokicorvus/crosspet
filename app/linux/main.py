"""CLI entrypoint, diagnostic probes, IPC client, and GUI bootstrap for CrossPet Linux."""

from __future__ import annotations

import json
import os
import signal
import sys
from pathlib import Path

from .notebook_scan import scan_all
from .placement import Rect, companion_pick, companion_slots, place_window
from .quota import AntigravityQuota, CodexQuotaSource
from .wm import detect_wm_backend, send_control_command


def _handle_probes(argv: list[str]) -> int | None:
    if "--codex-quota-probe" in argv:
        timeout = float(os.environ.get("CROSSPET_CODEX_TIMEOUT") or "15")
        binary = CodexQuotaSource.find_binary()
        if binary:
            rl, err, ms = CodexQuotaSource.query_live(binary, timeout=timeout)
            out = CodexQuotaSource.payload("live" if rl is not None else "none", rl, None if rl is not None else err, ms)
        else:
            out = CodexQuotaSource.payload("none", None, "没找到 codex 程序", 0)
        print(json.dumps(out, ensure_ascii=False, sort_keys=True))
        return 0

    if "--codex-tick-probe" in argv:
        idx = argv.index("--codex-tick-probe")
        vals = [float(x) for x in argv[idx + 1 : idx + 3]]
        if len(vals) != 2:
            print("参数不对")
            return 1
        due = CodexQuotaSource.codex_tick_due(vals[0], None if vals[1] < 0 else vals[1])
        print("yes" if due else "no")
        return 0

    if "--agy-quota-probe" in argv:
        idx = argv.index("--agy-quota-probe")
        if idx + 1 >= len(argv):
            print("null")
            return 1
        try:
            obj = json.loads(Path(argv[idx + 1]).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("null")
            return 1
        q = AntigravityQuota.antigravity_parse(obj) or {}
        print(json.dumps(q, ensure_ascii=False))
        return 0

    if "--agy-hub-probe" in argv:
        idx = argv.index("--agy-hub-probe")
        if idx + 1 >= len(argv):
            print("null")
            return 1
        hub = AntigravityQuota.antigravity_hub(Path(argv[idx + 1]))
        if hub is None:
            print("null")
            return 0
        out: dict[str, object] = {"pid": hub[0], "token": hub[1]}
        if hub[2] is not None:
            out["port"] = hub[2]
        print(json.dumps(out, ensure_ascii=False))
        return 0

    if "--window-place-probe" in argv:
        idx = argv.index("--window-place-probe")
        args = argv[idx + 1 :]
        if len(args) != 10:
            print("参数不对")
            return 1
        anchor = args[0]
        n = [float(x) for x in args[1:]]
        r = place_window(Rect(n[0], n[1], n[2], n[3]), n[4], n[5], n[6], n[7], anchor, n[8])
        print(" ".join(f"{v:g}" for v in (r.x, r.y, r.w, r.h)))
        return 0

    if "--companion-place-probe" in argv:
        idx = argv.index("--companion-place-probe")
        n = [float(x) for x in argv[idx + 1 :]]
        if len(n) != 11:
            print("参数不对")
            return 1
        slots = companion_slots(
            Rect(n[0], n[1], n[2], n[3]),
            int(n[4]),
            n[5],
            n[6],
            Rect(n[7], n[8], n[9], n[10]),
        )
        for s in slots:
            print(" ".join(f"{v:g}" for v in (s.x, s.y, s.w, s.h)))
        return 0

    if "--companion-seq-probe" in argv:
        idx = argv.index("--companion-seq-probe")
        n = [float(x) for x in argv[idx + 1 :]]
        if len(n) < 11:
            print("参数不对")
            return 1
        main_r = Rect(n[0], n[1], n[2], n[3])
        total = int(n[4])
        cw, ch = n[5], n[6]
        vf = Rect(n[7], n[8], n[9], n[10])
        placed: list[Rect] = []
        for k in range(total):
            j = 11 + 2 * k
            saved = Rect(n[j], n[j + 1], cw, ch) if (j + 1 < len(n) and n[j] >= 0) else None
            r = companion_pick(main_r, placed, saved, total, cw, ch, vf)
            placed.append(r)
            print(" ".join(f"{v:g}" for v in (r.x, r.y, r.w, r.h)))
        return 0

    if "--notebook-scan-probe" in argv:
        idx = argv.index("--notebook-scan-probe")
        home = Path(argv[idx + 1]) if idx + 1 < len(argv) else Path.home()
        print(json.dumps(scan_all(home, os.environ), ensure_ascii=False))
        return 0

    if "--wm-info" in argv:
        wm = detect_wm_backend()
        win = wm.active_window()
        mons = wm.monitors()
        info = {
            "backend": wm.name,
            "cursor": wm.cursor_pos(),
            "activeWindow": (
                {
                    "class": win.win_class,
                    "initialClass": win.initial_class,
                    "title": win.title,
                    "pid": win.pid,
                    "fullscreen": win.fullscreen,
                    "monitor": win.monitor_name,
                }
                if win
                else None
            ),
            "monitors": [
                {
                    "name": m.name,
                    "frame": [m.x, m.y, m.w, m.h],
                    "workArea": [m.work_x, m.work_y, m.work_w, m.work_h],
                    "scale": m.scale,
                    "focused": m.focused,
                }
                for m in mons
            ],
        }
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    return None


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    probe_rc = _handle_probes(args)
    if probe_rc is not None:
        return probe_rc

    ipc_flags = {
        "--toggle": "toggle",
        "--show": "show",
        "--hide": "hide",
        "--bring-to-front": "bring-to-front",
        "--settings": "settings",
        "--quit": "quit",
        "--status": "status",
    }
    for flag, cmd in ipc_flags.items():
        if flag in args:
            resp = send_control_command(cmd)
            if resp is not None:
                if cmd == "status":
                    print(json.dumps(resp, ensure_ascii=False))
                return 0
            if cmd in ("hide", "quit", "status"):
                if cmd == "status":
                    print(json.dumps({"ok": False, "running": False}))
                return 1 if cmd == "status" else 0
            break

    # Single-instance check for normal launch
    if send_control_command("bring-to-front") is not None:
        return 0

    if os.environ.get("CROSSPET_WEBKIT_DISABLE_DMABUF") == "1":
        os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")

    import gi

    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk

    from .app import CrossPetApp

    Gtk.init(sys.argv)
    app = CrossPetApp()

    def _sig_handler(_signum: int, _frame: object) -> None:
        GLib.idle_add(lambda: (app._cleanup_on_exit(), Gtk.main_quit(), False)[2])

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    try:
        Gtk.main()
    finally:
        app._cleanup_on_exit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
