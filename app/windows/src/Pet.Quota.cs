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

        void RefreshQuota()
        {
            if (!ready) return;
            if (Store.Flag("agyQuota")) _ = RefreshGeminiQuota();
        }

        // ---- GPT 额度：什么时候拿、从哪拿（来源见 CodexQuota.cs，规则见 docs/superpowers/specs/2026-10-12-codex-quota-design.md）----
        enum CodexWhy { Now, TurnEnd, Tick }
        DateTime codexLiveAt = DateTime.MinValue;       // 上次问服务的时间（不管成没成）
        DateTime? codexBusyAt;                           // Codex 最近一次干活的事件（不是 Stop）；Stop 后清掉。干活时额度查得勤一点
        bool codexInFlight, sessionLocked;
        Dictionary<string, object> codexLast; DateTime codexLastAt;   // 最后一次问到的额度：问不到时接着显示它，并标上时间
        string codexNote = "";                           // 从没问到过时的原因，设置里那个开关下面显示
        string lastGptQuota = "还没读过", lastGptLogKey;

        /// 打开额度显示 / 页面就绪：马上问；Codex 回完一轮：隔 20 秒以上才问；定时（每分钟）：见 CodexTickDue。藏着、锁屏时定时的不查
        /// （和 macOS 版 App+Quota.swift 一致）
        /// <summary>定时到点时要不要问：Codex 在干活（10 分钟内有不是 Stop 的事件，长命令中途可能好几分钟没事件）1 分钟一次，
        /// 闲着 2 分钟一次。实测一次约 0.15 秒 CPU（macOS），每分钟一次平均约 0.25% 一个核心。定时器每 60 秒一跳有一两秒误差，门槛各留 5 秒。
        /// 和 macOS 的 App.codexTickDue 一样（那边有测试 tests/codex_quota_probe.sh）</summary>
        static bool CodexTickDue(double since, double? busyAgo) => since >= (busyAgo.HasValue && busyAgo.Value < 600 ? 55 : 115);

        async void RefreshCodexQuota(CodexWhy why)
        {
            if (!ready || !Store.Flag("gptQuota") || codexInFlight) return;
            if (why == CodexWhy.Tick && (userHidden || sessionLocked)) return;
            var since = (DateTime.UtcNow - codexLiveAt).TotalSeconds;
            var ask = why == CodexWhy.Now || (why == CodexWhy.TurnEnd && since >= 20) || (why == CodexWhy.Tick && CodexTickDue(since, codexBusyAt.HasValue ? (DateTime.UtcNow - codexBusyAt.Value).TotalSeconds : (double?)null));
            if (!ask) return;
            // 找程序（枚举进程）、问服务（可能要经过 WSL）都放到后台，别卡住桌宠；同一时间只跑一个
            codexInFlight = true; codexLiveAt = DateTime.UtcNow;
            try
            {
                var bin = await Task.Run(() => CodexQuota.FindBinary());
                (Dictionary<string, object> rl, string err, int ms) r = (null, "没找到 codex 程序", 0);
                var via = "";
                if (bin != null)
                {
                    r = await Task.Run(() => CodexQuota.QueryLive(bin));
                    if (r.err != null && r.err.StartsWith("起不来")) CodexQuota.Forget();   // 程序可能被更新挪走了，下次重新找
                }
                if (r.rl == null)
                {
                    // Windows 这边问不到（没装、没登录）：WSL 开着的话在 WSL 里问
                    var w = await Task.Run(() => CodexQuota.QueryWsl());
                    if (w.rateLimits != null || w.error != null) { r = (w.rateLimits, w.rateLimits != null ? null : $"{r.err}；{CodexQuota.WslNote}：{w.error}", w.ms); via = CodexQuota.WslNote; }
                }
                ApplyCodex(r.rl, r.err, r.ms, via);
            }
            catch (Exception e) { Store.Log("GPT 额度: " + e.Message); }
            finally { codexInFlight = false; }
        }

        /// 交给网页：问到了就是 live；没问到、但以前问到过，就接着显示最后一次的数（stale，网页标上是几点的数据）；从没问到过就不显示
        void ApplyCodex(Dictionary<string, object> rl, string error, int ms, string via)
        {
            if (!Store.Flag("gptQuota")) return;   // 查的途中关掉了额度显示
            if (rl != null) { codexLast = rl; codexLastAt = DateTime.Now; codexNote = ""; }
            else if (codexLast == null) codexNote = "问不到 Codex：" + (error ?? "原因不明");
            var tag = rl != null ? $"Codex 服务{(via != "" ? "（" + via + "）" : "")}，{ms / 1000.0:0.0} 秒" : "没问到：" + (error ?? "原因不明");
            lastGptQuota = $"{DateTime.Now:HH:mm:ss} （{tag}）" + (codexLast != null ? (rl == null ? $"沿用 {codexLastAt:HH:mm} 的数：" : "") + CodexQuota.Brief(codexLast) : "");
            // 来源或出错原因变了才记日志（每 5 分钟查一次，照记会刷屏）：反馈附带的日志里能看出额度从哪来、为什么没问到
            var logKey = (rl != null) + "|" + via + "|" + error;
            if (logKey != lastGptLogKey) { lastGptLogKey = logKey; Store.Log("GPT 额度：" + lastGptQuota.Substring(9)); }
            PushSettings();
            if (codexLast == null) { Js("setCodexQuota(null)"); return; }
            var p = CodexQuota.Payload(rl != null ? "live" : "stale", codexLast, error, ms);
            p["at"] = new DateTimeOffset(codexLastAt).ToUnixTimeSeconds();
            Js($"setCodexQuota({Store.Json.Serialize(p)})");
        }
        bool askingGemini;
        async Task RefreshGeminiQuota()
        {
            if (askingGemini) return;
            askingGemini = true;
            try
            {
                var q = await Task.Run(AntigravityQuota.Read);   // 进程查询比较慢，放到后台
                Js($"setQuota('gemini', {(q == null ? "null" : Store.Json.Serialize(q))})");   // Antigravity 没开就不显示
            }
            catch (Exception e) { Store.Log("Gemini 额度: " + e.Message); }
            finally { askingGemini = false; }
        }
    }
}
