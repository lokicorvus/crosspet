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
        // ---------------- 能点到的区域 ----------------
        Canvas hit;
        static readonly Brush HitBrush = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0));
        string lastHitRects;
        async Task UpdateHitRects()
        {
            if (hit == null || !ready || Mouse.LeftButton == MouseButtonState.Pressed) return;
            var json = await Eval("hitRects()");
            if (json == lastHitRects || json == "null") return;
            lastHitRects = json;
            if (!(Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is object[] list)) return;
            var zoom = Window.Width / pageW;   // 网页像素 → 窗口坐标（画布可能因为文字大小比 260 宽）
            hit.Children.Clear();
            foreach (var item in list)
            {
                if (!(item is object[] r) || r.Length != 4) continue;
                var box = new System.Windows.Shapes.Rectangle { Fill = HitBrush, Width = Convert.ToDouble(r[2]) * zoom, Height = Convert.ToDouble(r[3]) * zoom };
                Canvas.SetLeft(box, Convert.ToDouble(r[0]) * zoom);
                Canvas.SetTop(box, Convert.ToDouble(r[1]) * zoom);
                hit.Children.Add(box);
            }
        }

        // ---------------- 鼠标：单击摸头、拖动换位置、右键菜单 ----------------
        void WireMouse(UIElement hit)
        {
            Point down = default; bool pressed = false;
            // 按下时抓住鼠标：能点的只有桌宠那几块，拖的时候鼠标出了这几块也要继续收到移动
            hit.MouseLeftButtonDown += (_, e) => { down = e.GetPosition(Window); pressed = true; hit.CaptureMouse(); };
            hit.MouseMove += (_, e) =>
            {
                if (!pressed || e.LeftButton != MouseButtonState.Pressed) return;
                var p = e.GetPosition(Window);
                if (Math.Abs(p.X - down.X) + Math.Abs(p.Y - down.Y) <= 4) return;
                pressed = false;
                hit.ReleaseMouseCapture();
                Undock();
                // 甩：拖动时横向来回反转方向（记住这个方向上的最远点，往回超过 18 算一次反转），0.9 秒内两次以上就算在甩（惹她生气）
                bool shook = false; double swingX = Window.Left, swingDir = 0; var swings = new List<DateTime>(); var lastShake = DateTime.MinValue;
                EventHandler onMove = (_, __) =>
                {
                    double x = Window.Left;
                    if (swingDir == 0) { if (Math.Abs(x - swingX) > 18) { swingDir = x > swingX ? 1 : -1; swingX = x; } }
                    else if ((x - swingX) * swingDir > 0) swingX = x;
                    else if ((swingX - x) * swingDir > 18)
                    {
                        swingDir = -swingDir; swingX = x;
                        swings.Add(DateTime.UtcNow);
                        swings.RemoveAll(t => (DateTime.UtcNow - t).TotalSeconds > 0.9);
                        if (swings.Count >= 2 && (DateTime.UtcNow - lastShake).TotalSeconds > 0.3) { shook = true; lastShake = DateTime.UtcNow; Js("shaken()"); }
                    }
                };
                Window.LocationChanged += onMove;
                try { Window.DragMove(); } catch { }
                Window.LocationChanged -= onMove;
                SavePosition();
                if (!shook) CheckDock();   // 甩她的时候松手不贴边
            };
            hit.MouseLeftButtonUp += (_, e) =>
            {
                hit.ReleaseMouseCapture();
                if (!pressed) return;
                pressed = false;
                // 点的位置换成网页坐标（CSS 像素，和可点区域一样按 窗口宽 / 画布宽 换算；不用 ZoomFactor：缩放被自动修正过时它不等于人物大小）：
                // 网页要知道是不是点在「新功能」卡片的按钮上
                var p = e.GetPosition(hit); var z = Math.Max(Window.Width / pageW, 0.01);
                Js($"handleClick('pat', {Num(Math.Round(p.X / z, 1))}, {Num(Math.Round(p.Y / z, 1))})");
            };
            hit.MouseRightButtonUp += (_, __) =>
            {
                openMenu?.Close();
                var menu = new Forms.ContextMenuStrip();
                // 按住 Shift 右键才出现「开发者控制台」（macOS 版是 ⌥）
                FillMenu(menu, (Keyboard.Modifiers & ModifierKeys.Shift) != 0);
                // 菜单靠「程序失去焦点」来关，可桌宠窗口从不拿焦点（WS_EX_NOACTIVATE），点别的程序它收不到，菜单一直挂着。
                // 开着时自己看：鼠标在菜单（含展开的子菜单）外面按下就关
                var watch = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
                watch.Tick += (_, ___) =>
                {
                    if (Forms.Control.MouseButtons != Forms.MouseButtons.None && !MenuCovers(menu, Forms.Cursor.Position)) menu.Close();
                };
                menu.Opened += (_, ___) => watch.Start();
                menu.Closed += (_, ___) =>
                {
                    watch.Stop();
                    if (openMenu == menu) openMenu = null;
                    Window.Dispatcher.BeginInvoke(new Action(menu.Dispose));
                };
                openMenu = menu;
                menu.Show(Forms.Cursor.Position);
            };
        }

        /// <summary>开着的右键菜单：藏起来（全屏、快捷键）时一起关掉，不然桌宠藏了、菜单还单独挂在屏幕上</summary>
        Forms.ContextMenuStrip openMenu;

        static bool MenuCovers(Forms.ToolStripDropDown d, System.Drawing.Point p) =>
            d.Visible && (d.Bounds.Contains(p) || d.Items.OfType<Forms.ToolStripDropDownItem>().Any(i => i.HasDropDownItems && MenuCovers(i.DropDown, p)));
    }
}
