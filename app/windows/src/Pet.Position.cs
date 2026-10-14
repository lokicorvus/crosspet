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
        // ---------------- 位置（按物理像素存，多显示器、不同缩放都对） ----------------
        void RestorePosition()
        {
            Native.GetWindowRect(hwnd, out var r);
            int w = r.Right - r.Left, h = r.Bottom - r.Top, x, y;
            if (Store.Settings.TryGetValue(PositionKey, out var pos) && pos is Dictionary<string, object> p && p.ContainsKey("x"))
            { x = Convert.ToInt32(p["x"]); y = Convert.ToInt32(p["y"]); }
            else if (IsCompanion)
            {
                // 新出现的小桌宠：贴在本体左边依次排开，排不下就换列，尽量不叠在一起
                Native.GetWindowRect(owner.hwnd, out var anchor);
                var screen = Forms.Screen.FromHandle(owner.hwnd).WorkingArea;
                var columns = Math.Max(1, (screen.Width - 40) / (w + 12));
                x = anchor.Left - (slot % columns) * (w + 12);
                y = anchor.Top - (slot / columns) * (h + 12);
                if (x < screen.Left) x = screen.Right - 40 - w - (slot % columns) * (w + 12);
            }
            else { var wa = Forms.Screen.PrimaryScreen.WorkingArea; x = wa.Right - w - 40; y = wa.Bottom - h - 100; }
            var (cx, cy) = Clamp(x, y, w, h);
            Native.MoveTo(hwnd, cx, cy);
            Raise();
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
            Store.Settings[PositionKey] = new Dictionary<string, object> { ["x"] = r.Left, ["y"] = r.Top };
            Store.SaveSettings();
        }
    }
}
