using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    sealed partial class Pet
    {
        // ---------------- 多桌宠（设置「在干活的 AI 各显示一只」，默认关） ----------------
        // 谁站着、谁走全在主桌宠页面判（app/web/companions.js）；外壳只做系统那一块：
        //   - 按页面交来的 companions 列表开 / 关额外桌宠的窗口（Companion.cs，同一个进程、同一个 WebView2 环境、同一套网页）
        //   - 把 <角色>@<客户端>-state.json、按客户端过滤的会话、额度转给对应的那只，前台程序、在跑的 AI 程序告诉主桌宠页面
        // 开关关着、也没在集合时：不读 @ 状态文件、不发前台 / 在跑的程序，行为和以前一样。
        // 页面 ↔ 外壳的接口见 .superpowers/sdd/2026-10-31-multi-pets/shell-contract.md；和 macOS 的 App+Companions.swift 一一对应

        /// <summary>站着的额外桌宠，按页面给的 id 管（集合来的收编客户端后 key 变、id 不变）</summary>
        internal readonly Dictionary<string, Companion> companions = new Dictionary<string, Companion>();
        readonly List<Companion> leavingCompanions = new List<Companion>();   // 收到 companionLeave、正在说 bye 的
        int companionExpected;
        int companionTarget;         // 这一轮页面发来的列表里一共几只额外桌宠：新开的那只按这个数排格子（CompanionOrigin）
        bool pageGathering;          // 页面说正集合着（companions 消息里的 gathering）：菜单显示「解散」，开关关着时也转发
        bool eggAllowed = true;      // 有别的桌宠在场时页面发 false：「召唤彩蛋」变灰
        object friendshipRows;       // 主桌宠页面最后一次发来的友谊行，推给设置页
        readonly Dictionary<string, (long seq, string code)> quotaCode = new Dictionary<string, (long seq, string code)>();   // 「角色|函数名」→ 最后一次额度调用和它的先后序号
        long quotaSeq;
        readonly Dictionary<string, (string json, string pose, DateTime at)> clientStates = new Dictionary<string, (string, string, DateTime)>();
        readonly Dictionary<string, (string json, string pose, DateTime at)> charStates = new Dictionary<string, (string, string, DateTime)>();
        readonly HashSet<string> clientStateSeen = new HashSet<string>();   // 读到过按客户端状态的角色（之后不再把按角色的那份给额外那只）
        readonly Dictionary<string, string> sessionsText = new Dictionary<string, string>();
        string sentRunning;
        bool runningInFlight;

        static bool MultiPetsOn => Store.Flag("multiPets");
        static string PetsRest => Store.Settings.TryGetValue("petsRest", out var v) && v as string == "stay" ? "stay" : "auto";
        /// <summary>固定主桌宠：""= 跟着规则换；存的角色已经不在了也当没固定</summary>
        string MainPet => Store.Settings.TryGetValue("mainPet", out var v) && v is string s && Characters().Any(c => c.id == s) ? s : "";
        /// <summary>要不要转发：开关开着，或者正集合着（集合不受开关限制）</summary>
        bool CompanionsForwarding => MultiPetsOn || pageGathering;

        /// <summary>算「终端」的程序（设计第二节「什么算在 AI 软件里」）：终端里看不出跑的是谁，由页面按最近有没有命令行客户端干过活判断</summary>
        static readonly HashSet<string> TerminalExes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "windowsterminal.exe", "cmd.exe", "conhost.exe", "powershell.exe", "pwsh.exe", "wezterm-gui.exe", "alacritty.exe", "code.exe" };

        // ---- 给 Companion 用的（和主桌宠共用的尺寸、缩放、隐藏状态） ----
        internal double PageW => pageW;
        internal double PageH => pageH;
        internal double PageFoot => pageFoot;
        internal double ZoomFix => zoomFix;
        internal bool Concealed => concealed;
        internal bool SessionLocked => sessionLocked;
        internal void OpenSettingsFromCompanion() => OpenSettings();
        IEnumerable<Companion> AllCompanions => companions.Values.Concat(leavingCompanions).ToList();

        // ---------------- 第一次出现放在哪 ----------------

        /// <summary>新开的那只放哪（物理像素）：记过位置（origin-&lt;key&gt;，还在某块屏幕上）就回到那里，夹进那块屏幕的工作区；
        /// 压着站着的窗口（主桌宠或别的额外那只），或者占了后面几只要用的格子（剩下的不够放），就不用它，改挑主桌宠旁边第一个空着的格子（CompanionPlace.Slots）。
        /// 格子按这一轮一共要站几只（companionTarget）排：以前按已经站着几只排，前后两套格子对不上就叠在一起了（11-02，同 Mac）</summary>
        internal (int x, int y) CompanionOrigin(string key, int w, int h)
        {
            var others = AllCompanions.Select(c => c.Frame).Where(f => f.HasValue).Select(f => f.Value).ToList();
            Native.GetWindowRect(hwnd, out var m);
            var main = new CompanionPlace.Rect(m.Left, m.Top, m.Right - m.Left, m.Bottom - m.Top);
            CompanionPlace.Rect Box(System.Drawing.Rectangle r) => new CompanionPlace.Rect(r.Left, r.Top, r.Width, r.Height);
            var wa = Box(Forms.Screen.FromHandle(hwnd).WorkingArea);
            var size = new CompanionPlace.Size(w, h);
            var total = Math.Max(companionTarget, others.Count + 1);
            var planned = CompanionPlace.Slots(main, total, size, wa);
            var slots = planned.Concat(CompanionPlace.Slots(main, 2 * others.Count + 1, size, wa)).ToArray();
            // 比的是去掉气泡空白的那部分：排不下时格子本来就压着上一排的气泡空白
            bool Clear(CompanionPlace.Rect s, IEnumerable<CompanionPlace.Rect> taken) => !taken.Any(o => CompanionPlace.Core(s).Intersects(CompanionPlace.Core(o), 1));   // 左右也去掉两边的透明边：格子排不下时左右压着这截
            if (Store.Settings.TryGetValue("origin-" + key, out var pos) && pos is Dictionary<string, object> p && p.ContainsKey("x") && p.ContainsKey("y"))
            {
                var r = new CompanionPlace.Rect(Convert.ToDouble(p["x"]), Convert.ToDouble(p["y"]), w, h);
                var inner = new CompanionPlace.Rect(r.X + 40, r.Y + 40, Math.Max(1, w - 80), Math.Max(1, h - 80));
                var scr = Forms.Screen.AllScreens.FirstOrDefault(s => Box(s.WorkingArea).Intersects(inner));
                if (scr != null)
                {
                    r = CompanionPlace.Clamp(r, Box(scr.WorkingArea));
                    var left = CompanionPlace.FreeSlots(planned, others.Concat(new[] { r })).Count;
                    if (Clear(r, new[] { main }.Concat(others)) && left >= total - others.Count - 1) return ((int)r.X, (int)r.Y);
                }
            }
            var free = slots.Cast<CompanionPlace.Rect?>().FirstOrDefault(s => Clear(s.Value, others));
            var pick = free ?? (slots.Length > 0 ? slots[slots.Length - 1] : main);
            return ((int)Math.Round(pick.X), (int)Math.Round(pick.Y));
        }

        // ---------------- 主桌宠页面发来的消息 ----------------

        /// <summary>主桌宠页面 WebMessageReceived 里调：companions / companionLeave / companionCall / eggAllowed / friendship。
        /// 不按开关挡：开关关掉时页面要发一次 [] 让外壳关窗口，关着时集合也要开窗口；页面在关着、没集合时本来就不发</summary>
        void HandleCompanionMessage(Dictionary<string, object> m)
        {
            if (m.TryGetValue("companionLeave", out var lv) && lv is string leaveId) CompanionLeave(leaveId);
            if (m.TryGetValue("companions", out var cv) && cv is object[] list)
            {
                // gathering：页面说正集合着（菜单显示「解散」；开关关着时也要转发）
                var was = CompanionsForwarding;
                pageGathering = m.TryGetValue("gathering", out var g) && g is bool gb && gb;
                // 集合时最后一共几只（还没登场的也算上）
                companionExpected = m.TryGetValue("expected", out var ex) ? Convert.ToInt32(ex) : 0;
                SyncCompanions(list);
                if (CompanionsForwarding && !was) StartForwarding();
            }
            if (m.TryGetValue("companionCall", out var call) && call is Dictionary<string, object> cd) CompanionCall(cd);
            if (m.TryGetValue("eggAllowed", out var ea) && ea is bool ok) eggAllowed = ok;
            if (m.TryGetValue("friendship", out var fr) && fr is object[] rows) { friendshipRows = rows; PushSettings(); }
            if (m.TryGetValue("friendshipStore", out var fs) && fs is Dictionary<string, object> store) SaveFriendshipFile(store);
        }

        // ---- 友谊的备份（数据目录里的 friendship.json）----
        // 网页的存储在 webview2 文件夹里：被清掉就没了。页面每次记账都交一份来，载入完（NavigationCompleted，init 之前）
        // 交回去并进网页的存储（restoreFriendship，合并规则见 friendship.js 的 merge）。和 Mac 一样
        static string FriendshipFile => Path.Combine(Store.Data, "friendship.json");
        static void SaveFriendshipFile(Dictionary<string, object> store)
        {
            try { Store.WriteJson(FriendshipFile, store); } catch (Exception e) { Store.Log("保存友谊备份失败: " + e.Message); }
        }
        /// <summary>交给 restoreFriendship 的参数：文件里的 JSON 对象，没有 / 坏了就是 null</summary>
        static string SavedFriendshipJson() => Store.ReadJson(FriendshipFile) is Dictionary<string, object> d ? Store.Json.Serialize(d) : "null";

        /// <summary>按完整列表对齐窗口（按 id）：没有窗口的开；已经不在列表里、也没收到过 companionLeave 的（开关关掉时的 []、页面重载后的完整列表）
        /// 直接关掉，不留残窗；收到过 companionLeave 的已经挪到 leavingCompanions，在说 bye</summary>
        void SyncCompanions(object[] list)
        {
            var seen = new HashSet<string>();
            companionTarget = Math.Max(list.Length, companionExpected);
            foreach (var item in list)
            {
                if (!(item is Dictionary<string, object> info) || !(info.TryGetValue("id", out var iv) && iv is string id) || id == "" || seen.Contains(id)
                    || !(info.TryGetValue("character", out var chv) && chv is string ch) || !Characters().Any(c => c.id == ch)) continue;
                seen.Add(id);
                if (companions.TryGetValue(id, out var c))
                {
                    if (c.Character == ch) { c.Update(info); continue; }
                    c.Close();   // 同一个 id 换了角色（不该发生）：关掉重开
                }
                try { companions[id] = new Companion(this, env, info); }
                catch (Exception e) { Store.Log("开额外桌宠窗口失败: " + e.Message); }
            }
            foreach (var kv in companions.Where(kv => !seen.Contains(kv.Key)).ToList()) kv.Value.Close();
        }

        void CompanionLeave(string id)
        {
            if (!companions.TryGetValue(id, out var c)) return;
            companions.Remove(id);
            leavingCompanions.Add(c);
            c.Leave();
        }

        /// <summary>主桌宠页面让某只额外的桌宠做的事：额度庆祝（celebrate）、每对台词里她那句（chat）；别的不认</summary>
        void CompanionCall(Dictionary<string, object> call)
        {
            if (!(call.TryGetValue("id", out var iv) && iv is string id) || !(call.TryGetValue("fn", out var fv) && fv is string fn && (fn == "celebrate" || fn == "chat"))
                || !(call.TryGetValue("args", out var av) && av is object[] args) || !companions.TryGetValue(id, out var c)) return;
            c.Js($"{fn}.apply(null, {Store.Json.Serialize(args)})");
        }

        internal void CompanionClosed(Companion c)
        {
            if (companions.TryGetValue(c.Id, out var cur) && cur == c) companions.Remove(c.Id);
            leavingCompanions.Remove(c);
        }

        void CloseAllCompanions() { foreach (var c in AllCompanions) c.Close(); }

        /// <summary>主桌宠页面重新载入完了：集合的记录跟着丢了。开关开着时页面热身完会发完整列表，按它对齐；
        /// 开关关着时页面不会再发，这里直接把窗口都关掉（回到单只）</summary>
        void CompanionsMainReloaded()
        {
            pageGathering = false;
            if (MultiPetsOn) return;
            CloseAllCompanions();
            // 关着开关集合过：页面发过 eggAllowed:false，重新载入后的页面在开关关着时不会再发 true，「召唤彩蛋」会一直灰着。
            // 窗口都关了、回到单只，这里自己放开（菜单每次打开时重新生成，下次打开就不灰了）
            eggAllowed = true;
        }

        /// <summary>主桌宠的网页 / 浏览器进程崩了（RecoverWeb）：额外那几只没人管了（不会再收到列表、状态；浏览器进程挂了的话
        /// 她们的网页也一起废了），全部关掉。主桌宠页面重新载入完照常按页面重新算的完整列表再开（用的是新环境）。
        /// 开关关着、也没有额外窗口时和以前一样什么都不做</summary>
        void CompanionsMainCrashed()
        {
            if (!MultiPetsOn && companions.Count == 0 && leavingCompanions.Count == 0) return;
            Store.Log("桌宠页面的网页进程退出了，关掉额外的桌宠，等页面重新载入后再按列表开");
            CloseAllCompanions();
            pageGathering = false;
            eggAllowed = true;   // 同 CompanionsMainReloaded：额外的都关了，别让「召唤彩蛋」一直灰着（开关开着时页面重新载入后会再发）
        }

        async void GatherCompanions()
        {
            if (!ready) return;
            if (await Eval("gather()") != "true") return;
            var was = CompanionsForwarding;
            pageGathering = true;
            if (!was) StartForwarding();
        }
        void DismissCompanions() { if (ready) Js("dismiss()"); }   // 解散完页面发 gathering: false

        // ---------------- 设置 ----------------

        /// <summary>三个设置一起推给主桌宠页面（页面加载完、设置改变时）</summary>
        void PushMultiPets() =>
            Js($"setMultiPets({Store.Json.Serialize(new Dictionary<string, object> { ["on"] = MultiPetsOn, ["rest"] = PetsRest, ["mainPet"] = MainPet })})");

        /// <summary>设置页 { cmd: 'set', key: multiPets / petsRest / mainPet }（HandleSettings 里调）；返回 false = 不是这三个键</summary>
        bool SetCompanionSetting(string key, object value)
        {
            switch (key)
            {
                case "multiPets":
                    var was = CompanionsForwarding;
                    Store.Settings["multiPets"] = value is bool b && b; Store.SaveSettings();
                    PushMultiPets();
                    ApplyMainPet();
                    if (CompanionsForwarding && !was) StartForwarding();
                    return true;
                case "petsRest":
                    if (value is string r && (r == "auto" || r == "stay")) { Store.Settings["petsRest"] = r; Store.SaveSettings(); PushMultiPets(); }
                    return true;
                case "mainPet":
                    if (value is string s && (s == "" || Characters().Any(c => c.id == s))) { Store.Settings["mainPet"] = s; Store.SaveSettings(); PushMultiPets(); ApplyMainPet(); }
                    return true;
                default: return false;
            }
        }

        /// <summary>固定主桌宠由外壳自己生效（页面只记着）：开关开着、固定了某个角色，就把主桌宠换成她</summary>
        void ApplyMainPet()
        {
            var id = MainPet;
            if (!MultiPetsOn || id == "" || id == current) return;
            SwitchTo(id, "manual", "mainPet");
        }

        /// <summary>共用的设置变了，额外那几只跟着（HandleSettings 里调）</summary>
        void CompanionsSettingChanged(string key)
        {
            if (companions.Count == 0) return;
            switch (key)
            {
                case "size": foreach (var c in companions.Values) c.ApplySizes(Anchor.Bottom); break;
                case "textSize": case "textLinked": foreach (var c in companions.Values) c.ApplySizes(Anchor.Feet); break;
                case "showName": case "aura": case "powerSave": case "noSleep": case "quotaStyle": case "peakStyle": CompanionsJs(CompanionLookJs); break;
                case "edgeDock": if (!EdgeDockEnabled) foreach (var c in companions.Values) c.Undock(); break;
            }
        }

        /// <summary>额外那只的外观设置（共用的那几项）。合并额度表只在主桌宠身上，所以她的关着</summary>
        internal string CompanionLookJs =>
            $"setAuraMode({Q(AuraMode)}); setShowName({(ShowName ? "true" : "false")}); setPowerSave({(PowerSave ? "true" : "false")}); setNeverSleep({(NoSleep ? "true" : "false")}); setQuotaAggregate(false); setPeakStyle({Q(PeakStyle)}); setQuotaStyle({Q(QuotaStyle)})";

        void CompanionsJs(string code) { foreach (var c in AllCompanions) c.Js(code); }

        /// <summary>全屏隐藏、快捷键隐藏、显示层级对所有窗口一起生效（ApplyLayer、SetConcealed 里调）</summary>
        void SyncCompanionWindows() { foreach (var c in AllCompanions) c.SyncWithMain(); }

        // ---------------- 转发 ----------------

        /// <summary>开始转发（打开开关、开关关着时开始集合、主桌宠页面重新载入完）：@ 状态重新读一遍，前台 / 在跑的程序马上交一次</summary>
        void StartForwarding()
        {
            foreach (var k in stamps.Keys.Where(k => k.Contains("@")).ToList()) stamps.Remove(k);
            PushForeground();
            PushRunning(force: true);
        }

        /// <summary>每次轮询（Poll）：状态目录里文件名带 @ 的 -state.json，有变化就交给主桌宠页面（applyClientState）和 key 对得上的那只</summary>
        void PollClientStates()
        {
            if (!CompanionsForwarding) return;
            string[] files;
            try { files = Directory.GetFiles(Store.State, "*@*-state.json"); } catch { return; }
            foreach (var file in files)
            {
                var name = Path.GetFileName(file);
                if (!name.EndsWith("-state.json", StringComparison.Ordinal)) continue;
                var key = name.Substring(0, name.Length - "-state.json".Length);
                var at = key.IndexOf('@');
                if (at <= 0) continue;
                string character = key.Substring(0, at), client = key.Substring(at + 1);
                if (client == "" || !Characters().Any(c => c.id == character)) continue;
                FileInfo fi;
                try { fi = new FileInfo(file); if (!fi.Exists || fi.Length > 1_000_000) continue; } catch { continue; }
                var stamp = fi.LastWriteTimeUtc.Ticks + ":" + fi.Length;
                var skey = key + "-state";
                if (stamps.TryGetValue(skey, out var old) && old == stamp) continue;
                if ((DateTime.UtcNow - fi.LastWriteTimeUtc).TotalMinutes > 10) { stamps[skey] = stamp; continue; }   // 和按角色的一样：只认 10 分钟内的
                var value = Store.ReadJson(file);
                if (value == null) continue;   // 可能正被钩子写一半，下次再读
                stamps[skey] = stamp;
                var json = Store.Json.Serialize(value);
                var pose = value.TryGetValue("pose", out var pv) ? pv as string : null;
                clientStateSeen.Add(character);
                clientStates[key] = (json, pose, fi.LastWriteTimeUtc);
                if (Paused) continue;
                Js($"applyClientState({Q(character)}, {Q(client)}, {json})");
                foreach (var c in companions.Values.Where(c => c.Key == key)) c.ApplyState(json, pose);
            }
        }

        /// <summary>按角色的状态（Poll 读到 &lt;角色&gt;-state.json 时调）：旧钩子没写按客户端的那份时，交给这个角色收编了客户端的那只</summary>
        void NoteCharState(string id, string json, string pose, DateTime at)
        {
            charStates[id] = (json, pose, at);
            if (!CompanionsForwarding || Paused || clientStateSeen.Contains(id)) return;
            foreach (var c in companions.Values.Where(c => c.Character == id && c.Client != null)) c.ApplyState(json, pose);
        }

        /// <summary>会话表变了（Poll 读到 &lt;角色&gt;-sessions.json 时调）：每只拿她自己客户端的那份</summary>
        void NoteSessions(string id, string json)
        {
            sessionsText[id] = json;
            if (!CompanionsForwarding || Paused) return;
            foreach (var c in companions.Values.Where(c => c.Character == id)) c.Js($"setSessions({Q(id)}, {SessionsFor(c)})");
        }

        /// <summary>只留她客户端的会话；没写 client 的旧条目按角色名算客户端（和 companions.js 的 clientsOf 一样）。还没收编客户端的集合那只：空的</summary>
        string SessionsFor(Companion c)
        {
            if (c.Client == null || !sessionsText.TryGetValue(c.Character, out var text)) return "{}";
            if (!(Store.Json.DeserializeObject(text) is Dictionary<string, object> map)) return "{}";
            string ClientOf(object entry) => entry is Dictionary<string, object> d && d.TryGetValue("client", out var cl) && cl is string s ? s : c.Character;
            var mine = map.Where(kv => ClientOf(kv.Value) == c.Client).ToDictionary(kv => kv.Key, kv => kv.Value);
            return Store.Json.Serialize(mine);
        }

        /// <summary>额度：主桌宠照旧拿，同时记下；这个角色 quota: true 的那只也拿一份。
        /// 按「角色 + 函数名」记：GPT 的 setQuota（额度文件）和 setCodexQuota（问 Codex 服务）不互相盖掉</summary>
        void QuotaJS(string character, string code)
        {
            Js(code);
            var paren = code.IndexOf('(');
            quotaCode[character + "|" + (paren < 0 ? code : code.Substring(0, paren))] = (++quotaSeq, code);
            foreach (var c in companions.Values.Where(c => c.Character == character && c.Quota)) c.Js(code);
        }
        /// <summary>这个角色记下的所有额度调用（新开的那只、额度刚归她时补一遍）：按主桌宠收到的先后补，不按函数名排</summary>
        internal IEnumerable<string> QuotaCodes(string character) =>
            quotaCode.Where(kv => kv.Key.StartsWith(character + "|", StringComparison.Ordinal)).OrderBy(kv => kv.Value.seq).Select(kv => kv.Value.code).ToList();

        /// <summary>新开的那只页面加载完（或换了客户端）：会话、状态、额度先补一遍</summary>
        internal void FeedCompanion(Companion c)
        {
            if (Paused) return;
            c.Js($"setSessions({Q(c.Character)}, {SessionsFor(c)})");
            // at 是状态文件的写入时间，只用来判断新不新（和 Poll 一样只认 10 分钟内的）；她贴边跑不跑出来按交给她的时间算（见 Companion.ApplyState）
            bool Fresh((string json, string pose, DateTime at) s) => (DateTime.UtcNow - s.at).TotalMinutes < 10;
            if (c.Client != null)
            {
                if (clientStates.TryGetValue(c.Key, out var cs) && Fresh(cs)) c.ApplyState(cs.json, cs.pose);
                else if (!clientStateSeen.Contains(c.Character) && charStates.TryGetValue(c.Character, out var ch) && Fresh(ch)) c.ApplyState(ch.json, ch.pose);
            }
            if (c.Quota) foreach (var code in QuotaCodes(c.Character)) c.Js(code);
            else c.Js($"setQuota({Q(c.Character)}, null)");
        }

        // ---------------- 前台程序、在跑的 AI 程序 ----------------

        /// <summary>前台程序是哪一类：ai（「跟随前台」认得的 AI 程序，Claude 桌面带 client）、terminal、ours（CrossPet 自己的窗口）、other</summary>
        Dictionary<string, object> ForegroundInfo()
        {
            var exe = Native.ForegroundExe();
            if (exe == "") return new Dictionary<string, object> { ["kind"] = "other" };
            if (exe == "crosspet.exe") return new Dictionary<string, object> { ["kind"] = "ours" };   // 设置、换角色、反馈窗口（桌宠窗口从不拿焦点）
            var match = ForegroundMatch(exe);
            if (!string.IsNullOrWhiteSpace(match))
            {
                var f = new Dictionary<string, object> { ["kind"] = "ai", ["character"] = HostCharacter(match) };
                if (exe == "claude.exe") f["client"] = "claude-desktop";
                return f;
            }
            return new Dictionary<string, object> { ["kind"] = TerminalExes.Contains(exe) ? "terminal" : "other" };
        }

        static string ForegroundMatch(string exe)
        {
            var map = Store.ReadJson(Store.AppMap);
            return exe == "" ? null : map?.FirstOrDefault(kv => string.Equals(kv.Key, exe, StringComparison.OrdinalIgnoreCase)).Value as string;
        }

        void PushForeground()
        {
            if (!ready || !CompanionsForwarding) return;
            Js($"setForeground({Store.Json.Serialize(ForegroundInfo())})");
        }

        /// <summary>在跑的 AI 程序的「角色@客户端」（「一直留着」时，程序关掉她才走）。程序经 apps.json（windows-apps.json）换成客户端名：
        /// Claude 桌面（claude.exe，有窗口的）claude-desktop、codex.exe codex、antigravity.exe antigravity，其余用它在对照表里的名字
        /// （多模型宿主是宿主名，其余是角色名，和钩子写的接入名一致）。同一个程序里可能跑着好几个模型的角色（Codex 接了 DeepSeek 接口就是
        /// deepseek@codex），所以每个客户端都和所有角色配一遍。枚举进程放到后台</summary>
        static List<string> RunningKeys(Dictionary<string, object> map, List<string> characterIds)
        {
            var clients = new HashSet<string>();
            if (map == null) return new List<string>();
            var byExe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in map) if (kv.Value is string v && !string.IsNullOrWhiteSpace(v)) byExe[kv.Key] = v;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    var exe = p.ProcessName + ".exe";
                    if (!byExe.TryGetValue(exe, out var mapped)) continue;
                    var name = exe.ToLowerInvariant();
                    if (name == "claude.exe") { if (p.MainWindowHandle != IntPtr.Zero) clients.Add("claude-desktop"); }   // 没窗口的是终端里的 Claude Code
                    else if (name == "codex.exe") clients.Add("codex");
                    else if (name == "antigravity.exe") clients.Add("antigravity");
                    else clients.Add(mapped);
                }
                catch { }
                finally { p.Dispose(); }
            }
            return clients.SelectMany(cl => characterIds.Select(id => id + "@" + cl)).OrderBy(k => k, StringComparer.Ordinal).ToList();
        }

        /// <summary>每 5 秒（Start 里）和开始转发时：变了才发</summary>
        async void PushRunning(bool force = false)
        {
            if (!ready || !CompanionsForwarding) { sentRunning = null; return; }
            if (runningInFlight) return;
            runningInFlight = true;
            try
            {
                var map = Store.ReadJson(Store.AppMap);
                var ids = Characters().Select(c => c.id).ToList();
                var keys = await Task.Run(() => RunningKeys(map, ids));
                if (!ready || !CompanionsForwarding) return;
                var json = Store.Json.Serialize(keys);
                if (!force && json == sentRunning) return;
                sentRunning = json;
                Js($"setRunning({json})");
            }
            catch (Exception e) { Store.Log("多桌宠：列在跑的程序失败 " + e.Message); }
            finally { runningInFlight = false; }
        }

        /// <summary>「跟随前台」要换角色：开关开着时先问页面（固定了主桌宠、要换成的已经有一只站着：不换）；关着时照旧直接换。
        /// 答复回来时前台变了、手动换了人、页面重载了（followEventGeneration 变了）就作废</summary>
        void FollowTo(string id, string why, string exe)
        {
            if (!MultiPetsOn) { SwitchTo(id, why, exe); return; }
            _ = FollowToAsk(id, why, exe);
        }
        async Task FollowToAsk(string id, string why, string exe)
        {
            var generation = followEventGeneration;
            var standing = companions.Values.Select(c => c.Character).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
            var input = Store.Json.Serialize(new Dictionary<string, object> { ["foregroundId"] = id, ["current"] = current, ["mainPet"] = MainPet, ["standing"] = standing });
            var answer = await Eval($"FollowPolicy.foregroundTarget(Object.assign({input}, {{ mainClaimed: mainClaimed() }}))");   // 主桌宠的角色有会话就不换（谁先来谁当）
            string target;
            try { target = Store.Json.Deserialize<string>(answer); } catch { target = null; }
            if (target != id || id == current || generation != followEventGeneration || !ready || Paused || Native.ForegroundExe() != exe) return;
            SwitchTo(id, why, exe);
        }
    }
}
