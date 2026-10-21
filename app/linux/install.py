#!/usr/bin/env python3
"""Linux 用户级安装：不需要 sudo，不自动改 AI 配置。"""
import argparse
import fcntl
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time

from core import ROOT, desktop_entry, write_json


def install(prefix):
    prefix = Path(prefix).expanduser().resolve()
    share = Path(os.environ.get("XDG_DATA_HOME", str(prefix / "share"))).resolve()
    data = Path(os.environ.get("CROSSPET_DATA_DIR") or str(share / "crosspet")).resolve()
    runtime = data / "runtime"
    launcher = prefix / "bin/crosspet"
    desktop = share / "applications/crosspet.desktop"
    data.mkdir(parents=True, exist_ok=True)
    # 更新代码前让旧进程正常退出，防止一边执行一边替换模块。
    with (data / "instance.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            write_json(data / "control.json", {"action": "quit", "ts": time.time()})
            deadline = time.monotonic() + 8
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("正在运行的 CrossPet 没有退出；请退出后重新安装")
                    time.sleep(0.1)
        if runtime == ROOT:
            raise RuntimeError("请从源码仓库运行安装器")
        for name in ("app/linux", "app/web", "app/icon", "characters", "integrations", "tools"):
            shutil.copytree(ROOT / name, runtime / name, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("__pycache__", "raw", "*.bak-crosspet-*"))
        for name in ("VERSION", "LICENSE"):
            shutil.copy2(ROOT / name, runtime / name)
        entry = runtime / "app/linux/main.py"
        launcher.parent.mkdir(parents=True, exist_ok=True)
        launcher.write_text("#!/bin/sh\n# CrossPet Linux launcher\n"
                            f"export CROSSPET_DATA_DIR={shlex.quote(str(data))}\n"
                            f'exec /usr/bin/python3 {shlex.quote(str(entry))} "$@"\n')
        launcher.chmod(0o755)
        desktop.parent.mkdir(parents=True, exist_ok=True)
        desktop.write_text(desktop_entry([str(launcher)]).replace(str(ROOT / "app/icon"), str(runtime / "app/icon")))
        shutil.copy2(ROOT / "integrations/crosspet-hook.py", data / "crosspet-hook.py")
        write_json(data / "launch.json", {"argv": [str(launcher)]})
    print(f"已安装：{launcher}\n应用菜单：CrossPet\nAI 接入：启动后右键 → 设置 → 接入 AI")
    return launcher


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", default=str(Path.home() / ".local"))
    parser.add_argument("--launch", action="store_true")
    parser.add_argument("--uninstall", action="store_true", help="撤销已接入的 AI 并卸载程序；保留角色和设置")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("此安装器只支持 Linux")
    if args.uninstall:
        prefix = Path(args.prefix).expanduser().resolve()
        share = Path(os.environ.get("XDG_DATA_HOME", str(prefix / "share"))).resolve()
        data = Path(os.environ.get("CROSSPET_DATA_DIR") or str(share / "crosspet")).resolve()
        env = dict(os.environ, CROSSPET_DATA_DIR=str(data))
        if data.exists():
            write_json(data / "control.json", {"action": "quit", "ts": time.time()})
            with (data / "instance.lock").open("a") as lock:
                deadline = time.monotonic() + 8
                while True:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError("CrossPet 没有退出，请先退出后卸载")
                        time.sleep(.1)
                result = subprocess.run(["/usr/bin/python3", str(ROOT / "tools/integrate.py"), "installed"],
                                        env=env, capture_output=True, text=True, check=True, timeout=15)
                import json
                for target in json.loads(result.stdout):
                    subprocess.run(["/usr/bin/python3", str(ROOT / "tools/integrate.py"), "uninstall", target],
                                   env=env, check=True, timeout=75)
                if (data / "runtime").is_dir():
                    shutil.rmtree(data / "runtime")
                for name in ("launch.json", "control.json", "crosspet-hook.py"):
                    (data / name).unlink(missing_ok=True)
        launcher = prefix / "bin/crosspet"
        if launcher.exists() and "# CrossPet Linux launcher" in launcher.read_text():
            launcher.unlink()
        (share / "applications/crosspet.desktop").unlink(missing_ok=True)
        config = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
        (config / "autostart/crosspet.desktop").unlink(missing_ok=True)
        print(f"已卸载，角色和设置保留在 {data} 及 {config / 'crosspet'}")
        return 0
    result = subprocess.run(["/usr/bin/python3", str(ROOT / "app/linux/main.py"), "--check"])
    if result.returncode:
        return result.returncode
    launcher = install(args.prefix)
    if args.launch:
        subprocess.Popen([str(launcher)], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
