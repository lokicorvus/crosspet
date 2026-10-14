using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace CrossPet
{
    static class Program
    {
        const string WebView2Download = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        /// <summary>单实例锁按「数据目录」区分：同一个 CROSSPET_DATA_DIR 仍然只开一只（再开就把已经在跑的叫到右下角），
        /// 不同的 CROSSPET_DATA_DIR 是不同实例，可以并排显示多只桌宠。标准数据目录不加后缀，和现有 AI 钩子认的名称保持一致</summary>
        static string InstanceTag()
        {
            var d = Store.Data ?? "";
            if (d.Length == 0) return "";
            var standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CrossPet");
            if (string.Equals(Path.GetFullPath(d).TrimEnd('\\', '/'), Path.GetFullPath(standard).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase)) return "";
            unchecked
            {
                uint h = 2166136261u;                       // FNV-1a
                foreach (var ch in d.ToLowerInvariant()) { h = (h ^ ch) * 16777619u; }
                return "-" + h.ToString("x8");
            }
        }

        /// WPF 渲染线程挂了（0x88980406 UCEERR_RENDERTHREADFAILURE）：这之后窗口不会再重画，当作没事继续跑就是画面冻住
        static bool IsRenderThreadFailure(Exception e)
        {
            for (var x = e; x != null; x = x.InnerException)
                if ((uint)x.HResult == 0x88980406 || (x.Message ?? "").Contains("UCEERR_RENDERTHREADFAILURE")) return true;
            return false;
        }

        /// 自动重启一次（位置、角色、设置都在设置文件里，重开就回来了）。2 分钟内最多一次，免得反复重启
        static void RestartAfterRenderFailure()
        {
            var mark = Path.Combine(Store.Data, "render-restart.txt");
            try
            {
                if (File.Exists(mark) && (DateTime.UtcNow - File.GetLastWriteTimeUtc(mark)).TotalMinutes < 2) { Store.Log("渲染线程又挂了，2 分钟内已经重启过一次，不再自动重启"); return; }
                File.WriteAllText(mark, DateTime.Now.ToString("s"));
                Store.Log("渲染线程挂了，自动重启 CrossPet");
                // 等这个进程退出（单实例锁放开）再开新的：交给 cmd 等 2 秒
                var exe = Path.Combine(Store.Install, "CrossPet.exe");
                Process.Start(new ProcessStartInfo("cmd.exe", $"/d /c ping -n 3 127.0.0.1 >nul & start \"\" \"{exe}\"") { UseShellExecute = false, CreateNoWindow = true });
            }
            catch (Exception e) { Store.Log("自动重启失败: " + e.Message); return; }
            Environment.Exit(0);
        }

        [STAThread]
        static void Main()
        {
            // 只开一个：再次打开时让已经在跑的那个回到右下角（多实例补丁：按数据目录区分，见 InstanceTag）
            var tag = InstanceTag();
            using (var mutex = new Mutex(true, @"Local\CrossPet-" + Environment.UserName + tag, out var first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\CrossPet-Show-" + Environment.UserName + tag))
            {
                if (!first) { show.Set(); return; }

                Directory.CreateDirectory(Store.Data);
                try { File.Delete(Pet.UserQuitFlag); } catch { }   // 自己打开了：恢复跟着 AI 出现
                try { Directory.CreateDirectory(Store.State); File.WriteAllText(Path.Combine(Store.State, "pet.pid"), Process.GetCurrentProcess().Id.ToString()); } catch { }   // DSH 插件看它判断桌宠在不在跑
                AppDomain.CurrentDomain.UnhandledException += (_, e) => Store.Log("崩溃: " + e.ExceptionObject);
                Store.Log($"启动 {Store.Version}，{Environment.OSVersion}，64 位进程 = {Environment.Is64BitProcess}");
                System.Windows.Forms.Application.EnableVisualStyles();

                var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                app.DispatcherUnhandledException += (_, e) =>
                {
                    Store.Log("界面异常: " + e.Exception);
                    e.Handled = true;
                    if (IsRenderThreadFailure(e.Exception)) RestartAfterRenderFailure();
                };

                // WebView2 运行时：Windows 11 自带；老的 Windows 10 可能没有，指引去微软官网装
                string version;
                try { version = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch { version = null; }
                if (string.IsNullOrEmpty(version))
                {
                    if (MessageBox.Show("CrossPet 需要系统组件「Microsoft Edge WebView2 运行时」（Windows 11 自带）。\n\n要现在打开微软官网下载吗？",
                        "CrossPet", MessageBoxButton.YesNo, MessageBoxImage.Information) == MessageBoxResult.Yes)
                        Process.Start(new ProcessStartInfo(WebView2Download) { UseShellExecute = true });
                    return;
                }
                Store.Log("WebView2 运行时 " + version);
                Store.LoadSettings();

                app.Startup += async (_, __) =>
                {
                    try
                    {
                        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Store.Data, "webview2"));
                        var pet = new Pet(env);
                        pet.Start();
                        new Thread(() =>
                        {
                            while (show.WaitOne()) app.Dispatcher.BeginInvoke(new Action(pet.Recenter));
                        }) { IsBackground = true }.Start();
                    }
                    catch (Exception e)
                    {
                        Store.Log("启动失败: " + e);
                        MessageBox.Show("CrossPet 启动失败：\n" + e.Message, "CrossPet");
                        app.Shutdown();
                    }
                };
                app.Run();
                try { File.Delete(Path.Combine(Store.State, "pet.pid")); } catch { }
            }
        }
    }
}
