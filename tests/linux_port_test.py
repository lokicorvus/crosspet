"""Comprehensive test suite for CrossPet Linux port."""

from __future__ import annotations

import json
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from app.linux import notebook_scan, paths, placement, quota, wm  # noqa: E402
import tools.integrate as integrate  # noqa: E402


class PathsAndStoreTests(unittest.TestCase):
    def test_xdg_paths_and_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": tmp}, clear=False):
                os.environ.pop("CROSSPET_DATA_DIR", None)
                self.assertEqual(paths.data_dir(), Path(tmp) / "crosspet")
            with mock.patch.dict(os.environ, {"CROSSPET_DATA_DIR": tmp + "/custom"}, clear=False):
                self.assertEqual(paths.data_dir(), Path(tmp + "/custom"))

    def test_config_store_and_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = paths.ConfigStore(Path(tmp) / "config.json")
            cfg.set("size", 1.2)
            cfg.set("multiPets", True)
            cfg.set("names", {"claude": "小克"})
            cfg2 = paths.ConfigStore(Path(tmp) / "config.json")
            self.assertAlmostEqual(cfg2.get_float("size"), 1.2)
            self.assertTrue(cfg2.get_bool("multiPets"))
            self.assertEqual(cfg2.get_dict("names"), {"claude": "小克"})
            cfg2.remove("multiPets")
            self.assertFalse(cfg2.get_bool("multiPets", False))

            ledger_file = Path(tmp) / "events.jsonl"
            for i in range(241):
                paths.Ledger.append(ledger_file, {"i": i}, keep=200)
            lines = ledger_file.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 200)
            self.assertEqual(json.loads(lines[-1])["i"], 240)


class PlacementTests(unittest.TestCase):
    def test_place_window_anchors_top_down(self):
        # Corner preserves top-left
        r = placement.place_window(placement.Rect(100, 200, 156, 217.2), 252, 265.8, 37.2, 61.8, "corner", 1000)
        self.assertEqual((r.x, r.y, r.w, r.h), (100, 200, 252, 265.8))

        # Bottom keeps bottom-center fixed
        r = placement.place_window(placement.Rect(100, 200, 260, 362), 156, 217.2, 62, 37.2, "bottom", 1000)
        self.assertAlmostEqual(r.mid_x, 230.0)
        self.assertAlmostEqual(r.max_y, 562.0)

        # Feet keeps character foot line fixed and clamps downward overflow
        r = placement.place_window(placement.Rect(100, 200, 156, 217.2), 252, 265.8, 37.2, 61.8, "feet", 1000)
        self.assertAlmostEqual(r.mid_x, 178.0)
        self.assertAlmostEqual(r.max_y - 61.8, (200 + 217.2) - 37.2)

        r_clamp = placement.place_window(placement.Rect(100, 770, 156, 217.2), 252, 265.8, 37.2, 61.8, "feet", 1000)
        self.assertAlmostEqual(r_clamp.max_y, 1000.0)

    def test_dock_and_notebook_and_yield_and_semver(self):
        vf = placement.Rect(0, 30, 1920, 1050)
        self.assertEqual(placement.dock_side(placement.Rect(-60, 400, 260, 362), vf, 78, False, False), "left")
        self.assertIsNone(placement.dock_side(placement.Rect(-60, 400, 260, 362), vf, 78, True, False))
        self.assertEqual(placement.dock_side(placement.Rect(1720, 400, 260, 362), vf, 78, False, False), "right")

        clamped = placement.dock_clamp_y(placement.Rect(0, -100, 260, 362), vf)
        self.assertEqual(clamped.y, 30)

        self.assertTrue(placement.dock_busy([("thinking", 100)], since=90, now=150))
        self.assertFalse(placement.dock_busy([("thinking", 80)], since=90, now=150))
        self.assertFalse(placement.dock_busy([("idle", 100)], since=90, now=150))

        nb = placement.notebook_frame(placement.Rect(1600, 300, 260, 362), 408, 560, vf)
        self.assertLessEqual(nb.max_x, vf.max_x)
        self.assertEqual(nb.y, 300)

        self.assertTrue(placement.yield_next(False, True, True))
        self.assertFalse(placement.yield_next(True, False, True))
        self.assertTrue(placement.is_newer("1.3.0", "1.3.0-beta.1"))
        self.assertTrue(placement.is_newer("1.3.0-beta.2", "1.3.0-beta.1"))
        self.assertFalse(placement.is_newer("1.3.0-beta.1", "1.3.0"))

    def test_companion_slots_non_overlapping_and_in_bounds(self):
        vf = placement.Rect(0, 30, 1920, 1050)
        main = placement.Rect(1620, 600, 260, 362)
        slots = placement.companion_slots(main, 10, 260, 362, vf)
        self.assertEqual(len(slots), 10)
        for s in slots:
            self.assertGreaterEqual(s.min_x, vf.min_x - 0.01)
            self.assertLessEqual(s.max_x, vf.max_x + 0.01)
            self.assertGreaterEqual(s.min_y, vf.min_y - 0.01)
            self.assertLessEqual(s.max_y, vf.max_y + 0.01)
            self.assertFalse(placement.core_rect(s).intersects(placement.core_rect(main), inset=0.5))
        for i in range(len(slots)):
            for j in range(i):
                self.assertFalse(placement.core_rect(slots[i]).intersects(placement.core_rect(slots[j]), inset=0.5))

        picked = placement.companion_pick(main, [slots[0]], slots[1], 6, 260, 362, vf)
        self.assertEqual(picked, slots[1])


