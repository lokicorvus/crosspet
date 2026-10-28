using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    sealed partial class Pet
    {
        // ---------------- 检查更新：每 3 小时和电脑醒来时，只读 GitHub 上公开的版本号，不发送任何数据 ----------------
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        static readonly HttpClient download = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        async Task CheckForUpdate(bool manual = false)
        {
            try
            {
                Dictionary<string, object> body = null;
                string tag = null;
                var fromPage = false;
                // 装的是测试版：也收下一个测试版（releases/latest 不含测试版）。看发布页订阅源，挑比现在新、Windows 安装包真的在的最新一个
                if (Store.Version.Contains("-")) { tag = await NewerFromFeed(); fromPage = tag != null; }
                if (tag == null)
                {
                var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{Repo}/releases/latest");
                req.Headers.UserAgent.ParseAdd("CrossPet/" + Store.Version);
                var res = await http.SendAsync(req);
                try { body = Store.Json.DeserializeObject(await res.Content.ReadAsStringAsync()) as Dictionary<string, object>; } catch { }
                tag = body != null && body.TryGetValue("tag_name", out var t) ? t as string : null;
                if (tag == null)
                {
                    // 接口限流（同一个网络每小时 60 次）或者返回了报错：改看网页 releases/latest 跳转到哪个版本（不限流，get.sh 也这么查）
                    Store.Log($"检查更新：接口没给版本号（HTTP {(int)res.StatusCode}），改查网页");
                    var page = await http.GetAsync($"https://github.com/{Repo}/releases/latest");
                    var final = page.RequestMessage?.RequestUri?.AbsolutePath ?? "";
                    var i = final.LastIndexOf("/tag/", StringComparison.Ordinal);
                    if (i >= 0) { tag = Uri.UnescapeDataString(final.Substring(i + 5)); fromPage = true; }
                }
                }
                if (tag != null && Newer(tag, Store.Version))
                {
                    var url = body != null && body.TryGetValue("html_url", out var u) && u is string s && s.StartsWith("https://github.com/") ? s : $"https://github.com/{Repo}/releases/tag/{tag}";
                    var first = latestRelease?.tag != tag;
                    latestRelease = (tag, url);
                    lastUpdateCheck = $"{DateTime.Now:MM-dd HH:mm} 最新 {tag}";
                    updateZip = null;
                    if (fromPage) updateZip = $"https://github.com/{Repo}/releases/download/{tag}/CrossPet-Windows.zip";   // 包名固定（一键更新按名字找）
                    else if (body.TryGetValue("assets", out var a) && a is object[] assets)
                        foreach (var asset in assets.OfType<Dictionary<string, object>>())
                            if (asset.TryGetValue("name", out var n) && n as string == "CrossPet-Windows.zip" &&
                                asset.TryGetValue("browser_download_url", out var d) && d is string dl &&
                                dl.StartsWith($"https://github.com/{Repo}/releases/download/{tag}/")) updateZip = dl;
                    // 手动检查时也让她在气泡里说、设置里出现「更新」按钮（和 macOS 一样），不跳到网页；
                    // 只有新版本没有 Windows 安装包、没法一键更新时才打开下载页
                    if (first || manual) Js($"notifyUpdate({Q(tag)})");
                    PushSettings();
                    if (manual && updateZip == null) Open(url);
                }
                else
                {
                    lastUpdateCheck = $"{DateTime.Now:MM-dd HH:mm} " + (tag == null ? "没拿到版本号" : $"已是最新（当前 {Store.Version}，发布页最新正式版 {tag}）");
                    if (manual) MessageBox.Show(tag == null ? "暂时连不上 GitHub，稍后再试。" : $"已经是最新版本（{Store.Version}）。", "CrossPet");
                }
            }
            catch (Exception e)
            {
                Store.Log("检查更新失败: " + e.Message);
                lastUpdateCheck = $"{DateTime.Now:MM-dd HH:mm} 失败：{e.Message}";
                if (manual) MessageBox.Show("检查更新失败：" + e.Message, "CrossPet");
            }
        }
        /// <summary>
        /// 一键更新：下载新版安装包 → 解压到临时文件夹 → 运行新包里的 install.ps1（覆盖安装、按新版刷新已接入的 AI、重新打开）。
        /// 设置、角色、接入都在数据目录里，不受影响。失败了就打开下载页，旧版照常能用
        /// </summary>
        async Task SelfUpdate()
        {
            if (updating || !(latestRelease is var (tag, page)) || updateZip == null) return;
            if (MessageBox.Show($"更新到 {tag}？\n\n会自动下载（约 20 MB）、安装并重新打开，设置、角色和 AI 接入都保留。",
                    "CrossPet 更新", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
            updating = true;
            try
            {
                Js($"setUpdateProgress(0, {Q("正在下载新版本…")})");
                var dir = Path.Combine(Path.GetTempPath(), "CrossPet-update", tag);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Directory.CreateDirectory(dir);
                var zip = Path.Combine(dir, "CrossPet-Windows.zip");
                using (var res = await download.GetAsync(updateZip, HttpCompletionOption.ResponseHeadersRead))
                {
                    res.EnsureSuccessStatusCode();
                    // 边下边在气泡里报进度（GitHub 在有些网络下很慢，没有进度看起来像卡住了）
                    var total = res.Content.Headers.ContentLength ?? 0;
                    using (var src = await res.Content.ReadAsStreamAsync())
                    using (var f = File.Create(zip))
                    {
                        var buf = new byte[81920]; long got = 0; int read, shown = -1;
                        while ((read = await src.ReadAsync(buf, 0, buf.Length)) > 0)
                        {
                            await f.WriteAsync(buf, 0, read);
                            got += read;
                            var pct = total > 0 ? (int)(got * 100 / total) : -1;
                            if (pct >= 0 && pct != shown && (pct - shown >= 2 || pct == 100)) { shown = pct; Js($"setUpdateProgress({pct}, {Q(pct >= 100 ? "下载好了，正在安装…" : $"正在下载新版本 {pct}%…")})"); }
                        }
                    }
                }
                Js($"setUpdateProgress(100, {Q("下载好了，正在安装…")})");
                await Task.Run(() => System.IO.Compression.ZipFile.ExtractToDirectory(zip, dir));
                var root = Path.Combine(dir, "CrossPet");
                var script = Path.Combine(root, "install.ps1");
                var version = Store.ReadText(Path.Combine(root, "VERSION"))?.Trim();
                if (!File.Exists(Path.Combine(root, "CrossPet.exe")) || !File.Exists(script) || version != tag.TrimStart('v', 'V'))
                    throw new Exception("下载的安装包不完整");
                Store.Log($"更新：{Store.Version} → {version}");
                Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{script}\" -Update")
                    { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root });
                Quit();   // install.ps1 等这边退出后再覆盖文件
            }
            catch (Exception e)
            {
                updating = false;
                Store.Log("一键更新失败: " + e);
                Js("endUpdate()");
                if (MessageBox.Show("自动更新没成功：" + e.Message + "\n\n要打开下载页手动更新吗？", "CrossPet 更新",
                        MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes) Open(page);
            }
        }

        /// <summary>语义化版本比较：先比 主.次.补丁；一样时正式版比测试版新（1.2.4 &lt; 1.2.5-beta.1 &lt; 1.2.5-beta.2 &lt; 1.2.5）</summary>
        /// <summary>发布页订阅源（releases.atom，含测试版、不限流）里比现在新、Windows 安装包在的最新版本；没有返回 null。
        /// 测试版发布页删了、标签还留着的，订阅源里也有，所以要看安装包在不在</summary>
        async Task<string> NewerFromFeed()
        {
            try
            {
                var text = await http.GetStringAsync($"https://github.com/{Repo}/releases.atom");
                var tags = System.Text.RegularExpressions.Regex.Matches(text, "/releases/tag/([^\"<]+)").Cast<System.Text.RegularExpressions.Match>()
                    .Select(m => Uri.UnescapeDataString(m.Groups[1].Value)).Distinct().Where(t => Newer(t, Store.Version)).ToList();
                tags.Sort((x, y) => Newer(x, y) ? -1 : Newer(y, x) ? 1 : 0);
                foreach (var t in tags)
                {
                    var head = new HttpRequestMessage(HttpMethod.Head, $"https://github.com/{Repo}/releases/download/{t}/CrossPet-Windows.zip");
                    var r = await http.SendAsync(head);
                    if (r.IsSuccessStatusCode) return t;
                }
            }
            catch (Exception e) { Store.Log("检查测试版更新失败: " + e.Message); }
            return null;
        }

        public static bool Newer(string tag, string cur)
        {
            (int[] core, string[] pre) P(string v)
            {
                var parts = v.Trim().TrimStart('v', 'V').Split(new[] { '-' }, 2);
                return (parts[0].Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray(),
                        parts.Length > 1 ? parts[1].Split('.') : new string[0]);
            }
            var a = P(tag); var b = P(cur);
            for (int i = 0; i < Math.Max(3, Math.Max(a.core.Length, b.core.Length)); i++)
            {
                var x = i < a.core.Length ? a.core[i] : 0; var y = i < b.core.Length ? b.core[i] : 0;
                if (x != y) return x > y;
            }
            if (a.pre.Length == 0 || b.pre.Length == 0) return a.pre.Length == 0 && b.pre.Length > 0;   // 正式版 > 同号测试版
            for (int i = 0; i < Math.Max(a.pre.Length, b.pre.Length); i++)
            {
                if (i >= a.pre.Length) return false;
                if (i >= b.pre.Length) return true;
                string x = a.pre[i], y = b.pre[i];
                if (x == y) continue;
                bool xn = int.TryParse(x, out var nx), yn = int.TryParse(y, out var ny);
                if (xn && yn) return nx > ny;
                if (xn) return false;   // 数字段比文字段小（semver 规则）
                if (yn) return true;
                return string.CompareOrdinal(x, y) > 0;
            }
            return false;
        }
    }
}
