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
        # 观察者钩子：永远退出码 0，不能影响 Cursor。观察事件回 {}；读不懂的输入回「放行」（可能是 beforeSubmitPrompt）
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn(result.stdout.strip(), ("{}", '{"continue": true}'))
        return self.read("grok-state.json")

    def read(self, name):
        path = self.state / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    # ---- 按 Cursor 里选的模型换角色（事件里每条都带 model / model_id）----
    def install(self, *ids):
        for cid in ids:
            d = Path(self.env["CROSSPET_DATA_DIR"]) / "characters" / cid
            d.mkdir(parents=True, exist_ok=True)
            (d / "character.json").write_text("{}", encoding="utf-8")
            (d / "idle.webp").write_bytes(b"x")

    def fire(self, args, kind, conv="C1", gen="G1", **extra):
        event = {"hook_event_name": kind, "conversation_id": conv, "generation_id": gen, **extra}
        result = subprocess.run([sys.executable, str(BRIDGE), *args], input=json.dumps(event), text=True,
                                capture_output=True, env=self.env, timeout=10)
        self.assertEqual((result.returncode, result.stdout.strip(), result.stderr), (0, "{}", ""))

    # ---- 发消息那一刻（beforeSubmitPrompt）：她马上开始听，不用等 Cursor 回答完 ----
    # 这个事件能拦住消息：回复格式不对 Cursor 会当成「拦下」，所以一定要回 {"continue": true}，读不懂事件时也一样
    def submit(self, text):
        result = subprocess.run([sys.executable, str(BRIDGE), "grok"], input=text, text=True,
                                capture_output=True, env=self.env, timeout=10)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        return json.loads(result.stdout)

    def test_submit_prompt_starts_listening_and_always_continues(self):
        reply = self.submit(json.dumps({"hook_event_name": "beforeSubmitPrompt", "conversation_id": "C1",
                                        "generation_id": "G1", "prompt": "hi", "model": "grok-4.6"}))
        self.assertEqual(reply, {"continue": True})
        state = self.read("grok-state.json")
        self.assertEqual((state["pose"], state["event"]), ("listening", "UserPromptSubmit"))

    def test_submit_prompt_continues_even_when_input_is_broken(self):
        for text in ("", "not json", '{"hook_event_name": "beforeSubmitPrompt"'):
            with self.subTest(text=text):
                self.assertEqual(self.submit(text), {"continue": True})

    def test_new_turn_after_stop_listens_again(self):
        self.submit(json.dumps({"hook_event_name": "beforeSubmitPrompt", "conversation_id": "C1", "generation_id": "G1"}))
        self.send("stop", gen="G1", status="completed")
        self.submit(json.dumps({"hook_event_name": "beforeSubmitPrompt", "conversation_id": "C1", "generation_id": "G2"}))
        self.assertEqual(self.read("grok-state.json")["pose"], "listening")

    def test_model_rule_matches_hook(self):
        """桥里那份按模型选角色的规则和 crosspet-hook.py 的必须一样（两边各自是独立脚本，没法互相 import）"""
        import ast
        def load(path):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "character_for_model")
            scope = {}
            exec(compile(ast.Module([node], []), str(path), "exec"), scope)
            return scope["character_for_model"]
        bridge, hook = load(BRIDGE), load(BRIDGE.parent.parent / "crosspet-hook.py")
        for model in ("claude-opus-4-7", "claude-4.5-sonnet-thinking", "gpt-5-codex", "o3", "gemini-2.5-pro", "grok-code-fast-1",
                      "deepseek-v3.1", "glm-4.6", "qwen3-coder", "kimi-k2", "composer-1", "auto", "cursor-small", ""):
            self.assertEqual(bridge(model), hook(model), model)

    def test_model_picks_character(self):
        self.install("claude", "gpt", "grok")
        for model, model_id, want in (("claude-opus-4-7-thinking-max", "claude-opus-4-7", "claude"),
                                      ("gpt-5-codex", "", "gpt"), ("grok-code-fast-1", "", "grok")):
            with self.subTest(model=model):
                extra = {"model": model, **({"model_id": model_id} if model_id else {})}
                self.fire([], "afterAgentThought", conv=model, **extra)
                self.assertEqual(self.read(f"{want}-state.json")["pose"], "thinking")
                self.assertEqual(self.read("cursor-host.json")["character"], want)

    def test_unknown_model_uses_given_character_or_current(self):
        self.install("claude", "gpt")
        # Cursor 自家的 Composer / Auto：认不出，用接入时指定的角色
        self.fire(["gpt"], "afterAgentThought", model="composer-1")
        self.assertEqual(self.read("gpt-state.json")["pose"], "thinking")
        self.assertEqual(self.read("cursor-host.json")["character"], "gpt")
        # 没指定角色：由当前角色来演，切到 Cursor 时也不换人
        self.fire([], "afterAgentThought", conv="C2", model="auto")
        self.assertEqual(self.read("current-state.json")["pose"], "thinking")
        self.assertIsNone(self.read("cursor-host.json")["character"])

    def test_model_without_artwork_falls_back(self):
        self.install("gpt")
        self.fire(["gpt"], "afterAgentThought", model="claude-4.5-sonnet")   # Claude 没装立绘
        self.assertEqual(self.read("gpt-state.json")["pose"], "thinking")
        self.assertIsNone(self.read("claude-state.json"))

    def test_cards_follow_each_conversation_model(self):
        self.install("claude", "gpt")
        self.fire([], "afterAgentThought", conv="A", model="claude-opus-4-7")
        self.fire([], "afterAgentThought", conv="B", model="gpt-5")
        cards = lambda cid: {k for k in (self.read(f"{cid}-sessions.json") or {}) if k.startswith("cursor_")}
        self.assertEqual((len(cards("claude")), len(cards("gpt"))), (1, 1))
        # 会话 A 中途换成 GPT 模型：卡片从 Claude 那边挪到 GPT 这边，不留在两边
        self.fire([], "afterAgentThought", conv="A", gen="G2", model="gpt-5")
        self.assertEqual((len(cards("claude")), len(cards("gpt"))), (0, 2))

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
        # 没指定角色、事件里也没模型：由当前角色来演（current），切到 Cursor 时不换人
        self.assertEqual(self.read("current-state.json")["after"], "reading")
        self.assertIsNone(self.read("cursor-host.json")["character"])
        self.assertTrue((self.state / "seen-cursor").exists())
        self.assertFalse((self.state / "seen-current").exists())
        self.assertTrue(self.read("cursor-bridge-status.json")["artwork_ready"])

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
            command = [sys.executable, str(BRIDGE), "gpt"] if source == "cursor" else [sys.executable, str(hook), "gpt"]
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