class QuotaAndNotebookTests(unittest.TestCase):
    def test_antigravity_fixtures(self):
        fdir = REPO / "tests/fixtures/antigravity"

        def load(name: str) -> dict:
            obj = json.loads((fdir / f"{name}.json").read_text(encoding="utf-8"))
            return quota.AntigravityQuota.antigravity_parse(obj) or {}

        q = load("ultra-only-model")
        self.assertTrue(q["text"].split(" ｜ ")[0].startswith("Gemini 剩余 100%"))
        self.assertEqual(q["text"].split(" ｜ ")[1], "Claude/GPT 剩余 100%")
        self.assertFalse(q["low"])

        q = load("gemini-used-up")
        self.assertTrue(q["text"].startswith("Gemini 剩余 0%"))
        self.assertTrue(q["low"])

        q = load("summary-multi-pool")
        self.assertEqual(
            [b["label"] for b in q["bars"]],
            ["Gemini 5小时", "Gemini 本周", "Argon 本周", "Claude/GPT 5小时", "Claude/GPT 本周"],
        )
        self.assertEqual([b["left"] for b in q["bars"]], [1, 0.99, 0.46, 1, 1])

        q = load("summary-argon-merged")
        self.assertEqual(len(q["text"].split(" ｜ ")), 2)
        self.assertNotIn("Argon", q["text"])
        self.assertEqual([b["group"] for b in q["bars"]], ["Gemini", "Gemini", "Claude/GPT", "Claude/GPT"])

        q = load("summary-no-reset")
        self.assertEqual(q["bars"], [{"label": "Gemini 本周", "left": 0.7, "group": "Gemini"}])
        self.assertEqual(load("summary-empty"), {})

    def test_antigravity_hub_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self.assertIsNone(quota.AntigravityQuota.antigravity_hub(d))
            pid = os.getpid()
            (d / "hub_51881.json").write_text(
                json.dumps({"pid": pid, "httpsPort": 51880, "csrfToken": "tok-live"}),
                encoding="utf-8",
            )
            (d / "hub_40001.json").write_text(
                json.dumps({"pid": 9999999, "httpsPort": 40000, "csrfToken": "tok-dead"}),
                encoding="utf-8",
            )
            res = quota.AntigravityQuota.antigravity_hub(d)
            self.assertEqual(res, (pid, "tok-live", 51880))

    def test_codex_quota_live_and_tick(self):
        fake = str(REPO / "tests/fake_codex.py")
        with mock.patch.dict(os.environ, {"FAKE_CODEX_MODE": "ok"}):
            rl, err, _ms = quota.CodexQuotaSource.query_live(fake, timeout=3.0)
        self.assertIsNone(err)
        self.assertIsNotNone(rl)
        self.assertIn("已用", quota.CodexQuotaSource.brief(rl))

        with mock.patch.dict(os.environ, {"FAKE_CODEX_MODE": "auth"}):
            rl2, err2, _ms2 = quota.CodexQuotaSource.query_live(fake, timeout=3.0)
        self.assertIsNone(rl2)
        self.assertIn("authentication", err2 or "")

        self.assertTrue(quota.CodexQuotaSource.codex_tick_due(58, 30))
        self.assertFalse(quota.CodexQuotaSource.codex_tick_due(40, 30))
        self.assertFalse(quota.CodexQuotaSource.codex_tick_due(58, None))
        self.assertTrue(quota.CodexQuotaSource.codex_tick_due(118, None))

    def test_notebook_scan_fixture(self):
        home = REPO / "tests/fixtures/notebook/home"
        want = json.loads((REPO / "tests/fixtures/notebook/expected.json").read_text(encoding="utf-8"))
        got = notebook_scan.scan_all(home, {})
        self.assertEqual(got, want)


