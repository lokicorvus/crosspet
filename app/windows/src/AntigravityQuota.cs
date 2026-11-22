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
    /// Antigravity 自己的界面就是这样拿额度的。令牌（每次启动随机生成、只在本机有效，不是账号凭据）：2.34 起写在
    /// %USERPROFILE%\.gemini\antigravity\daemon\hub_&lt;端口&gt;.json 里（见 PickHub），更早的版本在 language_server 的 --csrf_token 启动参数里，两种都认，新的优先。
    /// 只在内存里用，只发给 127.0.0.1；只信任本机的自签名证书。Antigravity 没开就不显示。
    /// </summary>
    static partial class AntigravityQuota
    {
        static readonly HttpClient http = new HttpClient(new HttpClientHandler
        {
            // 只信任本机 127.0.0.1 的自签名证书（Antigravity 后台服务用的是自签名 HTTPS）
            ServerCertificateCustomValidationCallback = (req, cert, chain, errors) => req.RequestUri.Host == "127.0.0.1",
        }) { Timeout = TimeSpan.FromSeconds(5) };
        static int cachedPid, cachedPort;
        /// <summary>最近一次找服务的结果（反馈「额度不对」用）</summary>
        public static string LastNote = "还没查过";

        public static async Task<Dictionary<string, object>> Read()
        {
            var hub = FindHub();
            var server = hub != null ? (hub.Value.pid, hub.Value.token) : FindServer();
            if (server == null) { LastNote = $"{DateTime.Now:MM-dd HH:mm} 没找到 Antigravity 的服务进程（daemon\\hub_*.json 和启动参数里都没有令牌）"; return null; }
            var (pid, token) = server.Value;
            var ports = cachedPid == pid ? new List<int> { cachedPort }
                : hub?.port != null ? new List<int> { hub.Value.port.Value } : ListeningPorts(pid);
            LastNote = $"{DateTime.Now:MM-dd HH:mm} 找到服务进程（令牌来自{(hub != null ? "daemon 文件" : "启动参数")}），端口 {ports.Count} 个";
            // 每个端口先问「额度汇总」（和 Antigravity 的「View Usage」同一份数据，刚对话完就更新），旧版没有这个接口时退回「用户状态」
            // （里面的额度是缓存，会慢几分钟；2026-10-14 实测 View Usage 已经 98%，用户状态里还是 100%）。和 macOS 版 askAntigravity 一致
            foreach (var port in ports)
            foreach (var method in new[] { "RetrieveUserQuotaSummary", "GetUserStatus" })
            {
                try
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, $"https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{method}")
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

        /// <summary>新版：读 daemon\hub_*.json，只认进程还活着的、取最新改过的（挑法在 PickHub）</summary>
        static (int pid, string token, int? port)? FindHub()
        {
            try
            {
                var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini", "antigravity", "daemon");
                if (!System.IO.Directory.Exists(dir)) return null;
                var files = new List<(object, DateTime)>();
                foreach (var f in System.IO.Directory.GetFiles(dir, "hub_*.json"))
                {
                    try { files.Add((Store.Json.DeserializeObject(System.IO.File.ReadAllText(f)), System.IO.File.GetLastWriteTimeUtc(f))); } catch { }
                }
                return PickHub(files, pid =>
                {
                    try { using (var p = System.Diagnostics.Process.GetProcessById(pid)) return !p.HasExited; } catch { return false; }
                });
            }
            catch (Exception e) { Store.Log("读取 Antigravity daemon 文件失败: " + e.Message); return null; }
        }

        /// <summary>旧版：找到 Antigravity 的 language_server 进程，从启动参数 --csrf_token 里取令牌，返回 (pid, 令牌)</summary>
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
    }
}
