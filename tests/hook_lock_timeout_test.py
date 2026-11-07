"""Windows observer locks must not outlive the host's five-second timeout.
Run from any directory: python -I <path-to-this-file>
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

HOOK = Path(__file__).resolve().parent.parent / "integrations" / "crosspet-hook.py"


@unittest.skipUnless(os.name == "nt", "Windows file-lock regression tests")
class HookLockTimeoutTest(unittest.TestCase):
    def test_contended_observer_locks_exit_successfully(self):
        import msvcrt
        for relative in ("events/.claude-hooks.lock", ".claude-models.lock",
                         ".claude-sessions.lock", ".claude-events.lock"):
            with self.subTest(lock=relative), tempfile.TemporaryDirectory() as directory:
                data = Path(directory)
                path = data / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                env = dict(os.environ, CROSSPET_DATA_DIR=directory, CROSSPET_STATE_DIR=directory)
                event = {"hook_event_name": "PreToolUse", "session_id": "lock-test",
                         "tool_name": "Read", "model": "claude"}
                with path.open("w+b") as lock:
                    lock.write(b"0")
                    lock.flush()
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    try:
                        start = time.monotonic()
                        result = subprocess.run([sys.executable, "-I", str(HOOK), "claude"],
                                                input=json.dumps(event).encode(), capture_output=True,
                                                env=env, cwd=directory, timeout=4)
                        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
                        self.assertEqual(result.stdout, b"")
                        self.assertLess(time.monotonic() - start, 4)
                        state = data / "claude-state.json"
                        self.assertEqual(state.exists(), relative != ".claude-events.lock")
                    finally:
                        lock.seek(0)
                        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
