using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace CrossPet
{
    /// <summary>小本子补算：从各 AI 程序在本机的对话记录里抽「精简事件」，只读时间和模型名，不读、不留对话内容。
    /// 格式见 app/web/notebook-backfill.js：{ t, k: "p" } 你发了一句、{ t, k: "a", m } 她回了一句、{ t, k: "r", m, end } 一整轮（Codex）。
    /// 规则照抄 app/mac/NotebookScan.swift，夹具 tests/fixtures/notebook 两边共用（tests/windows/LogicTests 比 expected.json）。
    /// 只依赖 BCL：JSON 解析由调用方给（外壳用 JavaScriptSerializer，LogicTests 用 System.Text.Json 转成同样的形状）</summary>
    static class NotebookScan
    {
        /// <summary>解析一行 JSON：对象 → Dictionary&lt;string, object&gt;，数组 → object[]，数字 → int / long / decimal；坏的行抛异常或返回别的</summary>
        public delegate object Parse(string json);

        static Dictionary<string, object> Obj(Parse parse, string line)
        {
            try { return parse(line) as Dictionary<string, object>; } catch { return null; }
        }
        static object Get(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) ? v : null;
        static bool IsTrue(object v) => v is bool b && b;

        public static long? Millis(object s)
        {
            if (!(s is string str)) return null;
            if (!DateTimeOffset.TryParse(str, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var d)) return null;
            return d.ToUnixTimeMilliseconds();
        }
        static long? Number(object v)
        {
            switch (v)
            {
                case int i: return i;
                case long l: return l;
                case decimal m: return (long)Math.Round(m);
                case double d: return (long)Math.Round(d);
                default: return null;
            }
        }

        // ---------------- Claude Code：~/.claude/projects/<项目>/<会话>.jsonl ----------------

        /// <summary>你发的一句：文字（不以 &lt; 开头，那是命令、系统插进来的）；只有工具结果的不算。她回的一句：带模型名、不是 &lt;synthetic&gt;</summary>
        public static Dictionary<string, object> ClaudeEvent(Dictionary<string, object> d)
        {
            if (d == null || IsTrue(Get(d, "isSidechain")) || IsTrue(Get(d, "isMeta"))) return null;
            var t = Millis(Get(d, "timestamp"));
            if (t == null || !(Get(d, "message") is Dictionary<string, object> msg)) return null;
            switch (Get(d, "type") as string)
            {
                case "user":
                    var content = Get(msg, "content");
                    if (content is string s) return s.StartsWith("<", StringComparison.Ordinal) ? null : new Dictionary<string, object> { ["t"] = t.Value, ["k"] = "p" };
                    if (!(content is object[] arr)) return null;
                    var parts = arr.OfType<Dictionary<string, object>>().ToList();
                    if (parts.Count != arr.Length) return null;   // Mac：不是对象数组就不算
                    if (parts.Any(p => Get(p, "type") as string == "tool_result")) return null;
                    var texts = parts.Where(p => Get(p, "type") as string == "text").Select(p => Get(p, "text") as string).Where(x => x != null);
                    return texts.Any(x => !x.StartsWith("<", StringComparison.Ordinal)) ? new Dictionary<string, object> { ["t"] = t.Value, ["k"] = "p" } : null;
                case "assistant":
                    if (!(Get(msg, "model") is string m) || m == "" || m == "<synthetic>") return null;
                    return new Dictionary<string, object> { ["t"] = t.Value, ["k"] = "a", ["m"] = m };
                default:
                    return null;
            }
        }

        /// <summary>先按文字粗筛再解析 JSON：工具结果那几行又多又大，解析它们占了大半时间（同 Mac）</summary>
        public static bool ClaudeWanted(string line)
        {
            if (line.Contains("\"type\":\"assistant\"")) return true;
            return line.Contains("\"type\":\"user\"") && !line.Contains("\"tool_result\"");
        }

        public static List<Dictionary<string, object>> ClaudeEvents(IEnumerable<string> lines, Parse parse)
        {
            var out_ = new List<Dictionary<string, object>>();
            foreach (var line in lines)
            {
                if (!ClaudeWanted(line)) continue;
                var e = ClaudeEvent(Obj(parse, line));
                if (e != null) out_.Add(e);
            }
            return out_;
        }

        // ---------------- Codex：~/.codex/sessions/**/*.jsonl ----------------

        /// <summary>turn_context 记下模型；task_complete / turn_aborted（被打断也算一轮）带 duration_ms 的是一整轮</summary>
        public static List<Dictionary<string, object>> CodexEvents(IEnumerable<string> lines, Parse parse)
        {
            var model = "";
            var out_ = new List<Dictionary<string, object>>();
            foreach (var line in lines)
            {
                var d = Obj(parse, line);
                if (!(Get(d, "payload") is Dictionary<string, object> p)) continue;
                var type = Get(d, "type") as string;
                if (type == "turn_context") { if (Get(p, "model") is string m) model = m; continue; }
                var pt = Get(p, "type") as string;
                if (type != "event_msg" || (pt != "task_complete" && pt != "turn_aborted")) continue;
                var end = Millis(Get(d, "timestamp"));
                var dur = Number(Get(p, "duration_ms"));
                if (end == null || dur == null) continue;
                out_.Add(new Dictionary<string, object> { ["t"] = end.Value - dur.Value, ["k"] = "r", ["m"] = model, ["end"] = end.Value });
            }
            return out_;
        }

        // ---------------- 全部 ----------------

        /// <summary>一行一行读（流式，大文件不整个读进内存）；AI 程序正写着的文件也能读</summary>
        static IEnumerable<string> Lines(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(fs, new UTF8Encoding(false)))
            {
                string line;
                while ((line = r.ReadLine()) != null) if (line.Length > 0) yield return line;
            }
        }

        static List<string> JsonlFiles(string dir, bool recursive)
        {
            var out_ = new List<string>();
            try
            {
                if (!Directory.Exists(dir)) return out_;
                if (recursive) out_.AddRange(Directory.EnumerateFiles(dir, "*.jsonl", SearchOption.AllDirectories));
                else
                    // projects/<项目>/<会话>.jsonl：只两层，不进子文件夹（子代理的记录在里面）
                    foreach (var p in Directory.EnumerateDirectories(dir))
                        out_.AddRange(Directory.EnumerateFiles(p, "*.jsonl", SearchOption.TopDirectoryOnly));
            }
            catch { }
            // EnumerateFiles 的 *.jsonl 在 Windows 上也会配到 .jsonlx 这种（8.3 短名规则），再按扩展名筛一次
            return out_.Where(f => string.Equals(Path.GetExtension(f), ".jsonl", StringComparison.OrdinalIgnoreCase))
                       .OrderBy(f => f, StringComparer.Ordinal).ToList();
        }

        static List<Dictionary<string, object>> Read(List<string> files, Func<IEnumerable<string>, List<Dictionary<string, object>>> parse)
        {
            var out_ = new List<Dictionary<string, object>>();
            foreach (var f in files)
            {
                try { out_.AddRange(parse(Lines(f))); }
                catch { }   // 读到一半被删了、没权限：跳过这个文件
            }
            return out_;
        }

        /// <summary>[{ source, events }]。CLAUDE_CONFIG_DIR / CODEX_HOME 设了就用它，没设用 home 下的 .claude / .codex；文件夹不存在就是空的</summary>
        public static List<Dictionary<string, object>> ScanAll(string home, Parse parse, IDictionary<string, string> env = null)
        {
            string Env(string k)
            {
                if (env != null) return env.TryGetValue(k, out var v) && !string.IsNullOrEmpty(v) ? v : null;
                var e = Environment.GetEnvironmentVariable(k);
                return string.IsNullOrEmpty(e) ? null : e;
            }
            var claude = Env("CLAUDE_CONFIG_DIR") ?? Path.Combine(home, ".claude");
            var codex = Env("CODEX_HOME") ?? Path.Combine(home, ".codex");
            return new List<Dictionary<string, object>>
            {
                new Dictionary<string, object> { ["source"] = "claude-code", ["events"] = Read(JsonlFiles(Path.Combine(claude, "projects"), false), ls => ClaudeEvents(ls, parse)) },
                new Dictionary<string, object> { ["source"] = "codex", ["events"] = Read(JsonlFiles(Path.Combine(codex, "sessions"), true), ls => CodexEvents(ls, parse)) },
            };
        }
    }
}
