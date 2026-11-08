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
        string lastHitRects;
        async Task UpdateHitRects()
        {
            if (Host == null || !ready || (Forms.Control.MouseButtons & Forms.MouseButtons.Left) != 0) return;
            var json = await Eval("hitRects()");
            if (json == lastHitRects || json == "null") return;
            lastHitRects = json;
            if (!(Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is object[] list)) return;
            var zoom = (double)Host.Width / pageW;   // 网页像素 → 窗口里的物理像素（画布可能因为文字大小比 260 宽）
            Host.SetHitRects(list.OfType<object[]>().Where(r => r.Length == 4).Select(r => new System.Drawing.Rectangle(
                (int)Math.Floor(Convert.ToDouble(r[0]) * zoom), (int)Math.Floor(Convert.ToDouble(r[1]) * zoom),
                (int)Math.Ceiling(Convert.ToDouble(r[2]) * zoom), (int)Math.Ceiling(Convert.ToDouble(r[3]) * zoom))));
        }

        // ---------------- 鼠标：单击摸头、拖动换位置、右键菜单（网页交来，见 index.html 的 setPointerBridge） ----------------
        bool HandlePointer(Dictionary<string, object> m)
        {
            if (!(m.TryGetValue("pointer", out var pv) && pv is string pointer)) return false;
            // 拖窗口要进系统的移动循环（松手才返回）、菜单要等弹出：都排到网页控件的回调返回之后
            if (pointer == "drag") ui.BeginInvoke(new Action(Drag));
            // 点的位置是网页坐标（CSS 像素）：网页要知道是不是点在「新功能」卡片的按钮上
            else if (pointer == "click") Js($"handleClick('pat', {Num(Convert.ToDouble(m["x"]))}, {Num(Convert.ToDouble(m["y"]))})");
            // 按住 Shift 右键才出现「开发者控制台」（macOS 版是 ⌥）
            else if (pointer == "menu") { var shift = m.TryGetValue("shift", out var sv) && sv is bool b && b; ui.BeginInvoke(new Action(() => ShowMenu(shift))); }
            return true;
        }

        void Drag()
        {
            CloseHoverMenu();
            Undock();
            // 甩：拖动时横向来回反转方向（记住这个方向上的最远点，往回超过 18（按 100% 缩放算）算一次反转），0.9 秒内两次以上就算在甩（惹她生气）
            var turn = 18 * Host.DpiScale;
            bool shook = false; double swingX = Host.Left, swingDir = 0; var swings = new List<DateTime>(); var lastShake = DateTime.MinValue;
            EventHandler onMove = (_, __) =>
            {
                double x = Host.Left;
                if (swingDir == 0) { if (Math.Abs(x - swingX) > turn) { swingDir = x > swingX ? 1 : -1; swingX = x; } }
                else if ((x - swingX) * swingDir > 0) swingX = x;
                else if ((swingX - x) * swingDir > turn)
                {
                    swingDir = -swingDir; swingX = x;
                    swings.Add(DateTime.UtcNow);
                    swings.RemoveAll(t => (DateTime.UtcNow - t).TotalSeconds > 0.9);
                    if (swings.Count >= 2 && (DateTime.UtcNow - lastShake).TotalSeconds > 0.3) { shook = true; lastShake = DateTime.UtcNow; Js("shaken()"); }
                }
            };
            Host.LocationChanged += onMove;
            try { Host.DragMove(); } catch { }
            Host.LocationChanged -= onMove;
            SavePosition();
            if (!shook) CheckDock();   // 甩她的时候松手不贴边
        }

        void ShowMenu(bool shift)
        {
            CloseHoverMenu();
            openMenu?.Close();
            var menu = new Forms.ContextMenuStrip();
            FillMenu(menu, shift);
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
                ui.BeginInvoke(new Action(menu.Dispose));
            };
            openMenu = menu;
            menu.Show(Forms.Cursor.Position);
        }

        /// <summary>开着的右键菜单：藏起来（全屏、快捷键）时一起关掉，不然桌宠藏了、菜单还单独挂在屏幕上</summary>
        Forms.ContextMenuStrip openMenu;

        static bool MenuCovers(Forms.ToolStripDropDown d, System.Drawing.Point p) =>
            d.Visible && (d.Bounds.Contains(p) || d.Items.OfType<Forms.ToolStripDropDownItem>().Any(i => i.HasDropDownItems && MenuCovers(i.DropDown, p)));
    }
}
