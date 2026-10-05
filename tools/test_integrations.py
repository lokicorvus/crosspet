"""Run with: python -m unittest discover -s tools -p test_*.py

All configuration mutations and hook outputs stay in temporary directories.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parent.parent


class IntegrationsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crosspet test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        spec = importlib.util.spec_from_file_location("integrate", REPO / "tools/integrate.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        m = self.module
        m.WINDOWS = True
        m.SUPPORT = self.root / "Local Data/CrossPet"
        m.CLAUDE_SETTINGS = self.root / "claude/settings.json"
        m.CODEX_HOOKS = self.root / "codex/hooks.json"
        m.GEMINI_SETTINGS = self.root / "gemini/settings.json"
        m.ANTIGRAVITY_HOOKS = self.root / "gemini/config/hooks.json"
        m.DSH_PROFILE = self.root / "dsh/desktop"
        m.DSH_PLUGIN_DIR = m.SUPPORT / "dsh-plugin-crosspet"
        m.install_hook()

    def test_hooks_install_reinstall_remove_preserves_user_settings(self):
        m = self.module
        for target, file in [(m.claude_hooks, m.CLAUDE_SETTINGS), (m.codex, m.CODEX_HOOKS), (m.gemini, m.GEMINI_SETTINGS)]:
            original = {"theme": "dark", "hooks": {"SessionStart": [{"hooks": [{"command": "echo user hook"}]}]}}
            m.save_json(file, original)
            with contextlib.redirect_stdout(io.StringIO()):
                target(True)
                installed = m.load_json(file)
                target(True)
                self.assertEqual(installed, m.load_json(file))
                target(False)
            self.assertEqual(m.load_json(file), original)
            commands = [h["command"] for groups in installed["hooks"].values() for group in groups for h in group["hooks"] if m.MARK in h.get("command", "")]
            self.assertTrue(commands)
            self.assertTrue(all(command.startswith('python "') and "$HOME" not in command and "Library/" not in command for command in commands))
            self.assertTrue(list(file.parent.glob("*.bak-crosspet-*")))

    def test_antigravity_and_macos_templates(self):
        m = self.module
        m.save_json(m.ANTIGRAVITY_HOOKS, {"user": {"Stop": []}})
        with contextlib.redirect_stdout(io.StringIO()):
            m.antigravity(True)
            data = m.load_json(m.ANTIGRAVITY_HOOKS)
            self.assertTrue(data["crosspet"]["PreInvocation"][0]["command"].endswith("gemini PreInvocation"))
            m.antigravity(False)
        self.assertEqual(m.load_json(m.ANTIGRAVITY_HOOKS), {"user": {"Stop": []}})
        m.WINDOWS = False
        file = REPO / "integrations/codex/hooks.json"
        self.assertEqual(m.hook_template(file), m.load_json(file))

    def test_deepseek_copy_works_without_symlink_privileges(self):
        m = self.module
        m.DSH_PROFILE.mkdir(parents=True)
        m.save_json(m.DSH_PROFILE / "package.json", {"dependencies": {"other": "1.0.0"}})
        link = m.DSH_PROFILE / "node_modules/@local/dsh-plugin-crosspet"
        with contextlib.redirect_stdout(io.StringIO()):
            m.deepseek(True)
            self.assertTrue((link / "lib/index.js").exists())
            self.assertFalse(link.is_symlink())
            m.deepseek(True)
            m.deepseek(False)
        self.assertFalse(link.exists())
        self.assertEqual(m.load_json(m.DSH_PROFILE / "package.json"), {"dependencies": {"other": "1.0.0"}})

    def test_generated_windows_command_runs_with_spaces(self):
        if sys.platform != "win32":
            self.skipTest("Windows shell check")
        m = self.module
        command = m.hook_template(REPO / "integrations/codex/hooks.json")["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        state_dir = self.root / "state"
        env = dict(os.environ, CROSSPET_STATE_DIR=str(state_dir))
        event = json.dumps({"hook_event_name": "PreToolUse", "tool_name": "read_file"})
        subprocess.run(command, shell=True, input=event, text=True, env=env, check=True, capture_output=True)
        self.assertEqual(json.loads((state_dir / "gpt-state.json").read_text())["pose"], "reading")
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], input=event, text=True, env=env, check=True, capture_output=True)

    def test_hook_default_windows_path_and_big_job(self):
        env = dict(os.environ, TEMP=str(self.root), TMP=str(self.root))
        env.pop("CROSSPET_STATE_DIR", None)
        if sys.platform != "win32":
            env["CROSSPET_STATE_DIR"] = str(self.root / "crosspet")
        def event(name, tool=""):
            result = subprocess.run([sys.executable, str(REPO / "integrations/crosspet-hook.py"), "gpt"], input=json.dumps({"hook_event_name": name, "tool_name": tool}), text=True, env=env, capture_output=True, check=True)
            self.assertEqual(result.stdout, "")
            return json.loads((self.root / "crosspet/gpt-state.json").read_text())
        self.assertEqual(event("UserPromptSubmit")["pose"], "listening")
        for _ in range(8):
            self.assertEqual(event("PreToolUse", "apply_patch")["pose"], "writing")
        self.assertEqual(event("Stop")["pose"], "proud")
        self.assertEqual(event("UserPromptSubmit")["pose"], "listening")
        self.assertEqual(event("Stop")["pose"], "happy")


if __name__ == "__main__":
    unittest.main()
