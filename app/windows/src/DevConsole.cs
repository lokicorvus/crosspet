using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace CrossPet
{
    /// <summary>
    /// 开发者控制台（Shift + 右键打开）：加载和 macOS 共用的 app/web/devconsole.html，
    /// 页面通过 chrome.webview.postMessage 发命令，这里转给桌宠页面执行，和 macOS 版 handleDev 一样。
    /// </summary>
    sealed class DevConsole
    {
        readonly Pet pet;
        readonly Window window;
        readonly WebView2 web;
        public event Action Closed;

        public DevConsole(Pet pet, CoreWebView2Environment env)
        {
            this.pet = pet;
            web = new WebView2();
            window = new Window { Title = "CrossPet 开发者控制台", Width = 1060, Height = 760, Content = web, WindowStartupLocation = WindowStartupLocation.CenterScreen };
            window.Closed += (_, __) => Closed?.Invoke();
            window.Loaded += async (_, __) =>
            {
                await web.EnsureCoreWebView2Async(env);
                Pet.Map(web.CoreWebView2);
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.WebMessageReceived += (_, e) => Handle(e.WebMessageAsJson);
                web.CoreWebView2.NavigationCompleted += (_, ___) =>
                {
                    var info = Store.Json.Serialize(new Dictionary<string, object> { ["version"] = Store.Version + " Windows", ["feedbackPath"] = Store.Feedback });
                    Js($"setAppInfo({info})");
                    Boot();
                };
                web.CoreWebView2.Navigate($"https://{Store.AppHost}/devconsole.html");
            };
        }

        public void Show() { window.Show(); window.Activate(); }
        public void Js(string code) { try { web.CoreWebView2?.ExecuteScriptAsync(code); } catch { } }
        public void Boot() => Js($"boot({pet.ManifestJson})");

        async void Handle(string json)
        {
            if (!(Store.Json.DeserializeObject(json) is Dictionary<string, object> msg) || !(msg.TryGetValue("cmd", out var c) && c is string cmd)) return;
            switch (cmd)
            {
                case "pet":     // 在桌宠页面里执行一段代码（控制台自己的本地页面发来的）
                    if (msg.TryGetValue("code", out var code) && code is string s) pet.Js(s);
                    break;
                case "status":  // ExecuteScriptAsync 返回的是 JSON 编码后的结果：JSON.stringify 的字符串再套一层引号
                    var raw = await pet.Eval("JSON.stringify(devStatus())");
                    if (raw != "null") Js($"onPetStatus(JSON.parse({raw}))");
                    break;
                case "pause":
                    pet.Paused = msg.TryGetValue("on", out var on) && on is bool b && b;
                    break;
                case "save":
                    var text = msg.TryGetValue("text", out var t) ? t as string ?? "" : "";
                    File.WriteAllText(Store.Feedback, text);
                    try { Clipboard.SetText(text); } catch { }
                    Js($"onSaved({Pet.Q(Store.Feedback)})");
                    break;
                case "reveal":
                    if (File.Exists(Store.Feedback)) Process.Start("explorer.exe", $"/select,\"{Store.Feedback}\"");
                    break;
                case "reload":
                    pet.Reload();
                    break;
            }
        }
    }

    /// <summary>
    /// 设置窗口（右键「设置…」）：加载和 macOS 共用的 app/web/settings.html，
    /// 页面通过 chrome.webview.postMessage 发 {cmd, ...}，Pet.HandleSettings 改完设置后用 Push 把最新状态推回页面
    /// </summary>
    sealed class SettingsWindow
    {
        readonly Pet pet;
        readonly Window window;
        readonly WebView2 web;
        public event Action Closed;

        public SettingsWindow(Pet pet, CoreWebView2Environment env)
        {
            this.pet = pet;
            web = new WebView2();
            window = new Window { Title = "CrossPet 设置", Width = 540, Height = 720, Content = web, WindowStartupLocation = WindowStartupLocation.CenterScreen };
            window.Closed += (_, __) => Closed?.Invoke();
            window.Loaded += async (_, __) =>
            {
                await web.EnsureCoreWebView2Async(env);
                Pet.Map(web.CoreWebView2);
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.WebMessageReceived += (_, e) =>
                {
                    if (Store.Json.DeserializeObject(e.WebMessageAsJson) is Dictionary<string, object> msg)
                        try { pet.HandleSettings(msg); } catch (Exception ex) { Store.Log("设置出错: " + ex); }
                };
                web.CoreWebView2.Navigate($"https://{Store.AppHost}/settings.html");
            };
        }

        public void Show() { window.Show(); window.Activate(); }
        public void Push()
        {
            try { web.CoreWebView2?.ExecuteScriptAsync($"setState({Store.Json.Serialize(pet.SettingsState())})"); } catch { }
        }
    }
}
