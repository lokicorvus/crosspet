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
        try { Directory.Delete(icRoot, true); } catch { }

        // 「跟着 AI」取消置顶时插到谁下面（1.3.7 用户反馈：右键几次 / 换角色后她不见了——前台是桌面时被插到了壁纸下面）
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
