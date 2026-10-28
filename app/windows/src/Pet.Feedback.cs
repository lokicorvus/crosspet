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
        // ---------------- 反馈问题 ----------------
        // 点选「哪方面」+ 必填一句「具体是哪里」，附上版本、系统、接入情况、最近日志，
        // 由页面拼成卡片，发到飞书群机器人。地址可在 settings.json 里用 "feedbackURL" 改（测试用）
        const string FeedbackEndpoint = "https://open.feishu.cn/open-apis/bot/v2/hook/854f8a9a-d3f4-4705-b6f8-15cc007f714b";

        void OpenFeedback()
        {
            if (feedback == null) { feedback = new FeedbackWindow(this, env); feedback.Closed += () => feedback = null; }
            feedback.Show();
        }

        /// <summary>每台机器一个随机 id，只用来让服务端限流、合并同一个人的多条反馈</summary>
        static string InstallId
        {
            get
            {
                if (Store.Settings.TryGetValue("installId", out var v) && v is string s && s != "") return s;
                var id = Guid.NewGuid().ToString();
                Store.Settings["installId"] = id; Store.SaveSettings();
                return id;
            }
        }

        /// <summary>去掉日志里的隐私：用户目录换成 ~，路径里的用户名、像 API Key 的字符串打码，顺便去掉终端颜色控制符</summary>
        static string Redact(string text)
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var s = string.IsNullOrEmpty(home) ? text : text.Replace(home, "~");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"\x1B\[[0-9;]*[A-Za-z]", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"(\\Users\\|/Users/)[^\\/\s]+", "$1<user>", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            s = System.Text.RegularExpressions.Regex.Replace(s, @"sk-[A-Za-z0-9_\-]{8,}", "sk-***");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"(?i)(bearer|token|key|secret|password)([\s""':=]+)[A-Za-z0-9_\-\.]{8,}", "$1$2***");
            return s;
        }

        // ---- 记录（反馈用，格式见 docs/架构.md「记录」）----
        static string EventsDir => Path.Combine(Store.Data, "events");
        static string PetEventsFile => Path.Combine(EventsDir, "pet.jsonl");
        static string SwitchesFile => Path.Combine(Store.Data, "switches.jsonl");
        static void NotePet(string id, Dictionary<string, object> state, string result, string detail = "") =>
            Ledger.Append(PetEventsFile, new Dictionary<string, object> { ["char"] = id, ["ev"] = state != null && state.TryGetValue("event", out var e) ? e as string ?? "" : "",
                ["pose"] = state != null && state.TryGetValue("pose", out var p) ? p as string ?? "" : "", ["result"] = result, ["detail"] = detail });

        /// <summary>反馈窗口第一步就要的：开头、第二步的选项（已接入的 AI、角色、打开了的额度）；sections 是这一类要附的段落（见 web/feedback-plan.js）</summary>
        Dictionary<string, object> FeedbackFacts(Dictionary<string, string> sections, string key = null)
        {
            var skin = Store.Skins != null && current != null && Store.Skins.TryGetValue(current, out var w) ? w as string ?? "" : "";
            var quotas = new List<string>();
            if (Store.Flag("gptQuota")) quotas.Add("gpt");
            if (Store.Flag("agyQuota")) quotas.Add("gemini");
            if (DsQuotaEnabled) quotas.Add("deepseek");
            return new Dictionary<string, object>
            {
                ["header"] = new Dictionary<string, object> { ["version"] = Store.Version, ["platform"] = "windows",
                    ["os"] = $"{Environment.OSVersion.VersionString} {System.Runtime.InteropServices.RuntimeInformation.OSArchitecture}",
                    ["install"] = InstallId, ["character"] = current ?? "", ["skin"] = skin, ["uptimeMin"] = (int)(DateTime.Now - launchedAt).TotalMinutes },
                ["integrations"] = integrated ?? new List<string>(),
                ["characters"] = Characters().Select(c => new Dictionary<string, object> { ["id"] = c.id, ["name"] = c.name }).ToList(),
                ["quotas"] = quotas,
                ["sections"] = sections.ToDictionary(kv => kv.Key, kv => (object)Redact(kv.Value)),
                ["key"] = key,   // 收集的结果带回 collect 时的 key，页面据此丢掉上一类迟到的结果
            };
        }
        void PushFacts(Dictionary<string, string> sections, string key = null) => feedback?.Run($"setFacts({Store.Json.Serialize(FeedbackFacts(sections, key))})");

        string lastUpdateCheck = "还没查过", diagText = "";
        readonly DateTime launchedAt = DateTime.Now;
        /// <summary>收集反馈要的段落（want 来自 web/feedback-plan.js 的 sectionsFor）。网页 2 秒不回就写「网页没有回应」；接入诊断在后台跑</summary>
        async Task<Dictionary<string, string>> CollectFeedback(List<string> want)
        {
            var o = new Dictionary<string, string>();
            string Read(string f) => Store.ReadText(f) ?? "";
            foreach (var id in want)
            {
                try
                {
                    switch (id)
                    {
                        case "window":
                            var rect = "";
                            if (hwnd != IntPtr.Zero && Native.GetWindowRect(hwnd, out var r))
                            {
                                var on = Forms.Screen.AllScreens.Any(sc => sc.WorkingArea.IntersectsWith(new System.Drawing.Rectangle(r.Left + 40, r.Top + 40, Math.Max(1, r.Right - r.Left - 80), Math.Max(1, r.Bottom - r.Top - 80))));
                                rect = $"位置 {r.Left},{r.Top} {r.Right - r.Left}×{r.Bottom - r.Top}{(on ? "" : "（不在任何屏幕里）")}；";
                            }
                            o[id] = $"{rect}显示中 {(Window?.IsVisible == true && !concealed ? "是" : "否")}，透明度 {Num(Math.Round(Window?.Opacity ?? 0, 2))}，置顶 {(Window?.Topmost == true ? "是" : "否")}；层级 {LayerMode}；贴边 {dock ?? "无"}{(dock != null ? (dockOut ? "·跑出来了" : "·缩着") : "")}；大小 {(int)(Scale * 100)}%；网页 {(ready ? "就绪" : "没就绪")}";
                            break;
                        case "displays": o[id] = DisplaysSummary(); break;
                        case "dpi":
                            o[id] = DisplaysSummary() + $"\n系统缩放 {(Window != null ? Math.Round(VisualTreeHelper.GetDpi(Window).DpiScaleX * 100) : 0)}%，网页缩放 {Num(Math.Round(web?.ZoomFactor ?? 0, 3))}{(Math.Abs(zoomFix - 1) > 0.001 ? $"（自动修正 ×{Num(Math.Round(zoomFix, 3))}）" : "")}，"
                                + $"画布 {Math.Round(pageW)}×{Math.Round(pageH)}，人物大小 {(int)(Scale * 100)}%，文字 {(TextLinked ? "跟着" : (int)(TextScale * 100) + "%")}";
                            break;
                        case "front": o[id] = $"前台 {Native.ForegroundExe()}，是桌面或任务栏 {(Native.ForegroundIsShell() ? "是" : "否")}；被别的窗口挡住 {(hwnd != IntPtr.Zero && Native.Covered(hwnd) ? "是" : "否")}"; break;
                        case "hidden": o[id] = $"因全屏藏着 {(hiddenForFullscreen ? "是" : "否")}，快捷键藏着 {(userHidden ? "是" : "否")}，从菜单退出的标记 {(File.Exists(UserQuitFlag) ? "有" : "无")}，锁屏 {(sessionLocked ? "是" : "否")}"; break;
                        case "renderRestart": o[id] = File.Exists(Path.Combine(Store.Data, "render-restart.txt")) ? "记录：" + Read(Path.Combine(Store.Data, "render-restart.txt")).Trim() : "没有记录"; break;
                        case "install":
                            var missing = InstallCheck.Missing(Store.Install);
                            string wv = "?"; try { wv = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
                            o[id] = $"装在 {Store.Install}；缺少 {(missing.Count == 0 ? "无" : string.Join("、", missing))}；数据 {Store.Data}；随包 Python {(File.Exists(Store.Python) ? "在" : "不在")}；WebView2 {wv}；检查更新 {lastUpdateCheck}";
                            break;
                        case "log": o[id] = Ledger.Tail(Path.Combine(Store.Data, "windows.log"), 400).Replace("\r", ""); break;
                        case "updateLog": o[id] = Ledger.Tail(Path.Combine(Store.Data, "update.log"), 100).Replace("\r", ""); break;
                        case "seen": o[id] = Store.Json.Serialize(SeenKeys.ToDictionary(kv => kv.Key, kv => (object)(SeenAt(kv.Value) ?? 0))); break;
                        case "petEvents": o[id] = Ledger.Tail(PetEventsFile, 200); break;
                        case "switches": o[id] = Ledger.Tail(SwitchesFile, 200); break;
                        case "settings":
                            var skins = Store.Settings.TryGetValue("skins", out var sv) ? Store.Json.Serialize(sv) : "{}";
                            o[id] = $"跟随前台 {(Store.Flag("followApps") ? "开" : "关")}，跟随事件 {(Store.Flag("followEvents") ? "开" : "关")}，AI 干活自动出现 {(AIAutostart ? "开" : "关")}，衣服 {skins}，"
                                + $"峰谷换装 {(PeakSkins.Count == 0 ? "无" : Store.Json.Serialize(PeakSkins))}，省电 {(PowerSave ? "开" : "关")}，彩蛋 {(EggsEnabled ? "开" : "关")}，额度合并 {(QuotaAggregate ? "开" : "关")}，额度样式 {QuotaStyle}，重置提醒 {(CodexResets ? "开" : "关")}";
                            break;
                        case "characters": o[id] = CharacterFolders(); break;
                        case "quota:gpt": o[id] = $"最近一次 {lastGptQuota}\n额度文件 {Read(Path.Combine(Store.State, "gpt-quota.json"))}"; break;
                        case "quota:gemini": o[id] = $"找服务 {AntigravityQuota.LastNote}\n额度文件 {Read(Path.Combine(Store.State, "gemini-quota.json"))}"; break;
                        case "quota:deepseek": o[id] = $"插件自检 {Read(Path.Combine(Store.State, "deepseek-plugin.json"))}\n余额文件 {Read(Path.Combine(Store.State, "deepseek-quota.json"))}"; break;
                        case "perf":
                            var me = Process.GetCurrentProcess();
                            var webviews = Process.GetProcessesByName("msedgewebview2");
                            o[id] = $"CrossPet 进程：CPU 时间 {(int)me.TotalProcessorTime.TotalSeconds} 秒（运行 {(int)(DateTime.Now - launchedAt).TotalMinutes} 分钟），内存 {me.WorkingSet64 / 1048576} MB；"
                                + $"网页进程（所有程序的 WebView2 合计）{webviews.Length} 个、内存 {webviews.Sum(x => { try { return x.WorkingSet64; } catch { return 0L; } }) / 1048576} MB；省电 {(PowerSave ? "开" : "关")}；"
                                + $"GPT 额度 {(Store.Flag("gptQuota") ? "开" : "关")}，Gemini 额度 {(Store.Flag("agyQuota") ? "开" : "关")}，DeepSeek 余额 {(DsQuotaEnabled ? "开" : "关")}";
                            break;
                        case "page":
                            var eval = Eval("JSON.stringify(diagnoseDisplay())");
                            var raw = await Task.WhenAny(eval, Task.Delay(2000)) == eval ? eval.Result : "null";
                            o[id] = Store.Json.DeserializeObject(raw) as string ?? "网页没有回应";
                            break;
                        case "diag":
                            // 诊断要跑 python，卡住的话整份反馈都等不来：最多等 3 秒，到点先写「诊断超时」（跑完的结果留着下次用）
                            if (diagText == "" && File.Exists(Store.Python))
                            {
                                var run = Task.Run(() => { var t = RunIntegrate("diagnose").Item1.Trim(); diagText = t; return t; });
                                o[id] = await Task.WhenAny(run, Task.Delay(3000)) == run ? run.Result : "诊断超时（3 秒内没跑完）";
                            }
                            else o[id] = diagText;
                            break;
                        default:
                            if (id.StartsWith("events:")) o[id] = Ledger.Tail(Path.Combine(EventsDir, id.Substring(7) + ".jsonl"), 200);
                            else if (id.StartsWith("state:"))
                            {
                                // state:<角色>|<宿主>：状态、多会话按角色记；轮次、按模型换角色按宿主名记（见 web/feedback-plan.js）
                                var parts = id.Substring(6).Split('|');
                                var c = parts[0]; var host = parts.Length > 1 ? parts[1] : c;
                                o[id] = string.Join("\n", new[] { "state", "sessions", "turns", "host" }.Select(k => (k, t: Read(Path.Combine(Store.State, $"{(k == "turns" || k == "host" ? host : c)}-{k}.json")).Trim()))
                                    .Where(x => x.t != "").Select(x => $"{x.k}：{(x.t.Length > 800 ? x.t.Substring(0, 800) : x.t)}"));
                            }
                            break;
                    }
                }
                catch (Exception e) { o[id] = "收集出错：" + e.Message; }
            }
            return o;
        }

        /// <summary>角色文件夹对照表：安装目录和数据目录里每个文件夹一行（json 能不能读、有没有待机图、几张立绘、加载了没有）</summary>
        string CharacterFolders()
        {
            var loaded = new HashSet<string>(Characters().Select(c => c.id));
            var skinIds = new HashSet<string>(Store.SkinChoices.Values.SelectMany(l => l.Select(x => x.id)));
            var rows = new List<string>();
            foreach (var (place, dir) in new[] { ("安装目录", Path.Combine(Store.Install, "characters")), ("数据目录", Store.Characters) })
            {
                if (!Directory.Exists(dir)) { rows.Add($"{place}：没有 characters 文件夹"); continue; }
                foreach (var d in Directory.GetDirectories(dir).OrderBy(x => x, StringComparer.Ordinal))
                {
                    var name = Path.GetFileName(d);
                    var jsonOk = Store.ReadJson(Path.Combine(d, "character.json")) != null;
                    var sprites = Directory.GetFiles(d).Where(f => f.EndsWith(".webp", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase)).Select(Path.GetFileName).ToList();
                    var idle = sprites.Any(f => f.StartsWith("idle.") || f.StartsWith("default."));
                    var state = loaded.Contains(name) ? "已加载" : skinIds.Contains(name) ? "已加载（衣服）" : name.StartsWith("egg-") ? "彩蛋" : !jsonOk ? "没加载：character.json 读不出" : !idle ? "没加载：缺待机图" : "没加载";
                    rows.Add($"{place} {name}：json {(jsonOk ? "能读" : "读不出")}，待机图 {(idle ? "有" : "无")}，立绘 {sprites.Count} 张，{state}");
                }
            }
            return string.Join("\n", rows);
        }
        /// <summary>反馈附带的显示信息：几块显示器、各自大小和相对主屏的位置、桌宠在哪块、显示层级 / 全屏隐藏 / 贴边</summary>
        string DisplaysSummary()
        {
            try
            {
                var all = Forms.Screen.AllScreens;
                var main = Forms.Screen.PrimaryScreen.Bounds;
                var mine = hwnd == IntPtr.Zero ? null : Forms.Screen.FromHandle(hwnd);
                var parts = all.Select(s =>
                {
                    var b = s.Bounds;
                    var where = s.Primary ? "主屏" : b.Left >= main.Right ? "右侧" : b.Right <= main.Left ? "左侧" : b.Bottom <= main.Top ? "上方" : b.Top >= main.Bottom ? "下方" : "重叠";
                    return $"{b.Width}×{b.Height} {where}{(mine != null && s.DeviceName == mine.DeviceName ? "（桌宠在这）" : "")}";
                });
                var flags = new List<string> { "层级 " + LayerMode, HideFullscreen ? "全屏隐藏" : "全屏不隐藏" };
                if (dock != null) flags.Add(dock == "left" ? "贴左边" : "贴右边");
                if (hiddenForFullscreen) flags.Add("此刻因全屏藏着");
                if (hwnd != IntPtr.Zero && Native.GetWindowRect(hwnd, out var wr))
                {
                    var onAny = all.Any(sc => sc.WorkingArea.IntersectsWith(new System.Drawing.Rectangle(wr.Left + 40, wr.Top + 40, Math.Max(1, wr.Right - wr.Left - 80), Math.Max(1, wr.Bottom - wr.Top - 80))));
                    flags.Add($"窗口 {wr.Left},{wr.Top} {wr.Right - wr.Left}×{wr.Bottom - wr.Top}{(onAny ? "" : "（不在任何屏幕里）")}{(Window.IsVisible && !concealed ? "" : "（隐藏）")}");
                }
                return $"{all.Length} 块：{string.Join("、", parts)}；{string.Join("，", flags)}";
            }
            catch { return ""; }
        }

        public void HandleFeedback(Dictionary<string, object> msg)
        {
            var cmd = msg.TryGetValue("cmd", out var c) ? c as string : null;
            if (cmd == "collect")   // 选好了类型（和补选）：按 web/feedback-plan.js 给的段落清单收集
            {
                var want = (msg.TryGetValue("want", out var wv) ? wv as object[] : null)?.OfType<string>().ToList() ?? new List<string>();
                var key = msg.TryGetValue("key", out var kv) ? kv as string : null;
                _ = Window.Dispatcher.InvokeAsync(async () =>
                {
                    try { PushFacts(await CollectFeedback(want), key); }
                    catch (Exception e) { Store.Log("收集反馈信息出错: " + e); }   // 不然异常进了没人看的 Task，什么痕迹都不留
                });
                return;
            }
            if (cmd != "send")   // get：反馈窗口刚打开，先给开头和第二步的选项
            {
                diagText = "";   // 每次打开反馈都重新诊断一次（要用时再跑）
                PushFacts(new Dictionary<string, string>());
                if (integrated == null) RefreshIntegrated(() => PushFacts(new Dictionary<string, string>()));
                return;
            }
            var endpoint = Store.Settings.TryGetValue("feedbackURL", out var u) && u is string us && us != "" ? us : FeedbackEndpoint;
            void Done(bool ok, string text)
            {
                Window.Dispatcher.BeginInvoke(new Action(() =>
                {
                    feedback?.Run($"onSent({(ok ? "true" : "false")}, {Q(text)})");
                    if (ok) Js("show('happy', true); say('收到反馈啦，谢谢你！')");
                }));
            }
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var url)) { Done(false, "反馈暂时关闭了"); return; }
            var body = msg.TryGetValue("body", out var b) ? b as string : null;
            if (body == null || Encoding.UTF8.GetByteCount(body) > 20000) { Done(false, "内容太长了，删短一点再发"); return; }
            // 本机限流：一小时最多 5 条（飞书群机器人的地址是公开的，不能让一台机器刷屏）
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var recent = ((Store.Settings.TryGetValue("feedbackTimes", out var ft) ? ft as object[] : null) ?? new object[0])
                .Select(x => { try { return (long)Convert.ToDouble(x, System.Globalization.CultureInfo.InvariantCulture); } catch { return 0L; } }).Where(x => now - x < 3600).ToList();
            if (recent.Count >= 5) { Done(false, "发得有点多啦，过一会儿再发"); return; }
            Task.Run(async () =>
            {
                try
                {
                    var res = await http.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
                    // 飞书不论成败都回 HTTP 200，看返回里的 code：0 才是发到了群里
                    var reply = Store.Json.DeserializeObject(await res.Content.ReadAsStringAsync()) as Dictionary<string, object>;
                    var code = reply != null && reply.TryGetValue("code", out var c2) ? Convert.ToInt32(c2) : -1;
                    if (code == 0)
                    {
                        await Window.Dispatcher.BeginInvoke(new Action(() =>
                        {
                            recent.Add(now);
                            Store.Settings["feedbackTimes"] = recent.Cast<object>().ToArray(); Store.SaveSettings();
                        }));
                        Done(true, "");
                    }
                    else if (code == 11232) Done(false, "反馈的人有点多，过一会儿再发");
                    else { Store.Log("发送反馈失败: " + code); Done(false, $"没发出去（{code}），稍后再试试"); }
                }
                catch (Exception e) { Store.Log("发送反馈失败: " + e.Message); Done(false, "连不上网络，稍后再试试"); }
            });
        }
    }
}
