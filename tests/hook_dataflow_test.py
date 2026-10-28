"""钩子脚本写给桌宠的数据（crosspet-hook.py）。只用临时目录，不打开桌宠。

    python3 tests/hook_dataflow_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "integrations" / "crosspet-hook.py"


class HookDataflowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.state = root / "state"
        self.data = root / "data"
        self.state.mkdir()
        self.data.mkdir()
        (self.data / "ai-autostart-off").write_text("test", encoding="utf-8")
        self.env = dict(os.environ, CROSSPET_STATE_DIR=str(self.state), CROSSPET_DATA_DIR=str(self.data),
                        CODEX_HOME=str(root / "no-codex"))
        for name in ("ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"):
            self.env.pop(name, None)

    def tearDown(self):
        self.temp.cleanup()

    def run_hook(self, payload, character="claude"):
        result = subprocess.run([sys.executable, str(HOOK), character], input=json.dumps(payload), text=True,
                                capture_output=True, env=self.env, timeout=10)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        return self.read(f"{character}-state.json")

    def read(self, name):
        path = self.state / name
        return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else None

    def test_mixed_up_models_file_does_not_break_the_hook(self):
        # 以前 claude-models.json 和 claude-sessions.json 共用一个临时文件，几个钩子同时写时会互相写错
        (self.state / "claude-models.json").write_text(json.dumps({"s1": {"pose": "running", "ts": 1}}))
        state = self.run_hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Read"})
        self.assertEqual(state["pose"], "reading")

    def test_mixed_up_sessions_file_heals(self):
        (self.state / "claude-sessions.json").write_text(json.dumps({"old": "claude-opus-5"}))
        self.run_hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Read"})
        self.assertEqual(set(self.read("claude-sessions.json")), {"s1"})

    def test_cursor_running_claude_hooks_writes_nothing(self):
        # Cursor 默认也跑 Claude Code 的钩子；Cursor 有自己的接入，这里什么都不写（心跳也不算 Claude 的）
        home = Path(self.temp.name) / "home"
        cursor = home / ".cursor"
        cursor.mkdir(parents=True)
        (cursor / "hooks.json").write_text(json.dumps({"hooks": {"postToolUse": [
            {"command": "python crosspet-cursor-bridge.py gpt"}]}}), encoding="utf-8")
        self.env.update(HOME=str(home), USERPROFILE=str(home))
        self.run_hook({"hook_event_name": "PreToolUse", "conversation_id": "c1", "generation_id": "g1",
                       "cursor_version": "2.0.0", "tool_name": "Shell", "model": "gpt-5"})
        self.assertEqual(sorted(p.name for p in self.state.iterdir()), [])

    def test_session_start_after_compaction_keeps_working(self):
        self.run_hook({"hook_event_name": "UserPromptSubmit", "session_id": "s1"})
        self.run_hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Edit"})
        state = self.run_hook({"hook_event_name": "SessionStart", "session_id": "s1", "source": "compact"})
        self.assertEqual((state["event"], state["pose"]), ("PreToolUse", "writing"))
        state = self.run_hook({"hook_event_name": "SessionStart", "session_id": "s2", "source": "startup"})
        self.assertEqual(state["pose"], "idle")

    def test_launch_events_follow_the_data_dir(self):
        # 临时运行目录里关掉了「AI 开始工作时自动出现」：钩子照它办，不去打开真的桌宠（macOS 上以前看的是真的设置）
        self.run_hook({"hook_event_name": "UserPromptSubmit", "session_id": "s1"})
        self.assertIn("不打开", (self.state / "autostart.txt").read_text(encoding="utf-8-sig"))

    @unittest.skipUnless(os.name == "nt", "Windows file-sharing semantics")
    def test_transient_state_reader_does_not_fail_the_observer(self):
        # The native UI may hold the previous state open while a hook replaces it.
        path = self.state / "gpt-state.json"
        path.write_text('{"pose":"idle"}', encoding="utf-8")
        reader = path.open("rb")
        p = subprocess.Popen([sys.executable, str(HOOK), "gpt"], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        try:
            p.stdin.write(json.dumps({"hook_event_name": "PreToolUse", "session_id": "s1",
                                      "turn_id": "t1", "tool_name": "Read"}).encode("utf-8"))
            p.stdin.flush()
            deadline = time.monotonic() + 5
            while p.poll() is None and not list(self.state.glob(".gpt-state.*.json")) and time.monotonic() < deadline:
                time.sleep(.001)
            time.sleep(.01)
            reader.close()
            _, stderr = p.communicate(timeout=5)
            self.assertEqual((p.returncode, stderr.decode("utf-8", errors="replace")), (0, ""))
            self.assertEqual(self.read("gpt-state.json")["pose"], "reading")
        finally:
            reader.close()
            if p.poll() is None:
                p.kill()
                p.communicate()


if __name__ == "__main__":
    unittest.main()
