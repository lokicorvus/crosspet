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
            else
            {
                // 新版本加的程序补进用户的对照表；用户改过、删成空值的不动
                var mine = ReadJson(AppMap);
                var bundled = ReadJson(Path.Combine(Install, "apps.json"));
                if (mine != null && bundled != null)
                {
                    var added = bundled.Keys.Where(k => !mine.Keys.Any(m => string.Equals(m, k, StringComparison.OrdinalIgnoreCase))).ToList();
                    foreach (var k in added) mine[k] = bundled[k];
                    if (added.Count > 0) try { WriteJson(AppMap, mine); } catch (Exception e) { Log("更新程序对照表失败: " + e.Message); }
                }
            }
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(from))
                if (!string.Equals(Path.GetFileName(d), "raw", StringComparison.OrdinalIgnoreCase)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        /// <summary>扫描 characters/&lt;id&gt;/：character.json + 立绘；和 macOS 版 loadCharacters 一样的规则</summary>
        // 皮肤（另一套衣服）：character.json 里写 "skinOf": "<角色>"，不单独算角色；选了它，那个角色就用这套立绘，台词、动作逻辑照旧
        public static Dictionary<string, List<(string id, string name)>> SkinChoices = new Dictionary<string, List<(string, string)>>();
        public static Dictionary<string, string> BaseOutfit = new Dictionary<string, string>();   // 原版衣服叫什么（outfit，比如「女仆装」）
        public static Dictionary<string, object> Skins => Settings.TryGetValue("skins", out var v) && v is Dictionary<string, object> d ? d : null;

        // 立绘：<文件名去掉 -2、-3> 是姿态名，idle-blink 是眨眼帧（照着 idle 本身画的）
        static (Dictionary<string, List<string>> poses, string blink, string blinkBase) Sprites(string dir)
        {
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
            return (poses, blink, blinkBase);
        }

        public static Dictionary<string, object> Manifest()
        {
            var chars = new Dictionary<string, object>();
            var dirs = Directory.GetDirectories(Characters).OrderBy(d => d, StringComparer.Ordinal).ToList();
            SkinChoices = new Dictionary<string, List<(string, string)>>();
            var skinSprites = new Dictionary<string, (Dictionary<string, List<string>>, string, string)>();
            var skinInfo = new Dictionary<string, Dictionary<string, object>>();
            foreach (var dir in dirs)
            {
                var info = ReadJson(Path.Combine(dir, "character.json"));
                if (info == null || !(info.TryGetValue("skinOf", out var so) && so is string skinOf)) continue;
                var sp = Sprites(dir);
                if (!sp.poses.ContainsKey("idle")) continue;
                var sid = Path.GetFileName(dir);
                if (!SkinChoices.ContainsKey(skinOf)) SkinChoices[skinOf] = new List<(string, string)>();
                SkinChoices[skinOf].Add((sid, info.TryGetValue("skinName", out var sn) && sn is string n ? n : sid));
                skinSprites[sid] = sp;
                skinInfo[sid] = info;
            }
            foreach (var dir in dirs)
            {
                var info = ReadJson(Path.Combine(dir, "character.json"));
                if (info == null || info.ContainsKey("skinOf")) continue;
                var id = Path.GetFileName(dir);
                var (poses, blink, blinkBase) = Sprites(dir);
                if (Skins != null && Skins.TryGetValue(id, out var chosen) && chosen is string skin && skinSprites.TryGetValue(skin, out var alt)
                    && SkinChoices.TryGetValue(id, out var list) && list.Any(x => x.id == skin))
                {
                    (poses, blink, blinkBase) = alt;
                    info["skin"] = skin;   // 网页据此挑彩蛋（有的彩蛋只在穿某件衣服时出现）
                    // 皮肤可以有自己的台词 / 登场招呼：写了的覆盖原版，没写的照旧
                    if (skinInfo[skin].TryGetValue("lines", out var ol) && ol is Dictionary<string, object> own)
                    {
                        var lines = info.TryGetValue("lines", out var bl) && bl is Dictionary<string, object> b0 ? b0 : new Dictionary<string, object>();
                        foreach (var kv2 in own) lines[kv2.Key] = kv2.Value;
                        info["lines"] = lines;
                    }
                    if (skinInfo[skin].TryGetValue("greeting", out var g)) info["greeting"] = g;
                }
                var egg = info.TryGetValue("egg", out var e) && e is bool b && b;
                if (egg ? !poses.ContainsKey("pop") : !(poses.ContainsKey("idle") || poses.ContainsKey("default"))) continue;
                if (!egg) BaseOutfit[id] = info.TryGetValue("outfit", out var o) ? o as string : null;
                if (!egg && Names.TryGetValue(id, out var custom) && custom is string s && s.Trim() != "") info["name"] = s.Trim();
                info["poses"] = poses; info["blink"] = blink; info["blinkBase"] = blinkBase;
                chars[id] = info;
            }
            return new Dictionary<string, object> { ["characters"] = chars };
        }
    }
}
