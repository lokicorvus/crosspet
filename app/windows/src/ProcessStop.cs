using System;
using System.Diagnostics;

namespace CrossPet
{
    /// <summary>
    /// 收尾一个问完话的子进程：先请它自己退出，等不到才强杀。
    /// 为什么不直接强杀（#48）：问额度起的 `codex app-server` 会在后台起 git 刷新插件市场，
    /// 一问完就 `taskkill /T /F` 整棵树，正好撞上 git 刚启动，Windows 上会间歇弹 git.exe「0xc0000142」错误窗口。
    /// 关掉它的输入，app-server 读到输入结束就自己收尾退出，派生出去的 git 也能正常走完。
    /// 不依赖界面，LogicTests 在 macOS 上也能跑
    /// </summary>
    static class ProcessStop
    {
        /// 返回 true：它自己退出了（或本来就退出了）；false：等了 graceMs 还在，调了 kill
        public static bool Stop(Process p, Action closeInput, int graceMs, Action<Process> kill)
        {
            try { if (p.HasExited) return true; } catch { }
            try { closeInput?.Invoke(); } catch { }
            try { if (p.WaitForExit(graceMs)) return true; } catch { }
            try { kill(p); } catch { }
            return false;
        }
    }
}
