using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Wpf = System.Windows;
using WpfControls = System.Windows.Controls;
using WpfMedia = System.Windows.Media;

namespace HostSpike
{
    // 试验 C：同一台电脑、同一套测量，比三种放网页的办法
    //   V0 现在的做法：WPF 透明窗口（AllowsTransparency）+ WebView2CompositionControl（把网页画面截下来贴进 WPF）
    //   V1 普通窗口去掉重定向画布（WS_EX_NOREDIRECTIONBITMAP）+ 普通 WebView2（子窗口，系统 DWM 直接合成）
    //   V2 V1 再加 WS_EX_LAYERED（SetLayeredWindowAttributes 255）：WS_EX_TRANSPARENT 一般要配它鼠标才穿得过去
    // 每种都看：开窗口时界面线程停多久、透明对不对（边缘有没有黑边白边）、鼠标能不能只在人物身上点到、拖动、清晰度
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControlForm());
        }
    }

    static class Native
    {
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x08000000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
        [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    }

    /// <summary>界面线程停顿：16ms 一跳的计时器，两跳之间隔太久就是界面线程被占住了（所有窗口一起冻住）</summary>
    static class Probe
    {
        static readonly Stopwatch clock = Stopwatch.StartNew();
        static readonly List<(long at, long gap)> gaps = new List<(long, long)>();
        public static readonly List<string> Lines = new List<string>();
        public static Action<string> Sink;
        static long last;
        public static long Now => clock.ElapsedMilliseconds;

        public static void Start()
        {
            var t = new Timer { Interval = 16 };
            last = Now;
            t.Tick += (_, __) =>
            {
                var now = Now; var gap = now - last; last = now;
                if (gap > 60) { gaps.Add((now, gap)); Mark($"界面线程停了 {gap}ms"); }
            };
            t.Start();
        }

        public static void Mark(string s)
        {
            var line = $"{Now,8} {s}";
            Lines.Add(line);
            Sink?.Invoke(line);
        }

        /// <summary>[from, to] 这段时间里的停顿：几次、最长、合计（每次减掉正常的一跳 16ms）</summary>
        public static (int count, long max, long sum) Stalls(long from, long to)
        {
            var g = gaps.Where(x => x.at >= from && x.at - x.gap <= to).ToList();
            return (g.Count, g.Count == 0 ? 0 : g.Max(x => x.gap), g.Sum(x => x.gap - 16));
        }
    }

    interface IPet { void Close(); }

    static class Page
    {
        public static CoreWebView2Environment Env;
        public static string Url => "https://spike.local/spike.html";

        public static void Setup(CoreWebView2 core)
        {
            core.SetVirtualHostNameToFolderMapping("spike.local", AppDomain.CurrentDomain.BaseDirectory, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
        }

        static readonly Regex HitRx = new Regex(@"""hit"":\[([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\],""dpr"":([-\d.eE]+)");
        /// <summary>页面报来的能点那块（CSS 像素）和 devicePixelRatio</summary>
        public static bool ParseHit(string json, out RectangleF r, out double dpr)
        {
            r = default; dpr = 1;
            var m = HitRx.Match(json);
            if (!m.Success) return false;
            float F(int i) => float.Parse(m.Groups[i].Value, CultureInfo.InvariantCulture);
            r = new RectangleF(F(1), F(2), F(3), F(4));
            dpr = double.Parse(m.Groups[5].Value, CultureInfo.InvariantCulture);
            return true;
        }
    }

    // ---------------- V0：现在的做法 ----------------
    sealed class WpfPet : IPet
    {
        readonly Wpf.Window w;
        readonly Microsoft.Web.WebView2.Wpf.WebView2CompositionControl web;
        readonly WpfControls.Canvas hit = new WpfControls.Canvas();
        readonly WpfControls.Border hitBox = new WpfControls.Border { Background = new WpfMedia.SolidColorBrush(WpfMedia.Color.FromArgb(1, 0, 0, 0)) };
        readonly string name;

        public WpfPet(string name, double left, double top)
        {
            this.name = name;
            var t0 = Probe.Now;
            w = new Wpf.Window
            {
                WindowStyle = Wpf.WindowStyle.None, AllowsTransparency = true, Background = WpfMedia.Brushes.Transparent,
                Width = 300, Height = 380, Left = left, Top = top, Topmost = true, ShowInTaskbar = false, ShowActivated = false, ResizeMode = Wpf.ResizeMode.NoResize,
            };
            web = new Microsoft.Web.WebView2.Wpf.WebView2CompositionControl { DefaultBackgroundColor = Color.Transparent, IsHitTestVisible = false };
            var grid = new WpfControls.Grid();
            grid.Children.Add(web);
            hit.Children.Add(hitBox);
            grid.Children.Add(hit);
            w.Content = grid;
            hitBox.MouseLeftButtonDown += (_, e) =>
            {
                var start = e.GetPosition(w); var moved = false;
                hitBox.CaptureMouse();
                Wpf.Input.MouseEventHandler mv = null;
                mv = (s, e2) =>
                {
                    var p = e2.GetPosition(w);
                    if (moved || Math.Abs(p.X - start.X) + Math.Abs(p.Y - start.Y) <= 4) return;
                    moved = true; hitBox.ReleaseMouseCapture(); hitBox.MouseMove -= mv;
                    try { w.DragMove(); } catch { }
                };
                hitBox.MouseMove += mv;
                Wpf.Input.MouseButtonEventHandler up = null;
                up = (s, e3) => { hitBox.MouseMove -= mv; hitBox.MouseLeftButtonUp -= up; hitBox.ReleaseMouseCapture(); if (!moved) _ = web.CoreWebView2?.ExecuteScriptAsync("clicked()"); };
                hitBox.MouseLeftButtonUp += up;
            };
            w.Loaded += async (_, __) => await Init();
            w.Show();
            Probe.Mark($"{name} 构造+Show 用了 {Probe.Now - t0}ms");
        }

        async Task Init()
        {
            var t0 = Probe.Now;
            await web.EnsureCoreWebView2Async(Page.Env);
            Probe.Mark($"{name} EnsureCoreWebView2Async 等了 {Probe.Now - t0}ms");
            var core = web.CoreWebView2;
            Page.Setup(core);
            core.WebMessageReceived += (_, a) =>
            {
                if (!Page.ParseHit(a.WebMessageAsJson, out var r, out double _)) return;
                WpfControls.Canvas.SetLeft(hitBox, r.X); WpfControls.Canvas.SetTop(hitBox, r.Y); hitBox.Width = r.Width; hitBox.Height = r.Height;
            };
            core.NavigationCompleted += (_, __) => Probe.Mark($"{name} 网页加载完（距开始 {Probe.Now - t0}ms）");
            core.Navigate(Page.Url);
        }

        public void Close() { try { web.Dispose(); } catch { } w.Close(); }
    }

    // ---------------- V1 / V2：系统直接合成 ----------------
    sealed class FormPet : Form, IPet
    {
        readonly bool layered;
        readonly string name;
        readonly Microsoft.Web.WebView2.WinForms.WebView2 web = new Microsoft.Web.WebView2.WinForms.WebView2 { DefaultBackgroundColor = Color.Transparent, Dock = DockStyle.Fill };
        readonly Timer passTimer = new Timer { Interval = 30 };
        RectangleF hitCss; double dpr = 1; bool hasHit;
        public int Toggles;
        long t0;

        public FormPet(string name, bool layered, int left, int top, float scale)
        {
            this.name = name; this.layered = layered;
            t0 = Probe.Now;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Bounds = new Rectangle(left, top, (int)(300 * scale), (int)(380 * scale));
            Controls.Add(web);
            passTimer.Tick += (_, __) => UpdatePassThrough();
            Load += async (_, __) => await Init();
            Show();
            Probe.Mark($"{name} 构造+Show 用了 {Probe.Now - t0}ms");
        }

        protected override bool ShowWithoutActivation => true;
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= Native.WS_EX_NOREDIRECTIONBITMAP | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_TRANSPARENT;
                if (layered) cp.ExStyle |= Native.WS_EX_LAYERED;
                return cp;
            }
        }
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (layered) Native.SetLayeredWindowAttributes(Handle, 0, 255, 2 /* LWA_ALPHA */);
        }
        protected override void OnPaintBackground(PaintEventArgs e) { }   // 没有重定向画布，画了也看不见；不画省事

        async Task Init()
        {
            var t1 = Probe.Now;
            await web.EnsureCoreWebView2Async(Page.Env);
            Probe.Mark($"{name} EnsureCoreWebView2Async 等了 {Probe.Now - t1}ms");
            var core = web.CoreWebView2;
            Page.Setup(core);
            core.WebMessageReceived += (_, a) =>
            {
                var json = a.WebMessageAsJson;
                if (json.Contains("\"drag\"")) { Native.ReleaseCapture(); Native.SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero); return; }
                if (Page.ParseHit(json, out var r, out var d)) { hitCss = r; dpr = d; hasHit = true; }
            };
            core.NavigationCompleted += (_, __) => Probe.Mark($"{name} 网页加载完（距开始 {Probe.Now - t1}ms）");
            core.Navigate(Page.Url);
            passTimer.Start();
        }

        /// <summary>鼠标在人物 / 气泡上：去掉 WS_EX_TRANSPARENT 让她接鼠标；别处加上，鼠标穿到后面的窗口。按着左键（拖动中）不改</summary>
        void UpdatePassThrough()
        {
            if (!hasHit || IsDisposed) return;
            if (Native.GetAsyncKeyState(0x01) < 0) return;
            Native.GetCursorPos(out var p);
            Native.GetWindowRect(Handle, out var wr);
            var box = new RectangleF((float)(wr.Left + hitCss.X * dpr), (float)(wr.Top + hitCss.Y * dpr), (float)(hitCss.Width * dpr), (float)(hitCss.Height * dpr));
            var over = box.Contains(p);
            var ex = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
            var want = over ? ex & ~Native.WS_EX_TRANSPARENT : ex | Native.WS_EX_TRANSPARENT;
            if (want != ex) { Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, want); Toggles++; }
        }

        public new void Close()
        {
            passTimer.Stop();
            Probe.Mark($"{name} 关掉（鼠标穿透切换了 {Toggles} 次）");
            try { web.Dispose(); } catch { }
            base.Close();
        }
    }

    // ---------------- 控制窗口 ----------------
    sealed class ControlForm : Form
    {
        readonly RadioButton v0 = new RadioButton { Text = "V0 现在的做法（WPF + 截图贴图）", AutoSize = true, Checked = true };
        readonly RadioButton v1 = new RadioButton { Text = "V1 系统直接合成", AutoSize = true };
        readonly RadioButton v2 = new RadioButton { Text = "V2 系统直接合成 + 分层窗口", AutoSize = true };
        readonly TextBox log = new TextBox { Multiline = true, ScrollBars = ScrollBars.Vertical, ReadOnly = true, Dock = DockStyle.Fill, Font = new Font("Consolas", 9) };
        readonly TextBox summary = new TextBox { Multiline = true, ReadOnly = true, Dock = DockStyle.Top, Height = 150, Font = new Font("Microsoft YaHei", 10) };
        readonly List<IPet> pets = new List<IPet>();
        int serial;

        public ControlForm()
        {
            Text = "CrossPet 试验 C · 开窗口卡不卡";
            Width = 760; Height = 640;
            StartPosition = FormStartPosition.Manual; Location = new Point(40, 40);
            var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 90, AutoSize = true, Padding = new Padding(6) };
            top.Controls.AddRange(new Control[] { v0, v1, v2 });
            void Btn(string text, Action a) { var b = new Button { Text = text, AutoSize = true }; b.Click += (_, __) => a(); top.Controls.Add(b); }
            Btn("开 1 只", () => Open(1, 0));
            Btn("一秒一只开 6 只", () => Open(6, 1000));
            Btn("一起开 6 只", () => Open(6, 0));
            Btn("全部关掉", CloseAll);
            Btn("保存日志", Save);
            Controls.Add(log);
            Controls.Add(summary);
            Controls.Add(top);
            Probe.Sink = line => { if (!IsDisposed) log.AppendText(line + "\r\n"); };
            Load += async (_, __) =>
            {
                Probe.Start();
                var dir = Path.Combine(Path.GetTempPath(), "CrossPetHostSpike");
                Page.Env = await CoreWebView2Environment.CreateAsync(null, dir);
                Probe.Mark($"WebView2 {Page.Env.BrowserVersionString} 准备好了；屏幕缩放 {DeviceDpi * 100 / 96}%");
                summary.AppendText($"屏幕缩放 {DeviceDpi * 100 / 96}%，WebView2 {Page.Env.BrowserVersionString}\r\n");
            };
        }

        string Mode => v0.Checked ? "V0" : v1.Checked ? "V1" : "V2";

        void Open(int count, int stepMs)
        {
            if (Page.Env == null) return;
            var mode = Mode;
            var t0 = Probe.Now;
            Probe.Mark($"---- {mode} 开 {count} 只（间隔 {stepMs}ms）----");
            var wa = Screen.PrimaryScreen.WorkingArea;
            var scale = DeviceDpi / 96f;
            for (int i = 0; i < count; i++)
            {
                var k = i;
                void One()
                {
                    var name = $"{mode}#{++serial}";
                    var slot = pets.Count % 6;
                    int x = wa.Left + (int)((360 + slot * 220) * scale), y = wa.Bottom - (int)(400 * scale);
                    if (mode == "V0") pets.Add(new WpfPet(name, x / scale, y / scale));
                    else pets.Add(new FormPet(name, mode == "V2", x, y, scale));
                }
                if (stepMs == 0) One();
                else { var t = new Timer { Interval = Math.Max(1, k * stepMs) }; t.Tick += (_, __) => { t.Stop(); t.Dispose(); One(); }; t.Start(); }
            }
            var span = (count - 1) * stepMs + 3000;
            var done = new Timer { Interval = span };
            done.Tick += (_, __) =>
            {
                done.Stop(); done.Dispose();
                var (n, max, sum) = Probe.Stalls(t0, t0 + span);
                var line = $"{mode} 开 {count} 只{(stepMs > 0 ? "（一秒一只）" : count > 1 ? "（一起）" : "")}：停了 {n} 次，最长 {max}ms，合计 {sum}ms";
                summary.AppendText(line + "\r\n");
                Probe.Mark("结果：" + line);
            };
            done.Start();
        }

        void CloseAll()
        {
            foreach (var p in pets) try { p.Close(); } catch { }
            pets.Clear();
            Probe.Mark("---- 全部关掉 ----");
        }

        void Save()
        {
            var text = summary.Text + "\r\n" + string.Join("\r\n", Probe.Lines);
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "CrossPet试验C-日志.txt");
            File.WriteAllText(path, text, new System.Text.UTF8Encoding(true));
            MessageBox.Show(this, "存到了 " + path);
        }
    }
}
