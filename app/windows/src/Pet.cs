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
    /// <summary>
    /// 桌宠本体。和 macOS 版 CrossPet.swift 做的事一样：一个透明、置顶、不抢焦点的小窗口里放桌宠网页（app/web/index.html），
    /// 读 AI 写来的状态文件交给网页演，跟着前台程序换角色，右键菜单 / 托盘 / 接入 AI / 额度 / 检查更新。
    /// 网页用 WebView2CompositionControl：它把网页画面当图片放进 WPF 透明窗口，才能做到逐像素半透明（柔和边缘、光晕）。
    /// </summary>
    sealed class Pet
    {
        const string Repo = "lokicorvus/crosspet";
        readonly CoreWebView2Environment env;
        public Window Window { get; private set; }
        WebView2CompositionControl web;
        IntPtr hwnd;
        bool ready;
        string current;
        public bool Paused;                     // 开发者控制台测试时，先不把真实 AI 的状态交给桌宠
        public string ManifestJson { get; private set; } = "{}";
        readonly Dictionary<string, string> stamps = new Dictionary<string, string>();
        (string tag, string url)? latestRelease;
        Forms.NotifyIcon tray;
        Native.ForegroundWatcher foreground;
        DispatcherTimer appSwitch;
        DevConsole dev;

        public Pet(CoreWebView2Environment env) { this.env = env; }

        // ---------------- 启动 ----------------
        public void Start()
        {
            Store.SyncResources();
            current = Store.Settings.TryGetValue("character", out var c) && c is string s ? s : "claude";

            Window = new Window
            {
                Title = "CrossPet", WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
                Width = 260, Height = 362, Topmost = true, ShowInTaskbar = false, ShowActivated = false, ResizeMode = ResizeMode.NoResize,
                Left = -10000, Top = -10000,   // 先放屏幕外，拿到窗口句柄后按像素摆到保存的位置
            };
            Window.SourceInitialized += (_, __) =>
            {
                hwnd = new WindowInteropHelper(Window).Handle;
                Native.MakeToolWindow(hwnd);
                RestorePosition();
            };

            var grid = new Grid();
            web = new WebView2CompositionControl { DefaultBackgroundColor = System.Drawing.Color.Transparent, IsHitTestVisible = false };
            grid.Children.Add(web);
            // 透明的接鼠标层：拖动 / 单击 / 右键由窗口自己处理（和 macOS 版的 DragView 一样），网页只负责画
            var hit = new Border { Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)) };
            grid.Children.Add(hit);
            Window.Content = grid;
            WireMouse(hit);

            Window.Loaded += async (_, __) => await InitWeb();
            Window.Show();

            tray = new Forms.NotifyIcon { Text = "CrossPet", Visible = true };
            try { tray.Icon = new System.Drawing.Icon(Path.Combine(Store.Install, "AppIcon.ico")); } catch { tray.Icon = System.Drawing.SystemIcons.Application; }
            var trayMenu = new Forms.ContextMenuStrip();
            trayMenu.Opening += (_, e) => { FillMenu(trayMenu, false); e.Cancel = false; };
            tray.ContextMenuStrip = trayMenu;
            tray.DoubleClick += (_, __) => Recenter();

            // 前台程序一变：重新置顶（别的置顶窗口激活后会盖过来），停留半秒再按对照表换角色（启动时窗口会来回抢焦点）
            appSwitch = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            appSwitch.Tick += (_, __) => { appSwitch.Stop(); FollowForeground(); };
            foreground = new Native.ForegroundWatcher(() =>
            {
                if (hwnd != IntPtr.Zero) Native.BringToTop(hwnd);
                appSwitch.Stop(); appSwitch.Start();
            });

            Every(TimeSpan.FromMilliseconds(300), Poll);
            Every(TimeSpan.FromSeconds(60), RefreshQuota);
            Every(TimeSpan.FromHours(24), () => _ = CheckForUpdate());
            var first = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
            first.Tick += (_, __) => { first.Stop(); _ = CheckForUpdate(); };
            first.Start();
        }

        static void Every(TimeSpan t, Action a)
        {
            var timer = new DispatcherTimer { Interval = t };
            timer.Tick += (_, __) => { try { a(); } catch (Exception e) { Store.Log("定时任务出错: " + e); } };
            timer.Start();
        }

        async Task InitWeb()
        {
            try
            {
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                Map(core);
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.NavigationCompleted += async (_, a) =>
                {
                    ready = false;
                    if (!a.IsSuccess) { Store.Log("桌宠页面加载失败: " + a.WebErrorStatus); return; }
                    LoadCharacters();
                    await core.ExecuteScriptAsync($"init({ManifestJson}); setCharacter({Q(current)}, true)");
                    ready = true;
                    stamps.Clear();
                    Poll();
                    RefreshQuota();
                    FollowForeground();
                };
                core.Navigate($"https://{Store.AppHost}/index.html");
            }
            catch (Exception e)
            {
                Store.Log("WebView2 初始化失败: " + e);
                MessageBox.Show("桌宠画面启动失败：\n" + e.Message + "\n\n日志：" + Path.Combine(Store.Data, "windows.log"), "CrossPet");
            }
        }

        /// <summary>两个虚拟域名：程序自带的网页（安装目录）、角色立绘和数据（数据目录）。只在这两个域名里加载，外部网页一律不开</summary>
        public static void Map(CoreWebView2 core)
        {
            core.SetVirtualHostNameToFolderMapping(Store.AppHost, Path.Combine(Store.Install, "web"), CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(Store.DataHost, Store.Data, CoreWebView2HostResourceAccessKind.Allow);
            core.NavigationStarting += (_, a) => { if (!a.Uri.StartsWith($"https://{Store.AppHost}/")) a.Cancel = true; };
            core.NewWindowRequested += (_, a) => a.Handled = true;
        }

        List<(string id, string name)> characters = new List<(string id, string name)>();   // 可切换的角色（不含彩蛋）
        public void LoadCharacters()
        {
            var m = Store.Manifest();
            ManifestJson = Store.Json.Serialize(m);
            var chars = (Dictionary<string, object>)m["characters"];
            characters = chars.Where(kv => !IsEgg(kv.Value))
                              .Select(kv => (kv.Key, (kv.Value as Dictionary<string, object>)?["name"] as string ?? kv.Key)).ToList();
            if (!characters.Any(c => c.id == current)) current = characters.FirstOrDefault().id ?? "claude";
        }
        static bool IsEgg(object info) => info is Dictionary<string, object> d && d.TryGetValue("egg", out var e) && e is bool b && b;
        List<(string id, string name)> Characters() => characters;

        // ---------------- 和网页打交道 ----------------
        public void Js(string code)
        {
            try { web?.CoreWebView2?.ExecuteScriptAsync(code); } catch (Exception e) { Store.Log("JS 出错: " + e.Message); }
        }
        public async Task<string> Eval(string code)
        {
            try { return web?.CoreWebView2 == null ? "null" : await web.CoreWebView2.ExecuteScriptAsync(code); }
            catch { return "null"; }
        }
        public void Reload() { ready = false; web?.CoreWebView2?.Reload(); }
        public static string Q(string s) => Store.Json.Serialize(s);

        void SwitchTo(string id)
        {
            if (!Characters().Any(c => c.id == id)) return;
            current = id;
            Store.Settings["character"] = id; Store.SaveSettings();
            Js($"setCharacter({Q(id)})");
        }

        /// <summary>读 AI 写来的状态 / 额度文件（state 目录），有变化就交给网页。和 macOS 版 pollStates 一样</summary>
        void Poll()
        {
            if (!ready) return;
            var latestActive = (id: (string)null, ts: 0.0);
            foreach (var (id, _) in Characters())
                foreach (var kind in new[] { "state", "quota" })
                {
                    var file = Path.Combine(Store.State, $"{id}-{kind}.json");
                    FileInfo fi;
                    try { fi = new FileInfo(file); if (!fi.Exists || fi.Length > 1_000_000) continue; } catch { continue; }
                    var stamp = fi.LastWriteTimeUtc.Ticks + ":" + fi.Length;
                    var key = id + "-" + kind;
                    if (stamps.TryGetValue(key, out var old) && old == stamp) continue;
                    if (kind == "state" && (DateTime.UtcNow - fi.LastWriteTimeUtc).TotalMinutes > 10) { stamps[key] = stamp; continue; }  // 只认 10 分钟内的
                    var value = Store.ReadJson(file);
                    if (value == null) continue;   // 可能正被另一边写一半，下次再读
                    stamps[key] = stamp;
                    var json = Store.Json.Serialize(value);
                    dev?.Js($"logEvent({Q(id)}, {Q(kind)}, {json}, {(Paused ? "true" : "false")})");
                    if (Paused) continue;
                    if (kind == "state")
                    {
                        // 在终端里用 AI 时没有对应的前台程序：跟着最新一条工作事件换角色
                        var pose = value.TryGetValue("pose", out var p) ? p as string : null;
                        var ts = value.TryGetValue("ts", out var t) ? Convert.ToDouble(t) : 0;
                        if (pose != "idle" && pose != "sleeping" && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts < 30 && ts > latestActive.ts) latestActive = (id, ts);
                        Js($"applyCharState({Q(id)}, {json})");
                    }
                    else Js($"setQuota({Q(id)}, {json})");
                }
            if (latestActive.id != null && latestActive.id != current && Store.Flag("followEvents")) SwitchTo(latestActive.id);
        }

        void FollowForeground()
        {
            if (!ready || Paused || !Store.Flag("followApps")) return;
            var exe = Native.ForegroundExe();
            if (exe == "") return;
            var map = Store.ReadJson(Store.AppMap);
            var match = map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
            if (match != null && match != current) SwitchTo(match);
        }

        void RefreshQuota()
        {
            if (!ready || !Store.Flag("gptQuota")) return;
            var q = CodexQuota.Read();
            if (q != null) Js($"setQuota('gpt', {Store.Json.Serialize(q)})");
        }

        // ---------------- 鼠标：单击摸头、拖动换位置、右键菜单 ----------------
        void WireMouse(UIElement hit)
        {
            Point down = default; bool pressed = false;
            hit.MouseLeftButtonDown += (_, e) => { down = e.GetPosition(Window); pressed = true; };
            hit.MouseMove += (_, e) =>
            {
                if (!pressed || e.LeftButton != MouseButtonState.Pressed) return;
                var p = e.GetPosition(Window);
                if (Math.Abs(p.X - down.X) + Math.Abs(p.Y - down.Y) <= 4) return;
                pressed = false;
                try { Window.DragMove(); } catch { }
                SavePosition();
            };
            hit.MouseLeftButtonUp += (_, __) => { if (pressed) { pressed = false; Js("handleClick('pat')"); } };
            hit.MouseRightButtonUp += (_, __) =>
            {
                var menu = new Forms.ContextMenuStrip();
                // 按住 Shift 右键才出现「开发者控制台」（macOS 版是 ⌥）
                FillMenu(menu, (Keyboard.Modifiers & ModifierKeys.Shift) != 0);
                menu.Closed += (_, ___) => Window.Dispatcher.BeginInvoke(new Action(menu.Dispose));
                menu.Show(Forms.Cursor.Position);
            };
        }

        // ---------------- 位置（按物理像素存，多显示器、不同缩放都对） ----------------
        void RestorePosition()
        {
            Native.GetWindowRect(hwnd, out var r);
            int w = r.Right - r.Left, h = r.Bottom - r.Top, x, y;
            if (Store.Settings.TryGetValue("position", out var pos) && pos is Dictionary<string, object> p && p.ContainsKey("x"))
            { x = Convert.ToInt32(p["x"]); y = Convert.ToInt32(p["y"]); }
            else { var wa = Forms.Screen.PrimaryScreen.WorkingArea; x = wa.Right - w - 40; y = wa.Bottom - h - 100; }
            var (cx, cy) = Clamp(x, y, w, h);
            Native.MoveTo(hwnd, cx, cy);
            Native.BringToTop(hwnd);
        }
        static (int, int) Clamp(int x, int y, int w, int h)
        {
            var center = new System.Drawing.Point(x + w / 2, y + h / 2);
            var wa = (Forms.Screen.AllScreens.FirstOrDefault(s => s.WorkingArea.Contains(center)) ?? Forms.Screen.PrimaryScreen).WorkingArea;
            return (Math.Max(wa.Left, Math.Min(x, wa.Right - w)), Math.Max(wa.Top, Math.Min(y, wa.Bottom - h)));
        }
        void SavePosition()
        {
            Native.GetWindowRect(hwnd, out var r);
            Store.Settings["position"] = new Dictionary<string, object> { ["x"] = r.Left, ["y"] = r.Top };
            Store.SaveSettings();
        }
        public void Recenter()
        {
            Store.Settings.Remove("position"); Store.SaveSettings();
            RestorePosition();
            Window.Show();
        }

        // ---------------- 菜单 ----------------
        void FillMenu(Forms.ContextMenuStrip menu, bool developer)
        {
            menu.Items.Clear();
            Forms.ToolStripMenuItem Item(string text, Action click, bool? check = null)
            {
                var i = new Forms.ToolStripMenuItem(text);
                if (check.HasValue) i.Checked = check.Value;
                i.Click += (_, __) => { try { click(); } catch (Exception e) { Store.Log("菜单出错: " + e); } };
                return i;
            }
            void Sep() => menu.Items.Add(new Forms.ToolStripSeparator());

            if (latestRelease is var (tag, url)) { menu.Items.Add(Item($"⬆️ 有新版本 {tag}，点这里下载", () => Open(url))); Sep(); }
            menu.Items.Add(Item("摸摸头", () => Js("handleClick('pat')")));
            menu.Items.Add(Item("戳一下", () => Js("handleClick('poke')")));
            menu.Items.Add(Item("召唤彩蛋", () => Js("playEgg(true)")));
            Sep();
            foreach (var (id, name) in Characters()) { var cid = id; menu.Items.Add(Item("换成 " + name, () => SwitchTo(cid), cid == current)); }
            menu.Items.Add(Item("给当前角色改名…", Rename));
            Sep();
            menu.Items.Add(Item("跟随前台 AI 应用", () => Toggle("followApps"), Store.Flag("followApps")));
            menu.Items.Add(Item("跟随 AI 工作事件（含终端）", () => Toggle("followEvents"), Store.Flag("followEvents")));
            menu.Items.Add(Item("显示 GPT 额度（读取 Codex 会话记录）", () =>
            {
                Toggle("gptQuota");
                if (Store.Flag("gptQuota")) RefreshQuota(); else Js("setQuota('gpt', null)");
            }, Store.Flag("gptQuota")));
            menu.Items.Add(Item("登录时自动启动", ToggleLogin, LoginEnabled));
            var integrate = new Forms.ToolStripMenuItem("接入 AI");
            foreach (var (target, label) in new[] { ("claude-hooks", "Claude Code"), ("codex", "Codex"), ("deepseek", "DeepSeek Harness"), ("antigravity", "Antigravity"), ("gemini", "Gemini CLI") })
            {
                var sub = new Forms.ToolStripMenuItem(label);
                var t = target;
                sub.DropDownItems.Add(Item("接入 / 更新", () => Integrate("install", t, label)));
                sub.DropDownItems.Add(Item("撤销接入", () => Integrate("uninstall", t, label)));
                integrate.DropDownItems.Add(sub);
            }
            menu.Items.Add(integrate);
            Sep();
            menu.Items.Add(Item("打开角色文件夹", () => Open(Store.Characters)));
            menu.Items.Add(Item("打开数据和状态目录", () => Open(Store.Data)));
            menu.Items.Add(Item("回到右下角", Recenter));
            if (developer) menu.Items.Add(Item("开发者控制台…", OpenDev));
            menu.Items.Add(Item($"检查更新（当前 {Store.Version}）", () => _ = CheckForUpdate(true)));
            Sep();
            menu.Items.Add(Item("退出 CrossPet", Quit));
        }

        static void Toggle(string key) { Store.Settings[key] = !Store.Flag(key); Store.SaveSettings(); }
        static void Open(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception e) { Store.Log("打开失败: " + e.Message); } }

        public void Quit()
        {
            foreground?.Dispose();
            tray.Visible = false; tray.Dispose();
            Application.Current.Shutdown();
        }

        // ---------------- 改名 / 开发者控制台 ----------------
        void Rename()
        {
            var name = Characters().FirstOrDefault(c => c.id == current).name ?? current;
            var result = RenameDialog.Ask(name);
            if (result == null) return;
            if (result == "") Store.Names.Remove(current); else Store.Names[current] = result;
            Store.SaveSettings();
            LoadCharacters();
            var shown = Characters().FirstOrDefault(c => c.id == current).name ?? current;
            Js($"setName({Q(current)}, {Q(shown)})");
            dev?.Boot();
        }

        void OpenDev()
        {
            if (dev == null) { dev = new DevConsole(this, env); dev.Closed += () => { dev = null; Paused = false; Js("devRelease()"); }; }
            dev.Show();
        }

        // ---------------- 开机启动（当前用户的 Run 注册表项，不需要管理员） ----------------
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        static string Exe => Process.GetCurrentProcess().MainModule.FileName;
        static bool LoginEnabled
        {
            get { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return (k?.GetValue("CrossPet") as string)?.Contains(Exe) == true; }
        }
        static void ToggleLogin()
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                if (LoginEnabled) k.DeleteValue("CrossPet", false); else k.SetValue("CrossPet", $"\"{Exe}\"");
        }

        // ---------------- 接入 AI：用随包 Python 跑和 macOS 共用的 tools/integrate.py ----------------
        void Integrate(string action, string target, string label)
        {
            if (!File.Exists(Store.Python)) { MessageBox.Show("没找到随包的 Python，请用完整的安装包重新安装。", "CrossPet AI 接入"); return; }
            Task.Run(() =>
            {
                var psi = new ProcessStartInfo(Store.Python, $"\"{Path.Combine(Store.Install, "tools", "integrate.py")}\" {action} {target}")
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Store.Install,
                };
                psi.EnvironmentVariables["PYTHONUTF8"] = "1";
                psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
                psi.EnvironmentVariables["CROSSPET_DATA_DIR"] = Store.Data;
                psi.EnvironmentVariables["CROSSPET_STATE_DIR"] = Store.State;
                string output; int code;
                try
                {
                    using (var p = Process.Start(psi))
                    {
                        var err = p.StandardError.ReadToEndAsync();
                        output = p.StandardOutput.ReadToEnd() + err.Result;
                        if (!p.WaitForExit(30000)) { p.Kill(); output += "\n（超时）"; }
                        code = p.ExitCode;
                    }
                }
                catch (Exception e) { output = e.Message; code = -1; }
                Store.Log($"接入 {action} {target} → {code}\n{output}");
                Window.Dispatcher.Invoke(() =>
                {
                    // 没找到 AI 的配置目录时脚本正常退出但什么都没改，不能显示成「已更新」
                    var missing = output.Contains("没找到");
                    var title = code != 0 ? "没有完成" : missing ? "没有接入：没找到这个 AI 的配置" : action == "install" ? "已接入" : "已撤销";
                    MessageBox.Show($"{label}：{title}\n\n{output.Trim()}", "CrossPet AI 接入", MessageBoxButton.OK,
                        code != 0 ? MessageBoxImage.Error : missing ? MessageBoxImage.Warning : MessageBoxImage.Information);
                });
            });
        }

        // ---------------- 检查更新：每天一次，只读 GitHub 上公开的版本号，不发送任何数据 ----------------
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        async Task CheckForUpdate(bool manual = false)
        {
            try
            {
                var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{Repo}/releases/latest");
                req.Headers.UserAgent.ParseAdd("CrossPet/" + Store.Version);
                var res = await http.SendAsync(req);
                var body = Store.Json.DeserializeObject(await res.Content.ReadAsStringAsync()) as Dictionary<string, object>;
                var tag = body?["tag_name"] as string;
                if (tag != null && Newer(tag, Store.Version))
                {
                    var url = body.TryGetValue("html_url", out var u) && u is string s && s.StartsWith("https://github.com/") ? s : $"https://github.com/{Repo}/releases/latest";
                    var first = latestRelease?.tag != tag;
                    latestRelease = (tag, url);
                    if (first) Js($"notifyUpdate({Q(tag)})");
                    if (manual) Open(url);
                }
                else if (manual) MessageBox.Show($"已经是最新版本（{Store.Version}）。", "CrossPet");
            }
            catch (Exception e)
            {
                Store.Log("检查更新失败: " + e.Message);
                if (manual) MessageBox.Show("检查更新失败：" + e.Message, "CrossPet");
            }
        }
        static bool Newer(string tag, string cur)
        {
            int[] P(string v) => v.TrimStart('v', 'V').Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
            var a = P(tag); var b = P(cur);
            for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
            {
                var x = i < a.Length ? a[i] : 0; var y = i < b.Length ? b[i] : 0;
                if (x != y) return x > y;
            }
            return false;
        }
    }
}
