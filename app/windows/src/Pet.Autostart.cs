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
        // ---------------- 跟着 AI 出现 ----------------
        // 接入的 AI 开始工作时，钩子脚本 / DSH 插件发现桌宠没在跑（查单实例互斥量）就把它打开。
        // 从菜单手动退出 = 这会儿不想看到它：记下 user-quit（看文件修改时间），在那之前就开着的 AI 不再把它拉起来；
        // AI 程序关掉重开、重启电脑后就作废，自己打开桌宠也会清掉（见 Program）。
        // 设置里关掉「AI 开始工作时自动出现」= 写 ai-autostart-off。一键更新时的退出不算手动退出。
        public static string UserQuitFlag => Path.Combine(Store.Data, "user-quit");
        static string AIAutostartOffFlag => Path.Combine(Store.Data, "ai-autostart-off");
        static bool AIAutostart => !File.Exists(AIAutostartOffFlag);
        static void SetAIAutostart(bool on)
        {
            try { if (on) File.Delete(AIAutostartOffFlag); else File.WriteAllText(AIAutostartOffFlag, ""); }
            catch (Exception e) { Store.Log("设置跟着 AI 出现失败: " + e.Message); }
        }

        /// 菜单里的「退出」：用户主动退出。第一次退出时说一句，让人知道什么时候会再出来
        void UserQuit()
        {
            try { File.WriteAllText(UserQuitFlag, ""); } catch { }
            // 挥手道别再走；第一次退出时说明什么时候会再出来，多停一会儿让人看清
            var hint = AIAutostart && !Store.Flag("quitHinted");
            if (hint) { Store.Settings["quitHinted"] = true; Store.SaveSettings(); }
            Js(hint ? "farewell('我先走啦～下次重新打开 AI 我再出来', 5000)" : "farewell(null, 2000)");
            CompanionsJs($"farewell(null, {(hint ? 5000 : 2000)})");   // 多桌宠：额外那几只也一起挥手、同一时刻走开
            var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(hint ? 5 : 2) };
            t.Tick += (_, __) => { t.Stop(); Quit(); };
            t.Start();
        }

        public void Quit()
        {
            CloseHoverMenu(); hoverHost?.Dispose();
            foreground?.Dispose();
            tray.Visible = false; tray.Dispose();
            Application.Current.Shutdown();
        }

        // ---------------- 开机启动（当前用户的 Run 注册表项，不需要管理员） ----------------
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        static string Exe => Process.GetCurrentProcess().MainModule.FileName;
        static bool LoginEnabled
        {
            get { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return (k?.GetValue("CrossPet") as string)?.Contains(Exe) == true; }
        }
        static void ToggleLogin()
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                if (LoginEnabled) k.DeleteValue("CrossPet", false); else k.SetValue("CrossPet", $"\"{Exe}\"");
        }
    }
}
