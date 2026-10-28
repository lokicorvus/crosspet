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
        // ---------------- 贴边 ----------------
        // 拖到屏幕左 / 右边缘松手：她缩到屏幕外，只露半个身子扒着边缘（额度、名牌、气泡都藏起来）。
        // AI 干活时（或在等你回答）自己跑出来，干完过约 10 秒缩回去；鼠标移到露出来的那截上她会探出来一点。
        // 拖离边缘就不贴了。另一块屏幕接在这边时不算边缘。坐标都是物理像素
        string dock;                 // "left" / "right"
        bool dockOut, dockHover, dockTucked;   // dockTucked：现在是缩着的样子（之后换探出来不用先挪窗口）
        DateTime? dockLeaveAt, dockEnterAt;
        DateTime dockedAt = DateTime.MinValue;   // 刚拖到边上：之前就在进行的工作不算，先缩进去给个反应，AI 有新动作再跑出来
        readonly Dictionary<string, double> dockCut = new Dictionary<string, double>();   // 切口位置（网页像素），按 边 + 角色 记
        /// <summary>DeepSeek 余额（默认开）：用别家订阅（OpenCode Go……）跑 DeepSeek 模型时官方账户没钱，她会一直没精神，可以关掉</summary>
        /// <summary>省电模式（默认关）：特效每秒 15 帧、闲着 10 秒就停（平时 30 帧、30 秒）</summary>
        static bool PowerSave => Store.Settings.TryGetValue("powerSave", out var v) && v is bool b && b;
        /// <summary>额度合并显示（默认关）：小窗把各家 AI 的额度排成几行，而不是只显示当前角色的。怎么排在网页里（quota-aggregate.js）</summary>
        static bool QuotaAggregate => Store.Flag("quotaAggregate");
        static string QuotaStyle => Store.Settings.TryGetValue("quotaStyle", out var v) && v is string s && s == "bars" ? "bars" : "text";   // 额度怎么显示：text 文字（默认）/ bars 额度条（网页层 quota-bars.js）
        static string PeakStyle => Store.Settings.TryGetValue("peakStyle", out var v) && v is string s && (s == "text" || s == "off") ? s : "bar";   // 额度栏怎么显示峰谷时段：bar 时间条（默认）/ text 一行文字 / off（规则在网页层 peak-hours.js）
        static bool CodexResets => Store.Flag("codexResets");   // Codex 重置提醒（默认关，数据来自 codex-resets.com）
        /// <summary>按时段换衣服：{ 角色: { peak: 皮肤, valley: 皮肤 } }（"" = 原版，没写 = 不换）。判断在网页层（peak-hours.js），这里只存（和 macOS 的 cleanPeakSkins 一致）</summary>
        static Dictionary<string, object> CleanPeakSkins(object v)
        {
            var output = new Dictionary<string, object>();
            if (!(v is Dictionary<string, object> all)) return output;
            foreach (var kv in all)
            {
                if (!(kv.Value is Dictionary<string, object> d)) continue;
                var e = new Dictionary<string, object>();
                foreach (var k in new[] { "peak", "valley" }) if (d.TryGetValue(k, out var s) && s is string str) e[k] = str;
                if (e.Count > 0) output[kv.Key] = e;
            }
            return output;
        }
        static Dictionary<string, object> PeakSkins => CleanPeakSkins(Store.Settings.TryGetValue("peakSkins", out var v) ? v : null);
        static bool DsQuotaEnabled => !(Store.Settings.TryGetValue("dsQuota", out var v) && v is bool b && !b);
        static bool EdgeDockEnabled => !(Store.Settings.TryGetValue("edgeDock", out var v) && v is bool b && !b);
        static void After(int ms, Action a)
        {
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ms) };
            t.Tick += (_, __) => { t.Stop(); a(); };
            t.Start();
        }

        void Undock()
        {
            if (dock == null) return;
            dock = null; dockOut = dockHover = dockTucked = false;
            Store.Settings.Remove("dock"); Store.SaveSettings();
            Js("setTucked(null)");
        }
        void CheckDock()
        {
            if (!EdgeDockEnabled || hwnd == IntPtr.Zero) return;
            Native.GetWindowRect(hwnd, out var r);
            int w = r.Right - r.Left, mid = r.Left + w / 2;
            var scr = Forms.Screen.FromHandle(hwnd);
            var wa = scr.WorkingArea;
            double reach = w * (BaseWidth / pageW) * 0.3;   // 按人物那块的宽算：画布因为文字变宽时不该更容易贴边
            bool Neighbor(bool left) => Forms.Screen.AllScreens.Any(o => !o.Equals(scr) && o.Bounds.Top < r.Bottom && o.Bounds.Bottom > r.Top &&
                (left ? Math.Abs(o.Bounds.Right - scr.Bounds.Left) < 2 : Math.Abs(o.Bounds.Left - scr.Bounds.Right) < 2));
            if (mid - wa.Left < reach && !Neighbor(true)) SetDock("left");
            else if (wa.Right - mid < reach && !Neighbor(false)) SetDock("right");
        }
        void SetDock(string side)
        {
            dock = side;
            dockedAt = DateTime.UtcNow;
            Store.Settings["dock"] = side; Store.SaveSettings();
            dockOut = DockBusy();
            ApplyDock();
        }
        /// <summary>AI 在干活 / 等你回答 / 刚干完（10 秒内）：跑出来</summary>
        bool DockBusy()
        {
            var now = DateTime.UtcNow;
            return lastPose.Values.Any(p =>
            {
                if (p.at <= dockedAt) return false;
                var age = (now - p.at).TotalSeconds;
                switch (p.pose)
                {
                    case "asking": return age < 600;
                    case "happy": case "proud": case "oops": case "surprised": return age < 10;
                    case "idle": case "sleeping": case "tired": return false;
                    default: return age < 180;
                }
            });
        }
        void UpdateDock()
        {
            if (dock == null) return;
            var busy = DockBusy();
            if (busy != dockOut) { dockOut = busy; dockHover = false; ApplyDock(); }
        }
        async void ApplyDock()
        {
            var side = dock;
            if (side == null || hwnd == IntPtr.Zero) return;
            hit?.Children.Clear(); lastHitRects = null;   // 换了样子，可点区域重新量（旧的范围会让她误以为鼠标在身上，来回闪）
            After(500, () => { lastHitRects = null; _ = UpdateHitRects(); });   // 新图换好后再量一次
            Native.GetWindowRect(hwnd, out var r);
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            var wa = Forms.Screen.FromHandle(hwnd).WorkingArea;
            int y = Math.Max(wa.Top, Math.Min(r.Top, wa.Bottom - (int)(h * 0.85)));
            int edgeX = side == "left" ? wa.Left : wa.Right - w;
            if (dockOut) { dockTucked = false; Js("setTucked(null)"); Slide(edgeX, y); return; }
            // 窗口还没到边上（刚拖过来松手 / 刚干完活）：先整个滑到屏幕边缘，滑完再缩进去。一次只做一个动作，不然窗口在滑、人物也在窗口里滑，看着乱
            if (!dockTucked && (Math.Abs(r.Left - edgeX) > 1 || Math.Abs(r.Top - y) > 1))
            {
                Slide(edgeX, y);
                await Task.Delay(370);
                if (dock != side || dockOut) return;
            }
            dockTucked = true;
            // 鼠标移上来：换成探出来更多的那张（edge_*_peek），切口照样对齐屏幕边缘（不能光把窗口往外挪，切口会露在屏幕中间）
            var peek = dockHover;
            Js($"setTucked({Q(side)}, {(peek ? "true" : "false")})");
            var key = side + (peek ? "-peek" : "") + current;
            if (!dockCut.TryGetValue(key, out var cut))
            {
                await Task.Delay(450);   // 换成贴边立绘后再量切口（图要先载入），量过的记下来
                if (dock != side || dockOut || dockHover != peek) return;
                var res = await Eval($"dockCut({Q(side)})");
                if (!double.TryParse(res, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out cut)) return;
                dockCut[key] = cut;
            }
            if (dock != side || dockOut || dockHover != peek) return;
            double zoom = (double)w / pageW;   // 网页像素 → 物理像素
            int tx = side == "left" ? wa.Left - (int)(cut * zoom) : wa.Right - (int)(cut * zoom);
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
                var k = Math.Min(1, (DateTime.UtcNow - start).TotalSeconds / 0.35);
                var e = k < 0.5 ? 2 * k * k : 1 - Math.Pow(-2 * k + 2, 2) / 2;
                Native.MoveTo(hwnd, (int)(x0 + (x - x0) * e), (int)(y0 + (y - y0) * e));
                if (k >= 1) slideTimer.Stop();
            };
            slideTimer.Start();
        }
        /// <summary>缩着时鼠标在露出来的那截上停 0.15 秒：探出来；移开 0.3 秒后缩回去</summary>
        void UpdateDockHover()
        {
            if (dock == null || dockOut || hwnd == IntPtr.Zero) return;
            if (hit != null && hit.Children.Count == 0) _ = UpdateHitRects();   // 刚换了图：马上量能点的范围，探出来 / 缩回去才跟得上鼠标
            bool inside = hit != null && hit.IsMouseOver;   // 只算露出来的那截（能点的区域），窗口其余是透明的
            if (inside)
            {
                dockLeaveAt = null;
                if (dockHover) return;
                if (dockEnterAt == null) dockEnterAt = DateTime.UtcNow;   // 停一小会儿才探出来，路过不算
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
    }
}
