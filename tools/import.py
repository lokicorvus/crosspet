#!/usr/bin/env python3
"""批量导入立绘：把生图 AI 画的白底图放进 characters/<角色id>/raw/（文件名 = 姿态名，如 thinking.png、idle-2.png），然后运行
    python3 tools/import.py            # 处理所有角色的 raw/
    python3 tools/import.py gpt        # 只处理某个角色
处理完会自动修正眨眼帧。raw/ 不会被提交到 git。
"""
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
CHARACTERS = TOOLS.parent / "characters"
only = sys.argv[1] if len(sys.argv) > 1 else None

for raw in sorted(CHARACTERS.glob("*/raw")):
    cid = raw.parent.name
    if only and cid != only:
        continue
    files = [f for f in sorted(raw.iterdir()) if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
    for f in files:
        subprocess.run([sys.executable, str(TOOLS / "prepare.py"), str(f), cid, f.stem], check=True)
    if any(f.stem == "idle-blink" for f in files) and (CHARACTERS / cid / "idle.webp").exists():
        subprocess.run([sys.executable, str(TOOLS / "fix_blink.py"), cid], check=True)
