"""Codex (GPT) and Antigravity (Gemini) quota sources for CrossPet Linux."""

from __future__ import annotations

import json
import os
import re
import shutil
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def _round_half_away_from_zero(val: float) -> int:
    return int(val + 0.5) if val >= 0 else int(val - 0.5)


def _parse_iso(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    s = raw.strip()
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.astimezone()
        return dt.astimezone()
    except ValueError:
        return None


def _format_reset(dt: datetime) -> str:
    now = datetime.now(dt.tzinfo)
    if (dt - now).total_seconds() < 86400:
        return f"{dt.hour:02d}:{dt.minute:02d}"
    return f"{dt.month}/{dt.day}"


class CodexQuotaSource:
    """Query live Codex usage via `codex app-server` JSON-RPC."""

    cached_binary: str | None = None

    @classmethod
    def find_binary(cls) -> str | None:
        override = os.environ.get("CROSSPET_CODEX_BIN")
        if override:
            return override if (os.path.isfile(override) and os.access(override, os.X_OK)) else None
        if cls.cached_binary and os.path.isfile(cls.cached_binary) and os.access(cls.cached_binary, os.X_OK):
            return cls.cached_binary
        cls.cached_binary = None
        found = shutil.which("codex")
        if found:
            cls.cached_binary = found
            return found
        shell_found = cls.login_shell_which("codex")
        if shell_found and os.path.isfile(shell_found) and os.access(shell_found, os.X_OK):
            cls.cached_binary = shell_found
            return shell_found
        for cand in (
            Path.home() / ".local" / "bin" / "codex",
            Path.home() / ".npm-global" / "bin" / "codex",
            Path("/usr/local/bin/codex"),
            Path("/usr/bin/codex"),
        ):
            if cand.is_file() and os.access(cand, os.X_OK):
                cls.cached_binary = str(cand)
                return cls.cached_binary
        return None

    @staticmethod
    def login_shell_which(name: str) -> str | None:
        shell = os.environ.get("SHELL") or "/bin/bash"
        if not os.path.isfile(shell):
            shell = "/bin/sh"
        try:
            res = subprocess.run(
                [shell, "-lc", f"command -v {name}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode != 0:
                return None
            lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            last = lines[-1] if lines else ""
            return last if last.startswith("/") else None
        except Exception:
            return None

    @staticmethod
    def codex_tick_due(since: float, busy_ago: float | None) -> bool:
        busy = busy_ago is not None and busy_ago < 600.0
        return since >= (55.0 if busy else 115.0)

    @staticmethod
    def query_live(binary: str, timeout: float = 15.0) -> tuple[dict[str, Any] | None, str | None, int]:
        started = time.monotonic()
        try:
            proc = subprocess.Popen(
                [binary, "app-server"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=False,
            )
        except Exception as exc:
            return None, f"起不来 Codex：{exc}", int((time.monotonic() - started) * 1000)

        lock = threading.Lock()
        done_ev = threading.Event()
        result: dict[str, Any] = {"rl": None, "err": None}

        def finish(rl: dict[str, Any] | None, err: str | None) -> None:
            with lock:
                if done_ev.is_set():
                    return
                result["rl"] = rl
                result["err"] = err
                done_ev.set()
            try:
                if proc.poll() is None:
                    proc.terminate()
            except Exception:
                pass

        def reader() -> None:
            assert proc.stdout is not None
            try:
                while not done_ev.is_set():
                    line = proc.stdout.readline()
                    if not line:
                        finish(None, "Codex 服务提前退出")
                        return
                    try:
                        msg = json.loads(line.decode("utf-8", errors="replace"))
                    except ValueError:
                        continue
                    if not isinstance(msg, dict) or msg.get("id") != 2:
                        continue
                    err_obj = msg.get("error")
                    if isinstance(err_obj, dict):
                        finish(None, str(err_obj.get("message") or "Codex 服务返回错误"))
                        return
                    res = msg.get("result")
                    if not isinstance(res, dict):
                        finish(None, "Codex 服务没给额度")
                        return
                    by_id = res.get("rateLimitsByLimitId")
                    rl = None
                    if isinstance(by_id, dict) and isinstance(by_id.get("codex"), dict):
                        rl = by_id["codex"]
                    elif isinstance(res.get("rateLimits"), dict):
                        rl = res["rateLimits"]
                    finish(rl, None if rl is not None else "Codex 服务没给额度")
                    return
            except Exception as exc:
                finish(None, f"读取 Codex 出错：{exc}")

        threading.Thread(target=reader, name="crosspet-codex-read", daemon=True).start()

        def send(obj: dict[str, Any]) -> None:
            if proc.stdin is None:
                return
            try:
                proc.stdin.write((json.dumps(obj) + "\n").encode("utf-8"))
                proc.stdin.flush()
            except OSError:
                pass

        send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "crosspet", "version": "1"}}})
        send({"method": "initialized"})
        send({"id": 2, "method": "account/rateLimits/read"})

        if not done_ev.wait(timeout=timeout):
            finish(None, f"超时（{int(timeout)} 秒没回）")
        try:
            if proc.stdin is not None:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=0.5)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=0.5)
            except Exception:
                pass
        try:
            if proc.stdout is not None:
                proc.stdout.close()
        except Exception:
            pass
        ms = int((time.monotonic() - started) * 1000)
        return result["rl"], result["err"], ms

    @staticmethod
    def brief(rl: dict[str, Any]) -> str:
        parts: list[str] = []
        for k in ("primary", "secondary"):
            w = rl.get(k)
            if not isinstance(w, dict):
                continue
            u = w.get("usedPercent")
            if not isinstance(u, (int, float)) or isinstance(u, bool):
                continue
            mins = int(w.get("windowDurationMins") or 0)
            win = "本周" if mins >= 10080 else "今日" if mins >= 1440 else f"{max(1, mins // 60)}小时"
            parts.append(f"{win}已用 {_round_half_away_from_zero(float(u))}%")
        return "，".join(parts)

    @staticmethod
    def payload(source: str, rate_limits: dict[str, Any] | None, error: str | None, ms: int) -> dict[str, Any]:
        p: dict[str, Any] = {"source": source, "ms": ms, "at": time.time()}
        if rate_limits is not None:
            p["rateLimits"] = rate_limits
        if error is not None:
            p["error"] = error
        return p


