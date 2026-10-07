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
        string updateZip;    // 新版本的 Windows 安装包下载地址（只认本仓库 Releases 里的）
        bool updating;
        Forms.NotifyIcon tray;
        Native.ForegroundWatcher foreground;
        DispatcherTimer appSwitch;
        DevConsole dev;
        SettingsWindow settings;
        const double BaseWidth = 260, BaseHeight = 362;

        public Pet(CoreWebView2Environment env) { this.env = env; }

        // ---------------- 启动 ----------------
        public void Start()
        {
            Store.SyncResources();
            current = Store.Settings.TryGetValue("character", out var c) && c is string s ? s : "claude";

            Window = new Window
            {
                Title = "CrossPet", WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
                Width = BaseWidth * Scale, Height = BaseHeight * Scale, Topmost = LayerMode != "normal", ShowInTaskbar = false, ShowActivated = false, ResizeMode = ResizeMode.NoResize,
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
                if (hwnd != IntPtr.Zero && Window.Topmost) Native.BringToTop(hwnd);
                appSwitch.Stop(); appSwitch.Start();
            });

            Every(TimeSpan.FromMilliseconds(300), Poll);
            Every(TimeSpan.FromSeconds(60), RefreshQuota);
            // 检查更新：启动后 20 秒、之后每 3 小时，电脑从睡眠中醒来时也查一次（很多人的电脑一直不关机，只是合盖）
            Every(TimeSpan.FromHours(3), () => _ = CheckForUpdate());
            Microsoft.Win32.SystemEvents.PowerModeChanged += (_, e) =>
            {
                if (e.Mode != Microsoft.Win32.PowerModes.Resume) return;
                var wake = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };   // 等网络连上
                wake.Tick += (__, ___) => { wake.Stop(); _ = CheckForUpdate(); };
                wake.Start();
            };
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
                web.ZoomFactor = Scale;
                core.NavigationCompleted += async (_, a) =>
                {
                    ready = false;
                    if (!a.IsSuccess) { Store.Log("桌宠页面加载失败: " + a.WebErrorStatus); return; }
                    LoadCharacters();
                    await core.ExecuteScriptAsync($"init({ManifestJson}); setCharacter({Q(current)}, true); setAuraMode({Q(AuraMode)}); setShowName({(ShowName ? "true" : "false")}); setEggsEnabled({(EggsEnabled ? "true" : "false")})");
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
            settings?.Push();
        }

        /// <summary>读 AI 写来的状态 / 额度文件（state 目录），有变化就交给网页。和 macOS 版 pollStates 一样</summary>
        void Poll()
        {
            if (!ready) return;
            var latestActive = (id: (string)null, ts: 0.0);
            // current：多模型宿主（WorkBuddy）里没有对应角色的模型，由当前角色来演；它只有状态，没有额度
            foreach (var id in Characters().Select(c => c.id).Concat(new[] { "current" }))
                foreach (var kind in new[] { "state", "quota" })
                {
                    if (id == "current" && kind == "quota") continue;
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
                        lastPose[id] = (pose ?? "", DateTime.UtcNow);
                        if (id != "current" && pose != "idle" && pose != "sleeping" && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts < 30 && ts > latestActive.ts) latestActive = (id, ts);
                        Js($"applyCharState({Q(id)}, {json})");
                    }
                    else Js($"setQuota({Q(id)}, {json})");
                }
            if (latestActive.id != null && latestActive.id != current && Store.Flag("followEvents")) SwitchTo(latestActive.id);
            ApplyLayer();
        }

        // ---------------- 显示层级 ----------------
        // always：始终在最上层；ai：前台是 AI 应用、或者 AI 正在干活 / 等你回答时在最上层，其他时候是普通窗口（会被挡住）；
        // normal：普通窗口。另外全屏程序（视频 / 游戏 / 演示）在前台时整个隐藏
        static string LayerMode => Store.Settings.TryGetValue("layer", out var v) && v is string s && (s == "ai" || s == "normal") ? s : "always";
        static bool HideFullscreen => !(Store.Settings.TryGetValue("hideFullscreen", out var v) && v is bool b && !b);
        readonly Dictionary<string, (string pose, DateTime at)> lastPose = new Dictionary<string, (string, DateTime)>();
        bool frontIsAI, hiddenForFullscreen;

        bool AIActive()
        {
            if (frontIsAI) return true;
            var now = DateTime.UtcNow;
            return lastPose.Values.Any(p => p.pose == "asking" ? (now - p.at).TotalMinutes < 10
                : (now - p.at).TotalSeconds < 45 && !new[] { "idle", "sleeping", "happy", "proud" }.Contains(p.pose));
        }

        void ApplyLayer()
        {
            if (Window == null || hwnd == IntPtr.Zero) return;
            // 全屏时隐藏
            var hide = HideFullscreen && Native.InFullscreen();
            if (hide != hiddenForFullscreen)
            {
                hiddenForFullscreen = hide;
                if (hide) Window.Hide(); else { Window.Show(); if (Window.Topmost) Native.BringToTop(hwnd); }
            }
            var top = LayerMode == "always" || (LayerMode == "ai" && AIActive());
            if (Window.Topmost == top) return;
            Window.Topmost = top;
            if (top) Native.BringToTop(hwnd); else Native.DropFromTop(hwnd);
        }

        void FollowForeground()
        {
            var exe = Native.ForegroundExe();
            var map = Store.ReadJson(Store.AppMap);
            var match = exe == "" ? null : map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
            frontIsAI = !string.IsNullOrWhiteSpace(match);
            ApplyLayer();
            if (!ready || Paused || !Store.Flag("followApps") || exe == "") return;
            if (string.IsNullOrWhiteSpace(match)) return;   // 对照表里没有，或者值留空：这个程序不跟随
            match = HostCharacter(match);
            if (match != current) SwitchTo(match);
        }

        /// <summary>
        /// 一个程序里能用好几家模型（比如 DeepSeek Harness）：它的接入插件把当前角色写在 &lt;角色&gt;-host.json，
        /// 切到这个程序时换成那个角色。一天内写的才算，角色不存在就还用对照表里的
        /// </summary>
        static readonly Dictionary<string, string> HostDefaults = new Dictionary<string, string> { ["zcode"] = "glm" };
        string HostCharacter(string id)
        {
            var file = Path.Combine(Store.State, id + "-host.json");
            try
            {
                // 还不知道它在用哪个模型（刚装好、还没对话过）：先按它默认的模型换，比如 ZCode 默认是 GLM
                if (!File.Exists(file) || (DateTime.UtcNow - File.GetLastWriteTimeUtc(file)).TotalHours > 24)
                    return HostDefaults.TryGetValue(id, out var d) && Characters().Any(x => x.id == d) ? d : id;
            }
            catch { return id; }
            var host = Store.ReadJson(file);
            var c = host != null && host.TryGetValue("character", out var v) ? v as string : null;
            return c != null && Characters().Any(x => x.id == c) ? c : id;
        }

        void RefreshQuota()
        {
            if (!ready) return;
            if (Store.Flag("gptQuota"))
            {
                var q = CodexQuota.Read();
                if (q != null) Js($"setQuota('gpt', {Store.Json.Serialize(q)})");
            }
            if (Store.Flag("agyQuota")) _ = RefreshGeminiQuota();
        }
        bool askingGemini;
        async Task RefreshGeminiQuota()
        {
            if (askingGemini) return;
            askingGemini = true;
            try
            {
                var q = await Task.Run(AntigravityQuota.Read);   // 进程查询比较慢，放到后台
                Js($"setQuota('gemini', {(q == null ? "null" : Store.Json.Serialize(q))})");   // Antigravity 没开就不显示
            }
            catch (Exception e) { Store.Log("Gemini 额度: " + e.Message); }
            finally { askingGemini = false; }
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
            if (Window.Topmost) Native.BringToTop(hwnd);
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

            if (latestRelease is var (tag, url))
            {
                if (updateZip != null) menu.Items.Add(Item(updating ? $"⬆️ 正在更新到 {tag}…" : $"⬆️ 更新到 {tag}", () => _ = SelfUpdate()));
                else menu.Items.Add(Item($"⬆️ 有新版本 {tag}，点这里下载", () => Open(url)));
                Sep();
            }
            menu.Items.Add(Item("摸摸头", () => Js("handleClick('pat')")));
            menu.Items.Add(Item("戳一下", () => Js("handleClick('poke')")));
            menu.Items.Add(Item("召唤彩蛋", () => Js("playEgg(true)")));
            Sep();
            var switchTo = new Forms.ToolStripMenuItem("换角色");
            foreach (var (id, name) in Characters()) { var cid = id; switchTo.DropDownItems.Add(Item(name, () => SwitchTo(cid), cid == current)); }
            menu.Items.Add(switchTo);
            Sep();
            var layer = new Forms.ToolStripMenuItem("显示层级");
            foreach (var (mode, title) in new[] { ("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）") })
            {
                var m = mode;
                layer.DropDownItems.Add(Item(title, () => { Store.Settings["layer"] = m; Store.SaveSettings(); ApplyLayer(); }, LayerMode == m));
            }
            menu.Items.Add(layer);
            menu.Items.Add(Item("设置…", OpenSettings));
            if (developer) menu.Items.Add(Item("开发者控制台…", OpenDev));
            menu.Items.Add(Item("回到右下角", Recenter));
            Sep();
            menu.Items.Add(Item("退出 CrossPet", Quit));
        }

        // ---------------- 设置窗口（web/settings.html，和 macOS 版共用） ----------------
        static double Scale => Store.Settings.TryGetValue("size", out var v) && (v is double || v is int || v is decimal) &&
                               Convert.ToDouble(v) >= 0.6 && Convert.ToDouble(v) <= 1.6 ? Convert.ToDouble(v) : 1;
        static bool ShowName => !(Store.Settings.TryGetValue("showName", out var v) && v is bool b && !b);
        static bool EggsEnabled => !(Store.Settings.TryGetValue("eggs", out var v) && v is bool b && !b);

        /// <summary>改大小：窗口和网页一起按比例缩放，底边中点不动（脚下的位置不变）</summary>
        void ApplyScale(double scale)
        {
            Native.GetWindowRect(hwnd, out var old);
            Window.Width = BaseWidth * scale; Window.Height = BaseHeight * scale;
            Window.UpdateLayout();
            if (web != null) web.ZoomFactor = scale;
            Native.GetWindowRect(hwnd, out var now);
            int w = now.Right - now.Left, h = now.Bottom - now.Top;
            var (x, y) = Clamp((old.Left + old.Right) / 2 - w / 2, old.Bottom - h, w, h);
            Native.MoveTo(hwnd, x, y);
            SavePosition();
        }

        /// <summary>拖滑块时每次只变一点，直接跟手；一下子变很多（点「还原」）时用 0.2 秒过渡过去</summary>
        DispatcherTimer scaleTimer;
        double shownScale;
        void AnimateScale(double target)
        {
            scaleTimer?.Stop();
            var from = shownScale > 0 ? shownScale : Window.Width / BaseWidth;
            if (Math.Abs(target - from) <= 0.06) { shownScale = target; ApplyScale(target); return; }
            var start = DateTime.Now;
            scaleTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
            scaleTimer.Tick += (_, __) =>
            {
                var k = Math.Min(1, (DateTime.Now - start).TotalSeconds / 0.2);
                shownScale = from + (target - from) * (1 - Math.Pow(1 - k, 3));
                ApplyScale(shownScale);
                if (k >= 1) scaleTimer.Stop();
            };
            scaleTimer.Start();
        }

        void OpenSettings()
        {
            if (settings == null) { settings = new SettingsWindow(this, env); settings.Closed += () => settings = null; }
            settings.Show();
        }

        List<string> integrated;   // 已接入的 AI（设置窗口打开时查一次，接入 / 撤销后再查）
        public void RefreshIntegrated(Action done = null)
        {
            Task.Run(() =>
            {
                var r = RunIntegrate("installed").output;
                List<string> list = null;
                try { list = (Store.Json.DeserializeObject(r.Trim().Split('\n').Last()) as object[])?.OfType<string>().ToList(); } catch { }
                Window.Dispatcher.Invoke(() => { integrated = list ?? new List<string>(); settings?.Push(); done?.Invoke(); });
            });
        }

        static readonly (string id, string label, string note)[] IntegrationTargets =
        {
            ("claude-hooks", "Claude Code（标准钩子）", "所有版本可用，不显示额度"),
            ("claude-mod", "Claude Code 增强版 mod", "能显示额度；终端里要 2.1.287 以上，桌面 App 2.1.286 以上"),
            ("codex", "Codex", "接入后要在 Codex 里用 /hooks 信任一次"),
            ("deepseek", "DeepSeek Harness", "工作状态 + 余额"),
            ("antigravity", "Antigravity", "桌面版和命令行都有效"),
            ("gemini", "Gemini CLI", null),
            ("workbuddy", "WorkBuddy", "按当前模型换角色，没有对应角色的模型由当前角色来演"),
            ("zcode", "ZCode（智谱）", "按会话的模型换角色，GLM 角色没装时由当前角色来演"),
        };

        public Dictionary<string, object> SettingsState()
        {
            var state = new Dictionary<string, object>
            {
                ["version"] = Store.Version + " Windows", ["platform"] = "windows",
                ["size"] = Scale, ["showName"] = ShowName, ["eggs"] = EggsEnabled, ["hideFullscreen"] = HideFullscreen, ["aura"] = AuraMode,
                ["followApps"] = Store.Flag("followApps"), ["followEvents"] = Store.Flag("followEvents"),
                ["gptQuota"] = Store.Flag("gptQuota"), ["agyQuota"] = Store.Flag("agyQuota"),
                ["login"] = LoginEnabled, ["character"] = current, ["updating"] = updating,
                ["characters"] = Characters().Select(c => new Dictionary<string, object>
                {
                    ["id"] = c.id, ["name"] = c.name,
                    ["defaultName"] = Store.ReadJson(Path.Combine(Store.Characters, c.id, "character.json"))?["name"] as string ?? c.id,
                    ["custom"] = Store.Names.TryGetValue(c.id, out var n) ? n as string ?? "" : "",
                }).ToList(),
                ["integrations"] = integrated == null ? null : IntegrationTargets.Select(t => new Dictionary<string, object>
                    { ["id"] = t.id, ["label"] = t.label, ["note"] = t.note, ["installed"] = integrated.Contains(t.id) }).ToList(),
            };
            if (latestRelease is var (tag, _) && updateZip != null) state["update"] = tag;
            return state;
        }

        public void HandleSettings(Dictionary<string, object> msg)
        {
            var cmd = msg.TryGetValue("cmd", out var c) ? c as string : null;
            switch (cmd)
            {
                case "get":
                    if (integrated == null) RefreshIntegrated();
                    break;
                case "set":
                    var key = msg.TryGetValue("key", out var k) ? k as string : null;
                    msg.TryGetValue("value", out var value);
                    var on = value is bool b && b;
                    switch (key)
                    {
                        case "size":
                            var v = Math.Min(1.6, Math.Max(0.6, Math.Round(Convert.ToDouble(value) * 100) / 100));
                            Store.Settings["size"] = v; Store.SaveSettings(); AnimateScale(v);
                            break;
                        case "showName": Store.Settings["showName"] = on; Store.SaveSettings(); Js($"setShowName({(on ? "true" : "false")})"); break;
                        case "hideFullscreen": Store.Settings["hideFullscreen"] = on; Store.SaveSettings(); ApplyLayer(); break;
                        case "eggs": Store.Settings["eggs"] = on; Store.SaveSettings(); Js($"setEggsEnabled({(on ? "true" : "false")})"); break;
                        case "aura":
                            if (value is string m && (m == "auto" || m == "on" || m == "off")) { Store.Settings["auraMode"] = m; Store.SaveSettings(); Js($"setAuraMode({Q(m)})"); }
                            break;
                        case "followApps": case "followEvents": Store.Settings[key] = on; Store.SaveSettings(); break;
                        case "gptQuota":
                            Store.Settings[key] = on; Store.SaveSettings();
                            if (on) RefreshQuota(); else Js("setQuota('gpt', null)");
                            break;
                        case "agyQuota":
                            Store.Settings[key] = on; Store.SaveSettings();
                            if (on) _ = RefreshGeminiQuota(); else Js("setQuota('gemini', null)");
                            break;
                        case "login": if (on != LoginEnabled) ToggleLogin(); break;
                        case "character": if (value is string id) SwitchTo(id); break;
                    }
                    break;
                case "rename":
                    if (msg.TryGetValue("id", out var rid) && rid is string cid && Characters().Any(x => x.id == cid))
                    {
                        var name = (msg.TryGetValue("name", out var nm) ? nm as string ?? "" : "").Trim();
                        if (name == "") Store.Names.Remove(cid); else Store.Names[cid] = name;
                        Store.SaveSettings();
                        LoadCharacters();
                        Js($"setName({Q(cid)}, {Q(Characters().First(x => x.id == cid).name)})");
                        dev?.Boot();
                    }
                    break;
                case "integrate":
                    if (msg.TryGetValue("target", out var t) && t is string target && msg.TryGetValue("action", out var a) && a is string action &&
                        IntegrationTargets.Any(x => x.id == target) && (action == "install" || action == "uninstall"))
                        Integrate(action, target, IntegrationTargets.First(x => x.id == target).label);
                    break;
                case "action":
                    switch (msg.TryGetValue("name", out var an) ? an as string : null)
                    {
                        case "update": _ = SelfUpdate(); break;
                        case "checkUpdate": _ = CheckForUpdate(true); break;
                        case "openCharacters": Open(Store.Characters); break;
                        case "openData": Open(Store.Data); break;
                        case "devConsole": OpenDev(); break;
                    }
                    break;
            }
            settings?.Push();
        }

        /// <summary>背景光晕：auto（跟着系统深浅色，深色模式下关）/ on / off</summary>
        static string AuraMode => Store.Settings.TryGetValue("auraMode", out var v) && v is string s && (s == "on" || s == "off") ? s : "auto";

        static void Toggle(string key) { Store.Settings[key] = !Store.Flag(key); Store.SaveSettings(); }
        static void Open(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception e) { Store.Log("打开失败: " + e.Message); } }

        public void Quit()
        {
            foreground?.Dispose();
            tray.Visible = false; tray.Dispose();
            Application.Current.Shutdown();
        }

        // ---------------- 开发者控制台 ----------------
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
                var (output, code) = RunIntegrate($"{action} {target}");
                Store.Log($"接入 {action} {target} → {code}\n{output}");
                Window.Dispatcher.Invoke(() =>
                {
                    // 没找到 AI 的配置目录时脚本正常退出但什么都没改，不能显示成「已更新」
                    var missing = output.Contains("没找到");
                    var title = code != 0 ? "没有完成" : missing ? "没有接入：没找到这个 AI 的配置" : action == "install" ? "已接入" : "已撤销";
                    MessageBox.Show($"{label}：{title}\n\n{output.Trim()}", "CrossPet AI 接入", MessageBoxButton.OK,
                        code != 0 ? MessageBoxImage.Error : missing ? MessageBoxImage.Warning : MessageBoxImage.Information);
                    RefreshIntegrated();
                });
            });
        }

        /// <summary>用随包 Python 跑一次 tools/integrate.py，返回输出和退出码</summary>
        (string output, int code) RunIntegrate(string args)
        {
            var psi = new ProcessStartInfo(Store.Python, $"\"{Path.Combine(Store.Install, "tools", "integrate.py")}\" {args}")
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
            return (output, code);
        }

        // ---------------- 检查更新：每 3 小时和电脑醒来时，只读 GitHub 上公开的版本号，不发送任何数据 ----------------
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        static readonly HttpClient download = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
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
                    updateZip = null;
                    if (body.TryGetValue("assets", out var a) && a is object[] assets)
                        foreach (var asset in assets.OfType<Dictionary<string, object>>())
                            if (asset.TryGetValue("name", out var n) && n as string == "CrossPet-Windows.zip" &&
                                asset.TryGetValue("browser_download_url", out var d) && d is string dl &&
                                dl.StartsWith($"https://github.com/{Repo}/releases/download/{tag}/")) updateZip = dl;
                    if (first) Js($"notifyUpdate({Q(tag)})");
                    settings?.Push();
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
