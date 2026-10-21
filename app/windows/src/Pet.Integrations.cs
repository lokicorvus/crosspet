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
        // ---------------- 接入被别的工具冲掉时接回去 ----------------
        // CC Switch 3.x 切换服务商会整个重写 .claude\settings.json，CrossPet 的 mod / 钩子跟着没了。每 3 秒看一眼这个文件，
        // 有改动就等 2 秒（等对方写完）跑一次 integrate.py heal：只补 CrossPet 自己的那一项，在 CrossPet 里撤销过的不管。
        // 启动时也看一次。一小时最多接 6 次，免得和别的工具来回打架。和 macOS 版一样
        DateTime? claudeConfigStamp;
        readonly List<DateTime> healTimes = new List<DateTime>();
        DispatcherTimer healPending;
        static string ClaudeSettings => Path.Combine(Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") is string d && d != "" ? d
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude"), "settings.json");
        // ---------------- 心跳：各个 AI 最近一次发来消息的时间（和 macOS 版一样） ----------------
        static readonly Dictionary<string, string> SeenKeys = new Dictionary<string, string>
        {
            ["claude-hooks"] = "claude", ["claude-mod"] = "claude-mod", ["codex"] = "gpt", ["deepseek"] = "deepseek", ["gemini"] = "gemini",
            ["antigravity"] = "antigravity", ["workbuddy"] = "workbuddy", ["zcode"] = "zcode", ["hermes"] = "hermes",
            ["qwen"] = "qwen", ["cursor"] = "cursor",
        };
        static Dictionary<string, object> LastSeen => Store.Settings.TryGetValue("seen", out var v) && v is Dictionary<string, object> d ? d : new Dictionary<string, object>();
        static double? SeenAt(string key) => LastSeen.TryGetValue(key, out var v) ? Convert.ToDouble(v) : (double?)null;
        void RefreshSeen()
        {
            var seen = new Dictionary<string, object>(LastSeen); var changed = false;
            foreach (var key in SeenKeys.Values.Distinct())
            {
                try
                {
                    var f = Path.Combine(Store.State, "seen-" + key);
                    if (!File.Exists(f) || !double.TryParse(File.ReadAllText(f).Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var ts)) continue;
                    if (seen.TryGetValue(key, out var old) && Convert.ToDouble(old) >= ts) continue;
                    seen[key] = ts; changed = true;
                }
                catch { }
            }
            if (changed) { Store.Settings["seen"] = seen; Store.SaveSettings(); settings?.Push(); }
        }
        static double Now => (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds;
        static string AgoText(double? ts)
        {
            if (ts == null) return "从没收到";
            var d = Now - ts.Value;
            return d >= 86400 ? $"{(int)(d / 86400)} 天前" : d >= 3600 ? $"{(int)(d / 3600)} 小时前" : d >= 60 ? $"{(int)(d / 60)} 分钟前" : "刚刚";
        }

        void WatchClaudeConfig()
        {
            RefreshSeen();
            if (!ready) return;
            DateTime stamp;
            try { var fi = new FileInfo(ClaudeSettings); if (!fi.Exists) return; stamp = fi.LastWriteTimeUtc; } catch { return; }
            if (stamp == claudeConfigStamp) return;
            claudeConfigStamp = stamp;
            healPending?.Stop();
            healPending = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            healPending.Tick += (_, __) => { healPending.Stop(); HealIntegrations(); };
            healPending.Start();
        }
        void HealIntegrations()
        {
            healTimes.RemoveAll(t => (DateTime.UtcNow - t).TotalHours >= 1);
            if (healTimes.Count >= 6 || !File.Exists(Store.Python)) return;
            Task.Run(() =>
            {
                var (output, code) = RunIntegrate("heal");
                if (code != 0) return;
                List<string> healed = null;
                try { healed = (Store.Json.DeserializeObject(output.Trim().Split('\n').Last()) as object[])?.OfType<string>().ToList(); } catch { }
                if (healed == null || healed.Count == 0) return;
                Store.Log("接回被冲掉的接入: " + string.Join(", ", healed));
                Window.Dispatcher.Invoke(() => { healTimes.Add(DateTime.UtcNow); Js("configHealed()"); RefreshIntegrated(); });
            });
        }

        public void RefreshIntegrated(Action done = null)
        {
            Task.Run(() =>
            {
                var r = RunIntegrate("installed").output;
                List<string> list = null;
                try { list = (Store.Json.DeserializeObject(r.Trim().Split('\n').Last()) as object[])?.OfType<string>().ToList(); } catch { }
                Window.Dispatcher.Invoke(() => { integrated = list ?? new List<string>(); settings?.Push(); done?.Invoke(); });
            });
            RefreshPlugins();
        }

        string pluginStatus = "[]";   // 插件版本（接入工具的只读检查 integrate.py plugins，JSON 数组），桌宠和设置页据此提醒更新
        /// <summary>插件版本（只读检查，不改任何配置）：有新版本 / 更新了还没重开时，设置页那一行挂提醒；tellPet：桌宠刚启动，让她闲下来时说一句。
        /// 只提醒、不自动更新——改别家配置一律让用户自己点「更新」。和 macOS 版 refreshPlugins 一致</summary>
        void RefreshPlugins(bool tellPet = false)
        {
            Task.Run(() =>
            {
                var (output, code) = RunIntegrate("plugins");
                var last = (output ?? "").Trim().Split('\n').Last().Trim();
                try { if (code != 0 || !(Store.Json.DeserializeObject(last) is object[])) return; } catch { return; }
                Window.Dispatcher.Invoke(() => { pluginStatus = last; if (tellPet) Js($"setPluginUpdates({last})"); settings?.Push(); });
            });
        }

        static readonly (string id, string label, string note)[] IntegrationTargets =
        {
            ("claude-hooks", "Claude Code（标准钩子）", "所有版本可用，不显示额度"),
            ("claude-mod", "Claude Code 增强版 mod", "能显示额度；终端里要 2.1.287 以上，桌面 App 2.1.286 以上"),
            ("codex", "Codex", "接入后要在 Codex 里用 /hooks 信任一次"),
            ("deepseek", "DeepSeek Harness", "工作状态 + 余额"),
            ("antigravity", "Antigravity", "桌面版和命令行都有效"),
            ("gemini", "Gemini CLI", null),
            ("workbuddy", "WorkBuddy", "按当前模型换角色，没有对应角色的模型由当前角色来演"),
            ("zcode", "ZCode（智谱）", "按会话的模型换角色，GLM 角色没装时由当前角色来演"),
            ("hermes", "Hermes Agent", "按当前模型换角色，没有对应角色的模型由当前角色来演；新开的会话生效"),
            ("cursor", "Cursor", "跟着工作状态动。默认演 GPT，钩子命令末尾可以改成自己的角色"),
            ("qwen", "Qwen Code（阿里）", "按当前模型换角色，没有对应角色的模型由当前角色来演；新开的会话生效"),
        };

        public Dictionary<string, object> SettingsState()
        {
            var state = new Dictionary<string, object>
            {
                ["version"] = Store.Version + " Windows", ["platform"] = "windows",
                ["size"] = Scale, ["textSize"] = TextScale, ["textLinked"] = TextLinked, ["showName"] = ShowName, ["eggs"] = EggsEnabled, ["hideFullscreen"] = HideFullscreen, ["aura"] = AuraMode,
                ["followApps"] = Store.Flag("followApps"), ["followEvents"] = Store.Flag("followEvents"),
                ["gptQuota"] = Store.Flag("gptQuota"), ["agyQuota"] = Store.Flag("agyQuota"), ["gptQuotaNote"] = codexNote,
                ["login"] = LoginEnabled, ["edgeDock"] = EdgeDockEnabled, ["dsQuota"] = DsQuotaEnabled, ["quotaAggregate"] = QuotaAggregate, ["codexResets"] = CodexResets, ["peakStyle"] = PeakStyle, ["peakSkins"] = PeakSkins, ["appVersion"] = Store.Version, ["whatsNewSeen"] = Store.Settings.TryGetValue("whatsNewSeen", out var wns) && wns is string ws ? ws : Store.Version, ["powerSave"] = PowerSave,
                ["hideHotkey"] = HideHotkey, ["hotkeyFailed"] = hotkeyFailed,
                ["hotkeys"] = new[] { new Dictionary<string, object> { ["id"] = "off", ["label"] = "不用快捷键" } }.Concat(HotkeyChoices.Select(h => new Dictionary<string, object> { ["id"] = h.id, ["label"] = h.label })).ToList(), ["aiAutostart"] = AIAutostart, ["character"] = current, ["updating"] = updating,
                ["characters"] = Characters().Select(c =>
                {
                    var d = new Dictionary<string, object>
                    {
                        ["id"] = c.id, ["name"] = c.name,
                        ["defaultName"] = Store.ReadJson(Path.Combine(Store.Characters, c.id, "character.json"))?["name"] as string ?? c.id,
                        ["custom"] = Store.Names.TryGetValue(c.id, out var n) ? n as string ?? "" : "",
                    };
                    if (Store.SkinChoices.TryGetValue(c.id, out var skins) && skins.Count > 0)   // 有别的衣服：原版排第一
                    {
                        var list = new List<object> { new Dictionary<string, object> { ["id"] = "", ["name"] = Store.BaseOutfit.TryGetValue(c.id, out var bo) && bo != null ? bo : "原版" } };
                        list.AddRange(skins.Select(k => (object)new Dictionary<string, object> { ["id"] = k.id, ["name"] = k.name }));
                        d["skins"] = list;
                        d["skin"] = Store.Skins != null && Store.Skins.TryGetValue(c.id, out var cur) ? cur as string ?? "" : "";
                    }
                    return d;
                }).ToList(),
                ["plugins"] = Store.Json.DeserializeObject(pluginStatus),
                ["integrations"] = integrated == null ? null : IntegrationTargets.Select(t => new Dictionary<string, object>
                    { ["id"] = t.id, ["label"] = t.label, ["note"] = t.note, ["installed"] = integrated.Contains(t.id),
                      ["lastSeen"] = SeenAt(SeenKeys.TryGetValue(t.id, out var sk) ? sk : "") is double ts ? (object)(Now - ts) : null }).ToList(),
            };
            if (latestRelease is var (tag, _) && updateZip != null) state["update"] = tag;
            return state;
        }

        public void HandleSettings(Dictionary<string, object> msg)
        {
            var cmd = msg.TryGetValue("cmd", out var c) ? c as string : null;
            switch (cmd)
            {
                case "get":
                    if (integrated == null) RefreshIntegrated();
                    break;
                case "set":
                    var key = msg.TryGetValue("key", out var k) ? k as string : null;
                    msg.TryGetValue("value", out var value);
                    var on = value is bool b && b;
                    switch (key)
                    {
                        case "size":
                            var v = Math.Min(1.6, Math.Max(0.6, Math.Round(Convert.ToDouble(value) * 100) / 100));
                            Store.Settings["size"] = v; Store.SaveSettings(); ApplySizes(v);
                            break;
                        case "textSize":   // 单独调文字：同时记为解锁
                            Store.Settings["textSize"] = Math.Min(1.6, Math.Max(0.6, Math.Round(Convert.ToDouble(value) * 100) / 100));
                            Store.Settings["textLinked"] = false; Store.SaveSettings(); ApplySizes();
                            break;
                        case "textLinked": Store.Settings["textLinked"] = !(value is bool lb) || lb; Store.SaveSettings(); ApplySizes(); break;
                        case "showName": Store.Settings["showName"] = on; Store.SaveSettings(); Js($"setShowName({(on ? "true" : "false")})"); break;
                        case "hideFullscreen": Store.Settings["hideFullscreen"] = on; Store.SaveSettings(); ApplyLayer(); break;
                        case "hideHotkey": if (value is string hk) { Store.Settings["hideHotkey"] = hk; Store.SaveSettings(); RegisterHideHotKey(); } break;
                        case "quotaAggregate": Store.Settings["quotaAggregate"] = on; Store.SaveSettings(); Js($"setQuotaAggregate({(on ? "true" : "false")})"); break;
                        case "whatsNewSeen": if (value is string seen) { Store.Settings["whatsNewSeen"] = seen; Store.SaveSettings(); } break;   // 打开了「新功能」页：小红点消失
                        case "codexResets": Store.Settings["codexResets"] = on; Store.SaveSettings(); Js($"setCodexResets({(on ? "true" : "false")})"); break;
                        case "peakSkins": Store.Settings["peakSkins"] = CleanPeakSkins(value); Store.SaveSettings(); Js($"setPeakSkins({Store.Json.Serialize(PeakSkins)})"); break;
                        case "peakStyle":
                            if (value is string ps && (ps == "bar" || ps == "text" || ps == "off")) { Store.Settings["peakStyle"] = ps; Store.SaveSettings(); Js($"setPeakStyle({Q(ps)})"); }
                            break;
                        case "powerSave": Store.Settings["powerSave"] = on; Store.SaveSettings(); Js($"setPowerSave({(on ? "true" : "false")})"); break;
                        case "eggs": Store.Settings["eggs"] = on; Store.SaveSettings(); Js($"setEggsEnabled({(on ? "true" : "false")})"); break;
                        case "aura":
                            if (value is string m && (m == "auto" || m == "on" || m == "off")) { Store.Settings["auraMode"] = m; Store.SaveSettings(); Js($"setAuraMode({Q(m)})"); }
                            break;
                        case "followApps": case "followEvents": Store.Settings[key] = on; Store.SaveSettings(); break;
                        case "gptQuota":
                            Store.Settings[key] = on; Store.SaveSettings();
                            if (on) RefreshCodexQuota(CodexWhy.Now); else Js("setCodexQuota(null)");
                            break;
                        case "agyQuota":
                            Store.Settings[key] = on; Store.SaveSettings();
                            if (on) _ = RefreshGeminiQuota(); else Js("setQuota('gemini', null)");
                            break;
                        case "aiAutostart": SetAIAutostart(on); break;
                        case "dsQuota":
                            Store.Settings["dsQuota"] = on; Store.SaveSettings();
                            stamps.Remove("deepseek-quota");   // 重新打开时马上读一次
                            if (!on) Js("setQuota('deepseek', null)");
                            break;
                        case "edgeDock": Store.Settings["edgeDock"] = on; Store.SaveSettings(); if (!on) Undock(); break;
                        case "login": if (on != LoginEnabled) ToggleLogin(); break;
                        case "character": if (value is string id) SwitchTo(id); break;
                    }
                    break;
                case "skin":   // 换衣服：记下来，重新载入立绘，并换成这个角色
                    if (msg.TryGetValue("id", out var kid) && kid is string skinId && Characters().Any(x => x.id == skinId) && msg.TryGetValue("skin", out var kv) && kv is string skinName)
                    { Wear(skinId, skinName); SwitchTo(skinId); }
                    break;
                case "rename":
                    if (msg.TryGetValue("id", out var rid) && rid is string cid && Characters().Any(x => x.id == cid))
                    {
                        var name = (msg.TryGetValue("name", out var nm) ? nm as string ?? "" : "").Trim();
                        if (name == "") Store.Names.Remove(cid); else Store.Names[cid] = name;
                        Store.SaveSettings();
                        LoadCharacters();
                        Js($"setName({Q(cid)}, {Q(Characters().First(x => x.id == cid).name)})");
                        dev?.Boot();
                    }
                    break;
                case "integrate":
                    if (msg.TryGetValue("target", out var t) && t is string target && msg.TryGetValue("action", out var a) && a is string action &&
                        IntegrationTargets.Any(x => x.id == target) && (action == "install" || action == "uninstall"))
                        Integrate(action, target, IntegrationTargets.First(x => x.id == target).label);
                    break;
                case "action":
                    switch (msg.TryGetValue("name", out var an) ? an as string : null)
                    {
                        case "update": _ = SelfUpdate(); break;
                        case "checkUpdate": _ = CheckForUpdate(true); break;
                        case "openCharacters": Open(Store.Characters); break;
                        case "openCodexResets": Open("https://codex-resets.com"); break;
                        case "openData": Open(Store.Data); break;
                        case "openReleases": Open("https://github.com/lokicorvus/crosspet/releases"); break;
                        case "devConsole": OpenDev(); break;
                        case "feedback": OpenFeedback(); break;
                    }
                    break;
            }
            settings?.Push();
        }

        /// <summary>背景光晕：auto（跟着系统深浅色，深色模式下关）/ on / off</summary>
        static string AuraMode => Store.Settings.TryGetValue("auraMode", out var v) && v is string s && (s == "on" || s == "off") ? s : "auto";

        static void Toggle(string key) { Store.Settings[key] = !Store.Flag(key); Store.SaveSettings(); }
        static void Open(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception e) { Store.Log("打开失败: " + e.Message); } }

        // ---------------- 接入 AI：用随包 Python 跑和 macOS 共用的 tools/integrate.py ----------------
        void Integrate(string action, string target, string label)
        {
            if (!File.Exists(Store.Python)) { MessageBox.Show("没找到随包的 Python，请用完整的安装包重新安装。", "CrossPet AI 接入"); return; }
            Task.Run(() =>
            {
                var (output, code) = RunIntegrate($"{action} {target}");
                Store.Log($"接入 {action} {target} → {code}\n{output}");
                Window.Dispatcher.Invoke(() =>
                {
                    // 没找到 AI 的配置目录时脚本正常退出但什么都没改，不能显示成「已更新」
                    var missing = output.Contains("没找到");
                    var title = code != 0 ? "没有完成" : missing ? "没有接入：没找到这个 AI 的配置" : action == "install" ? "已接入" : "已撤销";
                    MessageBox.Show($"{label}：{title}\n\n{output.Trim()}", "CrossPet AI 接入", MessageBoxButton.OK,
                        code != 0 ? MessageBoxImage.Error : missing ? MessageBoxImage.Warning : MessageBoxImage.Information);
                    RefreshIntegrated();
                });
            });
        }

        /// <summary>用随包 Python 跑一次 tools/integrate.py，返回输出和退出码</summary>
        (string output, int code) RunIntegrate(string args)
        {
            var psi = new ProcessStartInfo(Store.Python, $"\"{Path.Combine(Store.Install, "tools", "integrate.py")}\" {args}")
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Store.Install,
            };
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables["CROSSPET_DATA_DIR"] = Store.Data;
            psi.EnvironmentVariables["CROSSPET_STATE_DIR"] = Store.State;
            string output; int code;
            try
            {
                using (var p = Process.Start(psi))
                {
                    var err = p.StandardError.ReadToEndAsync();
                    output = p.StandardOutput.ReadToEnd() + err.Result;
                    if (!p.WaitForExit(30000)) { p.Kill(); output += "\n（超时）"; }
                    code = p.ExitCode;
                }
            }
            catch (Exception e) { output = e.Message; code = -1; }
            return (output, code);
        }
    }
}
