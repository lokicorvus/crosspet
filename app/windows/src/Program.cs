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

        [STAThread]
        static void Main()
        {
            // 只开一个：再次打开时让已经在跑的那个回到右下角
            using (var mutex = new Mutex(true, @"Local\CrossPet-" + Environment.UserName, out var first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\CrossPet-Show-" + Environment.UserName))
            {
                if (!first) { show.Set(); return; }

                Directory.CreateDirectory(Store.Data);
                AppDomain.CurrentDomain.UnhandledException += (_, e) => Store.Log("崩溃: " + e.ExceptionObject);
                Store.Log($"启动 {Store.Version}，{Environment.OSVersion}，64 位进程 = {Environment.Is64BitProcess}");
                System.Windows.Forms.Application.EnableVisualStyles();

                var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                app.DispatcherUnhandledException += (_, e) => { Store.Log("界面异常: " + e.Exception); e.Handled = true; };

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
            }
        }
    }
}
