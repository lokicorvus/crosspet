"""钩子等锁不能拖住 AI（#45 @Ink-Stained-Clouds）：别的进程一直占着某把锁时，钩子要在 Claude 的 5 秒上限内正常退出（退出码 0、不输出东西）；
占着的是外层的事件锁就整条丢掉，占着的是里面的记录锁就只跳过那一项，状态照写。
Windows 用 msvcrt、macOS 用 fcntl，两边都跑：python3 -m unittest tests.hook_lock_timeout_test
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


def hold(f):
    if os.name == "nt":
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)


def release(f):
    if os.name == "nt":
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(f, fcntl.LOCK_UN)


class HookLockTimeoutTest(unittest.TestCase):
    def test_contended_observer_locks_exit_successfully(self):
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
                    hold(lock)
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
                        release(lock)


if __name__ == "__main__":
    unittest.main(verbosity=2)
