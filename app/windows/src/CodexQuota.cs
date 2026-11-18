using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace CrossPet
{
    /// <summary>
    /// GPT（Codex）额度来源，和 macOS 版 CodexQuotaSource 同一套规则（docs/superpowers/specs/2026-10-12-codex-quota-design.md）：
    /// 起 `codex app-server` 问 account/rateLimits/read（Codex 用自己的登录查实时额度，不对话、不耗额度；CrossPet 不碰凭据）。
    /// Windows 这边的 Codex 问不到（没装、没登录）时，WSL 开着的话在 WSL 里问。
    /// 不再读会话记录：Codex 回复了也不一定往里写额度，读出来的常常是旧数还看着像新的（1.3.3 测试里实测）。
    /// 排版在网页 codex-quota.js 里做，这里只交原始数据
    /// </summary>
    static class CodexQuota
    {
        static string cached;

        public static string FindBinary()
        {
            var o = Environment.GetEnvironmentVariable("CROSSPET_CODEX_BIN");
            if (!string.IsNullOrEmpty(o)) return File.Exists(o) ? o : null;
            if (cached != null && File.Exists(cached)) return cached;
            cached = null;
            // Codex 桌面版开着时，它自带的命令行 codex.exe 在跑：用它（装在受保护目录里也能拿到路径），记下来下次直接用。
            // 桌面版的图形界面程序可能也叫 Codex.exe（名字不分大小写），起它会弹窗口：认出来跳过
            try
            {
                foreach (var p in Process.GetProcessesByName("codex"))
                    using (p)
                        try
                        {
                            var f = p.MainModule?.FileName;
                            if (f == null || !File.Exists(f) || !LooksLikeCli(f)) continue;
                            if (SavedBin() != f) OnUi(() => { Store.Settings["codexBin"] = f; Store.SaveSettings(); });
                            return cached = f;
                        }
                        catch { }
            }
            catch { }
            var saved = SavedBin();
            if (saved != null)
            {
                if (File.Exists(saved) && LooksLikeCli(saved)) return cached = saved;
                OnUi(() => { Store.Settings.Remove("codexBin"); Store.SaveSettings(); });
            }
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
                foreach (var name in new[] { "codex.exe", "codex.cmd" })
                    try { var f = Path.Combine(dir.Trim(), name); if (File.Exists(f)) return cached = f; } catch { }
            var npm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "codex.cmd");
            return File.Exists(npm) ? cached = npm : null;
        }

        // FindBinary 在后台线程跑：设置只在界面线程改，这里读的时候出错就当没有
        static string SavedBin() { try { return Store.Settings.TryGetValue("codexBin", out var v) ? v as string : null; } catch { return null; } }
        static void OnUi(Action a) { try { System.Windows.Application.Current?.Dispatcher.BeginInvoke(a); } catch { } }

        /// 图形界面程序（Electron 做的桌面版）旁边有这些文件；命令行 codex.exe 旁边没有
        static bool LooksLikeCli(string exe)
        {
            var dir = Path.GetDirectoryName(exe) ?? "";
            return !(File.Exists(Path.Combine(dir, "resources.pak")) || File.Exists(Path.Combine(dir, "ffmpeg.dll"))
                     || File.Exists(Path.Combine(dir, "icudtl.dat")) || File.Exists(Path.Combine(dir, "chrome_100_percent.pak")));
        }

        /// 起不来时调：程序可能被更新挪走了，下次重新找
        public static void Forget() { cached = null; }

        /// 结束整棵进程树：npm 装的 codex.cmd 是 cmd.exe → node.exe → codex.exe，.NET Framework 的 Kill 只杀最外面一层
        static void KillTree(Process p)
        {
            try
            {
                if (p.HasExited) return;
                using (var k = Process.Start(new ProcessStartInfo("taskkill.exe", $"/T /F /PID {p.Id}") { UseShellExecute = false, CreateNoWindow = true }))
                    k?.WaitForExit(3000);
            }
            catch { }
            try { if (!p.HasExited) p.Kill(); } catch { }
        }

        public static Task<(Dictionary<string, object> rateLimits, string error, int ms)> QueryLive(string binary, int timeoutMs = 15000)
        {
            var cmd = binary.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase);
            return Query(cmd ? "cmd.exe" : binary, cmd ? $"/d /s /c \"\"{binary}\" app-server\"" : "app-server", timeoutMs);
        }

        static async Task<(Dictionary<string, object> rateLimits, string error, int ms)> Query(string file, string args, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            var psi = new ProcessStartInfo
            {
                FileName = file, Arguments = args,
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
            };
            Process p;
            try { p = Process.Start(psi); } catch (Exception e) { return (null, "起不来 Codex：" + e.Message, (int)sw.ElapsedMilliseconds); }
            StreamWriter stdin = null;
            try
            {
                p.ErrorDataReceived += (_, __) => { }; p.BeginErrorReadLine();   // 不读 stderr 会把管道塞满
                stdin = new StreamWriter(p.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
                stdin.WriteLine("{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"crosspet\",\"version\":\"1\"}}}");
                stdin.WriteLine("{\"method\":\"initialized\"}");
                stdin.WriteLine("{\"id\":2,\"method\":\"account/rateLimits/read\"}");
                var read = Task.Run(() =>
                {
                    string line;
                    while ((line = p.StandardOutput.ReadLine()) != null)
                    {
                        Dictionary<string, object> msg;
                        try { msg = Store.Json.DeserializeObject(line) as Dictionary<string, object>; } catch { continue; }
                        if (msg == null || !(msg.TryGetValue("id", out var id) && Convert.ToString(id) == "2")) continue;
                        if (msg.TryGetValue("error", out var e) && e is Dictionary<string, object> ed)
                            return ((Dictionary<string, object>)null, ed.TryGetValue("message", out var m) ? m as string ?? "Codex 服务返回错误" : "Codex 服务返回错误");
                        var r = msg.TryGetValue("result", out var rv) ? rv as Dictionary<string, object> : null;
                        Dictionary<string, object> rl = null;
                        if (r != null && r.TryGetValue("rateLimitsByLimitId", out var by) && by is Dictionary<string, object> byd && byd.TryGetValue("codex", out var c)) rl = c as Dictionary<string, object>;
                        if (rl == null && r != null && r.TryGetValue("rateLimits", out var rr)) rl = rr as Dictionary<string, object>;
                        return (rl, rl == null ? "Codex 服务没给额度" : null);
                    }
                    return ((Dictionary<string, object>)null, "Codex 服务提前退出");
                });
                var winner = await Task.WhenAny(read, Task.Delay(timeoutMs));
                if (winner != read) return (null, $"超时（{timeoutMs / 1000} 秒没回）", (int)sw.ElapsedMilliseconds);
                var (rl2, err) = read.Result;
                return (rl2, err, (int)sw.ElapsedMilliseconds);
            }
            catch (Exception e) { return (null, "问 Codex 出错：" + e.Message, (int)sw.ElapsedMilliseconds); }
            finally
            {
                // 先关输入请它自己退出，5 秒还没退再强杀整棵树（为什么不直接强杀见 ProcessStop，#48）。
                // 等它退出放到后台，额度先交给网页，不多等这几秒
                var w = stdin;
                _ = Task.Run(() =>
                {
                    ProcessStop.Stop(p, () => { if (w != null) w.Dispose(); else p.StandardInput.Close(); }, 5000, KillTree);
                    p.Dispose();
                });
            }
        }

        /// 给网页的 payload（rateLimits 原样，不含账号标识——accountId 在 result 里，不在 rateLimits 里）
        public static Dictionary<string, object> Payload(string source, Dictionary<string, object> rateLimits, string error, int ms)
        {
            var d = new Dictionary<string, object> { ["source"] = source, ["ms"] = ms, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() };
            if (rateLimits != null) d["rateLimits"] = rateLimits;
            if (error != null) d["error"] = error;
            return d;
        }

        /// 运行状态里的简写：5小时已用 3%，本周已用 40%
        public static string Brief(Dictionary<string, object> rl)
        {
            var parts = new List<string>();
            foreach (var k in new[] { "primary", "secondary" })
            {
                if (!(rl.TryGetValue(k, out var w) && w is Dictionary<string, object> win)) continue;
                var used = win.TryGetValue("usedPercent", out var u) ? u : null;
                var mins = win.TryGetValue("windowDurationMins", out var m) ? m : null;
                if (!IsNumber(used)) continue;
                var mm = IsNumber(mins) ? Convert.ToInt32(mins) : 0;
                parts.Add($"{(mm >= 10080 ? "本周" : mm >= 1440 ? "今日" : $"{Math.Max(1, mm / 60)}小时")}已用 {(int)Math.Round(Convert.ToDouble(used), MidpointRounding.AwayFromZero)}%");
            }
            return string.Join("，", parts);
        }

        // ---------------- WSL 里的 Codex ----------------
        // 在 WSL 里用 Codex 的人（含 Codex 桌面版「在 WSL 里运行」），登录状态在 WSL 那边，Windows 这边问不到：
        // 通过 wsl.exe 在 WSL 里起 `codex app-server` 问。只在 WSL 已经开着时问（不把它拉起来，WSL 没开也不可能正在用它）；
        // 在哪个发行版、codex 在哪，找一次缓存 10 分钟
        static (string distro, string codex) wsl;
        static DateTime wslCheckedAt = DateTime.MinValue;
        public static string WslNote = "";

        public static async Task<(Dictionary<string, object> rateLimits, string error, int ms)> QueryWsl(int timeoutMs = 15000)
        {
            var (distro, codex) = FindWslCodex();
            if (distro == null) return (null, null, 0);   // 没有开着的 WSL / WSL 里没有 codex：不算出错
            // bash -lic：登录 + 交互，npm / nvm 装的 codex 才在 PATH 里；.bashrc 往输出里打的东西会被当成非 JSON 跳过
            return await Query("wsl.exe", $"-d {distro} -e bash -lic \"exec '{codex}' app-server\"", timeoutMs);
        }

        static (string distro, string codex) FindWslCodex()
        {
            if (!(Running("vmmemWSL") || Running("vmmem"))) { WslNote = ""; return (null, null); }
            if ((DateTime.UtcNow - wslCheckedAt).TotalMinutes < 10) return wsl;
            wslCheckedAt = DateTime.UtcNow; wsl = (null, null); WslNote = "";
            foreach (var d in Run("wsl.exe", "-l --running -q", Encoding.Unicode).Replace("\0", "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).Where(x => x.Length > 0))
            {
                var path = Run("wsl.exe", $"-d {d} -e bash -lic \"command -v codex\"", Encoding.UTF8)
                    .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).LastOrDefault(x => x.StartsWith("/"));
                if (path == null) continue;
                wsl = (d, path); WslNote = $"WSL {d}";
                break;
            }
            return wsl;
        }

        /// 跑一个小命令拿输出（最多等 8 秒）
        static string Run(string file, string args, Encoding enc)
        {
            try
            {
                var psi = new ProcessStartInfo(file, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = enc };
                using (var p = Process.Start(psi))
                {
                    p.ErrorDataReceived += (_, __) => { }; p.BeginErrorReadLine();
                    var t = p.StandardOutput.ReadToEndAsync();
                    if (!p.WaitForExit(8000)) KillTree(p);
                    return t.Wait(1000) ? t.Result : "";
                }
            }
            catch { return ""; }
        }

        static bool Running(string name)
        {
            var ps = Process.GetProcessesByName(name);
            foreach (var p in ps) p.Dispose();
            return ps.Length > 0;
        }

        static bool IsNumber(object v) => v is int || v is long || v is double || v is decimal;
    }
}
