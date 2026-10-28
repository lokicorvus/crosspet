using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;

namespace CrossPet
{
    // WPF 合成线程已损坏后，只做文件/进程交接，不能 Close/Dispose WebView2。
    // net48 的 Environment.Exit 也会运行终结器（#28：HwndHost.Finalize 内的 COM 强转崩溃）。
    static class RenderRecovery
    {
        static string Mark => Path.Combine(Store.Data, "render-restart.txt");
        static int restarting;
        static DispatcherTimer healthyTimer;
        static bool notice;

        static RenderRestartState ReadState() => File.Exists(Mark)
            ? RenderRestartState.Parse(File.ReadAllText(Mark), File.GetLastWriteTimeUtc(Mark)) : new RenderRestartState(0, DateTime.UtcNow);

        public static void Started()
        {
            try
            {
                var state = ReadState();
                notice = state.Attempts > 0 && state.Recent(DateTime.UtcNow);
                if (notice) Store.Log($"检测到上次渲染失败记录：已尝试重启 {state.Attempts} 次，等待网页稳定");
            }
            catch (Exception e) { Store.Log("读取渲染恢复记录失败: " + e.Message); }
        }

        // 返回是否需要提示：每进程只提示一次。必须网页就绪，且 UI 线程继续工作两分钟才算恢复成功。
        public static bool Ready()
        {
            healthyTimer?.Stop();
            healthyTimer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(2) };
            healthyTimer.Tick += (_, __) =>
            {
                healthyTimer.Stop();
                if (Volatile.Read(ref restarting) != 0 || !File.Exists(Mark)) return;   // 没出过故障就不写这行（不然每次启动都记一条，排查时误导人）
                try { File.Delete(Mark); Store.Log("渲染恢复确认：网页已稳定运行 2 分钟，重试计数清零"); }
                catch (Exception e) { Store.Log("清除渲染恢复记录失败: " + e.Message); }
            };
            healthyTimer.Start();
            var show = notice; notice = false;
            return show;
        }

        public static void Restart()
        {
            if (Interlocked.Exchange(ref restarting, 1) != 0) return;
            healthyTimer?.Stop();
            try
            {
                var next = ReadState().Next(DateTime.UtcNow);
                if (next != null)
                {
                    // 先落盘再交接；若记录不可写就停止，不能在没有预算保护的情况下无限重启。
                    var temp = Mark + ".tmp";
                    File.WriteAllText(temp, next.Serialize());
                    if (File.Exists(Mark)) File.Replace(temp, Mark, null); else File.Move(temp, Mark);
                    Store.Log($"渲染线程挂了，自动重启 CrossPet（第 {next.Attempts}/{RenderRestartState.MaxAttempts} 次）");
                }
                else Store.Log("渲染线程连续失败，重试预算已耗尽，停止自动重启并提示手动打开");
                var parent = Process.GetCurrentProcess();
                // 不经过 cmd/start（安装路径可能含空格、& 等）；子进程先等父进程真正退出，再抢单实例锁。
                var args = $"--render-restart {parent.Id} {parent.StartTime.ToUniversalTime().Ticks} {(next == null ? "stop" : "retry")}";
                if (Process.Start(new ProcessStartInfo(Path.Combine(Store.Install, "CrossPet.exe"), args)
                    { UseShellExecute = false, WorkingDirectory = Store.Install }) == null)
                    throw new InvalidOperationException("未能创建接班进程");
            }
            catch (Exception e)
            {
                Store.Log("自动重启失败: " + e.Message);
                MessageBoxW(IntPtr.Zero, "CrossPet 的画面出了问题，自动重启没有成功。请手动重新打开；若反复发生，请提交反馈。", "CrossPet", 0x10);
            }
            // 只终止自身。让内核回收已损坏的进程，跳过 CLR 终结器和 WebView2 COM 清理。
            // 设置在正常操作时已保存；此处不尝试在坏掉的界面上再次保存/释放控件。
            TerminateProcess(GetCurrentProcess(), 0);
            Environment.FailFast("终止损坏的渲染进程失败"); // 极少数内核调用失败时也不能回到托管清理路径。
        }

        // 在 Main 进入单实例锁、创建 Application/WebView2 之前执行。
        public static bool WaitForParent(string[] args)
        {
            if (args.Length == 0 || args[0] != "--render-restart") return true;
            if (args.Length != 4 || !int.TryParse(args[1], out var pid) || pid <= 0
                || !long.TryParse(args[2], out var ticks) || (args[3] != "retry" && args[3] != "stop")) return false;
            try
            {
                Process parent;
                try { parent = Process.GetProcessById(pid); } catch (ArgumentException) { parent = null; }
                using (parent)
                {
                    // PID 可能已被系统复用；只能等待原来那一个进程。
                    if (parent != null && parent.StartTime.ToUniversalTime().Ticks == ticks && !parent.WaitForExit(15000))
                    { Store.Log("渲染恢复接班超时：旧进程未退出，不启动重复实例"); return false; }
                }
            }
            catch (InvalidOperationException) { /* 在读取时间或等待前刚好退出，单实例锁会在后面继续防重。 */ }
            catch (Exception e) { Store.Log("渲染恢复接班失败: " + e.Message); return false; }
            if (args[3] == "stop")
            {
                MessageBoxW(IntPtr.Zero, "CrossPet 的图形组件连续出错，已停止自动重启以免循环。请手动重新打开，并通过托盘提交反馈。设置和角色文件已保留。", "CrossPet", 0x30);
                return false;
            }
            Store.Log("渲染恢复接班：旧进程已退出，开始重新打开");
            return true;
        }

        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int MessageBoxW(IntPtr hwnd, string text, string caption, uint type);
    }
}
