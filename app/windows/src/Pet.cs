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
    /// 桌宠本体。和 macOS 版（app/mac/）做的事一样：一个透明、置顶、不抢焦点的小窗口里放桌宠网页（app/web/index.html），
    /// 读 AI 写来的状态文件交给网页演，跟着前台程序换角色，右键菜单 / 托盘 / 接入 AI / 额度 / 检查更新。
    /// 网页用 WebView2CompositionControl：它把网页画面当图片放进 WPF 透明窗口，才能做到逐像素半透明（柔和边缘、光晕）。
    /// </summary>
    sealed partial class Pet
    {
        const string Repo = "lokicorvus/crosspet";
        CoreWebView2Environment env;   // 浏览器进程崩溃后要换一个新的（见 RecoverWeb）
        Grid grid;
        public Window Window { get; private set; }
        WebView2CompositionControl web;
        IntPtr hwnd;
        bool ready;
        string current;
        bool paused;
        public bool Paused                     // 开发者控制台测试时，先不把真实 AI 的状态交给桌宠
        {
            get => paused;
            set { if (paused != value) ++followEventGeneration; paused = value; }
        }
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
        FeedbackWindow feedback;
        const double BaseWidth = 260, BaseHeight = 362;
        // 文字大小：网页按「人物大小、文字大小」算出的画布（网页 CSS 尺寸），窗口 = 画布 × 人物大小（app/web/text-size.js）
        double pageW = BaseWidth, pageH = BaseHeight;
        double pageFoot = 62;      // 画布底栏高（网页像素）
        double shownFootPx;        // 窗口现在的底栏在屏幕上多高（物理像素）；0 = 还没按画布设过

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
                HwndSource.FromHwnd(hwnd)?.AddHook(HotKeyHook);
                RegisterHideHotKey();
            };

            grid = new Grid();
            web = new WebView2CompositionControl { DefaultBackgroundColor = System.Drawing.Color.Transparent, IsHitTestVisible = false };
            grid.Children.Add(web);
            // 透明的接鼠标层：拖动 / 单击 / 右键由窗口自己处理（和 macOS 版的 DragView 一样），网页只负责画
            // 只在桌宠本体、气泡、名牌、额度上铺：窗口其余地方完全透明，点击直接落到后面的窗口
            // （窗口比桌宠大，是给动作、气泡留的空间；透明窗口里全透明的像素本来就不接鼠标）
            hit = new Canvas();
            grid.Children.Add(hit);
            Window.Content = grid;
            WireMouse(hit);
            Every(TimeSpan.FromMilliseconds(250), () => { _ = UpdateHitRects(); });
            Every(TimeSpan.FromMilliseconds(80), UpdateDockHover);

            // 换 DPI 时 WPF 先按新缩放排好窗口再发这个事件；等这一轮排版走完再让网页控件对齐（原因见 ResyncWebForDpi）
            Window.DpiChanged += (_, e) => Window.Dispatcher.BeginInvoke(DispatcherPriority.Loaded,
                new Action(() => ResyncWebForDpi(e.OldDpi.DpiScaleX, e.NewDpi.DpiScaleX)));
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
                ++followEventGeneration;
                fullscreenOverride = false;   // 前台窗口换了：双击托盘临时叫出来的作废，重新按全屏规则来
                if (hwnd != IntPtr.Zero) Raise();
                appSwitch.Stop(); appSwitch.Start();
            });

            Every(TimeSpan.FromMilliseconds(300), Poll);
            Every(TimeSpan.FromSeconds(60), () => { RefreshQuota(); RefreshCodexQuota(CodexWhy.Tick); });
            Every(TimeSpan.FromSeconds(3), WatchClaudeConfig);
            // 锁屏时动画全停（看不见还在画，白白耗电）
            SystemEvents.SessionSwitch += (_, e) =>
            {
                if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.SessionUnlock)
                    Window.Dispatcher.BeginInvoke(new Action(() =>
                    {
                        var locked = e.Reason == SessionSwitchReason.SessionLock;
                        var wasLocked = sessionLocked; sessionLocked = locked;
                        UpdatePageHidden();
                        if (wasLocked && !locked) RefreshCodexQuota(CodexWhy.Tick);   // 锁屏时没查：解锁补一次（自带间隔，不会多问）
                    }));
            };
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

        int imageErrors;
        async Task InitWeb()
        {
            try
            {
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                Map(core);
                core.NavigationStarting += (_, a) => { if (!a.Cancel) { ++followEventGeneration; ready = false; } };
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                web.ZoomFactor = Scale * zoomFix;
                // 网页进程 / 浏览器进程崩溃（显卡驱动、系统睡眠醒来、内存不够时偶尔会）：不处理的话她就一直停住，
                // 之后每次调网页都报「控件已失效」
                core.ProcessFailed += (_, a) => Window.Dispatcher.BeginInvoke(new Action(() => _ = RecoverWeb(a.ProcessFailedKind)));
                core.NavigationCompleted += async (_, a) =>
                {
                    ready = false;
                    if (!a.IsSuccess) { Store.Log("桌宠页面加载失败: " + a.WebErrorStatus); return; }
                    LoadCharacters();
                    await core.ExecuteScriptAsync($"init({ManifestJson}); setCharacter({Q(current)}, true); setAuraMode({Q(AuraMode)}); setShowName({(ShowName ? "true" : "false")}); setEggsEnabled({(EggsEnabled ? "true" : "false")}); setPowerSave({(PowerSave ? "true" : "false")}); setQuotaAggregate({(QuotaAggregate ? "true" : "false")}); setCodexResets({(CodexResets ? "true" : "false")}); setPeakStyle({Q(PeakStyle)}); setPeakSkins({Store.Json.Serialize(PeakSkins)})");
                    if (Store.Settings.TryGetValue("dock", out var dk) && dk is string side && EdgeDockEnabled) After(1500, () => SetDock(side));   // 上次是贴着边的
                    // 刚更新完（上次打开的是别的版本）：让她说一声
                    var last = Store.Settings.TryGetValue("lastVersion", out var lv) ? lv as string : null;
                    // 「新功能」页看到哪一版了（设置里的小红点用）：没记过时，老用户按上次的版本算（有没看过的就亮），新安装按当前版本（不亮）。要在下面改掉 lastVersion 之前记
                    if (!(Store.Settings.TryGetValue("whatsNewSeen", out var wn) && wn is string)) { Store.Settings["whatsNewSeen"] = last ?? Store.Version; Store.SaveSettings(); }
                    if (last != Store.Version)
                    {
                        Store.Settings["lastVersion"] = Store.Version; Store.SaveSettings();
                        // 带上上次的版本：这版（跳过的几版合在一起）有新功能就弹「新功能」卡片（见 whats-new.js）
                        if (last != null && Newer(Store.Version, last)) Js($"justUpdated({Q("v" + Store.Version)}, {Q(last)})");
                    }
                    ready = true;
                    if (RenderRecovery.Ready()) tray?.ShowBalloonTip(6000, "CrossPet", "上次画面出了问题，现已重新打开。若再次消失，请提交反馈。", Forms.ToolTipIcon.Info);
                    ApplySizes(anchor: Anchor.Corner);   // 解锁过文字大小的：按画布重设窗口，左上角不动（锁着的尺寸不变）
                    After(1000, PassThroughBrowserWindows); After(5000, PassThroughBrowserWindows);   // 背后的浏览器窗口不接鼠标（见 PassThroughBrowserWindows）
                    stamps.Clear();
                    Poll();
                    RefreshQuota();
                    RefreshCodexQuota(CodexWhy.Now);
                    RefreshPlugins(tellPet: true);   // 插件旧了：等她闲下来提醒一句
                    FollowForeground();
                };
                // 立绘加载失败时网页发消息过来：记进日志（每次启动最多 5 条），反馈里能看出是哪张图、为什么
                core.WebMessageReceived += (_, a) =>
                {
                    try
                    {
                        if (!(Store.Json.DeserializeObject(a.WebMessageAsJson) is Dictionary<string, object> m)) return;
                        // 「新功能」卡片点了「去看看」：打开设置停在「新功能」页
                        if (m.TryGetValue("openSettings", out var tab) && tab is string t) { OpenSettings(t); return; }
                        // 按时段换衣服（网页层判断好了时段）：只换这个角色已有的衣服，不切换当前角色（和 macOS 的 handlePet 一致）
                        if (m.TryGetValue("wear", out var wv) && wv is Dictionary<string, object> w && w.TryGetValue("id", out var wi) && wi is string wid
                            && w.TryGetValue("skin", out var ws) && ws is string wskin && Characters().Any(c => c.id == wid)
                            && (wskin == "" || (Store.SkinChoices.TryGetValue(wid, out var wl) && wl.Any(x => x.id == wskin))))
                        { Wear(wid, wskin); return; }
                        if (imageErrors >= 5 || !m.TryGetValue("imageError", out var src)) return;
                        imageErrors++;
                        Store.Log($"立绘加载失败: {src}");
                    }
                    catch { }
                };
                core.Navigate(Store.PageUrl("index.html"));
            }
            catch (Exception e)
            {
                Store.Log("WebView2 初始化失败: " + e);
                MessageBox.Show("桌宠画面启动失败：\n" + e.Message + "\n\n日志：" + Path.Combine(Store.Data, "windows.log"), "CrossPet");
            }
        }

        readonly List<DateTime> crashes = new List<DateTime>();
        /// <summary>WebView2 崩溃后恢复：网页进程挂了就重新加载；浏览器进程挂了控件就废了，换新的环境和控件重来。
        /// 显卡进程挂了 WebView2 会自己重启，不用管。10 分钟内最多恢复 3 次，免得一直崩一直重来</summary>
        async Task RecoverWeb(CoreWebView2ProcessFailedKind kind)
        {
            Store.Log("WebView2 进程崩溃: " + kind);
            if (kind == CoreWebView2ProcessFailedKind.GpuProcessExited) return;
            crashes.RemoveAll(t => (DateTime.UtcNow - t).TotalMinutes > 10);
            if (crashes.Count >= 3) { Store.Log("10 分钟内崩溃太多次，不再自动恢复"); return; }
            crashes.Add(DateTime.UtcNow);
            ++followEventGeneration;
            ready = false;
            try
            {
                if (kind != CoreWebView2ProcessFailedKind.BrowserProcessExited && web?.CoreWebView2 != null)
                {
                    web.CoreWebView2.Reload();
                    return;
                }
                var old = web;
                web = new WebView2CompositionControl { DefaultBackgroundColor = System.Drawing.Color.Transparent, IsHitTestVisible = false };
                grid.Children.Remove(old);
                grid.Children.Insert(0, web);
                try { old.Dispose(); } catch { }
                env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Store.Data, "webview2"));
                await InitWeb();
                Store.Log("WebView2 已恢复");
            }
            catch (Exception e) { Store.Log("WebView2 恢复失败: " + e); }
        }

        /// <summary>两个虚拟域名：程序自带的网页（安装目录\web，文件夹映射）、角色立绘（数据目录\characters，程序自己读文件，
        /// 不能用文件夹映射，原因见 SpriteResources）。只在网页的域名里导航，外部网页一律不开</summary>
        public static void Map(CoreWebView2 core)
        {
            core.SetVirtualHostNameToFolderMapping(Store.AppHost, Path.Combine(Store.Install, "web"), CoreWebView2HostResourceAccessKind.Allow);
            SpriteResources.Attach(core);
            core.NavigationStarting += (_, a) => { if (!a.Uri.StartsWith($"https://{Store.AppHost}/")) a.Cancel = true; };
            core.NewWindowRequested += (_, a) => a.Handled = true;
        }

        List<(string id, string name)> characters = new List<(string id, string name)>();   // 可切换的角色（不含彩蛋）
        public void LoadCharacters()
        {
            ++followEventGeneration;
            var m = Store.Manifest();
            ManifestJson = Store.Json.Serialize(m);
            var chars = (Dictionary<string, object>)m["characters"];
            characters = chars.Where(kv => !IsEgg(kv.Value))
                              .Select(kv => (kv.Key, (kv.Value as Dictionary<string, object>)?["name"] as string ?? kv.Key)).ToList();
            if (!characters.Any(c => c.id == current)) current = characters.FirstOrDefault().id ?? "claude";
        }
        static bool IsEgg(object info) => info is Dictionary<string, object> d && d.TryGetValue("egg", out var e) && e is bool b && b;
        List<(string id, string name)> Characters() => characters;

    }
}