class HyprlandAndIPCTests(unittest.TestCase):
    def test_hyprland_backend_with_mock_sockets(self):
        with tempfile.TemporaryDirectory() as tmp:
            sock_path = Path(tmp) / ".socket.sock"
            ev_path = Path(tmp) / ".socket2.sock"

            monitors_json = [
                {
                    "id": 0,
                    "name": "eDP-1",
                    "x": 0,
                    "y": 0,
                    "width": 2560,
                    "height": 1600,
                    "scale": 2.0,
                    "transform": 0,
                    "reserved": [0, 32, 0, 0],
                    "focused": True,
                    "activeWorkspace": {"id": 1, "name": "1"},
                },
                {
                    "id": 1,
                    "name": "DP-1",
                    "x": 1280,
                    "y": 0,
                    "width": 1920,
                    "height": 1080,
                    "scale": 1.0,
                    "transform": 1,
                    "reserved": [0, 0, 0, 0],
                    "focused": False,
                    "activeWorkspace": {"id": 2, "name": "2"},
                },
            ]
            workspaces_json = [
                {"id": 1, "name": "1", "monitor": "eDP-1", "hasfullscreen": False},
                {"id": 2, "name": "2", "monitor": "DP-1", "hasfullscreen": True},
            ]
            active_json = {
                "class": "kitty",
                "initialClass": "kitty",
                "title": "nvim",
                "pid": os.getpid(),
                "fullscreen": 0,
                "monitor": 0,
            }
            clients_json = [
                active_json,
                {"class": "Cursor", "initialClass": "cursor", "pid": 0},
            ]

            stop = threading.Event()
            srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            srv.bind(str(sock_path))
            srv.listen(8)
            srv.settimeout(0.2)

            def serve_queries():
                while not stop.is_set():
                    try:
                        conn, _ = srv.accept()
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    with conn:
                        cmd = conn.recv(4096).decode("utf-8", errors="ignore").strip()
                        if cmd == "j/monitors":
                            conn.sendall(json.dumps(monitors_json).encode("utf-8"))
                        elif cmd == "j/workspaces":
                            conn.sendall(json.dumps(workspaces_json).encode("utf-8"))
                        elif cmd == "j/activewindow":
                            conn.sendall(json.dumps(active_json).encode("utf-8"))
                        elif cmd == "j/clients":
                            conn.sendall(json.dumps(clients_json).encode("utf-8"))
                        elif cmd == "cursorpos":
                            conn.sendall(b"420, 315")

            t = threading.Thread(target=serve_queries, daemon=True)
            t.start()

            ev_srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            ev_srv.bind(str(ev_path))
            ev_srv.listen(4)
            received_events: list[str] = []
            ev_done = threading.Event()

            def serve_events():
                conn, _ = ev_srv.accept()
                with conn:
                    conn.sendall(b"activewindow>>kitty,nvim\nfullscreen>>1\n")
                    time.sleep(0.2)

            te = threading.Thread(target=serve_events, daemon=True)
            te.start()

            try:
                backend = wm.HyprlandBackend(
                    signature="test",
                    socket_path=sock_path,
                    event_socket_path=ev_path,
                    dispatcher=lambda fn: fn(),
                )
                mons = backend.monitors()
                self.assertEqual(len(mons), 2)
                self.assertEqual((mons[0].w, mons[0].h, mons[0].work_y, mons[0].work_h), (1280.0, 800.0, 32.0, 768.0))
                # transform=1 swaps width & height
                self.assertEqual((mons[1].w, mons[1].h), (1080.0, 1920.0))

                aw = backend.active_window()
                self.assertIsNotNone(aw)
                self.assertEqual(aw.win_class, "kitty")
                self.assertEqual(aw.monitor_name, "eDP-1")

                self.assertFalse(backend.is_fullscreen_on("eDP-1"))
                self.assertTrue(backend.is_fullscreen_on("DP-1"))
                self.assertEqual(backend.cursor_pos(), (420.0, 315.0))
                classes = backend.running_classes()
                self.assertIn("kitty", classes)
                self.assertIn("cursor", classes)

                def on_ev(ev_name: str):
                    received_events.append(ev_name)
                    if len(received_events) >= 2:
                        ev_done.set()

                backend.start_events(on_ev)
                self.assertTrue(ev_done.wait(timeout=2.0))
                self.assertEqual(received_events, ["activewindow", "fullscreen"])
                backend.stop()
            finally:
                stop.set()
                srv.close()
                ev_srv.close()

    def test_control_ipc_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            sock = Path(tmp) / "crosspet.sock"
            seen: list[str] = []
            srv = wm.ControlServer(
                handler=lambda cmd: (seen.append(cmd), {"ok": True, "cmd": cmd})[1],
                sock_path=sock,
                dispatcher=lambda fn: fn(),
            )
            srv.start()
            try:
                resp = wm.send_control_command("toggle", sock_path=sock)
                self.assertEqual(resp, {"ok": True, "cmd": "toggle"})
                self.assertEqual(seen, ["toggle"])
            finally:
                srv.stop()


