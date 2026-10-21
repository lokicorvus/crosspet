"""Cursor 桥（integrations/cursor/crosspet-cursor-bridge.py）。只用临时目录，不打开桌宠，不碰 ~/.cursor。

    python3 tests/cursor_bridge_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent.parent / "integrations" / "cursor" / "crosspet-cursor-bridge.py"


class CursorBridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.state = root / "state"
        self.env = dict(os.environ, CROSSPET_STATE_DIR=str(self.state), CROSSPET_DATA_DIR=str(root / "data"))

    def tearDown(self):
        self.temp.cleanup()

    def send(self, kind, conv="C1", gen="G1", **extra):
        event = {"hook_event_name": kind, "conversation_id": conv, **extra}
        if gen is not None:
            event["generation_id"] = gen
        return self.raw(json.dumps(event))

    def raw(self, text):
        result = subprocess.run([sys.executable, str(BRIDGE), "grok"], input=text, text=True,
                                capture_output=True, env=self.env, timeout=10)
        # 观察者钩子：永远退出码 0、只回 {}，不能影响 Cursor
        self.assertEqual((result.returncode, result.stdout.strip(), result.stderr), (0, "{}", ""))
        return self.read("grok-state.json")

    def read(self, name):
        path = self.state / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def test_turn_shows_tools_then_finishes(self):
        self.assertEqual(self.send("afterAgentThought")["pose"], "thinking")
        state = self.send("postToolUse", tool_name="Read")
        # 工具动作捎带在「回去思考」里（after），桌宠先演完它
        self.assertEqual((state["event"], state["pose"], state["after"]), ("PostToolUse", "thinking", "reading"))
        self.assertEqual(self.send("afterShellExecution", command="ls")["after"], "running")
        state = self.send("stop", status="completed")
        self.assertEqual((state["event"], state["pose"]), ("Stop", "happy"))

    def test_late_events_after_stop_stay_finished(self):
        self.send("afterAgentThought")
        self.send("stop", status="completed")
        for late in ("postToolUse", "afterShellExecution", "subagentStop", "afterAgentResponse"):
            with self.subTest(late=late):
                state = self.send(late, tool_name="Shell")
                self.assertEqual((state["event"], state["pose"]), ("Stop", "happy"))
        self.assertEqual(self.send("afterAgentResponse", gen=None)["event"], "Stop")

    def test_next_message_starts_a_new_turn(self):
        self.send("afterAgentThought")
        self.send("stop", status="completed")
        self.assertEqual(self.send("afterAgentThought", gen="G2")["pose"], "thinking")
        self.assertEqual(self.send("stop", gen="G2", status="aborted")["pose"], "surprised")
        self.assertEqual(self.send("afterAgentThought", gen="G3")["pose"], "thinking")
        self.assertEqual(self.send("stop", gen="G3", status="error")["pose"], "oops")

    def test_big_job_ends_proud(self):
        for _ in range(8):
            self.send("postToolUse", tool_name="Read")
            self.send("afterShellExecution", command="ls")   # 同一次调用的重复事件，不多算
        self.assertEqual(self.send("stop", status="completed")["pose"], "proud")
        self.send("postToolUse", gen="G2", tool_name="Read")
        self.assertEqual(self.send("stop", gen="G2", status="completed")["pose"], "happy")

    def test_small_job_with_duplicate_events_stays_happy(self):
        for _ in range(5):
            self.send("postToolUse", tool_name="Shell")
            self.send("afterShellExecution", command="ls")
        self.assertEqual(self.send("stop", status="completed")["pose"], "happy")

    def test_other_conversation_keeps_working(self):
        self.send("postToolUse", conv="C2", gen="H1", tool_name="Write")
        self.send("afterAgentThought")
        state = self.send("stop", status="completed")
        # C1 干完了，C2 还在干活：桌宠接着演 C2
        self.assertEqual((state["event"], state["after"]), ("PostToolUse", "writing"))
        cards = self.read("grok-sessions.json")
        self.assertEqual(sorted(card["pose"] for card in cards.values()), ["happy", "writing"])

    def test_session_end_removes_its_card(self):
        self.send("sessionStart", gen=None, session_id="C1")
        self.send("afterAgentThought")
        self.assertEqual(len(self.read("grok-sessions.json")), 1)
        self.send("sessionEnd", gen=None, session_id="C1", reason="user_close")
        self.assertEqual(self.read("grok-sessions.json"), {})

    def test_cards_from_other_apps_are_kept(self):
        # 别的宿主里用 Grok 模型时，crosspet-hook.py 也往 grok-sessions.json 里写自己的会话
        self.state.mkdir(parents=True)
        other = {"pose": "reading", "event": "PreToolUse", "ts": time.time()}
        (self.state / "grok-sessions.json").write_text(json.dumps({"workbuddy-1": other}), encoding="utf-8")
        self.send("afterAgentThought")
        cards = self.read("grok-sessions.json")
        self.assertEqual(cards["workbuddy-1"], other)
        self.assertEqual(len(cards), 2)

    def test_unidentified_or_broken_input_writes_nothing(self):
        self.send("afterAgentThought", conv=None)
        self.raw("not json")
        self.raw("")
        self.send("workspaceOpen")
        self.assertFalse((self.state / "grok-state.json").exists())

    def test_does_not_wait_for_stdin_to_close(self):
        # 和 hook_stdin_test 一样：读到完整的 JSON 就处理、退出，不等宿主关输入
        p = subprocess.Popen([sys.executable, str(BRIDGE), "grok"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=self.env)
        try:
            p.stdin.write(json.dumps({"hook_event_name": "afterAgentThought", "conversation_id": "C1",
                                      "generation_id": "G1"}).encode("utf-8"))
            p.stdin.flush()
            p.wait(timeout=5)
            self.assertEqual(self.read("grok-state.json")["pose"], "thinking")
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
            for stream in (p.stdin, p.stdout, p.stderr):
                try:
                    stream.close()
                except OSError:
                    pass

    def test_default_character_works_without_custom_artwork(self):
        payload = {"hook_event_name": "postToolUse", "conversation_id": "default", "generation_id": "turn", "tool_name": "Read"}
        result = subprocess.run([sys.executable, str(BRIDGE)], input=json.dumps(payload), text=True,
                                capture_output=True, env=self.env, timeout=10)
        self.assertEqual((result.returncode, result.stdout.strip(), result.stderr), (0, "{}", ""))
        self.assertEqual(self.read("gpt-state.json")["after"], "reading")
        self.assertEqual(self.read("cursor-host.json")["character"], "gpt")
        self.assertTrue((self.state / "seen-cursor").exists())
        self.assertFalse((self.state / "seen-gpt").exists())
        self.assertFalse(self.read("cursor-bridge-status.json")["artwork_ready"])

    def test_custom_character_heartbeats_stay_cursor_owned(self):
        self.send("postToolUse", tool_name="Read")
        self.assertTrue((self.state / "seen-cursor").exists())
        self.assertFalse((self.state / "seen-grok").exists())
        self.assertEqual(self.read("cursor-host.json")["character"], "grok")

    def test_default_character_keeps_codex_cards_during_concurrent_writes(self):
        data = Path(self.env["CROSSPET_DATA_DIR"])
        data.mkdir(parents=True)
        (data / "ai-autostart-off").write_text("test", encoding="utf-8")
        hook = BRIDGE.parent.parent / "crosspet-hook.py"
        def write(source):
            payload = ({"hook_event_name": "postToolUse", "conversation_id": "cursor-test", "generation_id": "G1", "tool_name": "Read"}
                       if source == "cursor" else {"hook_event_name": "PreToolUse", "session_id": "codex-test", "turn_id": "T1", "tool_name": "read_file"})
            command = [sys.executable, str(BRIDGE)] if source == "cursor" else [sys.executable, str(hook), "gpt"]
            result = subprocess.run(command, input=json.dumps(payload), text=True, encoding="utf-8",
                                    capture_output=True, env=self.env, timeout=10)
            self.assertEqual((result.returncode, result.stderr), (0, ""))
        with ThreadPoolExecutor(max_workers=2) as pool:
            for _ in range(8):
                list(pool.map(write, ("cursor", "codex")))
        cards = self.read("gpt-sessions.json")
        self.assertIn("codex-test", cards)
        self.assertTrue(any(key.startswith("cursor_") for key in cards))
        self.assertTrue(all(isinstance(value, dict) and value["pose"] == "reading" for value in cards.values()))


if __name__ == "__main__":
    unittest.main()
