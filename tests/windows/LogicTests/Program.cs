using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using CrossPet;

static class Program
{
    static int fails;
    static void Check(string name, bool ok) { Console.WriteLine((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; }

    static int Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "crosspet-sprite-test", "characters");
        string file, mime;

        Check("普通立绘", SpritePath.TryResolve(root, "/characters/claude/idle.webp", out file, out mime)
            && file == Path.GetFullPath(Path.Combine(root, "claude", "idle.webp")) && mime == "image/webp");
        Check("png", SpritePath.TryResolve(root, "/characters/gpt/edge_left.png", out file, out mime) && mime == "image/png");
        Check("扩展名大写", SpritePath.TryResolve(root, "/characters/gpt/IDLE.WEBP", out file, out mime) && mime == "image/webp");
        Check("中文角色名（网址编码）", SpritePath.TryResolve(root, "/characters/%E5%8F%AF%E8%90%9D/idle.webp", out file, out mime)
            && file == Path.GetFullPath(Path.Combine(root, "可萝", "idle.webp")));
        Check("文件名里有空格（%20）", SpritePath.TryResolve(root, "/characters/my%20pet/idle%201.webp", out file, out mime));

        Check("角色目录是 ..", !SpritePath.TryResolve(root, "/characters/%2E%2E/settings.webp", out file, out mime));
        Check("文件名里编码的斜杠", !SpritePath.TryResolve(root, "/characters/claude/..%2F..%2Fsettings.webp", out file, out mime));
        Check("文件名里编码的反斜杠", !SpritePath.TryResolve(root, "/characters/claude/..%5C..%5Cx.webp", out file, out mime));
        Check("盘符冒号", !SpritePath.TryResolve(root, "/characters/claude/C%3Ax.webp", out file, out mime));
        Check("character.json 不给", !SpritePath.TryResolve(root, "/characters/gpt/character.json", out file, out mime));
        Check("数据目录里别的文件不给", !SpritePath.TryResolve(root, "/settings.json", out file, out mime));
        Check("多一层目录不给", !SpritePath.TryResolve(root, "/characters/a/b/c.webp", out file, out mime));
        Check("空的文件名", !SpritePath.TryResolve(root, "/characters/claude/", out file, out mime));
        Check("结尾是点", !SpritePath.TryResolve(root, "/characters/claude./idle.webp", out file, out mime));
        Check("控制字符", !SpritePath.TryResolve(root, "/characters/claude/a%00.webp", out file, out mime));

        // 藏起来时鼠标穿透（WS_EX_TRANSPARENT = 0x20）：只动这一位，别的样式原样保留
        const int layered = 0x80000, noActivate = 0x08000000, toolWindow = 0x80, transparent = 0x20;
        int ex = layered | noActivate | toolWindow;
        Check("藏起来：加上鼠标穿透", ConcealStyle.ClickThrough(ex, true) == (ex | transparent));
        Check("叫回来：去掉鼠标穿透", ConcealStyle.ClickThrough(ex | transparent, false) == ex);
        Check("重复藏不会出错", ConcealStyle.ClickThrough(ConcealStyle.ClickThrough(ex, true), true) == (ex | transparent));
        Check("没藏时叫回来不变", ConcealStyle.ClickThrough(ex, false) == ex);

        // Gemini（Antigravity）额度排版，样本和 macOS 的 tests/antigravity_quota_probe.sh 共用
        string Agy(string name)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "../../../../../fixtures/antigravity", name + ".json");
            var q = AntigravityQuota.Parse(Js(JsonDocument.Parse(File.ReadAllText(path)).RootElement));
            return q == null ? "null" : q["text"] + " | low=" + q["low"];
        }
        string AgyBars(string name)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "../../../../../fixtures/antigravity", name + ".json");
            var q = AntigravityQuota.Parse(Js(JsonDocument.Parse(File.ReadAllText(path)).RootElement));
            return q == null || !q.ContainsKey("bars") ? "null" : JsonSerializer.Serialize(q["bars"], new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        }
        var a1 = Agy("ultra-only-model");
        Check("Gemini：不可用的模型不算进额度（" + a1 + "）", a1.StartsWith("Gemini 剩余 100%") && a1.Contains(" ｜ Claude/GPT 剩余 100% |") && a1.EndsWith("low=False"));
        var a2 = Agy("gemini-used-up");
        Check("Gemini：真用完了还是 0%（" + a2 + "）", a2.StartsWith("Gemini 剩余 0%") && a2.Contains(" ｜ Claude/GPT 剩余 100% |") && a2.EndsWith("low=True"));
        var a3 = Agy("two-pools-with-unavailable");
        Check("Gemini：两个池 + 不可用模型（" + a3 + "）", a3.StartsWith("Gemini 剩余 52%") && a3.Contains(" ｜ Claude/GPT 剩余 99% |") && !a3.Contains(" 0%") && a3.EndsWith("low=False"));

        var s1 = Agy("summary-live");
        Check("Gemini 汇总：两组各一行，98%（" + s1 + "）", s1.StartsWith("Gemini 剩余 100%") && s1.Contains(" ｜ Claude/GPT 剩余 98% · ") && s1.EndsWith("low=False"));
        var s2 = Agy("summary-gemini-used-up");
        Check("Gemini 汇总：比例被省略算 0%（" + s2 + "）", s2.StartsWith("Gemini 剩余 0%") && s2.EndsWith("low=True"));
        var s3 = Agy("summary-two-windows");
        Check("Gemini 汇总：一组两个窗口只留剩余最少的（" + s3 + "）", s3.StartsWith("Gemini 今日 剩余 40%") && !s3.Contains("本周") && s3.Contains(" ｜ Claude/GPT 剩余 98% · "));
        var s4 = Agy("summary-multi-pool");
        Check("Gemini 汇总：独立额度池保留名字，每组一行（" + s4 + "）", s4.StartsWith("Gemini 本周 剩余 99% · ") && s4.Contains(" ｜ Gemini 4 Argon 剩余 46%") && s4.Split('｜').Length == 3 && !s4.Contains("Five Hour"));
        var s5 = Agy("summary-5h-tightest");
        Check("Gemini 汇总：5h 最紧时写成「5小时」（" + s5 + "）", s5.StartsWith("Gemini 5小时 剩余 30%") && !s5.Contains("本周") && s5.Contains(" ｜ Claude/GPT 剩余 100% · "));
        var s6 = Agy("summary-tie-5h-first"); var s7 = Agy("summary-tie-weekly-first");
        Check("Gemini 汇总：两窗口一样紧，显示 5小时 和重置时间，不看接口顺序（" + s6 + "）", s6.StartsWith("Gemini 5小时 剩余 50% · ") && s7.StartsWith("Gemini 5小时 剩余 50% · "));
        var s8 = Agy("summary-weekly-low");
        Check("Gemini 汇总：周额度 ≤10% 不被 5h 盖住（" + s8 + "）", s8.StartsWith("Gemini 本周 剩余 5% · ") && s8.EndsWith("low=True"));
        var s9 = Agy("summary-all-50");
        Check("Gemini 汇总：每一行都带重置时间（" + s9 + "）", s9.Split(new[] { " ｜ " }, StringSplitOptions.None).Length == 3 && s9.Split(new[] { " ｜ " }, StringSplitOptions.None).All(seg => seg.Contains(" 重置")));
        var g1 = AgyBars("summary-multi-pool");
        Check("Gemini bars：每个窗口一项，池名 + 窗口名，同一个池挨着排（" + g1 + "）",
            g1.IndexOf("\"label\":\"Gemini 5小时\"") < g1.IndexOf("\"label\":\"Gemini 本周\"") && g1.IndexOf("\"label\":\"Gemini 本周\"") < g1.IndexOf("\"label\":\"Argon 本周\"")
            && g1.IndexOf("\"label\":\"Argon 本周\"") < g1.IndexOf("\"label\":\"Claude/GPT 5小时\"") && g1.Contains("\"group\":\"Argon\"") && g1.Split(new[] { "\"label\"" }, StringSplitOptions.None).Length == 6 && g1.Contains("\"reset\":17"));
        var g2 = AgyBars("summary-no-reset");
        Check("Gemini bars：没有重置时间就不写 reset（" + g2 + "）", g2 == "[{\"label\":\"Gemini 本周\",\"left\":0.7,\"group\":\"Gemini\"}]");
        Check("Gemini bars：旧接口（用户状态）没有 bars", AgyBars("two-pools-with-unavailable") == "null");
        Check("Gemini 汇总：空的不显示", Agy("summary-empty") == "null");

        // 网页大小核对（只记日志不修正）：量两次、两次一致且和画布差 2% 以上才算对不上——拖滑块时网页还没排完，量到的是半路的数
        Check("网页大小：对得上不记", !ZoomCheck.Off(260, 362, 260, 362, 260, 362));
        Check("网页大小：差 1% 以内不记（取整误差）", !ZoomCheck.Off(260, 362, 258.5, 360, 258.5, 360));
        Check("网页大小：两次都偏小且一致才记", ZoomCheck.Off(260, 362, 208, 289.6, 208, 289.6));
        Check("网页大小：两次量的不一样（还在变）不记", !ZoomCheck.Off(488, 477, 594, 531, 415, 408));
        Check("网页大小：量到的数不对劲（0 或负）不记", !ZoomCheck.Off(260, 362, 0, 0, 0, 0));
        // 系统缩放被算了两遍（反馈：125%、WebView2 155，网页 224×298 应为 280×372）：按偏差把网页缩放调回来；别的偏差不动
        bool Near(double? v, double want) => v.HasValue && Math.Abs(v.Value - want) < 0.005;
        Check("缩放修正：偏差正好是系统缩放 → 修正 0.8", Near(ZoomCheck.Fix(280, 372, 224, 298, 1.25, 1), 0.8));
        Check("缩放修正：150% 时偏差 1/1.5 → 修正 0.667", Near(ZoomCheck.Fix(280, 372, 186.7, 248, 1.5, 1), 0.667));
        Check("缩放修正：对得上不修", ZoomCheck.Fix(280, 372, 280, 372, 1.25, 1) == null);
        Check("缩放修正：宽高偏得不一样（拖滑块半路）不修", ZoomCheck.Fix(488, 477, 594, 531, 1.25, 1) == null);
        Check("缩放修正：100% 时偏小 0.8 不像算两遍，不修", ZoomCheck.Fix(280, 372, 224, 298, 1.0, 1) == null);
        Check("缩放修正：修过以后又好了（偏大回去）→ 撤销成 1", Near(ZoomCheck.Fix(280, 372, 350, 465, 1.25, 0.8), 1));
        Check("缩放修正：量到的数不对劲不修", ZoomCheck.Fix(280, 372, 0, 0, 1.25, 1) == null);
        // 10-29 反馈：系统缩放 100%，网页始终是应有的 2/3——WebView2 把 Windows「文本大小 150%」也算进了缩放
        Check("文本大小：100% 缩放、文本 150%、网页 2/3 → 修正 0.667", Near(ZoomCheck.Fix(260, 362, 174, 242, 1.0, 1, 1.5), 0.667));
        Check("文本大小：人物 160% 时也一样（173×241）", Near(ZoomCheck.Fix(260, 362, 173, 241, 1.0, 1, 1.5), 0.667));
        Check("文本大小：读不到（100%）时照旧不修", ZoomCheck.Fix(260, 362, 174, 242, 1.0, 1) == null);
        Check("文本大小：文本 125% 对不上 2/3 不修", ZoomCheck.Fix(260, 362, 174, 242, 1.0, 1, 1.25) == null);
        Check("文本大小：125% 缩放 × 文本 120% → 修正 1/1.5", Near(ZoomCheck.Fix(300, 300, 200, 200, 1.25, 1, 1.2), 0.667));
        Check("文本大小：修过以后对上了不再改", ZoomCheck.Fix(260, 362, 260, 362, 1.0, 0.667, 1.5) == null);
        // #28：换缩放后网页区域还停在旧缩放的像素上（虚拟显示器 + 混合显卡）：偏差正好是「旧缩放 ÷ 新缩放」
        Check("旧缩放：150%→200% 网页 195×271（应为 260×362）认得出", ZoomCheck.StuckAtOldDpi(260, 362, 195, 271, 1.5, 2.0));
        Check("旧缩放：200%→150% 网页 346×483 认得出", ZoomCheck.StuckAtOldDpi(260, 362, 346, 483, 2.0, 1.5));
        Check("旧缩放：对齐好了不算", !ZoomCheck.StuckAtOldDpi(260, 362, 260, 362, 1.5, 2.0));
        Check("旧缩放：偏差不是这个比例不算", !ZoomCheck.StuckAtOldDpi(260, 362, 208, 289.6, 1.5, 2.0));
        Check("旧缩放：宽高偏得不一样不算", !ZoomCheck.StuckAtOldDpi(260, 362, 195, 300, 1.5, 2.0));
        Check("旧缩放：缩放没变不算", !ZoomCheck.StuckAtOldDpi(260, 362, 260, 362, 1.5, 1.5));
        Check("旧缩放：这两个比例老的「算两遍」修正认不出（1.3.8-beta.1 实测没触发）", ZoomCheck.Fix(260, 362, 195, 271, 2.0, 1) == null && ZoomCheck.Fix(260, 362, 346, 483, 1.5, 1) == null);

        // 主线程必须是 STA：WPF 和 WebView2 都要求。1.3.7-test 里 [STAThread] 被新加的 InstallComplete 隔开、落到了它头上，
        // Main 变成 MTA，WebView2 一初始化就报 RPC_E_CHANGED_MODE（「无法在设置线程模式后对其加以更改」），桌宠打不开
        string FindUp(string rel) { for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent) { var f = Path.Combine(d.FullName, rel); if (File.Exists(f)) return f; } return null; }
        var programCs = FindUp(Path.Combine("app", "windows", "src", "Program.cs"));
        Check("启动：找得到 Program.cs", programCs != null);
        if (programCs != null)
            Check("启动：[STAThread] 紧挨着 static void Main", System.Text.RegularExpressions.Regex.IsMatch(File.ReadAllText(programCs), @"\[STAThread\]\s*static\s+void\s+Main\s*\("));

        // 安装是否完整（#24：一键更新删到一半，characters、integrations 没了，之后每次启动都崩）
        var icRoot = Path.Combine(Path.GetTempPath(), "crosspet-installcheck-" + Guid.NewGuid().ToString("N"));
        string Make(string dir, params string[] parts) { Directory.CreateDirectory(dir); foreach (var x in parts) Directory.CreateDirectory(Path.Combine(dir, x)); return dir; }
        var full = Make(Path.Combine(icRoot, "full"), "characters", "web", "integrations", "tools", "python");
        Check("安装检查：齐全的不缺", InstallCheck.Missing(full).Count == 0);
        var half = Make(Path.Combine(icRoot, "half"), "web", "tools", "python");
        Check("安装检查：删到一半的列出缺了哪些", string.Join(",", InstallCheck.Missing(half)) == "characters,integrations");
        Check("安装检查：目录不存在时全缺", InstallCheck.Missing(Path.Combine(icRoot, "nope")).Count == 5);
        var cache = Path.Combine(icRoot, "CrossPet-update");
        Check("修复包：没有缓存时找不到", InstallCheck.RepairPackage(cache) == null);
        var oldPkg = Make(Path.Combine(cache, "v1.3.3", "CrossPet"), "characters", "web", "integrations", "tools", "python");
        File.WriteAllText(Path.Combine(oldPkg, "install.ps1"), "");
        var badPkg = Make(Path.Combine(cache, "v1.3.6", "CrossPet"), "web");   // 下载 / 解压没完成的
        File.WriteAllText(Path.Combine(badPkg, "install.ps1"), "");
        var newPkg = Make(Path.Combine(cache, "v1.3.4", "CrossPet"), "characters", "web", "integrations", "tools", "python");
        File.WriteAllText(Path.Combine(newPkg, "install.ps1"), "");
        Check("修复包：挑版本最新的完整安装包（不完整的跳过）", InstallCheck.RepairPackage(cache) == newPkg);
        // 从哪儿打开的（#28）：解压出来的安装包问要不要安装；还在压缩包里说先解压；开发时的编译目录照常启动
        var pkgDir = Make(Path.Combine(icRoot, "Downloads", "CrossPet"), "characters", "web", "integrations", "tools", "python");
        File.WriteAllText(Path.Combine(pkgDir, "install.ps1"), "");
        Check("打开位置：就在安装目录", InstallCheck.Locate(full, full + "\\") == InstallCheck.Place.Installed);
        Check("打开位置：解压出来的完整安装包", InstallCheck.Locate(pkgDir, full) == InstallCheck.Place.Package);
        Check("打开位置：压缩包里直接双击", InstallCheck.Locate(Path.Combine(icRoot, "Temp1_CrossPet-Windows.zip", "CrossPet"), full) == InstallCheck.Place.InsideZip);
        Check("打开位置：编译目录（没有 install.ps1）照常启动", InstallCheck.Locate(half, full) == InstallCheck.Place.Other);
        // 宁可漏问也不误判：装好的那份路径和算出来的安装目录对不上时（AppData 重定向、目录链接……），只要叫 …\Programs\CrossPet 就算装好了
        var redirected = Make(Path.Combine(icRoot, "OneDrive", "AppData", "Programs", "CrossPet"), "characters", "web", "integrations", "tools", "python");
        File.WriteAllText(Path.Combine(redirected, "install.ps1"), "");
        Check("打开位置：安装目录对不上，但本身是 Programs\\CrossPet → 当作装好了", InstallCheck.Locate(redirected, full) == InstallCheck.Place.Installed);
        Check("打开位置：大小写不同也算", InstallCheck.Locate(Path.Combine(icRoot, "x", "programs", "crosspet"), full) == InstallCheck.Place.Installed);
        try { Directory.Delete(icRoot, true); } catch { }

        // 「跟着 AI」取消置顶时插到谁下面（1.3.7 用户反馈：右键几次 / 换角色后她不见了——前台是桌面时被插到了壁纸下面）
        Check("全屏：任务栏自动隐藏时最大化的普通窗口（有标题栏）不算全屏", ZOrderRule.JustMaximized(true, 0x16CF0000));
        Check("全屏：最大化的无边框程序（只有可拖边框，如 Electron）不算全屏", ZOrderRule.JustMaximized(true, unchecked((int)0x96040000)));
        Check("全屏：浏览器 F11 / 视频全屏（去掉了标题栏和边框）算全屏", !ZOrderRule.JustMaximized(false, unchecked((int)0x96000000)));
        Check("全屏：最大化的无边框弹出窗口（部分游戏、播放器）算全屏", !ZOrderRule.JustMaximized(true, unchecked((int)0x91000000)));
        Check("层级：前台是普通程序，插到它下面", ZOrderRule.TuckBelow("Chrome_WidgetWin_1", false));
        Check("层级：前台是桌面（Progman），不插", !ZOrderRule.TuckBelow("Progman", false));
        Check("层级：前台是桌面（WorkerW），不插", !ZOrderRule.TuckBelow("WorkerW", false));
        Check("层级：前台是任务栏，不插", !ZOrderRule.TuckBelow("Shell_TrayWnd", false) && !ZOrderRule.TuckBelow("Shell_SecondaryTrayWnd", false));
        Check("层级：前台是 CrossPet 自己（右键菜单、设置窗口），不插", !ZOrderRule.TuckBelow("WindowsForms10.Window.808.app.0.1", true));
        Check("层级：取不到类名，不插", !ZOrderRule.TuckBelow("", false) && !ZOrderRule.TuckBelow(null, false));
        // 记录文件（反馈用）：一行一个 JSON，超过 240 行截回 200 行（docs/架构.md「记录」）
        var line = Ledger.Line(new Dictionary<string, object> { ["char"] = "gpt", ["ev"] = "Pre\"Tool\nUse", ["ok"] = true, ["n"] = 3 });
        var parsed = JsonDocument.Parse(line).RootElement;
        Check("记录：一行能被解析、字段齐（含 t）", parsed.GetProperty("char").GetString() == "gpt" && parsed.GetProperty("ev").GetString() == "Pre\"Tool\nUse"
            && parsed.GetProperty("ok").GetBoolean() && parsed.GetProperty("n").GetInt32() == 3 && parsed.GetProperty("t").GetDouble() > 1_700_000_000);
        var ledgerFile = Path.Combine(Path.GetTempPath(), "crosspet-ledger-" + Guid.NewGuid().ToString("N"), "pet.jsonl");
        for (int i = 0; i < 245; i++) Ledger.Append(ledgerFile, new Dictionary<string, object> { ["i"] = i });
        var rows = File.ReadAllLines(ledgerFile).Where(l => l.Trim() != "").ToList();
        Check("记录：245 次后在 200–240 行、最后一行是最后写的", rows.Count >= 200 && rows.Count <= 240 && JsonDocument.Parse(rows.Last()).RootElement.GetProperty("i").GetInt32() == 244);
        Check("记录：读最后 n 行", Ledger.Tail(ledgerFile, 3).Split('\n').Length == 3 && Ledger.Tail(Path.Combine(Path.GetTempPath(), "nope.jsonl"), 3) == "");
        // 「跟着 AI」时要不要置顶（loki 实测：开 Chrome 再按 Win+D，桌面把不置顶的她一起盖住了，一直不出来）
        Check("置顶：始终在最上层", ZOrderRule.Top("always", false, false));
        Check("置顶：普通窗口模式从不置顶", !ZOrderRule.Top("normal", true, true));
        Check("置顶：跟着 AI，AI 在前台或刚干完活", ZOrderRule.Top("ai", true, false));
        Check("置顶：跟着 AI，普通程序在前台时不置顶（不挡你）", !ZOrderRule.Top("ai", false, false));
        Check("置顶：跟着 AI，前台是桌面 / 任务栏时置顶（没在用程序，挡不着谁）", ZOrderRule.Top("ai", false, true));
        var rn = new DateTime(2026, 10, 21, 4, 0, 0, DateTimeKind.Utc);
        var r1 = new RenderRestartState(0, rn).Next(rn);
        Check("渲染恢复：首次失败允许第 1 次重启", r1?.Attempts == 1);
        var r2 = r1.Next(rn.AddSeconds(10));
        Check("渲染恢复：十秒后又失败允许第 2 次，不留冻住实例", r2?.Attempts == 2);
        var r3 = r2?.Next(rn.AddSeconds(20));
        Check("渲染恢复：第三次连续失败仍允许重启", r3?.Attempts == 3);
        Check("渲染恢复：第 4 次失败停止自动重启", r3 != null && r3.Next(rn.AddSeconds(30)) == null);
        var capped = new RenderRestartState(3, rn);
        Check("渲染恢复：十分钟内预算仍耗尽", capped.Next(rn.AddMinutes(10).AddTicks(-1)) == null);
        Check("渲染恢复：十分钟边界允许新一轮", capped.Next(rn.AddMinutes(10))?.Attempts == 1);
        Check("渲染恢复：时钟倒退不绕过预算", capped.Next(rn.AddSeconds(-1)) == null);
        Check("渲染恢复：旧时间戳文件迁移为一次失败", RenderRestartState.Parse("2026-10-21T12:00:00", rn).Next(rn.AddSeconds(5))?.Attempts == 2);
        Check("渲染恢复：新版记录往返保持 UTC 和次数", RenderRestartState.Parse(capped.Serialize(), rn.AddDays(1)).Serialize() == capped.Serialize());
        Check("渲染恢复：损坏记录按一次失败接续", RenderRestartState.Parse("bad", rn).Next(rn)?.Attempts == 2);
        Check("渲染恢复：无历史次数时不继承失败预算", new RenderRestartState(0, rn).Next(rn.AddMinutes(2))?.Attempts == 1);
        // 角色页卡片图：portrait 不算姿态；卡片图只给存在的文件（设置页据此退回待机图 / 色块）
        Check("卡片图：portrait、portrait-card、avatar 不算姿态", !CardImages.IsSprite("portrait") && !CardImages.IsSprite("portrait-card") && !CardImages.IsSprite("avatar") && CardImages.IsSprite("idle") && CardImages.IsSprite("happy-2"));
        var cardRoot = Path.Combine(Path.GetTempPath(), "crosspet-cards-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(cardRoot, "deepseek"));
        foreach (var f in new[] { "idle.webp", "idle-blink.webp", "portrait.webp", "avatar.png", "happy.webp" }) File.WriteAllText(Path.Combine(cardRoot, "deepseek", f), "");
        Directory.CreateDirectory(Path.Combine(cardRoot, "mine"));
        File.WriteAllText(Path.Combine(cardRoot, "mine", "default.png"), "");
        var ci = CardImages.Of(cardRoot, "deepseek", "crosspet.data");
        Check("卡片图：有展示图、头像和待机图", ci.Count == 3 && (string)ci["avatar"] == "https://crosspet.data/characters/deepseek/avatar.png" && (string)ci["portrait"] == "https://crosspet.data/characters/deepseek/portrait.webp" && (string)ci["idle"] == "https://crosspet.data/characters/deepseek/idle.webp");
        Check("卡片图：只有 default 的自定义角色什么都不给", CardImages.Of(cardRoot, "mine", "crosspet.data").Count == 0);
        Check("卡片图：文件夹不存在也不出错", CardImages.Of(cardRoot, "nobody", "crosspet.data").Count == 0);
        Directory.Delete(cardRoot, true);
        Check("缩放：#28 的 200% 下 195×271 是 0.75 倍，不冒充重复 DPI 的 0.5 倍", ZoomCheck.Off(260, 362, 195, 271, 195, 271)
            && ZoomCheck.Fix(260, 362, 195, 271, 2, 1) == null);

        // 多桌宠：额外那几只第一次出现放在哪（CompanionPlace.Slots，物理像素、y 向下；规则同 macOS 的 companionSlots，
        // 那边测试 tests/companion_place_probe.sh）。都要整个在可见区里、两两不重叠、不压着主桌宠
        // bodies：只比去掉顶上气泡空白的那部分（屏幕放不下整窗口时允许压着气泡空白）
        string Layout(CompanionPlace.Rect main, int n, CompanionPlace.Size size, CompanionPlace.Rect vis, bool bodies = false)
        {
            var s = CompanionPlace.Slots(main, n, size, vis);
            CompanionPlace.Rect B(CompanionPlace.Rect r) => bodies ? CompanionPlace.Body(r) : r;
            if (s.Length != n) return $"只有 {s.Length} 只（要 {n} 只）";
            bool Over(CompanionPlace.Rect a, CompanionPlace.Rect b) => a.X < b.X + b.W - 0.01 && b.X < a.X + a.W - 0.01 && a.Y < b.Y + b.H - 0.01 && b.Y < a.Y + a.H - 0.01;
            for (int i = 0; i < n; i++)
            {
                var r = s[i];
                if (r.X < vis.X - 0.01 || r.Y < vis.Y - 0.01 || r.X + r.W > vis.X + vis.W + 0.01 || r.Y + r.H > vis.Y + vis.H + 0.01) return $"第 {i + 1} 只出了可见区：{r.X} {r.Y}";
                if (Over(B(r), B(main))) return $"第 {i + 1} 只压着主桌宠";
                for (int j = 0; j < i; j++) if (Over(B(r), B(s[j]))) return $"第 {j + 1} 和第 {i + 1} 只重叠";
            }
            return "ok";
        }
        CompanionPlace.Rect R(double x, double y, double w, double h) => new CompanionPlace.Rect(x, y, w, h);
        var pet1 = new CompanionPlace.Size(260, 362);
        // 1920×1080、任务栏 40：主桌宠在默认位置（右边留 40、底下留 100），叫出 12 只
        var vis1080 = R(0, 0, 1920, 1040);
        var mainBR = R(1920 - 260 - 40, 1040 - 362 - 100, 260, 362);
        var l12 = Layout(mainBR, 12, pet1, vis1080);
        Check("多桌宠位置：12 只都在可见区里、两两不重叠（" + l12 + "）", l12 == "ok");
        var first = CompanionPlace.Slots(mainBR, 1, pet1, vis1080);
        Check("多桌宠位置：第一只紧挨在主桌宠左边、底边对齐", first.Length == 1 && first[0].X == 1620 - 260 && first[0].Y == 578);
        var seven = CompanionPlace.Slots(mainBR, 7, pet1, vis1080);
        Check("多桌宠位置：左边排满 6 只后第 7 只往上一排、在主桌宠正上方", seven.Length == 7 && seven[6].X == 1620 && seven[6].Y == 578 - 362);
        var leftEdge = CompanionPlace.Slots(R(40, 578, 260, 362), 1, pet1, vis1080);
        Check("多桌宠位置：主桌宠在最左边时放右边", leftEdge.Length == 1 && leftEdge[0].X == 300 && leftEdge[0].Y == 578);
        // 1280×720 的小屏（任务栏 40）：人物最小（0.6 倍，156×217）时 12 只也都放得下、不重叠
        var vis720 = R(0, 0, 1280, 680);
        var small = new CompanionPlace.Size(156, 217);
        var l720 = Layout(R(1280 - 156 - 40, 680 - 217 - 100, 156, 217), 12, small, vis720);
        Check("多桌宠位置：1280×720 屏幕上 12 只都在可见区里、两两不重叠（" + l720 + "）", l720 == "ok");
        // 副屏在左边（负坐标）、主桌宠贴边缩出屏幕一半：照样都在可见区里
        var lSecond = Layout(R(-1920 - 130, 300, 260, 362), 6, pet1, R(-1920, 0, 1920, 1040));
        Check("多桌宠位置：副屏 + 主桌宠缩出屏幕（" + lSecond + "）", lSecond == "ok");
        // 文字放大后画布比人物宽：主桌宠比额外那只宽 / 窄都不重叠
        var lWide = Layout(R(1500, 600, 348, 341), 8, pet1, vis1080);
        var lNarrow = Layout(mainBR, 8, new CompanionPlace.Size(348, 341), vis1080);
        Check("多桌宠位置：主桌宠和额外那只宽窄不同（" + lWide + " / " + lNarrow + "）", lWide == "ok" && lNarrow == "ok");
        // 笔记本屏幕（可见区高 859，两排整窗口要 862）、主桌宠在右上：整窗口只排得下一排 3 格；
        // 6 只要压着气泡空白排成两排，人物不重叠（以前后 3 只叠在前 3 只上）
        var lLaptop = Layout(R(1164, 38, 310, 431), 6, new CompanionPlace.Size(310, 431), R(0, 38, 1512, 859), bodies: true);
        var lLaptop3 = Layout(R(1164, 38, 310, 431), 3, new CompanionPlace.Size(310, 431), R(0, 38, 1512, 859));
        Check("多桌宠位置：笔记本屏幕上 6 只压着气泡空白排两排（" + lLaptop + " / " + lLaptop3 + "）", lLaptop == "ok" && lLaptop3 == "ok");
        // 默认大小在 1280×720 上放不下 12 只：躲不开重叠，但每只都夹在可见区里
        var crowded = CompanionPlace.Slots(R(1280 - 260 - 40, 680 - 362 - 100, 260, 362), 12, pet1, vis720);
        Check("多桌宠位置：放不下时 12 只照样都在可见区里", crowded.Length == 12
            && crowded.All(r => r.X >= -0.01 && r.Y >= -0.01 && r.X + r.W <= 1280.01 && r.Y + r.H <= 680.01));
        // 叠放时要错开：不能有两只左上角完全重合（完全盖住就只看得见一只）
        Check("多桌宠位置：放不下时 12 只左上角两两不重合", crowded.Select(r => (r.X, r.Y)).Distinct().Count() == 12);
        Check("多桌宠位置：0 只、空尺寸不出错", CompanionPlace.Slots(mainBR, 0, pet1, vis1080).Length == 0
            && CompanionPlace.Slots(mainBR, 3, new CompanionPlace.Size(0, 0), vis1080).Length == 0);
        Console.WriteLine(fails == 0 ? "全部通过" : $"{fails} 项失败");
        return fails == 0 ? 0 : 1;
    }

    // 把 JSON 转成和 Windows 上 JavaScriptSerializer 一样的形状：对象 → Dictionary，数组 → object[]，整数 → int，小数 → decimal
    static object Js(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Object => e.EnumerateObject().ToDictionary(p => p.Name, p => Js(p.Value)),
        JsonValueKind.Array => e.EnumerateArray().Select(Js).ToArray(),
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt32(out var i) ? (object)i : e.GetDecimal(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };
}
