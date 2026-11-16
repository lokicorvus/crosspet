using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    /// <summary>小本子的小窗：无边框、置顶、透明背景（网页由系统直接合成，同 DirectHost），整个窗口都接鼠标，
    /// 能成为前台（收 Esc、点别处时 Deactivate 收起）。不进任务栏、不进 Alt+Tab</summary>
    sealed class NotebookHost : Forms.Form
    {
        public WebView2 Web { get; } = new WebView2 { DefaultBackgroundColor = Color.Transparent, Dock = Forms.DockStyle.Fill };

        public NotebookHost()
        {
            Text = "CrossPet 小本子";
            FormBorderStyle = Forms.FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = Forms.FormStartPosition.Manual;
            AutoScaleMode = Forms.AutoScaleMode.None;
            Bounds = new Rectangle(-10000, -10000, 408, 720);   // 先放屏幕外加载，页面量好尺寸再摆过来
            Controls.Add(Web);
        }

        protected override bool ShowWithoutActivation => true;   // 摆好位置以后再 Activate
        protected override Forms.CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | WS_EX_TOPMOST;
                return cp;
            }
        }
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SetLayeredWindowAttributes(Handle, 0, 255, LWA_ALPHA);
        }
        protected override void OnPaintBackground(Forms.PaintEventArgs e) { }

        const int WS_EX_TOPMOST = 0x8, WS_EX_LAYERED = 0x80000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
        const uint LWA_ALPHA = 2;
        [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    }

    /// <summary>她的小本子（相处记录）：右键「我们的小本子」在她旁边弹出 web/notebook.html。
    /// 数据由主桌宠页面算好（notebookFor），这里只开关窗口、摆位置、存备份 notebook.json、在后台补算一次。和 macOS 的 App+Notebook.swift 一样。
    /// 消息约定见 notebook.html；设计 docs/superpowers/specs/2026-11-08-notebook-design.md</summary>
    sealed partial class Pet
    {
        NotebookHost notebook;
        string notebookCharacter;
        /// <summary>谁的右键打开的（"main" 或额外那只的 id）：她走了就收起</summary>
        public string NotebookOwner { get; private set; }
        Rectangle notebookNear;      // 打开时她的窗口（物理像素）
        double notebookDpi = 1;
        bool notebookClosing, notebookBackfilling;

        // ---------------- 备份（数据目录里的 notebook.json，规则同 friendship.json）----------------
        static string NotebookFile => Path.Combine(Store.Data, "notebook.json");
        static void SaveNotebookFile(Dictionary<string, object> store)
        {
            try { Store.WriteJson(NotebookFile, store); } catch (Exception e) { Store.Log("保存小本子备份失败: " + e.Message); }
        }
        /// <summary>交给 restoreNotebook 的参数：文件里的 JSON 对象，没有 / 坏了就是 null</summary>
        static string SavedNotebookJson() => Store.ReadJson(NotebookFile) is Dictionary<string, object> d ? Store.Json.Serialize(d) : "null";

        /// <summary>主桌宠页面的 notebookStore（备份）、notebookBackfill（第一次 init 完、还没补算过）</summary>
        void HandleNotebookMessage(Dictionary<string, object> m)
        {
            if (m.TryGetValue("notebookStore", out var ns) && ns is Dictionary<string, object> store) SaveNotebookFile(store);
            if (m.TryGetValue("notebookBackfill", out var nb) && nb is bool b && b) RunNotebookBackfill();
        }

        // ---------------- 补算：在后台扫一次本机记录 ----------------
        void RunNotebookBackfill()
        {
            if (notebookBackfilling) return;
            notebookBackfilling = true;
            // 装 CrossPet 那天 = 数据目录建立的时间
            long installedAt;
            try { installedAt = new DateTimeOffset(Directory.GetCreationTimeUtc(Store.Data), TimeSpan.Zero).ToUnixTimeMilliseconds(); }
            catch { installedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            Task.Run(() =>
            {
                var t0 = DateTime.UtcNow;
                string json = "null"; int count = 0;
                try
                {
                    var js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };   // 不和界面线程共用 Store.Json
                    var files = NotebookScan.ScanAll(home, s => js.DeserializeObject(s));
                    count = files.Sum(f => f["events"] is List<Dictionary<string, object>> l ? l.Count : 0);
                    json = js.Serialize(new Dictionary<string, object> { ["installedAt"] = installedAt, ["files"] = files });
                }
                catch (Exception e) { Store.Log("小本子补算出错: " + e.Message); }
                var took = (DateTime.UtcNow - t0).TotalSeconds;
                ui.BeginInvoke(new Action(() =>
                {
                    notebookBackfilling = false;
                    Store.Log($"小本子补算：{count} 个事件，用时 {took:0.0}s");
                    if (json != "null") Js($"applyNotebookBackfill({json})");
                }));
            });
        }

        // ---------------- 窗口 ----------------
        void OpenOwnNotebook() => OpenNotebook(current, Host.Bounds, Host.DpiScale, "main");

        /// <summary>near：她的窗口（物理像素）；dpi：她那块屏幕的系统缩放</summary>
        public void OpenNotebook(string character, Rectangle near, double dpi, string owner)
        {
            CloseNotebook(false);
            if (!ready || character == null) return;
            var h = new NotebookHost();
            notebook = h;
            notebookCharacter = character;
            NotebookOwner = owner;
            notebookNear = near;
            notebookDpi = dpi > 0 ? dpi : 1;
            h.Deactivate += (_, __) => { if (h == notebook) CloseNotebook(); };   // 点了别处（别的程序、桌面）
            h.Load += async (_, __) =>
            {
                try
                {
                    await h.Web.EnsureCoreWebView2Async(env);
                    if (h != notebook) return;
                    var core = h.Web.CoreWebView2;
                    Map(core);
                    core.Settings.AreDefaultContextMenusEnabled = false;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.IsZoomControlEnabled = false;
                    core.Settings.IsStatusBarEnabled = false;
                    core.WebMessageReceived += (_, a) =>
                    {
                        try { if (Store.Json.DeserializeObject(a.WebMessageAsJson) is Dictionary<string, object> m) HandleNotebook(h, m); }
                        catch { }
                    };
                    core.Navigate(Store.PageUrl("notebook.html"));
                }
                catch (Exception e) { Store.Log("小本子打开失败: " + e.Message); if (h == notebook) CloseNotebook(false); }
            };
            h.Show();
        }

        /// <summary>notebook.html 发来的：ready → 取数据画出来；size → 摆好、显示、翻开；closed → 关窗口</summary>
        async void HandleNotebook(NotebookHost h, Dictionary<string, object> m)
        {
            if (h != notebook) return;
            if (m.TryGetValue("ready", out var rv) && rv is bool r && r)
            {
                string json = null;
                try { json = Store.Json.Deserialize<string>(await web.CoreWebView2.ExecuteScriptAsync($"JSON.stringify(notebookFor({Q(notebookCharacter)}))")); }
                catch { }
                if (h != notebook) return;
                if (string.IsNullOrEmpty(json) || json == "null") { CloseNotebook(false); return; }
                try { await h.Web.CoreWebView2.ExecuteScriptAsync($"render({json})"); } catch { }
            }
            if (m.TryGetValue("size", out var sv) && sv is Dictionary<string, object> s && s.TryGetValue("w", out var wv) && s.TryGetValue("h", out var hv))
            {
                // 网页量的是 CSS 像素：× 系统缩放 × Windows 文本大小（WebView2 把它算进网页缩放）= 物理像素
                var k = notebookDpi * WindowsTextScale();
                var size = new CompanionPlace.Size(Math.Ceiling(Convert.ToDouble(wv) * k), Math.Ceiling(Convert.ToDouble(hv) * k));
                var work = Forms.Screen.FromRectangle(notebookNear).WorkingArea;
                var p = NotebookPlace.Place(new CompanionPlace.Rect(notebookNear.X, notebookNear.Y, notebookNear.Width, notebookNear.Height), size,
                    new CompanionPlace.Rect(work.X, work.Y, work.Width, work.Height), Math.Round(12 * notebookDpi));
                var wasShown = h.Left > -5000;
                h.Bounds = new Rectangle((int)Math.Round(p.X), (int)Math.Round(p.Y), (int)p.W, (int)p.H);
                if (wasShown) return;
                h.Activate();
                h.Web.Focus();
                After(50, () => { if (h == notebook) try { _ = h.Web.CoreWebView2?.ExecuteScriptAsync("openBook()"); } catch { } });
            }
            if (m.TryGetValue("closed", out var cv) && cv is bool c && c) CloseNotebook(false);
        }

        /// <summary>前台窗口换了（Pet.Start 的 ForegroundWatcher）：不是小本子自己就收起（没能成为前台时 Deactivate 不会来）</summary>
        void NotebookForegroundChanged()
        {
            if (notebook == null || notebookClosing || notebook.Left <= -5000) return;
            if (GetForegroundWindow() != notebook.Handle) CloseNotebook();
        }

        /// <summary>animated：先让页面翻回去（closeBook，翻完发 closed），页面没回 1 秒后也关</summary>
        public void CloseNotebook(bool animated = true)
        {
            var h = notebook;
            if (h == null) return;
            if (animated && h.Left > -5000 && !notebookClosing && h.Web.CoreWebView2 != null)
            {
                notebookClosing = true;
                try { _ = h.Web.CoreWebView2.ExecuteScriptAsync("closeBook()"); } catch { }
                After(1000, () => { if (h == notebook) CloseNotebook(false); });
                return;
            }
            notebook = null;
            notebookCharacter = null;
            NotebookOwner = null;
            notebookClosing = false;
            try { h.Hide(); } catch { }
            // 可能是从它自己网页控件的回调里来的（closed 消息）：Dispose 排到回调返回之后（同 Companion.Close）
            ui.BeginInvoke(new Action(() => { try { h.Close(); h.Dispose(); } catch { } }));
        }

        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    }
}