class AntigravityQuota:
    """Query local Antigravity daemon quota without touching Google credentials."""

    METHODS = ("RetrieveUserQuotaSummary", "GetUserStatus")

    @staticmethod
    def daemon_dir() -> Path:
        return Path.home() / ".gemini" / "antigravity" / "daemon"

    @staticmethod
    def pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except OSError:
            return False

    @classmethod
    def antigravity_hub(
        cls,
        dir_path: Path,
        alive: Callable[[int], bool] | None = None,
    ) -> tuple[int, str, int | None] | None:
        is_alive = alive or cls.pid_alive
        if not dir_path.is_dir():
            return None
        found: list[tuple[int, str, int | None, float]] = []
        for entry in dir_path.iterdir():
            name = entry.name
            if not (name.startswith("hub_") and name.endswith(".json")):
                continue
            try:
                obj = json.loads(entry.read_text(encoding="utf-8"))
                if not isinstance(obj, dict):
                    continue
                pid_raw = obj.get("pid")
                if not isinstance(pid_raw, (int, float)) or isinstance(pid_raw, bool):
                    continue
                pid = int(pid_raw)
                if not is_alive(pid):
                    continue
                token = obj.get("csrfToken")
                if not isinstance(token, str) or not token:
                    continue
                port_raw = obj.get("httpsPort")
                port = int(port_raw) if isinstance(port_raw, (int, float)) and not isinstance(port_raw, bool) else None
                mtime = entry.stat().st_mtime
                found.append((pid, token, port, mtime))
            except (OSError, ValueError):
                continue
        if not found:
            return None
        best = max(found, key=lambda x: x[3])
        return best[0], best[1], best[2]

    @staticmethod
    def antigravity_server() -> tuple[int, str] | None:
        """Fallback for older Antigravity versions passing --csrf_token in cmdline."""
        try:
            for entry in os.scandir("/proc"):
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                try:
                    raw = (Path(entry.path) / "cmdline").read_bytes()
                except OSError:
                    continue
                args = [a.decode("utf-8", errors="ignore") for a in raw.split(b"\x00") if a]
                if not args:
                    continue
                joined = " ".join(args)
                if "language_server" not in joined or "antigravity" not in joined.lower():
                    continue
                for i, arg in enumerate(args):
                    if arg.startswith("--csrf_token="):
                        return pid, arg[len("--csrf_token="):]
                    if arg == "--csrf_token" and i + 1 < len(args):
                        return pid, args[i + 1]
        except OSError:
            pass
        return None

    @staticmethod
    def listening_ports(pid: int) -> list[int]:
        ports: list[int] = []
        if shutil.which("ss"):
            try:
                res = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=2)
                marker = f"pid={pid},"
                marker_end = f"pid={pid})"
                for line in res.stdout.splitlines():
                    if marker not in line and marker_end not in line:
                        continue
                    m = re.search(r"127\.0\.0\.1:(\d+)", line)
                    if m:
                        p = int(m.group(1))
                        if p not in ports:
                            ports.append(p)
            except Exception:
                pass
        return ports

    @classmethod
    def query_ports(cls, pid: int, token: str, ports: list[int]) -> tuple[dict[str, Any] | None, int | None]:
        """Try each port with RetrieveUserQuotaSummary then GetUserStatus."""
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        body = b'{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}'
        for port in ports:
            url_base = f"https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService"
            for method in cls.METHODS:
                req = urllib.request.Request(
                    f"{url_base}/{method}",
                    data=body,
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "X-Codeium-Csrf-Token": token,
                    },
                )
                try:
                    with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
                        if resp.status != 200:
                            continue
                        obj = json.loads(resp.read().decode("utf-8"))
                        parsed = cls.antigravity_parse(obj)
                        if parsed:
                            return parsed, port
                except (urllib.error.URLError, OSError, ValueError):
                    continue
        return None, None

    @classmethod
    def antigravity_parse(cls, obj: Any) -> dict[str, Any] | None:
        return cls.antigravity_summary(obj) or cls.antigravity_quota(obj)

    @staticmethod
    def antigravity_summary(obj: Any) -> dict[str, Any] | None:
        if not isinstance(obj, dict):
            return None
        resp = obj.get("response")
        if not isinstance(resp, dict):
            return None
        groups = resp.get("groups")
        if not isinstance(groups, list):
            return None

        def piece(label: str, left: float, reset: datetime | None) -> str:
            s = f"{label} 剩余 {_round_half_away_from_zero(left * 100)}%"
            if reset is not None:
                s += f" · {_format_reset(reset)} 重置"
            return s

        rows: list[tuple[str, float, datetime | None]] = []
        bars: list[dict[str, Any]] = []
        indexed = list(enumerate(groups))
        indexed.sort(key=lambda item: (0 if "Gemini" in str((item[1] or {}).get("displayName") or "") else 1, item[0]))

        win_names = {"weekly": "本周", "daily": "今日", "5h": "5小时"}
        win_order = {"5h": 0, "daily": 1, "weekly": 2}

        for _, g in indexed:
            if not isinstance(g, dict):
                continue
            title = str(g.get("displayName") or "")
            is_gemini = title.lower() == "gemini models"
            is_gpt = (not is_gemini) and ("Claude" in title or "GPT" in title)
            name = "Gemini" if is_gemini else "Claude/GPT" if is_gpt else title
            buckets = g.get("buckets")
            if not isinstance(buckets, list):
                buckets = []
            cands: list[tuple[str, str, float, datetime | None]] = []
            for b in buckets:
                if not isinstance(b, dict):
                    continue
                rf = b.get("remainingFraction")
                left = float(rf) if isinstance(rf, (int, float)) and not isinstance(rf, bool) else 0.0
                win = str(b.get("window") or "")
                disp = b.get("displayName")
                window = win_names.get(win) or (disp if isinstance(disp, str) and disp else win)
                reset = _parse_iso(b.get("resetTime"))
                cands.append((win, window, left, reset))

            if not cands:
                continue

            tightest = cands[0]
            for c in cands[1:]:
                if c[2] < tightest[2]:
                    tightest = c
                elif c[2] == tightest[2]:
                    c_ts = c[3].timestamp() if c[3] else float("-inf")
                    t_ts = tightest[3].timestamp() if tightest[3] else float("-inf")
                    if c_ts > t_ts:
                        tightest = c

            five = next((c for c in cands if c[0] == "5h"), None)
            pick = five if (tightest[2] > 0.1 and five is not None and five[2] < 1.0) else tightest
            row_label = f"{name} {pick[1]}" if len(cands) > 1 else name
            rows.append((row_label, pick[2], pick[3]))

            pool = "Gemini" if is_gemini else "Claude/GPT" if is_gpt else re.sub(r"^Gemini\s+(\d+\s+)?", "", title)
            for c in sorted(cands, key=lambda x: win_order.get(x[0], 3)):
                bar: dict[str, Any] = {"label": f"{pool} {c[1]}", "left": c[2], "group": pool}
                if c[3] is not None:
                    bar["reset"] = int(c[3].timestamp())
                bars.append(bar)

        if not rows:
            return None
        return {
            "text": " ｜ ".join(piece(l, lf, r) for l, lf, r in rows),
            "low": min(r[1] for r in rows) <= 0.1,
            "bars": bars,
        }

    @staticmethod
    def antigravity_quota(obj: Any) -> dict[str, Any] | None:
        if not isinstance(obj, dict):
            return None
        st = obj.get("userStatus")
        if not isinstance(st, dict):
            return None
        cfg = st.get("cascadeModelConfigData")
        if not isinstance(cfg, dict):
            return None
        models = cfg.get("clientModelConfigs")
        if not isinstance(models, list):
            return None

        groups: list[dict[str, Any]] = []
        for m in models:
            if not isinstance(m, dict):
                continue
            qi = m.get("quotaInfo")
            if not isinstance(qi, dict):
                continue
            if m.get("disabled") is True or (qi.get("remainingFraction") is None and qi.get("resetTime") is None):
                continue
            rf = qi.get("remainingFraction")
            left = float(rf) if isinstance(rf, (int, float)) and not isinstance(rf, bool) else 0.0
            reset = _parse_iso(qi.get("resetTime"))
            label = str(m.get("label") or "")
            name = "Gemini" if label.startswith("Gemini") else "Claude/GPT"
            existing = next((g for g in groups if g["name"] == name), None)
            if existing is not None:
                if left < existing["left"]:
                    existing["left"] = left
                    existing["reset"] = reset or existing["reset"]
            else:
                groups.append({"name": name, "left": left, "reset": reset})

        if not groups:
            return None
        groups.sort(key=lambda g: 0 if g["name"] == "Gemini" else 1)
        min_left = min(g["left"] for g in groups)
        parts: list[str] = []
        for i, g in enumerate(groups):
            piece = f"{g['name']} 剩余 {_round_half_away_from_zero(g['left'] * 100)}%"
            if (i == 0 or g["left"] <= 0.1) and g["reset"] is not None:
                piece += f" · {_format_reset(g['reset'])} 重置"
            parts.append(piece)
        return {"text": " ｜ ".join(parts), "low": min_left <= 0.1}
