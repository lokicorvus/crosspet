"""Exercise HostLifecycle against real, temporary macOS app processes."""
import os
import plistlib
import signal
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "build/module-cache"
TEST = ROOT / "build/host-lifecycle-tests"


def wait_for(path, timeout=10, proc=None):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if path.exists():
            return
        if proc is not None and proc.poll() is not None:
            out, err = proc.communicate()
            raise AssertionError(out + err)
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for {path.name}")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "swiftc", "-parse-as-library", "-module-cache-path", str(CACHE),
        str(ROOT / "app/HostLifecycle.swift"), str(ROOT / "tests/HostLifecycleTests.swift"),
        "-o", str(TEST), "-framework", "Cocoa",
    ], check=True)
    with tempfile.TemporaryDirectory(prefix="crosspet-lifecycle-") as tmp:
        base = Path(tmp)
        app = base / "LifecycleHost.app"
        exe = app / "Contents/MacOS/LifecycleHost"
        exe.parent.mkdir(parents=True)
        host = "io.github.crosspet.test." + uuid.uuid4().hex
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": host, "CFBundleName": "CrossPet Lifecycle Test Host",
            "CFBundleExecutable": "LifecycleHost", "CFBundlePackageType": "APPL",
            "LSUIElement": True,
        }))
        subprocess.run([
            "swiftc", "-parse-as-library", "-module-cache-path", str(CACHE),
            str(ROOT / "tests/LifecycleHost.swift"), "-o", str(exe), "-framework", "Cocoa",
        ], check=True)
        pids = set()
        testers = []

        def launch(label):
            pid_file = base / (label + ".pid")
            subprocess.run(["open", "-n", "-g", str(app), "--args", str(pid_file)], check=True)
            wait_for(pid_file)
            pid = int(pid_file.read_text())
            pids.add(pid)
            return pid

        def stop(pid, sig=signal.SIGTERM):
            os.kill(pid, sig)
            pids.discard(pid)

        def tester(mode, label):
            ready = base / (label + ".ready")
            proc = subprocess.Popen([str(TEST), mode, host, str(ready)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            testers.append(proc)
            wait_for(ready, proc=proc)
            return proc

        def passed(proc):
            out, err = proc.communicate(timeout=10)
            assert proc.returncode == 0, out + err
            print(out.strip())

        try:
            subprocess.run([str(TEST), "absent", host, str(base / "absent")], check=True)
            one = launch("normal")
            proc = tester("poll", "normal")
            stop(one)
            passed(proc)

            first, second = launch("first"), launch("second")
            proc = tester("poll", "multiple")
            stop(first)
            time.sleep(0.5)
            assert proc.poll() is None, "One remaining host must keep pet alive"
            stop(second)
            passed(proc)
            print("PASS: multiple instances wait for the last host")

            one = launch("blip")
            proc = tester("blip", "blip")
            time.sleep(0.5)
            assert proc.poll() is None, "Missing registry entry must not stop a live host"
            stop(one)
            passed(proc)
            print("PASS: cached host identity survives missing registry entries")

            one = launch("abrupt")
            proc = tester("poll", "abrupt")
            stop(one, signal.SIGKILL)
            passed(proc)
            print("PASS: abnormal host exit")

            one = launch("cancel")
            proc = tester("cancel", "cancel")
            stop(one)
            passed(proc)
        finally:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            for proc in testers:
                if proc.poll() is None:
                    proc.terminate()
                proc.communicate(timeout=5)


if __name__ == "__main__":
    main()
