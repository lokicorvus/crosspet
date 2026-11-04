using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Threading;
using Microsoft.Web.WebView2.WinForms;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    /// <summary>
    /// 放桌宠网页的窗口，网页由系统（DWM）直接合成：普通窗口去掉重定向画布（WS_EX_NOREDIRECTIONBITMAP）+ 普通 WebView2 子窗口，
    /// 透明的地方逐像素透出后面。以前用 WPF 透明窗口 + WebView2CompositionControl（把网页画面截下来贴进 WPF），
    /// 每开一个窗口初始化截图通道时整个界面要停 0.3–0.45 秒（1.3.9-test.11、试验 C 实测），集合时「卡一下出来一只」。
    /// 试验 C（tests/windows/HostSpike，11-03）：这样开一只不卡、一秒一只开 6 只也不卡，透明、点击、拖动都正常。
    /// 鼠标：分层窗口（WS_EX_LAYERED，整体不透明度 255）+ 按鼠标位置切 WS_EX_TRANSPARENT——鼠标在能点的那几块上才接，别处穿到后面的窗口。
    /// 网页直接收鼠标，按 setPointerBridge(true) 把按下拖动、单击、右键交给外壳（见 index.html），外壳照旧处理。
    /// 窗口位置、大小一律是物理像素
    /// </summary>
    sealed class DirectHost : Forms.Form
    {
        public WebView2 Web { get; private set; } = NewWeb();
        static WebView2 NewWeb() => new WebView2 { DefaultBackgroundColor = Color.Transparent, Dock = Forms.DockStyle.Fill };
        readonly DispatcherTimer passTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
        List<Rectangle> hitRects = new List<Rectangle>();   // 能点的那几块，窗口内的物理像素
        byte alpha;

        /// <summary>置顶。不用 Form.TopMost：它调 SetWindowPos 时不带 SWP_NOACTIVATE，会抢焦点</summary>
        public bool Topmost
        {
            get => topmost;
            set
            {
                topmost = value;
                if (IsHandleCreated) { if (value) Native.BringToTop(Handle); else Native.DropFromTop(Handle); }
            }
        }
        bool topmost;
        /// <summary>窗口收到的消息先给它看（主桌宠的全局快捷键 WM_HOTKEY）：返回 true = 处理掉了</summary>
        public Func<int, IntPtr, bool> MessageHook { get; set; }

        /// <summary>一直让鼠标穿过（藏着、备着）：不管鼠标在哪都不接</summary>
        public bool ForcePassThrough { get; set; }
        /// <summary>鼠标现在在能点的那几块上（贴边时判断探不探出来）</summary>
        public bool MouseOverHit { get; private set; }

        public DirectHost(bool visible)
        {
            alpha = visible ? (byte)255 : (byte)0;
            Text = "CrossPet";
            FormBorderStyle = Forms.FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = Forms.FormStartPosition.Manual;
            AutoScaleMode = Forms.AutoScaleMode.None;   // 大小由外壳按画布 × 人物大小 × 系统缩放算好，不让 WinForms 再缩
            Bounds = new Rectangle(-10000, -10000, 260, 362);   // 先放屏幕外，拿到窗口句柄后按像素摆到该在的位置
            Controls.Add(Web);
            passTimer.Tick += (_, __) => UpdatePassThrough();
            passTimer.Start();
        }

        protected override bool ShowWithoutActivation => true;
        protected override Forms.CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | WS_EX_TRANSPARENT | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
                if (topmost) cp.ExStyle |= WS_EX_TOPMOST;
                return cp;
            }
        }
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SetLayeredWindowAttributes(Handle, 0, alpha, LWA_ALPHA);
        }
        protected override void OnPaintBackground(Forms.PaintEventArgs e) { }   // 没有重定向画布，画了也看不见
        protected override void WndProc(ref Forms.Message m)
        {
            if (MessageHook != null && MessageHook(m.Msg, m.WParam)) { m.Result = IntPtr.Zero; return; }
            base.WndProc(ref m);
        }

        /// <summary>浏览器进程挂了（网页控件废了）：换一个新的网页控件，返回旧的（调用方 Dispose）</summary>
        public WebView2 ReplaceWeb()
        {
            var old = Web;
            Web = NewWeb();
            Controls.Remove(old);
            Controls.Add(Web);
            return old;
        }

        /// <summary>整个窗口的不透明度：藏起来、备着时 0（和以前 WPF 窗口的 Opacity 一样用来「隐身」）</summary>
        public byte Alpha => alpha;
        public void SetVisible(bool on)
        {
            alpha = on ? (byte)255 : (byte)0;
            if (IsHandleCreated) SetLayeredWindowAttributes(Handle, 0, alpha, LWA_ALPHA);
        }

        public void SetHitRects(IEnumerable<Rectangle> rects) { hitRects = rects.ToList(); UpdatePassThrough(); }
        public void ClearHitRects() { hitRects = new List<Rectangle>(); MouseOverHit = false; }
        public int HitRectCount => hitRects.Count;

        /// <summary>按住左键时不改（拖动中，或在别的窗口上按着拖过来）</summary>
        void UpdatePassThrough()
        {
            if (!IsHandleCreated || IsDisposed) return;
            Native.GetWindowRect(Handle, out var wr);
            GetCursorPos(out var p);
            var local = new Point(p.X - wr.Left, p.Y - wr.Top);
            var over = !ForcePassThrough && hitRects.Any(r => r.Contains(local));
            MouseOverHit = over;
            if (!ForcePassThrough && (Forms.Control.MouseButtons & Forms.MouseButtons.Left) != 0) return;
            var ex = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
            var want = over ? ex & ~WS_EX_TRANSPARENT : ex | WS_EX_TRANSPARENT;
            if (want != ex) Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, want);
        }

        /// <summary>开始拖窗口（网页报了 pointer: 'drag'）：交给系统的移动循环，松手才返回。拖动中 LocationChanged 照常来</summary>
        public void DragMove()
        {
            ReleaseCapture();
            SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
        }

        /// <summary>窗口所在屏幕的系统缩放（1 = 100%）</summary>
        public double DpiScale
        {
            get
            {
                if (!IsHandleCreated) return 1;
                try { var d = GetDpiForWindow(Handle); return d > 0 ? d / 96.0 : 1; } catch { return 1; }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) passTimer.Stop();
            base.Dispose(disposing);
        }

        const int WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_LAYERED = 0x80000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
        const uint LWA_ALPHA = 2;
        [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    }
}
