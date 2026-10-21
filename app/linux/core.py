"""Linux 数据、资源及状态协议。无 GUI 依赖，供安装器和回归测试复用。"""
import copy
from contextlib import suppress
import json
import math
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
DEFAULTS = {
    "size": 1.0, "textSize": 1.0, "textLinked": True, "showName": True,
    "aura": "auto", "eggs": True, "followApps": True, "followEvents": True,
    "hideFullscreen": True, "edgeDock": True, "powerSave": False,
    "gptQuota": False, "agyQuota": False, "dsQuota": True,
    "quotaAggregate": False, "codexResets": False, "aiAutostart": True,
    "peakStyle": "bar", "peakSkins": {},
    "hideHotkey": "ctrl-alt-p", "layer": "always", "names": {}, "skins": {},
}


def clean_peak_skins(value):
    """和 macOS / Windows 一样：空字符串代表原版，缺少某个时段代表不换。"""
    if not isinstance(value, dict):
        return {}
    result = {}
    for id, entry in value.items():
        if not isinstance(id, str) or not isinstance(entry, dict):
            continue
        skins = {key: entry[key] for key in ("peak", "valley") if isinstance(entry.get(key), str)}
        if skins:
            result[id] = skins
    return result


def read_json(path, fallback=None):
    try:
        if Path(path).stat().st_size > 2_000_000:
            return fallback
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def data_path():
    return Path(os.environ.get("CROSSPET_DATA_DIR") or
                str(Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "crosspet")).resolve()


def config_path():
    return Path(os.environ.get("CROSSPET_CONFIG_DIR") or
                str(Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "crosspet")).resolve()


class Store:
    def __init__(self):
        self.data = data_path()
        self.config = config_path()
        self.state = Path(os.environ.get("CROSSPET_STATE_DIR", "/tmp/crosspet")).resolve()
        self.version = (ROOT / "VERSION").read_text().strip()
        self.settings = copy.deepcopy(DEFAULTS)
        saved = read_json(self.config / "settings.json", {})
        if isinstance(saved, dict):
            self.settings.update(saved)
        for key in ("size", "textSize"):
            value = self.settings[key]
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.6 <= value <= 1.6:
                self.settings[key] = 1.0
        for key in ("names", "skins"):
            if not isinstance(self.settings[key], dict):
                self.settings[key] = {}
        if self.settings["peakStyle"] not in ("bar", "text", "off"):
            self.settings["peakStyle"] = "bar"
        self.settings["peakSkins"] = clean_peak_skins(self.settings["peakSkins"])
        self.stamps = {}

    def prepare(self):
        for p in (self.data, self.config, self.state):
            p.mkdir(parents=True, exist_ok=True)
        # 与原生两端一致：更新内置资源，保留用户新增的角色目录。
        for name in ("web", "characters"):
            shutil.copytree(ROOT / ("app/web" if name == "web" else name), self.data / name,
                            dirs_exist_ok=True, ignore=shutil.ignore_patterns("raw", "__pycache__"))
        shutil.copy2(ROOT / "integrations/crosspet-hook.py", self.data / "crosspet-hook.py")
        write_json(self.data / "launch.json", {"argv": ["/usr/bin/python3", str(ROOT / "app/linux/main.py")]})

    def save(self):
        write_json(self.config / "settings.json", self.settings)

    def manifest(self):
        dirs = sorted((self.data / "characters").glob("*"))
        infos = {p.name: read_json(p / "character.json", {}) for p in dirs if p.is_dir()}
        infos = {k: v for k, v in infos.items() if isinstance(v, dict) and v}
        skins = {}
        for id, info in infos.items():
            if info.get("skinOf"):
                skins.setdefault(info["skinOf"], []).append({"id": id, "name": info.get("skinName", id)})
        chars, choices = {}, []
        for id, original in infos.items():
            if original.get("skinOf"):
                continue
            info = copy.deepcopy(original)
            source = id
            skin = self.settings["skins"].get(id)
            if skin in [s["id"] for s in skins.get(id, [])]:
                source = skin
                info["skin"] = skin
                info["lines"] = {**info.get("lines", {}), **infos[skin].get("lines", {})}
                if "greeting" in infos[skin]:
                    info["greeting"] = infos[skin]["greeting"]
            poses, blink, blink_base = {}, None, None
            for image in sorted((self.data / "characters" / source).iterdir()):
                if image.suffix.lower() not in (".webp", ".png"):
                    continue
                if image.stem == "idle-blink":
                    blink = image.as_uri()
                    continue
                if image.stem == "idle":
                    blink_base = image.as_uri()
                poses.setdefault(image.stem.split("-")[0], []).append(image.as_uri())
            if not (("pop" in poses) if info.get("egg") else ("idle" in poses or "default" in poses)):
                continue
            default_name = info.get("name", id)
            custom = self.settings["names"].get(id, "")
            if custom and not info.get("egg"):
                info["name"] = custom
            info.update(poses=poses, blink=blink, blinkBase=blink_base)
            chars[id] = info
            if not info.get("egg"):
                choice = dict(id=id, name=info.get("name", id), defaultName=default_name, custom=custom)
                if id in skins:
                    choice.update(skins=[{"id": "", "name": info.get("outfit", "原版")}] + skins[id],
                                  skin=skin or "")
                choices.append(choice)
        return {"characters": chars}, choices

    def changes(self, ids):
        """写入中 / 无效 JSON 不记 stamp，下次重试；忽略过期动作，保留额度的来源时间。"""
        for id in [*ids, "current"]:
            for kind in ("state", "sessions", "quota"):
                path = self.state / f"{id}-{kind}.json"
                try:
                    stat = path.stat()
                    stamp = (stat.st_mtime_ns, stat.st_size)
                    if self.stamps.get(path) == stamp:
                        continue
                    if kind == "state" and time.time() - stat.st_mtime > 600:
                        self.stamps[path] = stamp
                        continue
                    obj = read_json(path)
                    if not isinstance(obj, dict):
                        continue
                    self.stamps[path] = stamp
                    yield id, kind, obj
                except OSError:
                    continue


