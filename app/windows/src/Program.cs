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

        /// WPF 渲染线程挂了（0x88980406 UCEERR_RENDERTHREADFAILURE）：这之后窗口不会再重画，当作没事继续跑就是画面冻住
        static bool IsRenderThreadFailure(Exception e)
        {
            for (var x = e; x != null; x = x.InnerException)
                if ((uint)x.HResult == 0x88980406 || (x.Message ?? "").Contains("UCEERR_RENDERTHREADFAILURE")) return true;
            return false;
        }

        // 只从开发者菜单触发；通过 Dispatcher 抛出同一 HRESULT，走真实异常处理与重启交接。
        internal static void InjectRenderFailure() => Application.Current.Dispatcher.BeginInvoke(new Action(() =>
            throw new System.Runtime.InteropServices.COMException("开发测试：UCEERR_RENDERTHREADFAILURE", unchecked((int)0x88980406))));

        /// <summary>安装目录缺东西（#24：上次一键更新删到一半）时不往下走——不然每次启动都崩、用户只看到「打不开」。
        /// 找得到下载好的完整安装包就问要不要用它修复，找不到就指去发布页重新下载</summary>
        static bool InstallComplete()
        {
            var missing = InstallCheck.Missing(Store.Install);
            if (missing.Count == 0) return true;
            Store.Log("安装不完整，缺少：" + string.Join("、", missing));
            var pkg = InstallCheck.RepairPackage(Path.Combine(Path.GetTempPath(), "CrossPet-update"));
            var what = $"CrossPet 的安装不完整（缺少 {string.Join("、", missing)}），多半是上次更新没装完。";
            if (pkg != null)
            {
                var ver = Path.GetFileName(Path.GetDirectoryName(pkg));
                if (MessageBox.Show($"{what}\n\n找到了已经下载好的安装包（{ver}），要现在用它修复吗？设置、角色和 AI 接入都会保留。",
                        "CrossPet", MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes)
                {
                    Store.Log("用下载好的安装包修复：" + pkg);
                    Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{Path.Combine(pkg, "install.ps1")}\"") { UseShellExecute = false });
                }
                return false;
            }
            if (MessageBox.Show($"{what}\n\n请重新下载安装（设置、角色和 AI 接入都会保留）。要现在打开下载页吗？",
                    "CrossPet", MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes)
                Process.Start(new ProcessStartInfo("https://github.com/lokicorvus/crosspet/releases/latest") { UseShellExecute = true });
            return false;
        }

        /// <summary>不是从安装目录打开的（#28）：解压出来的安装包就问要不要现在安装（和一键更新一样在后台跑 install.ps1，装好自己打开），
        /// 还在压缩包里就说先解压。返回 false = 这个进程不往下走</summary>
        static bool FromInstallDir()
        {
            var destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "CrossPet");
            switch (InstallCheck.Locate(Store.Install, destination))
            {
                case InstallCheck.Place.InsideZip:
                    MessageBox.Show("CrossPet 还在压缩包里，没法直接运行。\n\n请先把压缩包整个解压（右键 →「全部解压缩」），再双击解压出来的 CrossPet.exe。",
                        "CrossPet", MessageBoxButton.OK, MessageBoxImage.Information);
                    return false;
                case InstallCheck.Place.Package:
                    if (MessageBox.Show($"要把 CrossPet 安装到这台电脑吗？\n\n会装到 {destination}，在开始菜单建快捷方式，装好后自动打开，不需要管理员权限。" +
                            "已经装过的话就是更新，设置、角色和 AI 接入都保留。\n\n安装要十几秒，装好后桌宠会自己出现。",
                            "安装 CrossPet", MessageBoxButton.OKCancel, MessageBoxImage.Question) == MessageBoxResult.OK)
                    {
                        Store.Log("从安装包安装：" + Store.Install);
                        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{Path.Combine(Store.Install, "install.ps1")}\" -Update")
                            { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Store.Install });
                    }
                    return false;
                default:
                    return true;
            }
        }

        // [STAThread] 必须紧挨着 Main：WPF 和 WebView2 都要求主线程是 STA（中间插了别的函数，Main 就成了 MTA，启动报 RPC_E_CHANGED_MODE）
        [STAThread]
        static void Main(string[] args)
        {
            if (!RenderRecovery.WaitForParent(args)) return;
            if (args.Length == 0 && !FromInstallDir()) return;   // 放在「只开一个」前面：已装的旧版开着时，双击新版的安装包也要能装
            // 只开一个：再次打开时让已经在跑的那个回到右下角
            using (var mutex = new Mutex(true, @"Local\CrossPet-" + Environment.UserName, out var first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\CrossPet-Show-" + Environment.UserName))
            {
                if (!first) { show.Set(); return; }

                Directory.CreateDirectory(Store.Data);
                RenderRecovery.Started();
                try { File.Delete(Pet.UserQuitFlag); } catch { }   // 自己打开了：恢复跟着 AI 出现
                try { Directory.CreateDirectory(Store.State); File.WriteAllText(Path.Combine(Store.State, "pet.pid"), Process.GetCurrentProcess().Id.ToString()); } catch { }   // DSH 插件看它判断桌宠在不在跑
                AppDomain.CurrentDomain.UnhandledException += (_, e) => Store.Log("崩溃: " + e.ExceptionObject);
                Store.Log($"启动 {Store.Version}，{Environment.OSVersion}，64 位进程 = {Environment.Is64BitProcess}");
                if (!InstallComplete()) return;
                System.Windows.Forms.Application.EnableVisualStyles();

                var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                app.DispatcherUnhandledException += (_, e) =>
                {
                    Store.Log("界面异常: " + e.Exception);
                    e.Handled = true;
                    if (IsRenderThreadFailure(e.Exception)) RenderRecovery.Restart();
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
                // 不能做「软件渲染」兼容模式（#28 提过）：网页画面是 WebView2CompositionControl 用 D3DImage 贴进透明窗口的，
                // RenderOptions.ProcessRenderMode = SoftwareOnly 时 D3DImage 不出画面，桌宠整个空白（1.3.8 test.10 实测）

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
