using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    /// <summary>
    /// 多桌宠：额外那一只的窗口。和主桌宠同一个进程、同一个 CoreWebView2Environment、同一套网页（index.html，同源、同一份 localStorage），
    /// 页面先 setRole('companion') 再 init：只显示，不做只该做一次的事（那些在主桌宠页面里做）。
    /// 状态、会话（按她的客户端过滤）、额度都由 Pet 转发，她自己不读文件（见 Pet.Companions.cs）。
    /// 拖动、贴边、能点到的区域各自管；位置记在 origin-&lt;key&gt;、贴边记在 dock-&lt;key&gt;（key = &lt;角色&gt;@&lt;客户端&gt;），主桌宠原来的键不动。
    /// 贴边的计算和主桌宠共用 Pet.Dock.cs 里的纯函数；这里只放她自己的状态。和 macOS 的 Companion.swift 一一对应。
    /// 窗口是 DirectHost（系统直接合成网页，开窗口不卡；见那个文件），鼠标由网页交过来（pointer 消息）
    /// </summary>
    sealed class Companion
    {
        readonly Pet pet;
        public string Id { get; private set; }  // 窗口身份（页面给的，集合来的收编客户端后 key 变、id 不变）
        public string Character { get; private set; }   // 主桌宠换成她的角色时就地对调成主桌宠原来的角色（窗口、位置不变）
        public string Key { get; private set; }
        public string Client { get; private set; }   // 集合来、还没收编客户端时是 null
        public bool Quota { get; private set; }      // 同一个角色只有一只显示额度
        public string Label { get; private set; }    // 「桌面」「终端」小字（同一个角色站了两只时）
        public DirectHost Host { get; }
        WebView2 web;
        readonly Dispatcher ui = Dispatcher.CurrentDispatcher;
        IntPtr hwnd;
        bool ready, leaving, closed;
        bool parked;     // 屏幕外先备着（Pet.PrepareCompanions）：页面藏着，Adopt 时才挪到位置、噗一下出来
        public bool Warm { get; private set; }   // 备好了：页面加载完、第一下画面也画过了（那一下会卡住界面）
        int crashes;   // 网页进程崩了几次
        public (string pose, DateTime at)? LastPose;   // 她最近一次状态（贴边时判断跑不跑出来）
        readonly List<DispatcherTimer> timers = new List<DispatcherTimer>();

        // 尺寸：画布（网页 CSS 尺寸）× 人物大小，和主桌宠一样由网页 setSizes 算
        double pageW, pageH, pageFoot, shownFootPx;
        // 贴边
        string dock;
        bool dockOut, dockHover, dockTucked;
        DateTime? dockLeaveAt, dockEnterAt;
        DateTime dockedAt = DateTime.MinValue;
        readonly Dictionary<string, double> dockCut = new Dictionary<string, double>();
        bool concealedShown;   // 现在是不是跟着主桌宠藏着
        Forms.ContextMenuStrip openMenu;

        string OriginKey => "origin-" + Key;
        string DockKey => "dock-" + Key;
        public bool IsOpen => !closed && hwnd != IntPtr.Zero;

        /// <summary>info：主桌宠页面 companions 列表里的一项 { id, key, character, client, quota, label }（Pet.SyncCompanions 已检查过 id 和角色）。
        /// parked：先在屏幕外开好、页面藏着，等列表里真有她了再 Adopt（见 Pet.PrepareCompanions）</summary>
        public Companion(Pet pet, CoreWebView2Environment env, IDictionary<string, object> info, bool parked = false)
        {
            this.pet = pet;
            this.parked = parked;
            Id = Str(info, "id") ?? "";
            Key = Str(info, "key") ?? Id;
            Character = Str(info, "character") ?? "";
            Client = Str(info, "client");
            Quota = info.TryGetValue("quota", out var q) && q is bool qb && qb;
            Label = Str(info, "label") ?? "";
            pageW = pet.PageW; pageH = pet.PageH; pageFoot = pet.PageFoot;

            // 备着的整个窗口透明、鼠标穿过（网页刚加载、还没藏起来的那一下会漏出光圈，1.3.9-test.12 看到的）
            Host = new DirectHost(!parked) { Topmost = pet.Topmost, ForcePassThrough = parked };
            web = Host.Web;
            Host.HandleCreated += (_, __) =>
            {
                hwnd = Host.Handle;
                var dpi = Host.DpiScale;   // 和主桌宠一样大（共用人物大小、文字大小）
                Host.Size = new System.Drawing.Size((int)Math.Round(pageW * Pet.Scale * dpi), (int)Math.Round(pageH * Pet.Scale * dpi));
                if (this.parked) return;   // 备着的先不摆，Adopt 时再摆
                Native.GetWindowRect(hwnd, out var r);
                var (x, y) = pet.CompanionOrigin(Key, r.Right - r.Left, r.Bottom - r.Top);
                Native.MoveTo(hwnd, x, y);
                SaveOrigin();   // 走了以后这个客户端又干活：回到这里出现
                SyncWithMain();
            };
            Every(250, () => _ = UpdateHitRects());
            Every(80, UpdateDockHover);
            Host.DpiChanged += (_, __) => ui.BeginInvoke(DispatcherPriority.Loaded, new Action(() => { lastHitRects = null; dockCut.Clear(); ApplySizes(Pet.Anchor.Feet); }));
            Host.Load += async (_, __) => await InitWeb(env);
            Host.Show();
        }

        static string Str(IDictionary<string, object> d, string k) => d.TryGetValue(k, out var v) ? v as string : null;

        void Every(int ms, Action a)
        {
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ms) };
            t.Tick += (_, __) => { if (closed) return; try { a(); } catch (Exception e) { Store.Log("额外桌宠定时任务出错: " + e.Message); } };
            t.Start();
            timers.Add(t);
        }

        // ---------------- 网页 ----------------

        async Task InitWeb(CoreWebView2Environment env)
        {
            try
            {
                await web.EnsureCoreWebView2Async(env);
                if (closed) return;
                var core = web.CoreWebView2;
                Pet.Map(core);
                core.NavigationStarting += (_, a) => { if (!a.Cancel) ready = false; };
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                web.ZoomFactor = Pet.Scale * pet.ZoomFix;
                core.ProcessFailed += (_, a) => ui.BeginInvoke(new Action(() => ProcessFailed(a.ProcessFailedKind)));
                core.NavigationCompleted += (_, a) =>
                {
                    ready = false;
                    if (closed) return;
                    if (!a.IsSuccess) { Store.Log("额外桌宠页面加载失败: " + a.WebErrorStatus); return; }
                    ready = true;
                    // 一定先 setRole 再 init / setCharacter（同一段脚本里按顺序跑）：不然页面按主桌宠演登场招呼，会写共用的 crosspet-greeted
                    // setCharacter 不 quiet：「噗」一下出现，说一句登场招呼
                    // 备着的：init 按 roleInfo.parked 悄悄换上、整页藏着（不发 setCharacter，不然会噗一下说话）
                    Js($"setPointerBridge(true); setRole('companion', {RoleInfoJson}); init({pet.ManifestJson}); {pet.CompanionLookJs}" + (parked ? "" : $"; setCharacter({Pet.Q(Character)})"));
                    ApplySizes(Pet.Anchor.Corner);
                    if (parked) { Pet.After(WarmMs, () => Warm = true); return; }
                    UpdatePageHidden();
                    pet.FeedCompanion(this);
                    if (leaving) Js("leaveNow()");
                    Arrived();
                };
                core.WebMessageReceived += (_, a) =>
                {
                    try { if (Store.Json.DeserializeObject(a.WebMessageAsJson) is Dictionary<string, object> m) HandleMessage(m); }
                    catch { }
                };
                core.Navigate(Store.PageUrl("index.html"));
            }
            catch (Exception e) { Store.Log("额外桌宠网页初始化失败: " + e.Message); Close(); }
        }

        /// <summary>网页进程崩了：重新载入（NavigationCompleted 会重新 setRole、补状态）；最多重载 3 次，一直崩就关掉
        /// （主桌宠页面下次发列表时会重开一只）。浏览器进程挂了：整个环境都废了，主桌宠那边会换新环境、关掉所有额外窗口再按列表重开</summary>
        void ProcessFailed(CoreWebView2ProcessFailedKind kind)
        {
            if (closed || kind == CoreWebView2ProcessFailedKind.GpuProcessExited) return;
            ready = false;
            if (kind == CoreWebView2ProcessFailedKind.BrowserProcessExited || ++crashes > 3) { Close(); return; }
            try { web.CoreWebView2?.Reload(); } catch { Close(); }
        }

        /// <summary>没加载完的调用不排队：加载完（NavigationCompleted）按缓存的状态补一遍</summary>
        public void Js(string code)
        {
            if (!ready || closed) return;
            try { web?.CoreWebView2?.ExecuteScriptAsync(code); } catch (Exception e) { Store.Log("额外桌宠 JS 出错: " + e.Message); }
        }
        async Task<string> Eval(string code)
        {
            try { return !ready || closed || web?.CoreWebView2 == null ? "null" : await web.CoreWebView2.ExecuteScriptAsync(code); }
            catch { return "null"; }
        }

        string RoleInfoJson => Store.Json.Serialize(new Dictionary<string, object> { ["id"] = Id, ["key"] = Key, ["character"] = Character, ["client"] = Client, ["label"] = Label, ["parked"] = parked });

        // 页面加载完后网页控件第一次画画面，界面线程要停 0.1–0.35 秒（1.3.9-test.11 实测，停顿在加载完 0.1–0.2 秒后开始）：多等一会儿再算备好
        const int WarmMs = 600;

        /// <summary>备着的那只轮到登场了（列表里有她）：换上列表给的身份，摆到该在的位置，页面噗一下出来答到。
        /// 还没加载完的：NavigationCompleted 会按不备着的走法来（parked 已经是 false）</summary>
        public void Adopt(IDictionary<string, object> info)
        {
            if (!parked || closed) return;
            parked = false;
            Id = Str(info, "id") ?? Id;
            Key = Str(info, "key") ?? Key;
            Client = Str(info, "client");
            Quota = info.TryGetValue("quota", out var q) && q is bool qb && qb;
            Label = Str(info, "label") ?? "";
            if (hwnd != IntPtr.Zero)
            {
                Native.GetWindowRect(hwnd, out var r);
                var (x, y) = pet.CompanionOrigin(Key, r.Right - r.Left, r.Bottom - r.Top);
                Native.MoveTo(hwnd, x, y);
                SaveOrigin();
                // 备着时是「藏着」的样子（透明、鼠标穿过）：按主桌宠现在藏没藏重新对一遍
                concealedShown = true;
                SyncWithMain();
            }
            else { Host.SetVisible(true); Host.ForcePassThrough = false; }
            if (!ready) return;
            Js($"setRole('companion', {RoleInfoJson}); arriveNow()");
            UpdatePageHidden();
            pet.FeedCompanion(this);
            Arrived();
        }

        /// <summary>站到桌面上以后：上次贴着边的接着贴</summary>
        void Arrived()
        {
            if (Store.Settings.TryGetValue(DockKey, out var dk) && dk is string side && Pet.EdgeDockEnabled)
                Pet.After(1500, () => { if (!closed && dock == null) SetDock(side); });
        }

        /// <summary>她的页面发来的消息：鼠标（pointer，见 index.html 的 setPointerBridge）；摸头记给主桌宠页面（友谊记账只在那里做）；道别演完了关窗口</summary>
        void HandleMessage(Dictionary<string, object> m)
        {
            if (m.TryGetValue("pointer", out var pv) && pv is string pointer)
            {
                // 拖窗口要进系统的移动循环（松手才返回）：排到网页控件的回调返回之后
                if (pointer == "drag") ui.BeginInvoke(new Action(Drag));
                else if (pointer == "click")
                    Js($"handleClick('pat', {Pet.Num(Convert.ToDouble(m["x"]))}, {Pet.Num(Convert.ToDouble(m["y"]))})");
                else if (pointer == "menu") ui.BeginInvoke(new Action(ShowMenu));
                return;
            }
            if (m.TryGetValue("patted", out var p) && p is bool pb && pb) pet.Js($"notePat({Pet.Q(Character)})");
            // 不能在这个网页控件自己的消息回调里同步 Dispose 它：排到回调返回之后再关（和 ProcessFailed 一样）
            if (m.TryGetValue("gone", out var g) && g is bool gb && gb) ui.BeginInvoke(new Action(Close));
        }

        /// <summary>列表里同一个 id 的新内容：收编了客户端（key / client 变了）、小字变了、额度归不归她、对调成了别的角色</summary>
        public void Update(IDictionary<string, object> info)
        {
            var newKey = Str(info, "key") ?? Key;
            var newClient = Str(info, "client");
            var newQuota = info.TryGetValue("quota", out var q) && q is bool qb && qb;
            var newLabel = Str(info, "label") ?? "";
            var newCharacter = Str(info, "character") ?? Character;
            var characterChanged = newCharacter != Character;
            var roleChanged = newKey != Key || newClient != Client || newLabel != Label || characterChanged;
            var clientChanged = newClient != Client || characterChanged;
            Character = newCharacter;
            var quotaChanged = newQuota != Quota;
            if (newKey != Key)
            {
                Key = newKey;
                SaveOrigin();
                if (dock != null) { Store.Settings[DockKey] = dock; Store.SaveSettings(); }
            }
            Client = newClient; Quota = newQuota; Label = newLabel;
            if (!ready) return;
            if (roleChanged) Js($"setRole('companion', {RoleInfoJson})");   // 页面按新的 label 改小字
            if (characterChanged) Js($"setCharacter({Pet.Q(Character)})");   // 噗一下换成她、说登场招呼
            if (clientChanged) pet.FeedCompanion(this);
            else if (quotaChanged)
            {
                if (Quota) foreach (var code in pet.QuotaCodes(Character)) Js(code);
                else Js($"setQuota({Pet.Q(Character)}, null)");
            }
        }

        /// <summary>主桌宠页面让她走：说 bye、冒烟，页面发 gone 后关；页面没回（还没加载完、卡住）3 秒后也关</summary>
        public void Leave()
        {
            if (leaving || closed) return;
            leaving = true;
            Js("leaveNow()");
            Pet.After(3000, Close);
        }

        public void Close()
        {
            if (closed) return;
            closed = true;
            ready = false;
            foreach (var t in timers) t.Stop();
            timers.Clear();
            slideTimer?.Stop();
            openMenu?.Close();
            pet.CompanionClosed(this);
            // 关窗口可能是从网页控件的回调里来的（她自己的 gone、主桌宠页面的 companions 消息 / 加载完、初始化失败）：
            // 在回调里同步 Dispose 网页控件不安全，状态先改好（上面），真正的 Dispose 和关窗口排到回调返回之后
            var w = web; web = null;
            Host.SetVisible(false); Host.ForcePassThrough = true;   // 先藏起来，排队这一下也不会看见
            ui.BeginInvoke(new Action(() =>
            {
                try { w?.Dispose(); } catch { }
                try { Host.Close(); Host.Dispose(); } catch { }
            }));
        }

        /// <summary>她的状态（按客户端的那份；旧钩子时是按角色的那份）。贴边跑不跑出来按交给她的时间算，
        /// 和主桌宠一样（Poll 里 lastPose 记的是读到的时间 DateTime.UtcNow，不是文件的写入时间）</summary>
        public void ApplyState(string json, string pose)
        {
            if (pose != null) LastPose = (pose, DateTime.UtcNow);
            Js($"applyCharState({Pet.Q(Character)}, {json})");
        }

        /// <summary>自动记位置（物理像素，和主桌宠的 position 一样）。集合来、还没收编客户端的（&lt;角色&gt;@gather）不记：
        /// 下次集合要在主桌宠旁边重新排开；你拖过的照样记（force）</summary>
        void SaveOrigin(bool force = false)
        {
            if (hwnd == IntPtr.Zero || closed || (!force && Key.EndsWith("@gather"))) return;
            Native.GetWindowRect(hwnd, out var r);
            Store.Settings[OriginKey] = new Dictionary<string, object> { ["x"] = r.Left, ["y"] = r.Top };
            Store.SaveSettings();
        }

        // ---------------- 能点到的区域（和主桌宠的 UpdateHitRects 一样） ----------------
        string lastHitRects;
        async Task UpdateHitRects()
        {
            if (!ready || closed || (Forms.Control.MouseButtons & Forms.MouseButtons.Left) != 0) return;
            var json = await Eval("hitRects()");
            if (closed || json == lastHitRects || json == "null") return;
            lastHitRects = json;
            if (!(Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is object[] list)) return;
            var zoom = (double)Host.Width / pageW;   // 画布坐标 → 窗口里的物理像素
            Host.SetHitRects(list.OfType<object[]>().Where(r => r.Length == 4).Select(r => new System.Drawing.Rectangle(
                (int)Math.Floor(Convert.ToDouble(r[0]) * zoom), (int)Math.Floor(Convert.ToDouble(r[1]) * zoom),
                (int)Math.Ceiling(Convert.ToDouble(r[2]) * zoom), (int)Math.Ceiling(Convert.ToDouble(r[3]) * zoom))));
        }

        // ---------------- 鼠标：单击摸头、拖动换位置（甩她会生气）、右键精简菜单（网页交来，见 HandleMessage） ----------------
        void Drag()
        {
            if (closed) return;
            Undock();
            // 甩：拖动时横向来回反转方向（往回超过 18（按 100% 缩放算）算一次反转），0.9 秒内两次以上就算在甩
            var turn = 18 * Host.DpiScale;
            bool shook = false; double swingX = Host.Left, swingDir = 0; var swings = new List<DateTime>(); var lastShake = DateTime.MinValue;
            EventHandler onMove = (_, __) =>
            {
                double x = Host.Left;
                if (swingDir == 0) { if (Math.Abs(x - swingX) > turn) { swingDir = x > swingX ? 1 : -1; swingX = x; } }
                else if ((x - swingX) * swingDir > 0) swingX = x;
                else if ((swingX - x) * swingDir > turn)
                {
                    swingDir = -swingDir; swingX = x;
                    swings.Add(DateTime.UtcNow);
                    swings.RemoveAll(t => (DateTime.UtcNow - t).TotalSeconds > 0.9);
                    if (swings.Count >= 2 && (DateTime.UtcNow - lastShake).TotalSeconds > 0.3) { shook = true; lastShake = DateTime.UtcNow; Js("shaken()"); }
                }
            };
            Host.LocationChanged += onMove;
            try { Host.DragMove(); } catch { }
            Host.LocationChanged -= onMove;
            if (closed) return;
            SaveOrigin(force: true);
            if (!shook) CheckDock();
        }

        /// <summary>精简菜单：换角色、彩蛋、集合、更新、退出只在主桌宠菜单里</summary>
        void ShowMenu()
        {
            openMenu?.Close();
            var menu = new Forms.ContextMenuStrip();
            void Add(string text, Action click)
            {
                var i = new Forms.ToolStripMenuItem(text);
                i.Click += (_, __) => { try { click(); } catch (Exception e) { Store.Log("菜单出错: " + e); } };
                menu.Items.Add(i);
            }
            Add("摸摸头", () => Js("handleClick('pat')"));
            Add("戳一下", () => Js("handleClick('poke')"));
            // 让她先回去：交给主桌宠页面判（她这个客户端开始新的一轮活之前不再出现），页面再发 companionLeave 让她走
            Add("让她先回去", () => pet.Js($"sendHome({Pet.Q(Id)})"));
            // 换衣服：这个角色有别的衣服（皮肤）时列出来，原版排第一。衣服按角色记，同一个角色的几只一起换（Pet.Wear）
            if (Store.SkinChoices.TryGetValue(Character, out var skins) && skins.Count > 0)
            {
                var ch = Character;
                var worn = Store.Skins != null && Store.Skins.TryGetValue(ch, out var w) ? w as string ?? "" : "";
                var outfit = new Forms.ToolStripMenuItem("换衣服");
                var baseName = Store.BaseOutfit.TryGetValue(ch, out var bo) && bo != null ? bo : "原版";
                foreach (var (sid, sname) in new[] { ("", baseName) }.Concat(skins))
                {
                    var k = sid;
                    var i = new Forms.ToolStripMenuItem(sname) { Checked = worn == k };
                    i.Click += (_, __) => { try { pet.Wear(ch, k); } catch (Exception e) { Store.Log("菜单出错: " + e); } };
                    outfit.DropDownItems.Add(i);
                }
                menu.Items.Add(outfit);
            }
            menu.Items.Add(new Forms.ToolStripSeparator());
            Add("设置…", () => pet.OpenSettingsFromCompanion());
            // 和主桌宠一样：窗口从不拿焦点，菜单收不到「失去焦点」，鼠标在菜单外面按下就自己关
            var watch = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            watch.Tick += (_, ___) => { if (Forms.Control.MouseButtons != Forms.MouseButtons.None && !MenuCovers(menu, Forms.Cursor.Position)) menu.Close(); };
            menu.Opened += (_, ___) => watch.Start();
            menu.Closed += (_, ___) =>
            {
                watch.Stop();
                if (openMenu == menu) openMenu = null;
                ui.BeginInvoke(new Action(menu.Dispose));
            };
            openMenu = menu;
            menu.Show(Forms.Cursor.Position);
        }

        // ---------------- 大小、藏起来、层级（跟着主桌宠） ----------------

        /// <summary>和主桌宠的 ApplySizes 一样：网页按人物大小、文字大小算画布，窗口 = 画布 × 人物大小；放在哪见 Pet.Anchor。
        /// 改人物大小时不做主桌宠那段 0.2 秒过渡，直接跳到新大小</summary>
        public async void ApplySizes(Pet.Anchor anchor)
        {
            if (!ready || closed || hwnd == IntPtr.Zero) return;
            var scale = Pet.Scale;
            try
            {
                var json = await Eval($"setSizes({Pet.Num(scale)}, {Pet.Num(Pet.TextScale)}, {(Pet.TextLinked ? "true" : "false")})");
                if (closed) return;
                if (Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is Dictionary<string, object> o)
                {
                    double w0 = Convert.ToDouble(o["w"]), h0 = Convert.ToDouble(o["h"]), foot = Convert.ToDouble(o["foot"]);
                    if (w0 != pageW || h0 != pageH || foot != pageFoot) dockCut.Clear();
                    pageW = w0; pageH = h0; pageFoot = foot;
                }
            }
            catch (Exception e) { Store.Log("额外桌宠：算画布失败 " + e.Message); }
            if (closed) return;
            Native.GetWindowRect(hwnd, out var old);
            var dpi = Host.DpiScale;
            Host.Size = new System.Drawing.Size((int)Math.Round(pageW * scale * dpi), (int)Math.Round(pageH * scale * dpi));
            if (web != null) web.ZoomFactor = scale * pet.ZoomFix;   // 网页控件自己按系统缩放画：CSS 像素 × 人物大小 × 系统缩放 = 物理像素（ZoomFix 见 Pet.CheckZoom）
            Native.GetWindowRect(hwnd, out var now);
            int w = now.Right - now.Left, h = now.Bottom - now.Top;
            double footPx = pageFoot * w / pageW;
            var (x, y) = Pet.PlaceWindow(old, w, h, shownFootPx > 0 ? shownFootPx : footPx, footPx, anchor);
            shownFootPx = footPx;
            if (dock == null) (x, y) = ClampToScreen(x, y, w, h);
            Native.MoveTo(hwnd, x, y);
            lastHitRects = null;
            if (dock != null) ApplyDock(); else SaveOrigin();
        }

        /// <summary>夹进中心所在那块屏幕的工作区（和主桌宠的 Clamp 一样）</summary>
        static (int, int) ClampToScreen(int x, int y, int w, int h)
        {
            var center = new System.Drawing.Point(x + w / 2, y + h / 2);
            var wa = (Forms.Screen.AllScreens.FirstOrDefault(s => s.WorkingArea.Contains(center)) ?? Forms.Screen.PrimaryScreen).WorkingArea;
            var r = CompanionPlace.Clamp(new CompanionPlace.Rect(x, y, w, h), new CompanionPlace.Rect(wa.Left, wa.Top, wa.Width, wa.Height));
            return ((int)r.X, (int)r.Y);
        }
        static bool MenuCovers(Forms.ToolStripDropDown d, System.Drawing.Point p) =>
            d.Visible && (d.Bounds.Contains(p) || d.Items.OfType<Forms.ToolStripDropDownItem>().Any(i => i.HasDropDownItems && MenuCovers(i.DropDown, p)));

        public void UpdatePageHidden() => Js($"setPageHidden({(pet.Concealed || pet.SessionLocked ? "true" : "false")})");

        /// <summary>重新放到最顶层（主桌宠 Raise 时一起）</summary>
        public void Raise() { if (!closed && !concealedShown && Host.Topmost && hwnd != IntPtr.Zero) Native.BringToTop(hwnd); }

        /// <summary>全屏隐藏、快捷键隐藏、显示层级跟着主桌宠（Pet.SyncCompanionWindows 调）：藏起来用「隐身」（不透明度 0、鼠标穿透、取消置顶），
        /// 和主桌宠的 SetConcealed 一样不 Hide / Show</summary>
        public void SyncWithMain()
        {
            if (closed || hwnd == IntPtr.Zero) return;
            var hidden = pet.Concealed;
            if (hidden != concealedShown)
            {
                concealedShown = hidden;
                Host.ForcePassThrough = hidden;
                if (hidden) { openMenu?.Close(); Host.SetVisible(false); Native.DropFromTop(hwnd); }
                else { Host.SetVisible(true); Raise(); }
                UpdatePageHidden();
            }
            var top = pet.Topmost;
            if (Host.Topmost != top)
            {
                Host.Topmost = top;
                if (!top) Native.DropFromTop(hwnd); else Raise();
            }
        }

        // ---------------- 贴边（规则同主桌宠，见 Pet.Dock.cs；跑不跑出来只看她自己的状态） ----------------

        public void Undock()
        {
            if (dock == null) return;
            dock = null; dockOut = dockHover = dockTucked = false;
            Store.Settings.Remove(DockKey); Store.SaveSettings();
            Js("setTucked(null)");
        }
        void CheckDock()
        {
            if (!Pet.EdgeDockEnabled || hwnd == IntPtr.Zero) return;
            Native.GetWindowRect(hwnd, out var r);
            var side = Pet.DockSide(r, hwnd, pageW);
            if (side != null) SetDock(side);
        }
        void SetDock(string side)
        {
            if (closed) return;
            dock = side;
            dockedAt = DateTime.UtcNow;
            Store.Settings[DockKey] = side; Store.SaveSettings();
            dockOut = DockBusy();
            ApplyDock();
        }
        bool DockBusy() => Pet.DockBusy(LastPose.HasValue ? new[] { LastPose.Value } : new (string, DateTime)[0], dockedAt, DateTime.UtcNow);
        public void UpdateDock()
        {
            if (dock == null || closed) return;
            var busy = DockBusy();
            if (busy != dockOut) { dockOut = busy; dockHover = false; ApplyDock(); }
        }
        async void ApplyDock()
        {
            var side = dock;
            if (side == null || hwnd == IntPtr.Zero || closed) return;
            Host.ClearHitRects(); lastHitRects = null;
            Pet.After(500, () => { lastHitRects = null; _ = UpdateHitRects(); });
            Native.GetWindowRect(hwnd, out var r);
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            var wa = Forms.Screen.FromHandle(hwnd).WorkingArea;
            int y = Pet.DockClampY(r.Top, h, wa);
            int edgeX = Pet.DockEdgeX(side, w, wa);
            if (dockOut) { dockTucked = false; Js("setTucked(null)"); Slide(edgeX, y); return; }
            // 先整个滑到屏幕边缘，滑完再缩进去（同主桌宠）
            if (!dockTucked && (Math.Abs(r.Left - edgeX) > 1 || Math.Abs(r.Top - y) > 1))
            {
                Slide(edgeX, y);
                await Task.Delay(370);
                if (dock != side || dockOut || closed) return;
            }
            dockTucked = true;
            var peek = dockHover;
            Js($"setTucked({Pet.Q(side)}, {(peek ? "true" : "false")})");
            var key = side + (peek ? "-peek" : "");
            if (!dockCut.TryGetValue(key, out var cut))
            {
                await Task.Delay(450);
                if (dock != side || dockOut || dockHover != peek || closed) return;
                var res = await Eval($"dockCut({Pet.Q(side)})");
                if (!double.TryParse(res, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out cut)) return;
                dockCut[key] = cut;
            }
            if (dock != side || dockOut || dockHover != peek || closed) return;
            int tx = Pet.TuckX(side, cut, (double)w / pageW, wa);
            Native.GetWindowRect(hwnd, out var now);
            if (Math.Abs(now.Left - tx) > 1) Slide(tx, y);
        }
        DispatcherTimer slideTimer;
        void Slide(int x, int y)
        {
            Native.GetWindowRect(hwnd, out var r);
            int x0 = r.Left, y0 = r.Top;
            var start = DateTime.UtcNow;
            slideTimer?.Stop();
            slideTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(15) };
            slideTimer.Tick += (_, __) =>
            {
                if (closed) { slideTimer.Stop(); return; }
                var k = Math.Min(1, (DateTime.UtcNow - start).TotalSeconds / 0.35);
                var e = k < 0.5 ? 2 * k * k : 1 - Math.Pow(-2 * k + 2, 2) / 2;
                Native.MoveTo(hwnd, (int)(x0 + (x - x0) * e), (int)(y0 + (y - y0) * e));
                if (k >= 1) slideTimer.Stop();
            };
            slideTimer.Start();
        }
        void UpdateDockHover()
        {
            if (dock == null || dockOut || hwnd == IntPtr.Zero || closed) return;
            if (Host.HitRectCount == 0) _ = UpdateHitRects();
            bool inside = Host.MouseOverHit;
            if (inside)
            {
                dockLeaveAt = null;
                if (dockHover) return;
                if (dockEnterAt == null) dockEnterAt = DateTime.UtcNow;
                else if ((DateTime.UtcNow - dockEnterAt.Value).TotalSeconds > 0.15) { dockEnterAt = null; dockHover = true; ApplyDock(); }
                return;
            }
            dockEnterAt = null;
            if (dockHover)
            {
                if (dockLeaveAt == null) dockLeaveAt = DateTime.UtcNow;
                else if ((DateTime.UtcNow - dockLeaveAt.Value).TotalSeconds > 0.3) { dockHover = false; dockLeaveAt = null; ApplyDock(); }
            }
        }

        /// <summary>窗口现在在哪（物理像素）；没开好返回 null</summary>
        public CompanionPlace.Rect? Frame
        {
            get
            {
                if (!IsOpen || !Native.GetWindowRect(hwnd, out var r)) return null;
                return new CompanionPlace.Rect(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
            }
        }
    }
}
