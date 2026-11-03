#!/usr/bin/env python3
"""ChatGPT 桌面版的本地项目（CODEX_HOME/.chatgpt-projects/<项目>）里的事件照常演；
Codex 自己在后台整理记忆（CODEX_HOME/memories）的照旧不管（#38，思路来自 @longqiyun020506-dot）。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "integrations" / "crosspet-hook.py"


class CodexProjectHookTests(unittest.TestCase):
    def test_project_events_play_memory_events_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex_home = root / ".codex"
            project = codex_home / ".chatgpt-projects" / "project-id"
            memory = codex_home / "memories"
            state, data = root / "state", root / "data"
            for d in (project, memory, state, data):
                d.mkdir(parents=True)
            env = dict(os.environ, CODEX_HOME=str(codex_home), CROSSPET_DATA_DIR=str(data), CROSSPET_STATE_DIR=str(state))
            event = {"hook_event_name": "PostToolUse", "session_id": "s1", "tool_name": "bash"}
            state_file = state / "gpt-state.json"

            def fire(cwd):
                r = subprocess.run([sys.executable, str(HOOK), "gpt"], input=json.dumps({**event, "cwd": str(cwd)}).encode(),
                                   capture_output=True, env=env, timeout=20)
                self.assertEqual(r.returncode, 0, r.stderr.decode(errors="replace"))

            fire(project)
            self.assertEqual(json.loads(state_file.read_text())["pose"], "thinking")
            state_file.unlink()
            fire(memory)
            self.assertFalse(state_file.exists())
            fire(codex_home / ".chatgpt-projects")   # 项目文件夹本身（不在某个项目里）也不管
            self.assertFalse(state_file.exists())


if __name__ == "__main__":
    unittest.main()
