#!/usr/bin/env python3
"""Regression test for Codex hooks in local ChatGPT Projects."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "integrations" / "crosspet-hook.py"


class CodexProjectHookTests(unittest.TestCase):
    def test_project_events_are_not_background_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex_home = root / ".codex"
            project = codex_home / ".chatgpt-projects" / "project-id"
            memory = codex_home / "memories"
            state = root / "state"
            data = root / "data"
            for directory in (project, memory, state, data):
                directory.mkdir(parents=True)

            env = dict(os.environ, CODEX_HOME=str(codex_home),
                       CROSSPET_DATA_DIR=str(data), CROSSPET_STATE_DIR=str(state))
            event = {"hook_event_name": "PostToolUse", "session_id": "s1", "tool_name": "bash"}

            def fire(cwd):
                result = subprocess.run(
                    [sys.executable, str(HOOK), "gpt"],
                    input=json.dumps({**event, "cwd": str(cwd)}).encode(),
                    capture_output=True, env=env,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))

            fire(project)
            self.assertEqual(json.loads((state / "gpt-state.json").read_text())["pose"], "thinking")
            (state / "gpt-state.json").unlink()
            fire(memory)
            self.assertFalse((state / "gpt-state.json").exists())


if __name__ == "__main__":
    unittest.main()