def query_codex(binary, timeout=15, on_process=None):
    """复用现有 app-server JSONL 协议，只保留额度数字，不读取认证文件。"""
    process = subprocess.Popen([binary, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        if on_process:
            on_process(process)
        for msg in ({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "crosspet", "version": "1"}}},
                    {"method": "initialized"}, {"id": 2, "method": "account/rateLimits/read"}):
            process.stdin.write((json.dumps(msg) + "\n").encode())
        process.stdin.flush()
        deadline, buffer = time.monotonic() + timeout, b""
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while time.monotonic() < deadline:
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("Codex 服务提前退出")
                buffer += chunk
                if len(buffer) > 2_000_000:
                    raise RuntimeError("Codex 响应过大")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(msg, dict) or msg.get("id") != 2:
                        continue
                    if msg.get("error"):
                        raise RuntimeError(msg["error"].get("message", "Codex 查询失败"))
                    result = msg.get("result") or {}
                    limits = (result.get("rateLimitsByLimitId") or {}).get("codex") or result.get("rateLimits")
                    if not isinstance(limits, dict):
                        raise RuntimeError("Codex 服务没给额度")
                    return {"source": "live", "at": time.time(), "rateLimits": limits}
        raise TimeoutError("Codex 查询超时")
    finally:
        # npm 启动器可能再起子进程；退出时结束本次查询的进程组。
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        except ProcessLookupError:
            process.wait()
        with suppress(OSError):
            process.stdin.close()
        with suppress(OSError):
            process.stdout.close()
        if on_process:
            on_process(None)


def desktop_entry(argv):
    # Desktop Entry 的 Exec 不是 shell；% 是字段码，必须写成 %%。
    def quote(arg):
        return '"' + str(arg).replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$").replace("%", "%%") + '"'
    return ("[Desktop Entry]\nType=Application\nName=CrossPet\nComment=跨 AI 桌宠\n"
            f"Exec={' '.join(quote(a) for a in argv)}\n"
            f"Icon={ROOT / 'app/icon/AppIcon.png'}\nTerminal=false\nCategories=Utility;\nStartupNotify=false\n")
