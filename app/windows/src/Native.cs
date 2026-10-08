using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CrossPet
{
    /// <summary>用到的几个 Windows 系统调用：窗口样式、置顶、按像素摆位置、监听前台窗口切换。</summary>
    static class Native
    {
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1), HWND_NOTOPMOST = new IntPtr(-2);
        public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;
        const uint EVENT_SYSTEM_FOREGROUND = 0x0003, WINEVENT_OUTOFCONTEXT = 0, WINEVENT_SKIPOWNPROCESS = 0x2;
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

        delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint thread, uint flags);
        [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);

        /// <summary>不抢焦点、不出现在 Alt+Tab 里</summary>
        public static void MakeToolWindow(IntPtr hwnd) =>
            SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);

        /// <summary>重新放到最顶层（不抢焦点、不挪位置）。别的置顶窗口激活后会盖过来，每次前台切换都调一次</summary>
        public static void BringToTop(IntPtr hwnd) =>
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

        /// <summary>桌宠中间那块有没有被它上面的窗口挡住（顺着 Z 序往上看可见、没最小化、没被系统藏起来的窗口）</summary>
        public static bool Covered(IntPtr hwnd)
        {
            if (!GetWindowRect(hwnd, out var me)) return false;
            int w = me.Right - me.Left, h = me.Bottom - me.Top;
            int left = me.Left + w / 4, right = me.Right - w / 4, top = me.Top + h / 5, bottom = me.Bottom - h / 5;
            for (var other = GetWindow(hwnd, 3); other != IntPtr.Zero; other = GetWindow(other, 3))  // GW_HWNDPREV：Z 序里在它上面的
            {
                if (!IsWindowVisible(other) || IsIconic(other)) continue;
                if (DwmGetWindowAttribute(other, 14, out var cloaked, 4) == 0 && cloaked != 0) continue;  // DWMWA_CLOAKED（别的桌面、挂起的应用）
                if (!GetWindowRect(other, out var r) || r.Right - r.Left <= 0 || r.Bottom - r.Top <= 0) continue;
                if (r.Left < right && r.Right > left && r.Top < bottom && r.Bottom > top) return true;
            }
            return false;
        }

        /// <summary>取消置顶（变成普通窗口，会被别的窗口挡住）</summary>
        /// 取消置顶后系统会把它放在所有普通窗口最前面，还是压在你正在用的窗口上，要等那个窗口再激活一次才盖过来：
        /// 所以再把它挪到当前前台窗口的后面（就像你刚点了一下那个窗口）
        public static void DropFromTop(IntPtr hwnd)
        {
            SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            var front = GetForegroundWindow();
            if (front != IntPtr.Zero && front != hwnd)
                SetWindowPos(hwnd, front, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        // 用户现在是不是在全屏程序里（全屏视频 / 游戏 / 演示）：系统自己判断「这时候别打扰」用的就是它
        [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
        public static bool InFullscreen()
        {
            try { return SHQueryUserNotificationState(out var s) == 0 && (s == 2 || s == 3 || s == 4); }   // BUSY / D3D 全屏 / 演示模式
            catch { return false; }
        }

        public static void MoveTo(IntPtr hwnd, int x, int y) =>
            SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);

        /// <summary>前台窗口所属程序的文件名（小写，如 codex.exe）；取不到返回空串。只看程序名，不读窗口标题和内容</summary>
        public static string ForegroundExe()
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "";
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == 0) return "";
            var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return "";
            try
            {
                var sb = new StringBuilder(1024); int size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? Path.GetFileName(sb.ToString()).ToLowerInvariant() : "";
            }
            finally { CloseHandle(h); }
        }

        /// <summary>前台窗口一变就回调（系统事件推送，不用轮询）。返回值要一直留着，否则回调会被回收</summary>
        public sealed class ForegroundWatcher : IDisposable
        {
            readonly WinEventProc proc;
            readonly IntPtr hook;
            public ForegroundWatcher(Action changed)
            {
                proc = (h, e, w, o, c, t, time) => changed();
                hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, proc, 0, 0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            }
            public void Dispose() { if (hook != IntPtr.Zero) UnhookWinEvent(hook); }
        }
    }
}
