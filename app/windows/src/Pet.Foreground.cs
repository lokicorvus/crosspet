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
        long followEventGeneration;

        /// <summary>why：记进换角色记录的原因（front 切了前台 / host 前台程序换了模型 / startup 刚启动），和 macOS 一致</summary>
        void FollowForeground(string why = "front")
        {
            var exe = Native.ForegroundExe();
            var map = Store.ReadJson(Store.AppMap);
            var match = exe == "" ? null : map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
            frontIsAI = !string.IsNullOrWhiteSpace(match);
            frontIsShell = Native.ForegroundIsShell();
            ApplyLayer();
            if (!ready || Paused || !Store.Flag("followApps") || exe == "") return;
            if (string.IsNullOrWhiteSpace(match)) return;   // 对照表里没有，或者值留空：这个程序不跟随
            match = HostCharacter(match);
            if (match != current) SwitchTo(match, why, exe);
        }

        async Task FollowEvent(string id)
        {
            // 即使新事件属于当前角色，也必须退休还在等网页答复的旧选择。
            var generation = ++followEventGeneration;
            if (!ready || Paused || !Store.Flag("followEvents") || id == current) return;
            var exe = Native.ForegroundExe();
            var front = ForegroundCharacter(exe);
            var currentAt = current;
            var apps = Store.Flag("followApps");
            var events = Store.Flag("followEvents");
            var input = Store.Json.Serialize(new { eventId = id, foregroundId = front, followApps = apps, followEvents = events, characters = Characters().Select(c => c.id).ToArray() });
            var allowed = await Eval($"FollowPolicy.eventTarget({input}) === {Q(id)}");
            // 网页答复前可能切了窗口、手动换人或关了跟随；旧请求不能覆盖新选择。
            if (generation != followEventGeneration || !ready || Paused || current != currentAt || Native.ForegroundExe() != exe
                || Store.Flag("followApps") != apps || Store.Flag("followEvents") != events || ForegroundCharacter(exe) != front) { NotePet(id, null, "skipped", "answer-stale"); return; }
            if (allowed != "true") { NotePet(id, null, "skipped", "front-ai"); return; }
            if (id != current) SwitchTo(id, "event");
        }

        string ForegroundCharacter(string exe)
        {
            var map = Store.ReadJson(Store.AppMap);
            var host = exe == "" ? null : map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
            return string.IsNullOrWhiteSpace(host) ? null : HostCharacter(host);
        }

        // 首次写路由也算变化：Cursor 前台时桥的第一条角色记录不能等切窗口才生效。
        bool HostRoutesChanged()
        {
            var changed = false;
            foreach (var host in new[] { "deepseek", "workbuddy", "zcode", "claude", "gpt", "qwen", "cursor" })
            {
                try
                {
                    var key = host + "-host";
                    var fi = new FileInfo(Path.Combine(Store.State, host + "-host.json"));
                    if (!fi.Exists) { if (stamps.Remove(key)) changed = true; continue; }
                    var stamp = fi.LastWriteTimeUtc.Ticks + ":" + fi.Length;
                    if (stamps.TryGetValue(key, out var old) && old == stamp) continue;
                    stamps[key] = stamp;
                    changed = true;
                }
                catch { }
            }
            return changed;
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
            return c != null && Characters().Any(x => x.id == c) ? c : id;   // 认不出的模型（写的 null）：不换人
        }
    }
}
