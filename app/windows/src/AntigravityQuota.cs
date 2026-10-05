using System;
using System.Collections.Generic;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace CrossPet
{
    /// <summary>
    /// Gemini 额度（可选，默认关）：和 macOS 版一样，向本机正在运行的 Antigravity 后台服务（language_server）问一次额度——
    /// Antigravity 自己的界面就是这样拿额度的。令牌从它的启动参数里取（每次启动随机生成、只在本机有效，不是账号凭据），
    /// 只在内存里用，只发给 127.0.0.1；只信任本机的自签名证书。Antigravity 没开就不显示。
    /// </summary>
    static class AntigravityQuota
    {
        static readonly HttpClient http = new HttpClient(new HttpClientHandler
        {
            // 只信任本机 127.0.0.1 的自签名证书（Antigravity 后台服务用的是自签名 HTTPS）
            ServerCertificateCustomValidationCallback = (req, cert, chain, errors) => req.RequestUri.Host == "127.0.0.1",
        }) { Timeout = TimeSpan.FromSeconds(5) };
        static int cachedPid, cachedPort;

        public static async Task<Dictionary<string, object>> Read()
        {
            var server = FindServer();
            if (server == null) return null;
            var (pid, token) = server.Value;
            var ports = cachedPid == pid ? new List<int> { cachedPort } : ListeningPorts(pid);
            foreach (var port in ports)
            {
                try
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, $"https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus")
                    {
                        Content = new StringContent("{\"metadata\":{\"ideName\":\"antigravity\",\"extensionName\":\"antigravity\",\"locale\":\"en\"}}", Encoding.UTF8, "application/json"),
                    };
                    req.Headers.Add("X-Codeium-Csrf-Token", token);
                    var res = await http.SendAsync(req);
                    if (res.StatusCode != HttpStatusCode.OK) continue;
                    var q = Parse(Store.Json.DeserializeObject(await res.Content.ReadAsStringAsync()));
                    if (q == null) continue;
                    cachedPid = pid; cachedPort = port;
                    return q;
                }
                catch { }
            }
            cachedPid = 0;
            return null;
        }

        /// <summary>找到 Antigravity 的 language_server 进程，返回 (pid, 令牌)</summary>
        static (int, string)? FindServer()
        {
            try
            {
                using (var search = new ManagementObjectSearcher("SELECT ProcessId, CommandLine, ExecutablePath FROM Win32_Process WHERE Name LIKE 'language_server%'"))
                    foreach (ManagementObject p in search.Get())
                    {
                        var path = p["ExecutablePath"] as string ?? "";
                        var cmd = p["CommandLine"] as string ?? "";
                        if (path.IndexOf("antigravity", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        var token = Arg(cmd, "--csrf_token");
                        if (token != null) return (Convert.ToInt32(p["ProcessId"]), token);
                    }
            }
            catch (Exception e) { Store.Log("查找 Antigravity 后台服务失败: " + e.Message); }
            return null;
        }

        static string Arg(string cmd, string name)
        {
            var parts = cmd.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim('"')).ToArray();
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].StartsWith(name + "=")) return parts[i].Substring(name.Length + 1);
                if (parts[i] == name && i + 1 < parts.Length) return parts[i + 1];
            }
            return null;
        }

        // ---- 某个进程在 127.0.0.1 上监听的端口（系统的 TCP 连接表）----
        [DllImport("iphlpapi.dll")]
        static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, uint reserved);
        const int AF_INET = 2, TCP_TABLE_OWNER_PID_LISTENER = 3;

        static List<int> ListeningPorts(int pid)
        {
            var ports = new List<int>();
            int size = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref size, false, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
            var buf = Marshal.AllocHGlobal(size);
            try
            {
                if (GetExtendedTcpTable(buf, ref size, false, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0) return ports;
                var count = Marshal.ReadInt32(buf);
                for (int i = 0; i < count; i++)
                {
                    // MIB_TCPROW_OWNER_PID：state, localAddr, localPort, remoteAddr, remotePort, owningPid，各 4 字节
                    var row = buf + 4 + i * 24;
                    var addr = (uint)Marshal.ReadInt32(row + 4);
                    var port = ((Marshal.ReadByte(row + 8) << 8) | Marshal.ReadByte(row + 9));
                    var owner = Marshal.ReadInt32(row + 20);
                    if (owner == pid && addr == 0x0100007F) ports.Add(port);   // 127.0.0.1（网络字节序）
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return ports;
        }

        /// <summary>
        /// 额度按「额度池」共享（比如所有 Gemini 模型一个池，Claude 和 GPT-OSS 一个池）：按 (剩余比例, 重置时间) 分组，
        /// 每组用模型家族名命名，Gemini 池排前面；重置时间标在第一个池和快用完的池上。和 macOS 版 antigravityQuota 一样。
        /// </summary>
        public static Dictionary<string, object> Parse(object obj)
        {
            if (!(obj is Dictionary<string, object> root) || !(root.TryGetValue("userStatus", out var st) && st is Dictionary<string, object> status)) return null;
            if (!(status.TryGetValue("cascadeModelConfigData", out var cfg) && cfg is Dictionary<string, object> config)) return null;
            if (!(config.TryGetValue("clientModelConfigs", out var ms) && ms is object[] models)) return null;
            var pools = new List<(string key, double left, DateTime? reset, List<string> families)>();
            foreach (var m in models.OfType<Dictionary<string, object>>())
            {
                if (!(m.TryGetValue("quotaInfo", out var qi) && qi is Dictionary<string, object> info)) continue;
                var left = info.TryGetValue("remainingFraction", out var f) ? Convert.ToDouble(f) : 0;   // 用完时这个字段会被省略
                var resetText = info.TryGetValue("resetTime", out var r) ? r as string ?? "" : "";
                var family = ((m.TryGetValue("label", out var l) ? l as string : null) ?? "?").Split(' ')[0];
                var key = left + "|" + resetText;
                var i = pools.FindIndex(p => p.key == key);
                if (i >= 0) { if (!pools[i].families.Contains(family)) pools[i].families.Add(family); }
                else pools.Add((key, left, DateTime.TryParse(resetText, null, System.Globalization.DateTimeStyles.RoundtripKind, out var d) ? d.ToLocalTime() : (DateTime?)null, new List<string> { family }));
            }
            if (pools.Count == 0) return null;
            pools = pools.OrderBy(p => p.families.Contains("Gemini") ? 0 : 1).ThenBy(p => p.left).ToList();
            var parts = pools.Select((p, i) =>
            {
                var piece = $"{string.Join("/", p.families)} 剩余 {(int)Math.Round(p.left * 100)}%";
                if ((i == 0 || p.left <= 0.1) && p.reset is DateTime d)
                    piece += $" · {((d - DateTime.Now).TotalHours < 24 ? d.ToString("HH:mm") : $"{d.Month}/{d.Day}")} 重置";
                return piece;
            });
            return new Dictionary<string, object> { ["text"] = string.Join(" ｜ ", parts), ["low"] = pools.Min(p => p.left) <= 0.1 };
        }
    }
}
