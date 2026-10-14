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
        // ---------------- 快捷键隐藏 ----------------
        // 全局快捷键（默认 Ctrl+Alt+P）：按一下藏起来，再按一下出来；双击托盘图标也能叫出来。藏着时 AI 干活也不出来，重开恢复显示
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        const int HotKeyId = 0x4350;
        static readonly (string id, string label, uint vk)[] HotkeyChoices = { ("p", "Ctrl+Alt+P", 0x50), ("h", "Ctrl+Alt+H", 0x48) };
        static string HideHotkey => Store.Settings.TryGetValue("hideHotkey", out var v) && v is string s ? s : "p";
        static string HotkeyLabel => HotkeyChoices.FirstOrDefault(h => h.id == HideHotkey).label;
        bool userHidden, hotkeyFailed;
        void RegisterHideHotKey()
        {
            if (hwnd == IntPtr.Zero) return;
            UnregisterHotKey(hwnd, HotKeyId);
            hotkeyFailed = false;
            var choice = HotkeyChoices.FirstOrDefault(h => h.id == HideHotkey);
            if (choice.id == null) return;
            hotkeyFailed = !RegisterHotKey(hwnd, HotKeyId, 0x0001 | 0x0002 | 0x4000, choice.vk);   // Alt | Ctrl | 不连发
            if (hotkeyFailed) Store.Log($"快捷键 {choice.label} 注册失败（被别的程序占用了）");
        }
        IntPtr HotKeyHook(IntPtr h, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == 0x0312 && wParam.ToInt32() == HotKeyId) { SetUserHidden(!userHidden); handled = true; }   // WM_HOTKEY
            return IntPtr.Zero;
        }
        void SetUserHidden(bool hidden)
        {
            userHidden = hidden;
            if (!hidden) { fullscreenOverride = true; hiddenForFullscreen = false; }
            SetConcealed(hidden);
            // 多桌宠：快捷键藏的是整群，不然叫回来以后旁边还杵着几只
            foreach (var pet in companions.Values)
            {
                pet.userHidden = hidden;
                if (!hidden) { pet.fullscreenOverride = true; pet.hiddenForFullscreen = false; }
                pet.SetConcealed(hidden);
            }
            if (!hidden) RefreshCodexQuota(CodexWhy.Tick);   // 藏着时没查：叫回来补一次（自带间隔，不会多问）
        }

        public void Recenter()
        {
            Undock();
            Store.Settings.Remove(PositionKey); Store.SaveSettings();
            RestorePosition();
            // 只有控制者管「整群」的隐藏状态：小桌宠自己 Recenter 时别再遍历一遍，免得把同伴的状态改乱
            if (!IsCompanion)
            {
                if (userHidden) SetUserHidden(false);   // 快捷键藏起来的：一起恢复（包括动画）
                fullscreenOverride = true; hiddenForFullscreen = false;   // 你主动叫她：全屏时也出来，前台窗口换了再按规则藏
                SetConcealed(false);
                // 小桌宠没有托盘，叫本体回右下角时把它们一起摆回原位
                foreach (var pet in companions.Values) pet.Recenter();
            }
            ApplyLayer();
        }
        bool fullscreenOverride;
    }
}
