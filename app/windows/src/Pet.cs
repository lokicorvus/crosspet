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
        FeedbackWindow feedback;
        const double BaseWidth = 260, BaseHeight = 362;
        // 文字大小：网页按「人物大小、文字大小」算出的画布（网页 CSS 尺寸），窗口 = 画布 × 人物大小（app/web/text-size.js）
        double pageW = BaseWidth, pageH = BaseHeight;
        double pageFoot = 62;      // 画布底栏高（网页像素）
        double shownFootPx;        // 窗口现在的底栏在屏幕上多高（物理像素）；0 = 还没按画布设过

        // ---- 多桌宠：正在干活的每个模型各显示一只，互不抢同一个画面 ----
        // 主 Pet（owner == null）是「控制者」：由它一个人读状态文件、算当前工作模型集合，再把结果广播给跟着的小桌宠；
        // 跟着的小桌宠（owner != null）各有自己的窗口和网页，但不建托盘、不重复同步资源、不重复轮询状态文件。
        readonly Pet owner;
        readonly string fixedCharacter;
        readonly int slot;
        readonly Dictionary<string, Pet> companions = new Dictionary<string, Pet>();
        readonly ActivityState activity = new ActivityState();
        readonly Dictionary<string, Dictionary<string, object>> quotas = new Dictionary<string, Dictionary<string, object>>();
        List<string> activeModels = new List<string>();
        bool wanted = true;
        bool hadActivity;
        bool closed;
        bool webStarted;
        bool IsCompanion => owner != null;
        string PositionKey => IsCompanion ? "position-" + fixedCharacter : "position";
        string DockKey => IsCompanion ? "dock-" + fixedCharacter : "dock";
        Pet Controller => owner ?? this;
        bool MultiPet => !Store.Settings.TryGetValue("multiPet", out var v) || !(v is bool b) || b;
        bool HideIdle => Store.Flag("hideIdlePets");

        public Pet(CoreWebView2Environment env, Pet owner = null, string character = null, int slot = 0)
        { this.env = env; this.owner = owner; fixedCharacter = character; this.slot = slot; }

        // ---------------- 启动 ----------------
        public void Start()
        {
            if (!IsCompanion) Store.SyncResources();   // 资源只同步一次，跟着的小桌宠不重复拷
            current = fixedCharacter ?? (Store.Settings.TryGetValue("character", out var c) && c is string s ? s : "claude");

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
            Window.Closed += (_, __) => { closed = true; ready = false; web.Dispose(); };
            WireMouse(hit);
            Every(TimeSpan.FromMilliseconds(250), () => { _ = UpdateHitRects(); });
            Every(TimeSpan.FromMilliseconds(80), UpdateDockHover);

            // 换 DPI 时 WPF 先按新缩放排好窗口再发这个事件；等这一轮排版走完再让网页控件对齐（原因见 ResyncWebForDpi）
            Window.DpiChanged += (_, e) => Window.Dispatcher.BeginInvoke(DispatcherPriority.Loaded,
                new Action(() => ResyncWebForDpi(e.OldDpi.DpiScaleX, e.NewDpi.DpiScaleX)));
            Window.Loaded += async (_, __) => { if (webStarted) return; webStarted = true; await InitWeb(); };
            Window.Show();

            if (IsCompanion) return;   // 跟着的小桌宠：没有托盘、不查更新、不接入 AI，只显示自己那只

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
                fullscreenOverride = false;   // 前台窗口换了：双击托盘临时叫出来的作废，重新按全屏规则来
                if (hwnd != IntPtr.Zero) Raise();
                foreach (var pet in companions.Values)
                    if (pet.wanted) pet.Raise();
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

        void Every(TimeSpan t, Action a)
        {
            var timer = new DispatcherTimer { Interval = t };
            timer.Tick += (_, __) => { try { a(); } catch (Exception e) { Store.Log("定时任务出错: " + e); } };
            Window.Closed += (_, __) => timer.Stop();   // 跟着的小桌宠会被关掉重建，定时器要跟着停
            timer.Start();
        }

        int imageErrors;
        async Task InitWeb()
        {
            try
            {
                await web.EnsureCoreWebView2Async(env);
                if (closed) return;
                var core = web.CoreWebView2;
                Map(core);
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                web.ZoomFactor = Scale;
                // 网页进程 / 浏览器进程崩溃（显卡驱动、系统睡眠醒来、内存不够时偶尔会）：不处理的话她就一直停住，
                // 之后每次调网页都报「控件已失效」
                core.ProcessFailed += (_, a) => Window.Dispatcher.BeginInvoke(new Action(() => _ = RecoverWeb(a.ProcessFailedKind)));
                core.NavigationCompleted += async (_, a) =>
                {
                    ready = false;
                    if (closed) return;
                    if (!a.IsSuccess) { Store.Log("桌宠页面加载失败: " + a.WebErrorStatus); return; }
                    LoadCharacters();
                    await core.ExecuteScriptAsync($"init({ManifestJson}); setCharacter({Q(current)}, true); setAuraMode({Q(AuraMode)}); setShowName({(ShowName ? "true" : "false")}); setEggsEnabled({(EggsEnabled ? "true" : "false")}); setPowerSave({(PowerSave ? "true" : "false")}); setQuotaAggregate({(QuotaAggregate ? "true" : "false")})");
                    if (Store.Settings.TryGetValue(DockKey, out var dk) && dk is string side && EdgeDockEnabled) After(1500, () => SetDock(side));   // 每只桌宠分别记住贴边状态
                    // 刚更新完（上次打开的是别的版本）：让她说一声
                    var last = Store.Settings.TryGetValue("lastVersion", out var lv) ? lv as string : null;
                    if (last != Store.Version)
                    {
                        Store.Settings["lastVersion"] = Store.Version; Store.SaveSettings();
                        if (last != null && Newer(Store.Version, last)) Js($"justUpdated({Q("v" + Store.Version)})");
                    }
                    ready = true;
                    ApplySizes(anchor: Anchor.Corner);   // 解锁过文字大小的：按画布重设窗口，左上角不动（锁着的尺寸不变）
                    After(1000, PassThroughBrowserWindows); After(5000, PassThroughBrowserWindows);   // 背后的浏览器窗口不接鼠标（见 PassThroughBrowserWindows）
                    stamps.Clear();
                    if (IsCompanion)
                    {
                        owner.Replay(this);   // 刚建出来的小桌宠：把当前工作状态和额度补给它，免得空着
                        Js($"setEggsEnabled({(EggsEnabled && (!MultiPet || owner.activeModels.Count == 0) ? "true" : "false")})");
                        ApplyLayer();
                        return;   // 小桌宠不自己轮询、不接入、不查更新：它显示什么全听控制者的
                    }
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
                        if (imageErrors >= 5 || !(Store.Json.DeserializeObject(a.WebMessageAsJson) is Dictionary<string, object> m) || !m.TryGetValue("imageError", out var src)) return;
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
