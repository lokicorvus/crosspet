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
        // ---------------- 和网页打交道 ----------------
        public void Js(string code)
        {
            try { web?.CoreWebView2?.ExecuteScriptAsync(code); } catch (Exception e) { Store.Log("JS 出错: " + e.Message); }
        }
        public async Task<string> Eval(string code)
        {
            try { return web?.CoreWebView2 == null ? "null" : await web.CoreWebView2.ExecuteScriptAsync(code); }
            catch { return "null"; }
        }
        public void Reload() { ++followEventGeneration; ready = false; web?.CoreWebView2?.Reload(); }
        public static string Q(string s) => Store.Json.Serialize(s);

        /// <summary>换衣服（皮肤）：记下来，重新载入立绘；正在显示的就是她的话马上换上</summary>
        void Wear(string id, string skin)
        {
            if (!(Store.Settings.TryGetValue("skins", out var sv) && sv is Dictionary<string, object> sd)) Store.Settings["skins"] = sd = new Dictionary<string, object>();
            if ((sd.TryGetValue(id, out var cur) ? cur as string ?? "" : "") == skin) return;
            if (skin == "") sd.Remove(id); else sd[id] = skin;
            Store.SaveSettings();
            LoadCharacters();
            Js($"init({ManifestJson}); refreshLook({Q(id)})");
        }

        void SwitchTo(string id)
        {
            ++followEventGeneration;  // 同一个角色也算新的手动选择，不能让旧的异步跟随请求盖回来。
            if (!Characters().Any(c => c.id == id)) return;
            current = id;
            if (dock != null && !dockOut) After(800, ApplyDock);   // 换了角色，切口位置跟着变
            Store.Settings["character"] = id; Store.SaveSettings();
            Js($"setCharacter({Q(id)})");
            settings?.Push();
        }

        /// <summary>读 AI 写来的状态 / 额度文件（state 目录），有变化就交给网页。和 macOS 版 pollStates 一样</summary>
        void Poll()
        {
            if (!ready) return;
            // 前台换成 / 离开桌面：Win+D「显示桌面」不一定发前台切换事件，这里兜一下（见 ZOrderRule.Top）
            var shell = Native.ForegroundIsShell();
            if (shell != frontIsShell) { frontIsShell = shell; ApplyLayer(); }
            // 多模型宿主（DeepSeek Harness、WorkBuddy、ZCode，以及接了别家接口的 Claude Code、Codex）里换了模型：
            // 它正在前台的话马上换成那个模型的角色
            if (HostRoutesChanged()) FollowForeground();
            var latestActive = (id: (string)null, ts: 0.0);
            // current：多模型宿主（WorkBuddy）里没有对应角色的模型，由当前角色来演；它只有状态，没有额度
            foreach (var id in Characters().Select(c => c.id).Concat(new[] { "current" }))
                foreach (var kind in new[] { "state", "quota", "sessions" })   // sessions：好几个对话同时干活时各自的状态
                {
                    if (id == "current" && kind == "quota") continue;
                    if (id == "deepseek" && kind == "quota" && !DsQuotaEnabled) continue;
                    var file = Path.Combine(Store.State, $"{id}-{kind}.json");
                    FileInfo fi;
                    try { fi = new FileInfo(file); if (!fi.Exists || fi.Length > 1_000_000) continue; } catch { continue; }
                    var stamp = fi.LastWriteTimeUtc.Ticks + ":" + fi.Length;
                    var key = id + "-" + kind;
                    if (stamps.TryGetValue(key, out var old) && old == stamp) continue;
                    if (kind == "state" && (DateTime.UtcNow - fi.LastWriteTimeUtc).TotalMinutes > 10) { stamps[key] = stamp; continue; }  // 只认 10 分钟内的
                    var value = Store.ReadJson(file);
                    if (value == null) continue;   // 可能正被另一边写一半，下次再读
                    stamps[key] = stamp;
                    var json = Store.Json.Serialize(value);
                    if (kind == "sessions") { if (!Paused) Js($"setSessions({Q(id)}, {json})"); continue; }
                    dev?.Js($"logEvent({Q(id)}, {Q(kind)}, {json}, {(Paused ? "true" : "false")})");
                    if (Paused) continue;
                    if (kind == "state")
                    {
                        // 在终端里用 AI 时没有对应的前台程序：跟着最新一条工作事件换角色
                        var pose = value.TryGetValue("pose", out var p) ? p as string : null;
                        var ts = value.TryGetValue("ts", out var t) ? Convert.ToDouble(t) : 0;
                        lastPose[id] = (pose ?? "", DateTime.UtcNow);
                        if (id != "current" && pose != "idle" && pose != "sleeping" && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts < 30 && ts > latestActive.ts) latestActive = (id, ts);
                        Js($"applyCharState({Q(id)}, {json})");
                        // Codex 回完一轮：额度记录刚写进会话，马上读一次（不然要等每分钟一次的定时刷新）
                        if (id == "gpt")
                        {
                            if (value.TryGetValue("event", out var ev) && ev as string == "Stop") { codexBusyAt = null; After(1500, () => RefreshCodexQuota(CodexWhy.TurnEnd)); }
                            else codexBusyAt = DateTime.UtcNow;   // 在干活：定时查额度改成 1 分钟一次（CodexTickDue）
                        }
                    }
                    else Js($"setQuota({Q(id)}, {json})");
                }
            if (latestActive.id != null) _ = FollowEvent(latestActive.id);
            ApplyLayer();
            UpdateDock();
        }
    }
}
