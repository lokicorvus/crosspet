"""Regression inputs for the upstream turn gate, using temporary subprocess hooks only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

HOOK = Path(__file__).resolve().parent.parent / "integrations/crosspet-hook.py"


class HookOrderIsolationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.data = self.root / "data"
        self.state.mkdir()
        self.data.mkdir()
        (self.data / "ai-autostart-off").touch()
        self.env = dict(os.environ, CROSSPET_STATE_DIR=str(self.state), CROSSPET_DATA_DIR=str(self.data),
                        CODEX_HOME=str(self.root / "no-codex"), HOME=str(self.root), USERPROFILE=str(self.root))
        for key in ("ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"):
            self.env.pop(key, None)

    def tearDown(self):
        self.tmp.cleanup()

    def payload(self, kind, sid="s1", tid="T1", **extra):
        data = dict(hook_event_name=kind, session_id=sid, model="gpt-test", tool_name="read_file")
        data.update(extra)
        if tid is not None:
            data["turn_id"] = tid
        return json.dumps(data).encode("utf-8")

    def send(self, kind, sid="s1", tid="T1", host="gpt", **extra):
        data = self.payload(kind, sid, tid, **extra)
        result = subprocess.run([sys.executable, str(HOOK), host], input=data, capture_output=True,
                                env=self.env, timeout=15)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b"", b""))
        return self.read(f"{host}-state.json")

    def read(self, name):
        path = self.state / name
        return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else None

    def install_character(self, character):
        folder = self.data / "characters" / character
        folder.mkdir(parents=True)
        (folder / "character.json").write_text("{}", encoding="utf-8")
        (folder / "idle.png").touch()  # Existence check only; no image is loaded by this test.

    def test_old_child_cannot_rejoin_next_root_turn(self):
        self.send("UserPromptSubmit")
        self.send("UserPromptSubmit", tid="C1", agent_id="agent1")
        self.send("Stop")
        self.send("UserPromptSubmit", tid="T2")
        before = self.send("PreToolUse", tid="T2", tool_name="apply_patch")
        after = self.send("PreToolUse", tid="C1", agent_id="agent1")
        self.assertEqual(after, before)

    def test_background_memory_event_cannot_retire_a_user_turn(self):
        before = self.send('UserPromptSubmit')
        book = self.read('gpt-turns.json')
        route = self.read('gpt-host.json')
        self.assertEqual(self.send('PreToolUse',tid='background',cwd=str(self.root/'no-codex/memories')), before)
        self.assertEqual(self.read('gpt-turns.json'), book)
        self.assertEqual(self.read('gpt-host.json'), route)
        self.assertEqual(self.send('PreToolUse')['pose'], 'reading')

    def test_missing_transcript_event_cannot_retire_a_user_turn(self):
        before = self.send('UserPromptSubmit')
        book = self.read('gpt-turns.json')
        self.assertEqual(self.send('PreToolUse',tid='background',transcript_path=str(self.root/'not-a-session.jsonl')),before)
        self.assertEqual(self.read('gpt-turns.json'),book)
        self.assertEqual(self.send('PreToolUse')['pose'],'reading')

    def test_retired_turn_does_not_change_model_cache_or_host_route(self):
        self.install_character("claude")
        self.send("UserPromptSubmit")
        self.send("Stop")
        self.send("UserPromptSubmit", tid="T2")
        before_route = self.read("gpt-host.json")
        before_models = self.read("gpt-models.json")
        before_state = self.send("PreToolUse", tid="T2", tool_name="apply_patch")
        self.send("PreToolUse", model="claude-test")
        self.assertEqual(self.read("gpt-host.json")["character"], "gpt")
        self.assertEqual(self.read("gpt-host.json")["model"], before_route["model"])
        self.assertEqual(self.read("gpt-models.json"), before_models)
        self.assertEqual(self.read("gpt-state.json"), before_state)
        self.assertIsNone(self.read("claude-state.json"))

    def test_child_tool_after_its_own_stop_is_dropped(self):
        self.send("UserPromptSubmit")
        self.send("UserPromptSubmit", tid="C1", agent_id="agent1")
        before = self.send("Stop", tid="C1", agent_id="agent1")
        self.assertEqual(self.send("PreToolUse", tid="C1", agent_id="agent1"), before)

    def test_new_turn_of_reused_child_can_work(self):
        self.send("UserPromptSubmit")
        self.send("UserPromptSubmit", tid="C1", agent_id="agent1")
        self.send("Stop")
        self.send("UserPromptSubmit", tid="T2")
        self.send("UserPromptSubmit", tid="C2", agent_id="agent1")
        self.assertEqual(self.send("PreToolUse", tid="C2", agent_id="agent1")["pose"], "reading")

    def test_explicit_old_parent_is_rejected_on_first_child_event(self):
        self.send("UserPromptSubmit")
        self.send("Stop")
        before = self.send("UserPromptSubmit", tid="T2")
        self.assertEqual(self.send("PreToolUse", tid="C1", agent_id="agent1", parent_turn_id="T1"), before)

    def test_tool_counts_do_not_cross_sessions(self):
        self.send("UserPromptSubmit", sid="a")
        for _ in range(8):
            self.send("PreToolUse", sid="a")
        self.send("UserPromptSubmit", sid="b", tid="B1")
        self.assertEqual(self.send("Stop", sid="a")["pose"], "proud")
        self.assertEqual(self.send("Stop", sid="b", tid="B1")["pose"], "happy")

    def test_tool_counts_do_not_cross_turns_seen_midway(self):
        for _ in range(8):
            self.send("PreToolUse")
        self.assertEqual(self.send("Stop", tid="T2")["pose"], "happy")

    def test_child_tools_count_for_their_root(self):
        self.send("UserPromptSubmit")
        self.send("UserPromptSubmit", tid="C1", agent_id="agent1")
        for _ in range(8):
            self.send("PreToolUse", tid="C1", agent_id="agent1")
        self.send("Stop", tid="C1", agent_id="agent1")
        self.assertEqual(self.send("Stop")["pose"], "proud")

    def test_hosts_without_turn_id_still_isolate_session_counts(self):
        self.send("UserPromptSubmit", sid="a", tid=None, host="claude")
        for _ in range(8):
            self.send("PreToolUse", sid="a", tid=None, host="claude")
        self.send("UserPromptSubmit", sid="b", tid=None, host="claude")
        self.assertEqual(self.send("Stop", sid="a", tid=None, host="claude")["pose"], "proud")

    def test_compact_metadata_does_not_retire_working_root(self):
        self.send("UserPromptSubmit")
        self.send("SessionStart", tid="compact-id", source="compact")
        self.assertEqual(self.send("PreToolUse")["pose"], "reading")

    def test_session_end_retires_child_work(self):
        self.send("UserPromptSubmit")
        self.send("UserPromptSubmit", tid="C1", agent_id="agent1")
        before = self.send("SessionEnd")
        self.assertEqual(self.send("PreToolUse", tid="C1", agent_id="agent1"), before)

    def test_model_table_with_wrong_top_level_heals(self):
        (self.state / "gpt-models.json").write_text("[]", encoding="utf-8")
        self.send("PreToolUse")
        self.assertEqual(self.read("gpt-models.json"), {"s1": "gpt-test"})

    def cursor_config(self, commands):
        folder = self.root / ".cursor"
        folder.mkdir(exist_ok=True)
        (folder / "hooks.json").write_text(json.dumps({"hooks": {"postToolUse": [
            {"command": command} for command in commands]}}), encoding="utf-8")

    def test_cursor_import_without_bridge_preserves_legacy_observer(self):
        state = self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0")
        self.assertEqual(state["pose"], "reading")

    def test_cursor_import_with_installed_bridge_is_not_duplicated(self):
        self.cursor_config(["python crosspet-cursor-bridge.py gpt"])
        self.assertIsNone(self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0"))
        self.assertEqual(list(self.state.iterdir()), [])

    def test_cursor_import_with_legacy_bridge_is_not_duplicated(self):
        self.cursor_config(["python crosspet_cursor_bridge.py grok"])
        self.assertIsNone(self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0"))

    def test_cursor_import_after_bridge_uninstall_resumes_legacy_observer(self):
        self.cursor_config(["python crosspet-cursor-bridge.py gpt", "custom-observer"])
        self.assertIsNone(self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0"))
        self.cursor_config(["custom-observer"])
        self.assertEqual(self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0")["pose"], "reading")

    def test_cursor_import_during_partial_config_write_preserves_observer(self):
        self.cursor_config([])
        (self.root / ".cursor/hooks.json").write_text("{", encoding="utf-8")
        self.assertEqual(self.send("PreToolUse", tid=None, host="claude", cursor_version="2.0")["pose"], "reading")

    def test_short_tool_carry_does_not_borrow_another_session(self):
        self.send("PreToolUse", sid="a", tool_name="read_file")
        state = self.send("PostToolUse", sid="b", tool_name="apply_patch")
        self.assertEqual(state["pose"], "thinking")
        self.assertNotIn("after", state)

    def test_short_tool_carry_keeps_its_own_session(self):
        self.send("PreToolUse", tool_name="read_file")
        state = self.send("PostToolUse", tool_name="read_file")
        self.assertEqual((state["pose"], state["after"]), ("thinking", "reading"))

    def test_gate_and_visible_writes_share_one_lock(self):
        self.send("UserPromptSubmit")
        marker, release = self.root / "paused", self.root / "release"
        wrapper = self.root / "pause_before_state.py"
        wrapper.write_text('''import os, pathlib, runpy, sys, time
hook = sys.argv[1]
marker = pathlib.Path(os.environ["CROSSPET_TEST_PAUSED"])
release = pathlib.Path(os.environ["CROSSPET_TEST_RELEASE"])
replace = pathlib.Path.replace
def pause(self, target):
    if pathlib.Path(target).name == "gpt-state.json":
        marker.touch()
        end = time.monotonic() + 10
        while not release.exists() and time.monotonic() < end:
            time.sleep(.005)
    return replace(self, target)
pathlib.Path.replace = pause
sys.argv = [hook, "gpt"]
runpy.run_path(hook, run_name="__main__")
''', encoding="utf-8")
        env = dict(self.env, CROSSPET_TEST_PAUSED=str(marker), CROSSPET_TEST_RELEASE=str(release))
        tool = subprocess.Popen([sys.executable, str(wrapper), str(HOOK)], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        stop = None
        try:
            tool.stdin.write(self.payload("PreToolUse"))
            tool.stdin.flush()
            deadline = time.monotonic() + 8
            while not marker.exists() and tool.poll() is None and time.monotonic() < deadline:
                time.sleep(.005)
            self.assertTrue(marker.exists(), "tool did not reach its visible state write")
            stop = subprocess.Popen([sys.executable, str(HOOK), "gpt"], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
            stop.stdin.write(self.payload("Stop"))
            stop.stdin.flush()
            time.sleep(.2)  # Upstream's old gate lock is released before this controlled write pause.
            release.touch()
            for process in (tool, stop):
                stdout, stderr = process.communicate(timeout=15)
                self.assertEqual((process.returncode, stdout, stderr), (0, b"", b""))
            state = self.read("gpt-state.json")
            self.assertEqual((state["pose"], state["event"]), ("happy", "Stop"))
            self.assertEqual(self.read("gpt-sessions.json")["s1"]["event"], "Stop")
        finally:
            release.touch()
            for process in (tool, stop):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                    process.communicate()

    def test_busy_event_lock_does_not_hold_up_the_ai(self):
        with (self.state / '.gpt-events.lock').open('a+b') as lock:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                start = time.monotonic()
                self.assertIsNone(self.send('PreToolUse'))
                self.assertLess(time.monotonic() - start, 1.8)
                self.assertIsNone(self.read('gpt-host.json'))
                self.assertIsNone(self.read('gpt-models.json'))
            finally:
                lock.seek(0)
                if os.name == 'nt':
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == "__main__":
    unittest.main()
