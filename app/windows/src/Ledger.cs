using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace CrossPet
{
    /// <summary>记录文件（反馈用）：一行一个 JSON，只留最近 200 行（超过 240 行时截回 200）。
    /// 桌宠处理记录 events\pet.jsonl、换角色记录 switches.jsonl 都用它；格式见 docs/架构.md「记录」。
    /// 自己拼 JSON（值只有字符串、数字、布尔）：外壳是 .NET Framework、测试是 .NET 8，两边没有共用的 JSON 库。写不了就算了，不影响桌宠</summary>
    static class Ledger
    {
        public static string Line(IDictionary<string, object> line)
        {
            var row = new Dictionary<string, object>(line) { ["t"] = Math.Round(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0, 2) };
            return "{" + string.Join(",", row.Select(kv => Str(kv.Key) + ":" + Value(kv.Value))) + "}";
        }

        public static void Append(string path, IDictionary<string, object> line, int keep = 200)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.AppendAllText(path, Line(line) + "\n", new UTF8Encoding(false));
                var rows = File.ReadAllLines(path).Where(l => l.Trim() != "").ToArray();
                if (rows.Length > 240) File.WriteAllText(path, string.Join("\n", rows.Skip(rows.Length - keep)) + "\n", new UTF8Encoding(false));
            }
            catch { }
        }

        /// <summary>文件最后 n 行（没有文件返回空串）</summary>
        public static string Tail(string path, int n)
        {
            try { return File.Exists(path) ? string.Join("\n", File.ReadAllLines(path).Reverse().Take(n).Reverse()) : ""; } catch { return ""; }
        }

        static string Value(object v) =>
            v == null ? "null" : v is bool b ? (b ? "true" : "false")
            : v is int || v is long || v is double || v is float || v is decimal ? Convert.ToString(v, CultureInfo.InvariantCulture) : Str(v.ToString());

        static string Str(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in s)
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default: if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); break;
                }
            return sb.Append('"').ToString();
        }
    }
}
