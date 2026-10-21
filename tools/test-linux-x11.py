#!/usr/bin/env python3
"""在独立的 Xephyr X11 显示中测试输入，不移动用户主桌面的指针。"""
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
output = root / "build/linux-smoke-x11"
output.mkdir(parents=True, exist_ok=True)
xephyr = shutil.which("Xephyr")
if not xephyr:
    sys.exit("需要 Xephyr：sudo apt install xserver-xephyr")
read_fd, write_fd = os.pipe()
with (output / "xephyr.log").open("w") as log:
    server = subprocess.Popen([xephyr, "-displayfd", str(write_fd), "-screen", "1280x900",
                               "-no-host-grab", "-nolisten", "tcp"],
                              pass_fds=(write_fd,), stdout=log, stderr=log)
    os.close(write_fd)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(read_fd, selectors.EVENT_READ)
            if not selector.select(10):
                raise RuntimeError("Xephyr 启动超时")
            display = os.read(read_fd, 64).decode().strip()
        if not display.isdecimal():
            raise RuntimeError("Xephyr 没有提供显示编号，请查看 " + str(output / "xephyr.log"))
        env = dict(os.environ, DISPLAY=":" + display, XDG_SESSION_TYPE="x11", GDK_SCALE="1", GDK_DPI_SCALE="1")
        result = subprocess.run(["/usr/bin/python3", str(root / "app/linux/main.py"),
                                 "--smoke-test", str(output)], env=env, timeout=55)
        sys.exit(result.returncode)
    finally:
        os.close(read_fd)
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
