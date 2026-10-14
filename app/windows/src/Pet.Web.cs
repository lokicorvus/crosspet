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
        public void Reload() { ready = false; web?.CoreWebView2?.Reload(); }
        public static string Q(string s) => Store.Json.Serialize(s);

        /// <summary>发给所有桌宠（本体 + 跟着的小桌宠）。控制者读到的状态、设置变更都走这里，保证每只看到的都一样</summary>
        void Broadcast(string code)
        {
            Js(code);
            foreach (var pet in companions.Values) pet.Js(code);
        }

        /// <summary>把当前的工作状态、额度和会话状态补给一只（新建出来的）小桌宠</summary>
        void Replay(Pet pet)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            foreach (var kv in activity.States.Where(kv => ActivityState.Fresh(kv.Value, now)))
                pet.Js($"applyCharState({Q(kv.Key)}, {Store.Json.Serialize(kv.Value)})");
            foreach (var kv in quotas) pet.Js($"setQuota({Q(kv.Key)}, {Store.Json.Serialize(kv.Value)})");
            foreach (var kv in activity.Sessions) pet.Js($"setSessions({Q(kv.Key)}, {Store.Json.Serialize(kv.Value)})");
        }

        /// <summary>谁该显示、谁该收起来。控制者每轮状态检查后调一次：按当前工作模型集合决定每只桌宠的去留，
        /// 工作模型变了才记日志、刷设置窗口</summary>
        void ReconcilePets()
        {
            if (IsCompanion) return;   // 只有控制者管这一群：小桌宠不自己造同伴（否则会一只套一只）
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            var previous = activeModels;
            activeModels = activity.Active(now);
            if (!MultiPet)
            {
                // 关掉多桌宠：只留本体这一只，工作模型换了就换角色（和上游单只的行为一致）
                SetWanted(true);
                foreach (var pet in companions.Values) pet.SetWanted(false);
                if (Store.Flag("followEvents") && activeModels.Count > 0)
                {
                    var latest = activeModels.OrderByDescending(id => ActivityState.Timestamp(activity.Effective(id, now))).First();
                    if (latest != current) SwitchTo(latest);
                }
                Js($"setEggsEnabled({(EggsEnabled ? "true" : "false")})");
                return;
            }
            if (activeModels.Count > 0)
            {
                hadActivity = true;
                if (!activeModels.Contains(current)) SwitchTo(activeModels[0]);
                SetWanted(true);
                foreach (var id in activeModels.Where(m => m != current))
                {
                    if (!companions.TryGetValue(id, out var pet))
                    {
                        // 藏着的小桌宠随时可以被重建；先把已经不在工作的收掉，缓存的网页控件数量就跟着当前工作模型走
                        foreach (var old in companions.Keys.Where(k => !activeModels.Contains(k)).ToList())
                        { companions[old].Window.Close(); companions.Remove(old); }
                        var used = new HashSet<int>(companions.Values.Select(p => p.slot));
                        var next = 1; while (used.Contains(next)) next++;
                        pet = new Pet(env, this, id, next);
                        companions.Add(id, pet);
                        pet.Start();
                    }
                    pet.SetWanted(true);
                }
            }
            else
            {
                SetWanted(!HideIdle);
                // 从「有活干」回到「全空闲」：把停在最后一个动作上的本体叫回待机
                if (hadActivity && previous.Count > 0 && activity.States.TryGetValue(current, out var state) && !ActivityState.Fresh(state, now))
                    Js($"applyCharState({Q(current)}, {{pose:'idle',event:'Timeout',ts:{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}}})");
            }
            foreach (var kv in companions)
                kv.Value.SetWanted(activeModels.Contains(kv.Key) && kv.Key != current);
            if (!previous.SequenceEqual(activeModels))
            {
                Broadcast($"setEggsEnabled({(EggsEnabled && activeModels.Count == 0 ? "true" : "false")})");
                Store.Log("多桌宠工作模型: " + (activeModels.Count == 0 ? "待机" : string.Join(", ", activeModels)));
                settings?.Push();
            }
        }

        /// <summary>这只桌宠该不该显示。收起时走 SetConcealed（隐身：透明 + 鼠标穿透），不用 Hide()，
        /// 免得反复藏放把 WPF 渲染线程弄挂（原因见 Pet.Layer.cs）</summary>
        void SetWanted(bool value)
        {
            wanted = value;
            ApplyLayer();
            UpdateDock();
        }

        /// <summary>换衣服（皮肤）：记下来，重新载入立绘；正在显示的就是她的话马上换上</summary>
        void Wear(string id, string skin)
        {
            if (!(Store.Settings.TryGetValue("skins", out var sv) && sv is Dictionary<string, object> sd)) Store.Settings["skins"] = sd = new Dictionary<string, object>();
            if ((sd.TryGetValue(id, out var cur) ? cur as string ?? "" : "") == skin) return;
            if (skin == "") sd.Remove(id); else sd[id] = skin;
            Store.SaveSettings();
            LoadCharacters();
            foreach (var pet in companions.Values) pet.LoadCharacters();   // 小桌宠也重新载入立绘清单
            Broadcast($"init({ManifestJson}); refreshLook({Q(id)})");
        }

        void SwitchTo(string id)
        {
            if (!Characters().Any(c => c.id == id)) return;
            if (IsCompanion) return;   // 跟着的小桌宠的角色由控制者决定，不自己换
            // 多桌宠开着又有模型在工作时，只允许切到正在工作的模型（每只桌宠固定演一个模型）
            if (MultiPet && activeModels.Count > 0 && !activeModels.Contains(id)) return;
            current = id;
            if (dock != null && !dockOut) After(800, ApplyDock);   // 换了角色，切口位置跟着变
            Store.Settings["character"] = id; Store.SaveSettings();
            Js($"setCharacter({Q(id)}, {(MultiPet && activeModels.Count > 0 ? "true" : "false")})");
            Replay(this);   // 换过来之后把当前状态补上，免得新角色停在待机
            settings?.Push();
        }

        /// <summary>读 AI 写来的状态 / 额度文件（state 目录），有变化就交给网页。和 macOS 版 pollStates 一样</summary>
        void Poll()
        {
            if (!ready) return;
            // 多模型宿主（DeepSeek Harness、WorkBuddy、ZCode，以及接了别家接口的 Claude Code、Codex）里换了模型：
            // 它正在前台的话马上换成那个模型的角色
            var hostChanged = false;
            foreach (var host in new[] { "deepseek", "workbuddy", "zcode", "claude", "gpt" })
            {
                try
                {
                    var fi = new FileInfo(Path.Combine(Store.State, host + "-host.json"));
                    if (!fi.Exists) continue;
                    var stamp = fi.LastWriteTimeUtc.Ticks.ToString();
                    if (stamps.TryGetValue(host + "-host", out var old) && old == stamp) continue;
                    if (old != null) hostChanged = true;
                    stamps[host + "-host"] = stamp;
                }
                catch { }
            }
            if (hostChanged) FollowForeground();
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
                    if (kind == "sessions" && !Paused)
                    {
                        // 同一个模型的多个对话各自的状态：记下来交给 ActivityState 判「这个模型还在不在干活」
                        var sessionTarget = id == "current" ? current : id;
                        activity.Sessions[sessionTarget] = value;
                        Broadcast($"setSessions({Q(sessionTarget)}, {json})");
                        continue;
                    }
                    dev?.Js($"logEvent({Q(id)}, {Q(kind)}, {json}, {(Paused ? "true" : "false")})");
                    if (Paused) continue;
                    if (kind == "state")
                    {
                        // 在终端里用 AI 时没有对应的前台程序：跟着最新一条工作事件换角色
                        var pose = value.TryGetValue("pose", out var p) ? p as string : null;
                        var ts = value.TryGetValue("ts", out var t) ? Convert.ToDouble(t) : 0;
                        lastPose[id] = (pose ?? "", DateTime.UtcNow);
                        if (id != "current" && pose != "idle" && pose != "sleeping" && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts < 30 && ts > latestActive.ts) latestActive = (id, ts);
                        var target = id == "current" ? current : id;
                        activity.States[target] = value;   // 控制者留着这份，用来算工作模型集合、补给新建的小桌宠
                        Broadcast($"applyCharState({Q(target)}, {json})");
                        // Codex 回完一轮：额度记录刚写进会话，马上读一次（不然要等每分钟一次的定时刷新）
                        if (id == "gpt")
                        {
                            if (value.TryGetValue("event", out var ev) && ev as string == "Stop") { codexBusyAt = null; After(1500, () => RefreshCodexQuota(CodexWhy.TurnEnd)); }
                            else codexBusyAt = DateTime.UtcNow;   // 在干活：定时查额度改成 1 分钟一次（CodexTickDue）
                        }
                    }
                    else { quotas[id] = value; Broadcast($"setQuota({Q(id)}, {json})"); }
                }
            if (!Paused) ReconcilePets();
            ApplyLayer();
            foreach (var pet in companions.Values) pet.ApplyLayer();
        }
    }
}
