"""钩子事件记录（数据目录 events/<接入名>.jsonl）：每条事件记处理结果（演了 / 被哪条规则丢了 / 出错），绝不记内容。
设计见 docs/superpowers/specs/2026-10-21-feedback-redesign-design.md 第四节。不开真的桌宠、不碰用户配置。
    python3 -m unittest tests.hook_ledger_test
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "integrations" / "crosspet-hook.py"


class HookLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name, "state")
        self.data = Path(self.tmp.name, "data")
        self.codex_home = Path(self.tmp.name, "codex-home")
        for d in (self.state, self.data, self.codex_home):
            d.mkdir()
        (self.data / "ai-autostart-off").write_text("test")
        self.transcript = Path(self.tmp.name, "rollout.jsonl")
        self.transcript.write_text("")

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, ev, host="gpt", extra_args=(), raw=None):
        env = dict(os.environ, CROSSPET_STATE_DIR=str(self.state), CROSSPET_DATA_DIR=str(self.data), CODEX_HOME=str(self.codex_home))
        data = raw if raw is not None else json.dumps(ev).encode()
        r = subprocess.run([sys.executable, str(HOOK), host, *extra_args], input=data, capture_output=True, env=env, timeout=10)
        self.assertEqual(r.returncode, 0, r.stderr)

    def send(self, name, host="gpt", **extra):
        ev = {"hook_event_name": name, "session_id": "s1", "cwd": "/tmp", "model": "gpt-test", "tool_name": "exec_command", **extra}
        self.run_hook(ev, host)

    def lines(self, integration):
        p = self.data / "events" / f"{integration}.jsonl"
        return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []

    def test_shown_event_is_recorded(self):
        self.send("UserPromptSubmit", transcript_path=str(self.transcript), turn_id="T1")
        last = self.lines("codex")[-1]
        self.assertEqual(last["ev"], "UserPromptSubmit")
        self.assertEqual(last["result"], "shown")
        self.assertTrue(last["detail"].startswith("gpt "), last)
        self.assertTrue(last["turn"])
        for k in ("t", "ev", "tool", "sid", "turn", "result", "detail"):
            self.assertIn(k, last)

    def test_drop_rules_named(self):
        self.send("PreToolUse", cwd=str(self.codex_home / "memories"))
        self.assertEqual(self.lines("codex")[-1]["detail"], "codex-memory")
        self.send("PreToolUse", transcript_path=str(Path(self.tmp.name, "missing.jsonl")))
        self.assertEqual(self.lines("codex")[-1]["detail"], "codex-suggestion")
        self.send("UserPromptSubmit", turn_id="T1")
        self.send("Stop", turn_id="T1")
        self.send("PostToolUse", turn_id="T1")
        last = self.lines("codex")[-1]
        self.assertEqual((last["result"], last["detail"]), ("dropped", "turn-finished"))

    def test_bad_json(self):
        self.run_hook(None, raw=b"not json")
        last = self.lines("codex")[-1]
        self.assertEqual((last["result"], last["detail"]), ("dropped", "bad-json"))

    def test_unknown_event(self):
        self.send("SomethingNew")
        last = self.lines("codex")[-1]
        self.assertEqual((last["result"], last["detail"]), ("dropped", "unknown-event"))

    def test_no_content_leaks(self):
        self.send("PreToolUse", prompt="SECRET-PROMPT-123", tool_input={"command": "cat SECRET-FILE-456"},
                  tool_response="SECRET-OUT-789", last_assistant_message="SECRET-ANSWER",
                  cwd="/Users/someone/proj-SECRET-DIR", transcript_path=str(self.transcript))
        self.send("Stop", cwd="/Users/someone/proj-SECRET-DIR", last_assistant_message="SECRET-ANSWER-2")
        text = (self.data / "events" / "codex.jsonl").read_text(encoding="utf-8")
        self.assertNotIn("SECRET", text)
        self.assertNotIn(str(self.transcript), text)

    def test_integration_names(self):
        for host, args, integration in [("claude", (), "claude-hooks"), ("gpt", (), "codex"), ("gemini", (), "gemini"),
                                        ("gemini", ("PreInvocation",), "antigravity"), ("qwen", (), "qwen")]:
            with self.subTest(host=host, args=args):
                self.run_hook({"hook_event_name": "UserPromptSubmit", "session_id": "s1"}, host, args)
                self.assertTrue(self.lines(integration), integration)

    def test_trim(self):
        for i in range(245):
            self.run_hook(b"", raw=json.dumps({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": f"t{i}"}).encode())
        rows = self.lines("codex")
        self.assertTrue(200 <= len(rows) <= 240, len(rows))
        self.assertEqual(rows[-1]["tool"], "t244")

    def test_concurrent_writes(self):
        def one(i):
            self.send("PreToolUse", tool_name=f"tool{i}", session_id=f"s{i}")
        with ThreadPoolExecutor(10) as pool:
            list(pool.map(one, range(20)))
        self.assertEqual(len(self.lines("codex")), 20)   # 每行都能解析（lines() 里 json.loads），而且一条没丢

    def test_session_hashed(self):
        self.send("PreToolUse", session_id="abc-secret-session")
        last = self.lines("codex")[-1]
        self.assertEqual(last["sid"], hashlib.sha1(b"abc-secret-session").hexdigest()[:6])
        self.assertNotIn("abc-secret-session", (self.data / "events" / "codex.jsonl").read_text())


if __name__ == "__main__":
    unittest.main()
