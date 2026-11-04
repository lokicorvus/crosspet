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
        // ---------------- 显示层级 ----------------
        // always：始终在最上层；ai：前台是 AI 应用、AI 等你回答、刚干完活时在最上层，其他时候是普通窗口（会被挡住）；
        // normal：普通窗口。另外全屏程序（视频 / 游戏 / 演示）在前台时整个隐藏
        static string LayerMode => Store.Settings.TryGetValue("layer", out var v) && v is string s && (s == "ai" || s == "normal") ? s : "always";
        static bool HideFullscreen => !(Store.Settings.TryGetValue("hideFullscreen", out var v) && v is bool b && !b);
        readonly Dictionary<string, (string pose, DateTime at)> lastPose = new Dictionary<string, (string, DateTime)>();
        bool frontIsAI, frontIsShell, hiddenForFullscreen;

        bool AIActive()
        {
            if (frontIsAI) return true;
            var now = DateTime.UtcNow;
            // 等你回答：一直等到你回答（最长 10 分钟）；刚干完活：浮上来一会儿。
            // AI 在后台干活时不浮上来：选这个模式的人就是嫌挡路，干活时往往正是你切去忙别的
            return lastPose.Values.Any(p => p.pose == "asking" ? (now - p.at).TotalMinutes < 10
                : (now - p.at).TotalSeconds < 8 && (p.pose == "happy" || p.pose == "proud"));
        }

        // ---- 藏起来 / 露出来 ----
        // 不 Hide() / Show()：以前的 WPF 透明窗口反复藏和放有概率让渲染线程挂掉（1.3.2 用户反馈，0x88980406），
        // 一直用「隐身」：窗口一直开着，不透明度 0、鼠标穿透、取消置顶（不压在全屏游戏 / 视频上面），网页动画暂停
        bool concealed;
        void SetConcealed(bool c)
        {
            if (Host == null || concealed == c) return;
            concealed = c;
            Host.ForcePassThrough = c;   // 藏着时鼠标穿过整个窗口
            if (c) { openMenu?.Close(); Host.SetVisible(false); if (hwnd != IntPtr.Zero) Native.DropFromTop(hwnd); }
            else { Host.SetVisible(true); Raise(); }
            UpdatePageHidden();
            SyncCompanionWindows();   // 多桌宠：额外那几只一起藏 / 一起出来
        }

        /// 置顶（层级要求置顶、又没在隐身时）
        void Raise()
        {
            if (!concealed && Host.Topmost && hwnd != IntPtr.Zero) Native.BringToTop(hwnd);
            foreach (var c in AllCompanions) c.Raise();   // 多桌宠：额外那几只也回到最上层
        }
        void UpdatePageHidden()
        {
            Js($"setPageHidden({(concealed || sessionLocked ? "true" : "false")})");
            foreach (var c in AllCompanions) c.UpdatePageHidden();
        }

        /// <summary>多桌宠：额外那几只的层级、隐藏跟着主桌宠，每次对完层级（每 0.3 秒一次）同步一遍；没有额外窗口时什么都不做</summary>
        void ApplyLayer()
        {
            ApplyMainLayer();
            SyncCompanionWindows();
        }

        void ApplyMainLayer()
        {
            if (Host == null || hwnd == IntPtr.Zero) return;
            if (userHidden) return;   // 你用快捷键藏起来了：什么都别把她翻出来
            // 全屏时隐藏；全屏的是 AI 程序（对照表里有的，专心和 AI 干活）照常显示，和 macOS 一致
            var hide = HideFullscreen && !fullscreenOverride && !frontIsAI && Native.InFullscreen(hwnd);
            if (hide != hiddenForFullscreen)
            {
                hiddenForFullscreen = hide;
                Store.Log(hide ? $"全屏中，先藏起来（前台 {Native.ForegroundExe()}）" : "退出全屏，出来了");
                SetConcealed(hide);
            }
            var top = ZOrderRule.Top(LayerMode, LayerMode == "ai" && AIActive(), frontIsShell);   // 「跟着 AI」时前台是桌面也置顶（见 ZOrderRule.Top）
            if (Host.Topmost == top || surfacing) return;
            // 原本被别的窗口挡着、要浮上来：先藏起来，换完层级再淡入（没被挡住就直接换，免得闪一下）
            if (top && !hiddenForFullscreen && Native.Covered(hwnd)) { _ = Surface(); return; }
            Host.Topmost = top;
            if (top) Raise();
        }

        bool surfacing;
        async Task Surface()
        {
            surfacing = true;
            try
            {
                await Eval("sink()");
                await Task.Delay(50);
                Host.Topmost = true;
                Raise();
            }
            finally
            {
                surfacing = false;
                Js("surface()");
            }
        }
    }
}
