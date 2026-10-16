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

        void FollowForeground()
        {
            var exe = Native.ForegroundExe();
            var map = Store.ReadJson(Store.AppMap);
            var match = exe == "" ? null : map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
            frontIsAI = !string.IsNullOrWhiteSpace(match);
            ApplyLayer();
            if (!ready || Paused || !Store.Flag("followApps") || exe == "") return;
            if (string.IsNullOrWhiteSpace(match)) return;   // 对照表里没有，或者值留空：这个程序不跟随
            match = HostCharacter(match);
            if (match != current) SwitchTo(match);
        }

        /// <summary>
        /// 一个程序里能用好几家模型（比如 DeepSeek Harness）：它的接入插件把当前角色写在 &lt;角色&gt;-host.json，
        /// 切到这个程序时换成那个角色。一天内写的才算，角色不存在就还用对照表里的
        /// </summary>
        static readonly Dictionary<string, string> HostDefaults = new Dictionary<string, string> { ["zcode"] = "glm", ["qwen"] = "qwen" };
        string HostCharacter(string id)
        {
            var file = Path.Combine(Store.State, id + "-host.json");
            try
            {
                // 还不知道它在用哪个模型（刚装好、还没对话过）：先按它默认的模型换，比如 ZCode 默认是 GLM
                if (!File.Exists(file) || (DateTime.UtcNow - File.GetLastWriteTimeUtc(file)).TotalHours > 24)
                    return HostDefaults.TryGetValue(id, out var d) && Characters().Any(x => x.id == d) ? d : id;
            }
            catch { return id; }
            var host = Store.ReadJson(file);
            var c = host != null && host.TryGetValue("character", out var v) ? v as string : null;
            return c != null && Characters().Any(x => x.id == c) ? c : id;
        }
    }
}
