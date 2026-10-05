using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

namespace CrossPet
{
    /// <summary>目录、设置、日志、内置资源同步、角色清单。和 macOS 版 / docs/windows.md 的约定一致。</summary>
    static class Store
    {
        public static readonly string Install = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        public static readonly string Data = Env("CROSSPET_DATA_DIR") ??
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CrossPet");
        public static readonly string State = Env("CROSSPET_STATE_DIR") ?? Path.Combine(Data, "state");
        public static readonly string Codex = Env("CODEX_HOME") ??
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        public static string Characters => Path.Combine(Data, "characters");
        public static string Feedback => Path.Combine(Data, "dev-feedback.md");
        public static string AppMap => Path.Combine(Data, "windows-apps.json");
        public static string Python => Path.Combine(Install, "python", "python.exe");
        public static string Version => ReadText(Path.Combine(Install, "VERSION"))?.Trim() ?? "0";

        // 网页从两个虚拟域名读文件：程序自带的网页（安装目录）和角色立绘（数据目录，用户可以改）
        public const string AppHost = "crosspet.app", DataHost = "crosspet.data";

        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        static string Env(string name) { var v = Environment.GetEnvironmentVariable(name); return string.IsNullOrWhiteSpace(v) ? null : v; }
        public static string ReadText(string path) { try { return File.ReadAllText(path); } catch { return null; } }

        public static Dictionary<string, object> ReadJson(string path)
        {
            var text = ReadText(path);
            if (text == null) return null;
            try { return Json.DeserializeObject(text.TrimStart('﻿')) as Dictionary<string, object>; } catch { return null; }
        }

        public static void WriteJson(string path, object data)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, Json.Serialize(data));
            if (File.Exists(path)) File.Replace(tmp, path, null); else File.Move(tmp, path);
        }

        public static void Log(string text)
        {
            try
            {
                Directory.CreateDirectory(Data);
                var file = Path.Combine(Data, "windows.log");
                if (File.Exists(file) && new FileInfo(file).Length > 1_000_000) File.Delete(file);
                File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + text + "\r\n");
            }
            catch { }
        }

        // ---- 设置 ----
        public static Dictionary<string, object> Settings = new Dictionary<string, object>();
        static string SettingsFile => Path.Combine(Data, "settings.json");
        public static void LoadSettings()
        {
            Settings = ReadJson(SettingsFile) ?? new Dictionary<string, object>();
            if (!Settings.ContainsKey("followApps")) Settings["followApps"] = true;
            if (!Settings.ContainsKey("followEvents")) Settings["followEvents"] = true;
            if (!(Settings.TryGetValue("names", out var n) && n is Dictionary<string, object>)) Settings["names"] = new Dictionary<string, object>();
        }
        public static void SaveSettings() { try { WriteJson(SettingsFile, Settings); } catch (Exception e) { Log("保存设置失败: " + e.Message); } }
        public static bool Flag(string key) => Settings.TryGetValue(key, out var v) && v is bool b && b;
        public static Dictionary<string, object> Names => (Dictionary<string, object>)Settings["names"];

        /// <summary>
        /// 和 macOS 版一样：内置角色每次启动整份覆盖（这样更新后能拿到新立绘），用户自己加的角色文件夹不动；
        /// 钩子脚本复制到数据目录；前台程序 → 角色的对照表第一次才放，之后用户改了就留着。
        /// </summary>
        public static void SyncResources()
        {
            Directory.CreateDirectory(Characters);
            Directory.CreateDirectory(State);
            var src = Path.Combine(Install, "characters");
            foreach (var dir in Directory.GetDirectories(src))
            {
                var dst = Path.Combine(Characters, Path.GetFileName(dir));
                try { if (Directory.Exists(dst)) Directory.Delete(dst, true); CopyDir(dir, dst); }
                catch (Exception e) { Log("同步角色失败 " + dir + ": " + e.Message); }
            }
            foreach (var md in Directory.GetFiles(src, "*.md")) File.Copy(md, Path.Combine(Characters, Path.GetFileName(md)), true);
            var hook = Path.Combine(Install, "integrations", "crosspet-hook.py");
            if (File.Exists(hook)) File.Copy(hook, Path.Combine(Data, "crosspet-hook.py"), true);
            if (!File.Exists(AppMap)) File.Copy(Path.Combine(Install, "apps.json"), AppMap);
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(from))
                if (!string.Equals(Path.GetFileName(d), "raw", StringComparison.OrdinalIgnoreCase)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        /// <summary>扫描 characters/&lt;id&gt;/：character.json + 立绘；和 macOS 版 loadCharacters 一样的规则</summary>
        public static Dictionary<string, object> Manifest()
        {
            var chars = new Dictionary<string, object>();
            foreach (var dir in Directory.GetDirectories(Characters).OrderBy(d => d, StringComparer.Ordinal))
            {
                var info = ReadJson(Path.Combine(dir, "character.json"));
                if (info == null) continue;
                var id = Path.GetFileName(dir);
                var poses = new Dictionary<string, List<string>>();
                string blink = null, blinkBase = null;
                foreach (var f in Directory.GetFiles(dir).Where(f => f.EndsWith(".webp", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                                                          .OrderBy(f => Path.GetFileName(f), StringComparer.Ordinal))
                {
                    var stem = Path.GetFileNameWithoutExtension(f);
                    var url = $"https://{DataHost}/characters/{Uri.EscapeDataString(id)}/{Uri.EscapeDataString(Path.GetFileName(f))}";
                    if (stem == "idle-blink") { blink = url; continue; }
                    if (stem == "idle") blinkBase = url;
                    var pose = stem.Split('-')[0];
                    if (!poses.ContainsKey(pose)) poses[pose] = new List<string>();
                    poses[pose].Add(url);
                }
                var egg = info.TryGetValue("egg", out var e) && e is bool b && b;
                if (egg ? !poses.ContainsKey("pop") : !(poses.ContainsKey("idle") || poses.ContainsKey("default"))) continue;
                if (!egg && Names.TryGetValue(id, out var custom) && custom is string s && s.Trim() != "") info["name"] = s.Trim();
                info["poses"] = poses; info["blink"] = blink; info["blinkBase"] = blinkBase;
                chars[id] = info;
            }
            return new Dictionary<string, object> { ["characters"] = chars };
        }
    }
}