class LinuxIntegrateAndProbeTests(unittest.TestCase):
    def test_linux_integrate_rewrites_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            sup = Path(tmp) / "data"
            with mock.patch.object(integrate, "SUPPORT", sup):
                tpl = integrate.load_template(REPO / "integrations/qwen/hooks.json")
                entries = [c for gs in tpl["hooks"].values() for g in gs for c in g["hooks"]]
                expected_prefix = f"{shlex.quote(sys.executable)} {shlex.quote(str(sup / 'crosspet-hook.py'))}"
                for e in entries:
                    self.assertTrue(e["command"].startswith(expected_prefix), e["command"])
                    self.assertTrue(e["command"].endswith(" qwen"))
                self.assertTrue((sup / "crosspet-hook.py").exists())

                kcmd = integrate.kimi_command()
                self.assertEqual(kcmd, f"{expected_prefix} kimi")

                ctpl = integrate.load_cursor_template()
                centries = [e for arr in ctpl["hooks"].values() for e in arr]
                cprefix = f"{shlex.quote(sys.executable)} {shlex.quote(str(sup / 'crosspet-cursor-bridge.py'))}"
                for e in centries:
                    self.assertTrue(e["command"].startswith(cprefix), e["command"])
                self.assertTrue((sup / "crosspet-cursor-bridge.py").exists())

    def test_cli_probes_smoke(self):
        def run_probe(*args: str) -> str:
            res = subprocess.run(
                [sys.executable, "-m", "app.linux.main", *args],
                cwd=str(REPO),
                capture_output=True,
                text=True,
                timeout=8,
            )
            self.assertEqual(res.returncode, 0, res.stderr)
            return res.stdout.strip()

        out = run_probe("--window-place-probe", "corner", "100", "200", "156", "217.2", "252", "265.8", "37.2", "61.8", "1000")
        self.assertEqual(out, "100 200 252 265.8")

        self.assertEqual(run_probe("--codex-tick-probe", "58", "30"), "yes")
        self.assertEqual(run_probe("--codex-tick-probe", "58", "-1"), "no")

        agy_out = json.loads(run_probe("--agy-quota-probe", str(REPO / "tests/fixtures/antigravity/summary-live.json")))
        self.assertIn("Gemini", agy_out["text"])

        wm_out = json.loads(run_probe("--wm-info"))
        self.assertIn("backend", wm_out)

    def test_input_region_reset_when_unhidden_without_hit_rects(self):
        from app.linux import window

        class _StubWin:
            def __init__(self):
                self.regions = []
                self.draws = 0

            def input_shape_combine_region(self, reg):
                self.regions.append(reg)

            def queue_draw(self):
                self.draws += 1

        surf = object.__new__(window.PetSurface)
        surf.win = _StubWin()
        surf.hidden = True
        surf.yielding = False
        surf._has_hit_rects = False
        surf._hit_rects = []
        surf.zoom = 1.5
        surf.use_layer_shell = False

        # Hidden -> empty cairo.Region()
        window.PetSurface._apply_input_region(surf)
        self.assertEqual(len(surf.win.regions), 1)
        self.assertIsNotNone(surf.win.regions[-1])
        self.assertEqual(surf.win.regions[-1].num_rectangles(), 0)

        # Unhidden without hitRects (notebook window) -> None resets to full-window input
        surf.hidden = False
        window.PetSurface._apply_input_region(surf)
        self.assertIsNone(surf.win.regions[-1])

        # With hitRects -> scaled non-empty region
        surf._has_hit_rects = True
        surf._hit_rects = [placement.Rect(10, 20, 30, 40)]
        window.PetSurface._apply_input_region(surf)
        reg = surf.win.regions[-1]
        self.assertEqual(reg.num_rectangles(), 1)
        rect = reg.get_rectangle(0)
        self.assertEqual((rect.x, rect.y, rect.width, rect.height), (15, 30, 45, 60))

    def test_no_undefined_self_attributes_in_linux_shell(self):
        import ast

        for py_path in sorted((REPO / "app" / "linux").glob("*.py")):
            tree = ast.parse(py_path.read_text(encoding="utf-8"), str(py_path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ClassDef):
                    continue
                defined: set[str] = set()
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        defined.add(item.name)
                    elif isinstance(item, ast.Assign):
                        for t in item.targets:
                            if isinstance(t, ast.Name):
                                defined.add(t.id)
                    elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                        defined.add(item.target.id)
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Assign):
                        for t in sub.targets:
                            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self":
                                defined.add(t.attr)
                    elif isinstance(sub, ast.AnnAssign):
                        if (
                            isinstance(sub.target, ast.Attribute)
                            and isinstance(sub.target.value, ast.Name)
                            and sub.target.value.id == "self"
                        ):
                            defined.add(sub.target.attr)
                used = {
                    sub.attr
                    for sub in ast.walk(node)
                    if isinstance(sub, ast.Attribute) and isinstance(sub.value, ast.Name) and sub.value.id == "self"
                }
                self.assertEqual(sorted(used - defined), [], f"{py_path.name}:{node.name}")

    def test_poll_states_and_timer_resilience(self):
        from app.linux import app as linux_app

        class _StubWM:
            name = "wayland"

            def active_window(self):
                return None

            def is_fullscreen_on(self, _mon_name):
                return False

        class _StubSurface:
            layer_mode = "overlay"

            def current_monitor(self):
                return None

            def set_layer(self, mode):
                self.layer_mode = mode

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            data = tmp_path / "data"
            st = tmp_path / "state"
            data.mkdir()
            st.mkdir()

            inst = object.__new__(linux_app.CrossPetApp)
            inst.root = data
            inst.src_root = REPO
            inst.state_dir = st
            inst.config = paths.ConfigStore(data / "config.json")
            inst.ready = True
            inst.character_ids = ["gemini", "claude"]
            inst.current_id = "gemini"
            inst.stamps = {}
            inst.last_pose = {}
            inst.pause_real_events = False
            inst.follow_event_gen = 0
            inst.user_hidden = False
            inst.hidden_for_fullscreen = False
            inst.fullscreen_override = False
            inst.fullscreen_checked_at = time.monotonic()
            inst.dock = None
            inst.companions = {}
            inst.leaving_companions = []
            inst.page_gathering = False
            inst.client_state_seen = set()
            inst.char_states = {}
            inst.sessions_text = {}
            inst.quota_code = {}
            inst.quota_seq = 0
            inst.app_to_character = {}
            inst.wm = _StubWM()
            inst.surface = _StubSurface()

            js_calls: list[str] = []
            dev_calls: list[str] = []
            inst.js = lambda code, cb=None: js_calls.append(code)
            inst.dev_js = lambda code: dev_calls.append(code)
            inst.events_dir.mkdir(parents=True, exist_ok=True)

            # 1. Fresh state + sessions triggers applyCharState, setSessions, last_pose, and pet.jsonl played
            now = time.time()
            (st / "gemini-state.json").write_text(
                json.dumps({"pose": "thinking", "event": "PreInvocation", "tool": "", "ts": now}),
                encoding="utf-8",
            )
            (st / "gemini-sessions.json").write_text(
                json.dumps({"s1": {"pose": "running", "event": "PreToolUse", "ts": now, "client": "antigravity"}}),
                encoding="utf-8",
            )
            inst.poll_states()

            self.assertTrue(any(c.startswith('applyCharState("gemini",') for c in js_calls), js_calls)
            self.assertTrue(any(c.startswith('setSessions("gemini",') for c in js_calls), js_calls)
            self.assertEqual(inst.last_pose["gemini"][0], "thinking")
            rows = [json.loads(line) for line in inst.pet_events_url.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rows[-1]["char"], "gemini")
            self.assertEqual(rows[-1]["ev"], "PreInvocation")
            self.assertEqual(rows[-1]["result"], "played")

            # 2. Stale (>600s) state is skipped without calling applyCharState
            js_calls.clear()
            stale_file = st / "claude-state.json"
            stale_file.write_text(
                json.dumps({"pose": "running", "event": "PreToolUse", "ts": now - 700}),
                encoding="utf-8",
            )
            os.utime(stale_file, (now - 700, now - 700))
            inst.poll_states()

            self.assertFalse(any("applyCharState" in c for c in js_calls), js_calls)
            rows = [json.loads(line) for line in inst.pet_events_url.read_text(encoding="utf-8").splitlines()]
            self.assertEqual((rows[-1]["char"], rows[-1]["result"], rows[-1]["detail"]), ("claude", "skipped", "stale"))

            # 3. pause_real_events logs skipped/paused without calling applyCharState
            js_calls.clear()
            inst.pause_real_events = True
            (st / "gemini-state.json").write_text(
                json.dumps({"pose": "happy", "event": "Stop", "ts": now + 1}),
                encoding="utf-8",
            )
            os.utime(st / "gemini-state.json", (now + 1, now + 1))
            inst.poll_states()

            self.assertFalse(any("applyCharState" in c for c in js_calls), js_calls)
            rows = [json.loads(line) for line in inst.pet_events_url.read_text(encoding="utf-8").splitlines()]
            self.assertEqual((rows[-1]["char"], rows[-1]["result"], rows[-1]["detail"]), ("gemini", "skipped", "paused"))

            # 4. _timer_poll_states returns True even when poll_states raises
            inst.poll_states = mock.Mock(side_effect=RuntimeError("boom"))
            with mock.patch.object(linux_app, "app_log"):
                self.assertTrue(inst._timer_poll_states())

            # 5. _mark_launched registers launcher symlink when missing
            src_bundle = tmp_path / "bundle"
            src_bundle.mkdir()
            wrapper = src_bundle / "crosspet"
            wrapper.write_text("#!/bin/sh\n", encoding="utf-8")
            wrapper.chmod(0o755)
            inst.src_root = src_bundle
            inst._mark_launched()
            self.assertEqual((data / "launcher").resolve(), wrapper.resolve())

    def test_secondary_webview_select_stylesheet(self):
        import gi

        gi.require_version("WebKit2", "4.1")
        from gi.repository import WebKit2
        from app.linux import window

        css = window.SECONDARY_WEBVIEW_CSS
        self.assertIn("appearance: none", css)
        self.assertIn("var(--field", css)
        self.assertIn("var(--ink", css)
        self.assertIn("select option", css)
        ss = WebKit2.UserStyleSheet(
            css,
            WebKit2.UserContentInjectedFrames.ALL_FRAMES,
            WebKit2.UserStyleLevel.USER,
            None,
            None,
        )
        self.assertIsNotNone(ss)


if __name__ == "__main__":
    unittest.main()
