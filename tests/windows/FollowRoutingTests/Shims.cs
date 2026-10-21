using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace CrossPet
{
    static class Native
    {
        public static string Exe = "terminal.exe";
        public static string ForegroundExe() => Exe;
        public static bool ForegroundIsShell() => false;
    }

    static class Store
    {
        public static string State, AppMap;
        public static JavaScriptSerializer Json = new JavaScriptSerializer();
        public static Dictionary<string, object> Settings;
        public static Dictionary<string, object> ReadJson(string path)
        {
            try { return Json.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>; }
            catch { return null; }
        }
        public static bool Flag(string id) => Settings.TryGetValue(id, out var value) && value is bool b && b;
        public static void SaveSettings() { }
        public static void Log(string line) { }
    }

    sealed class PendingEval
    {
        public readonly TaskCompletionSource<string> Reply = new TaskCompletionSource<string>();
        public string Code;
    }
    sealed class FakeCore
    {
        public readonly List<PendingEval> Pending = new List<PendingEval>();
        public Task<string> ExecuteScriptAsync(string code)
        {
            if (!code.StartsWith("FollowPolicy.eventTarget(")) return Task.FromResult("null");
            var request = new PendingEval { Code = code };
            Pending.Add(request);
            return request.Reply.Task;
        }
        public void Reload() { }
    }
    sealed class FakeWeb { public FakeCore CoreWebView2 = new FakeCore(); }
    sealed class FakeSettings { public void Push() { } }
    sealed class FakeDev { public void Js(string code) { } }

    sealed partial class Pet
    {
        bool ready = true, frontIsAI, frontIsShell, dockOut = false, DsQuotaEnabled = false;
        public bool Paused = false;
        string current = "gpt";
        object dock = null;
        FakeWeb web = new FakeWeb();
        FakeSettings settings = null;
        FakeDev dev = null;
        DateTime? codexBusyAt;
        readonly Dictionary<string, string> stamps = new Dictionary<string, string>();
        readonly Dictionary<string, (string pose, DateTime at)> lastPose = new Dictionary<string, (string, DateTime)>();
        public string ManifestJson = "{}";
        public List<(string id, string name)> Catalog = new List<(string, string)> {
            ("gpt", "GPT"), ("claude", "Claude"), ("deepseek", "DeepSeek"), ("grok", "Custom Grok") };
        List<(string id, string name)> Characters() => Catalog;
        void ApplyLayer() { }
        void UpdateDock() { }
        void ApplyDock() { }
        void LoadCharacters() { }
        void After(int milliseconds, Action action) { }
        enum CodexWhy { TurnEnd }
        void RefreshCodexQuota(CodexWhy why) { }

        public string Selected => current;
        public List<PendingEval> Requests => web.CoreWebView2.Pending;
        public void Tick() => Poll();
        public void Activate() => FollowForeground();
        public void Choose(string id) => SwitchTo(id);
        public void ReadyAgain() => ready = true;
    }
}
