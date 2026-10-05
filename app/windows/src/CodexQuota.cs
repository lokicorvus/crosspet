using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace CrossPet
{
    /// <summary>
    /// GPT 额度（可选，默认关）：读 Codex 会话记录里最后一条 rate_limits，只取额度数字，不读也不保存对话内容。
    /// 和 macOS 版 codexQuota() 同一套规则：剩余百分比、按窗口长度标「5小时 / 今日 / 本周」、重置时间标在用得最多的窗口上。
    /// </summary>
    static class CodexQuota
    {
        /// <summary>最近 4 天的 Codex 会话记录，新的在前</summary>
        static List<FileInfo> SessionFiles()
        {
            var files = new List<FileInfo>();
            for (int back = 0; back < 4; back++)
            {
                var day = DateTime.Now.AddDays(-back);
                var dir = Path.Combine(Store.Codex, "sessions", day.ToString("yyyy"), day.ToString("MM"), day.ToString("dd"));
                try { files.AddRange(new DirectoryInfo(dir).GetFiles("*.jsonl")); } catch { }
            }
            return files.OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        }

        public static Dictionary<string, object> Read()
        {
            // 从最新的会话往前找：刚开的会话可能还没有额度记录
            foreach (var f in SessionFiles().Take(8))
            {
                var q = FromFile(f.FullName);
                if (q != null) return q;
            }
            return null;
        }

        // ---- Codex 提问还挂着吗 ----
        // Codex 提问（request_user_input）不触发钩子，而且是异步的：问题一发出这一轮就算结束，你的回答是下一条新消息。
        // 所以看会话记录：最近一次提问之后还没开始新的一轮，并且提问还没返回、或者返回后这一轮已经结束 → 在等你回答。
        // 只读每条记录的类型、工具名、编号和时间，不读问题、选项和对话内容。和 GPT 额度共用一个开关，默认关。和 macOS 版一样。
        static (string path, DateTime stamp, long size, DateTime? askAt, bool pending) cache;

        public static bool QuestionPending()
        {
            var f = SessionFiles().FirstOrDefault();
            if (f == null) return false;
            if (cache.path != f.FullName || cache.stamp != f.LastWriteTimeUtc || cache.size != f.Length)
            {
                var (askAt, pending) = Scan(f.FullName);
                cache = (f.FullName, f.LastWriteTimeUtc, f.Length, askAt, pending);
            }
            // 超过 15 分钟没回答的不算（比如点了「跳过」），免得一直挂着
            return cache.pending && cache.askAt is DateTime t && (DateTime.UtcNow - t).TotalMinutes < 15;
        }

        static (DateTime?, bool) Scan(string path)
        {
            string text;
            try
            {
                using (var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var n = (int)Math.Min(s.Length, 512_000);
                    s.Seek(-n, SeekOrigin.End);
                    var buf = new byte[n]; var read = 0;
                    while (read < n) { var r = s.Read(buf, read, n - read); if (r <= 0) break; read += r; }
                    text = Encoding.UTF8.GetString(buf, 0, read);
                }
            }
            catch { return (null, false); }
            string askId = null; DateTime? askAt = null; bool answered = false, ended = false, newTurn = false;
            foreach (var line in text.Split('\n'))
            {
                // 先用字符串粗筛，只解析可能相关的几种记录
                if (!(line.Contains("request_user_input") || line.Contains("task_started") || line.Contains("task_complete")
                      || (askId != null && line.Contains("function_call_output")))) continue;
                Dictionary<string, object> o;
                try { o = Store.Json.DeserializeObject(line) as Dictionary<string, object>; } catch { continue; }
                if (!(o != null && o.TryGetValue("payload", out var pl) && pl is Dictionary<string, object> p && p.TryGetValue("type", out var ty) && ty is string type)) continue;
                switch (type)
                {
                    case "function_call":
                    case "custom_tool_call":
                        if ((p.TryGetValue("name", out var nm) ? nm as string ?? "" : "").Contains("request_user_input"))
                        {
                            askId = p.TryGetValue("call_id", out var id) ? id as string : null;
                            askAt = o.TryGetValue("timestamp", out var ts) && ts is string tss && DateTime.TryParse(tss, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d : DateTime.UtcNow;
                            answered = ended = newTurn = false;
                        }
                        break;
                    case "function_call_output":
                    case "custom_tool_call_output":
                        if (askId != null && p.TryGetValue("call_id", out var cid) && cid as string == askId) answered = true;
                        break;
                    case "task_complete": if (askId != null) ended = true; break;
                    case "task_started": if (askId != null) newTurn = true; break;
                }
            }
            return (askAt, askId != null && !newTurn && (!answered || ended));
        }

        static Dictionary<string, object> FromFile(string path)
        {
            string text;
            try
            {
                using (var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var n = (int)Math.Min(s.Length, 1_000_000);
                    s.Seek(-n, SeekOrigin.End);
                    var buf = new byte[n]; var read = 0;
                    while (read < n) { var r = s.Read(buf, read, n - read); if (r <= 0) break; read += r; }
                    text = Encoding.UTF8.GetString(buf, 0, read);  // 截断处切到中文也不怕：坏的字节变成替换符
                }
            }
            catch { return null; }

            foreach (var line in text.Split('\n').Reverse())
            {
                if (!line.Contains("\"rate_limits\"")) continue;
                Dictionary<string, object> rl;
                try { rl = Find(Store.Json.DeserializeObject(line)); } catch { continue; }
                if (rl == null) continue;
                var windows = new List<(string label, double used, double reset)>();
                foreach (var key in new[] { "primary", "secondary" })
                {
                    if (!(rl.TryGetValue(key, out var w) && w is Dictionary<string, object> win)) continue;
                    if (!win.TryGetValue("used_percent", out var u) || !IsNumber(u)) continue;
                    var minutes = win.TryGetValue("window_minutes", out var m) && IsNumber(m) ? Convert.ToInt32(m) : 0;
                    var label = minutes >= 7 * 24 * 60 ? "本周" : minutes >= 24 * 60 ? "今日" : $"{Math.Max(1, minutes / 60)}小时";
                    var reset = win.TryGetValue("resets_at", out var r) && IsNumber(r) ? Convert.ToDouble(r) : 0;
                    windows.Add((label, Convert.ToDouble(u), reset));
                }
                if (windows.Count == 0) continue;
                var maxUsed = windows.Max(w => w.used);
                var marked = false;
                var parts = windows.Select(w =>
                {
                    var piece = $"{w.label} 剩余 {Math.Max(0, 100 - (int)Math.Round(w.used))}%";
                    if (!marked && w.used == maxUsed && w.reset > 0)
                    {
                        marked = true;
                        var d = DateTimeOffset.FromUnixTimeSeconds((long)w.reset).LocalDateTime;
                        piece += $" · {((d - DateTime.Now).TotalHours < 24 ? d.ToString("HH:mm") : $"{d.Month}/{d.Day}")} 重置";
                    }
                    return piece;
                });
                return new Dictionary<string, object>
                {
                    ["text"] = string.Join(" ｜ ", parts),
                    ["low"] = maxUsed >= 90,
                    // 给桌宠比对用：某个窗口在预定重置时间前突然恢复一大截 → 播 reset 动画
                    ["windows"] = windows.Select(w => new Dictionary<string, object> { ["label"] = w.label, ["used"] = w.used, ["reset"] = w.reset }).ToList(),
                };
            }
            return null;
        }

        static bool IsNumber(object v) => v is int || v is long || v is double || v is decimal;

        static Dictionary<string, object> Find(object o)
        {
            if (o is Dictionary<string, object> d)
            {
                if (d.TryGetValue("rate_limits", out var rl) && rl is Dictionary<string, object> r) return r;
                foreach (var v in d.Values) { var f = Find(v); if (f != null) return f; }
            }
            else if (o is object[] arr) foreach (var v in arr) { var f = Find(v); if (f != null) return f; }
            return null;
        }
    }
}
