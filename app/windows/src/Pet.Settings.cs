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
        // ---------------- 设置窗口（web/settings.html，和 macOS 版共用） ----------------
        static double Scale => Store.Settings.TryGetValue("size", out var v) && (v is double || v is int || v is decimal) &&
                               Convert.ToDouble(v) >= 0.6 && Convert.ToDouble(v) <= 1.6 ? Convert.ToDouble(v) : 1;
        static bool ShowName => !(Store.Settings.TryGetValue("showName", out var v) && v is bool b && !b);
        static bool EggsEnabled => !(Store.Settings.TryGetValue("eggs", out var v) && v is bool b && !b);
        /// <summary>文字大小（只在解锁时用）和锁：没存过 = 锁着，文字跟着人物，和以前一样</summary>
        static double TextScale => Store.Settings.TryGetValue("textSize", out var v) && (v is double || v is int || v is decimal) &&
                                   Convert.ToDouble(v) >= 0.6 && Convert.ToDouble(v) <= 1.6 ? Convert.ToDouble(v) : 1;
        static bool TextLinked => !(Store.Settings.TryGetValue("textLinked", out var v) && v is bool b && !b);
        static string Num(double d) => d.ToString(System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>换大小时窗口锚在哪（和 macOS 的 App.Anchor 一致，那边有测试 tests/window_place_probe.sh）：
        /// Corner = 启动 / 网页重载，存下的位置本来就是这个画布的窗口，左上角不动只换大小（不然解锁的人每次启动都往旁边漂）；
        /// Bottom = 改人物大小，底边中点不动，和以前一样（屏幕上的底栏高 = 62 × 文字大小，没变）；
        /// Feet = 改文字大小，底栏在屏幕上变高 / 变矮多少，窗口底边就往下 / 往上挪多少，人物不动</summary>
        enum Anchor { Corner, Bottom, Feet }

        /// <summary>纯计算，物理像素、y 向下。oldFoot / newFoot：底栏在屏幕上的高</summary>
        static (int, int) PlaceWindow(Native.RECT old, int w, int h, double oldFoot, double newFoot, Anchor anchor)
        {
            if (anchor == Anchor.Corner) return (old.Left, old.Top);
            int x = (old.Left + old.Right) / 2 - w / 2;
            if (anchor == Anchor.Feet) return (x, old.Bottom + (int)Math.Round(newFoot - oldFoot) - h);
            return (x, old.Bottom - h);
        }

        // ---- 网页大小核对：记日志；系统缩放被算了两遍时自动修正（见 ZoomCheck.Fix）----
        double shownZoom;   // 窗口现在按的人物大小
        double zoomFix = 1;   // 给网页的缩放 = 人物大小 × 这个系数；只有 ZoomCheck.Fix 认出「系统缩放算了两遍」时才不是 1
        int zoomFixes;   // 这次运行修正过几次：最多 3 次，免得来回改
        DispatcherTimer zoomCheckTimer;
        /// <summary>调完大小 / 换完缩放停 1 秒再量（拖滑块时每一帧都在变，别每帧都量）</summary>
        void CheckZoomSoon()
        {
            if (zoomCheckTimer == null)
            {
                zoomCheckTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                zoomCheckTimer.Tick += (_, __) => { zoomCheckTimer.Stop(); _ = CheckZoom(); };
            }
            zoomCheckTimer.Stop(); zoomCheckTimer.Start();
        }
        async Task<(double, double)?> PageSize()
        {
            var json = await Eval("JSON.stringify([innerWidth, innerHeight])");
            if (!(Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is object[] a) || a.Length != 2) return null;
            return (Convert.ToDouble(a[0]), Convert.ToDouble(a[1]));
        }
        /// <summary>隔 0.5 秒量两次网页实际排出来的大小，两次一样又和应有的画布对不上，记一行日志</summary>
        async Task CheckZoom()
        {
            if (!ready || web?.CoreWebView2 == null || shownZoom <= 0) return;
            try
            {
                var first = await PageSize();
                await Task.Delay(500);
                var second = await PageSize();
                if (first == null || second == null) return;
                var (w1, h1) = first.Value; var (w2, h2) = second.Value;
                if (!ZoomCheck.Off(pageW, pageH, w1, h1, w2, h2)) return;
                var dpi = VisualTreeHelper.GetDpi(Window).DpiScaleX;
                // #28：那台机器这之后 4~5 秒渲染线程就挂了，这行是先兆，写成警告；再逼网页控件按新缩放对齐，最多两次，还不行就走下面的老路
                if (dpiFrom > 0 && dpiResyncs < 2 && ZoomCheck.StuckAtOldDpi(pageW, pageH, w2, h2, dpiFrom, dpi))
                {
                    dpiResyncs++;
                    Store.Log($"警告：换缩放后网页区域还停在旧缩放上：网页 {Math.Round(w2)}×{Math.Round(h2)}，应为 {Math.Round(pageW)}×{Math.Round(pageH)}，{Math.Round(dpiFrom * 100)}% → {Math.Round(dpi * 100)}%，再对齐一次（第 {dpiResyncs} 次）");
                    await ResizeWebBounds();
                    CheckZoomSoon();
                    return;
                }
                var fix = zoomFixes < 3 ? ZoomCheck.Fix(pageW, pageH, w2, h2, dpi, zoomFix) : null;
                Store.Log($"网页大小和画布对不上{(fix == null ? "（只记录）" : "")}：网页 {Math.Round(w2)}×{Math.Round(h2)}，应为 {Math.Round(pageW)}×{Math.Round(pageH)}，缩放 {Num(Math.Round(web.ZoomFactor, 3))}，DPI {Math.Round(dpi * 100)}%");
                if (fix == null) return;
                zoomFixes++; zoomFix = fix.Value;
                web.ZoomFactor = shownZoom * zoomFix;
                lastHitRects = null; dockCut.Clear();
                Store.Log($"系统缩放像是被算了两遍：网页缩放自动改成 {Num(Math.Round(web.ZoomFactor, 3))}（人物大小 {Num(shownZoom)} × {Num(Math.Round(zoomFix, 3))}），再量一次");
                CheckZoomSoon();
            }
            catch (Exception e) { Store.Log("检查网页大小出错: " + e.Message); }
        }

        /// <summary>系统缩放变了（改了缩放、拖到缩放不同的另一块屏幕）：WebView2CompositionControl 只在自己的大小（DIP）变时
        /// 才按新 DPI 重算网页区域的物理像素（它的 SizeChanged → SyncControllerBounds），换 DPI 时 DIP 大小不变，网页区域就停在旧的
        /// 像素尺寸上，网页却按新缩放画，结果裁掉一截，重启才好（1.3.5 测试在 100%→150% 复现）。这里把它的宽度缩 1 再放回，逼它重算</summary>
        double resyncedDpi;   // 上次对齐时的缩放：同一次换缩放 DpiChanged 会来两遍（1.3.5 测试日志里每次两行），只对齐一次
        double dpiFrom;   // 最近一次换缩放前的缩放（0 = 这次运行没换过）：CheckZoom 靠它认出「网页区域还停在旧缩放上」
        int dpiResyncs;   // 这次换缩放后补对齐了几次
        void ResyncWebForDpi(double oldDpi, double newDpi)
        {
            if (web == null || Math.Abs(newDpi - resyncedDpi) < 0.001) return;
            resyncedDpi = newDpi;
            dpiFrom = oldDpi; dpiResyncs = 0;
            Store.Log($"系统缩放变了：{Math.Round(oldDpi * 100)}% → {Math.Round(newDpi * 100)}%，网页区域重新对齐");
            web.Width = Math.Max(1, web.ActualWidth - 1); web.UpdateLayout();   // 缩小（放大会超出窗口，不一定真的变）
            web.Width = double.NaN; web.UpdateLayout();
            lastHitRects = null; dockCut.Clear();   // 可点区域、贴边切口都按新像素重新量
            CheckZoomSoon();   // 再量一次网页大小：还停在旧缩放上就补对齐（StuckAtOldDpi），别的对不上记日志
        }

        /// <summary>补对齐：上面那招在 #28 那台机器（虚拟显示器 + 混合显卡）上没成功，可能是缩 1 再放回在同一帧里被合并了。
        /// 这次缩得多一点，并且等它真的按缩小的大小画完一帧再放回</summary>
        async Task ResizeWebBounds()
        {
            if (web == null) return;
            web.Width = Math.Max(1, Math.Round(web.ActualWidth * 0.9)); web.UpdateLayout();
            await Window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Render);
            await Task.Delay(100);
            if (web == null) return;
            web.Width = double.NaN; web.UpdateLayout();
            lastHitRects = null; dockCut.Clear();
        }

        /// <summary>改大小：窗口 = 画布 × 人物大小，网页按人物大小缩放；放在哪见 Anchor</summary>
        void ApplyScale(double scale, Anchor anchor = Anchor.Bottom)
        {
            Native.GetWindowRect(hwnd, out var old);
            Window.Width = pageW * scale; Window.Height = pageH * scale;
            Window.UpdateLayout();
            if (web != null) web.ZoomFactor = scale * zoomFix;
            shownZoom = scale;
            CheckZoomSoon();
            Native.GetWindowRect(hwnd, out var now);
            int w = now.Right - now.Left, h = now.Bottom - now.Top;
            double footPx = pageFoot * w / pageW;   // 网页像素 → 物理像素（含系统缩放）
            var (x, y) = PlaceWindow(old, w, h, shownFootPx > 0 ? shownFootPx : footPx, footPx, anchor);
            shownFootPx = footPx;
            if (dock == null) (x, y) = Clamp(x, y, w, h);   // 贴着边时不夹：窗口本来就有一截在屏幕外，之后 ApplyDock 会重新对齐
            Native.MoveTo(hwnd, x, y);
            SavePosition();
        }

        /// <summary>人物大小 / 文字大小变了：交给网页算画布（规则在 app/web/text-size.js），按回来的尺寸设窗口。
        /// target：人物大小要动画到哪（底边不动）；null = 文字变了（Feet）或网页刚加载完（Corner），按现在的人物大小重设一次</summary>
        async void ApplySizes(double? target = null, Anchor anchor = Anchor.Feet)
        {
            if (ready && web?.CoreWebView2 != null)   // 网页还没加载完：先按旧画布，加载完（NavigationCompleted）会再调一次
            {
                try
                {
                    var json = await Eval($"setSizes({Num(target ?? Scale)}, {Num(TextScale)}, {(TextLinked ? "true" : "false")})");
                    if (Store.Json.DeserializeObject(Store.Json.Deserialize<string>(json)) is Dictionary<string, object> o)
                    {
                        double w = Convert.ToDouble(o["w"]), h = Convert.ToDouble(o["h"]), foot = Convert.ToDouble(o["foot"]);
                        if (w != pageW || h != pageH || foot != pageFoot) dockCut.Clear();   // 画布变了：贴边切口要重新量
                        pageW = w; pageH = h; pageFoot = foot;
                    }
                }
                catch (Exception e) { Store.Log("文字大小：算画布失败 " + e.Message); }
            }
            if (target is double t) { AnimateScale(t); return; }
            ApplyScale(shownScale > 0 ? shownScale : Scale, anchor);
            if (anchor == Anchor.Feet && dock != null) ApplyDock();   // 贴着边时改了文字：窗口变宽了，重新对齐屏幕边
        }

        /// <summary>拖滑块时每次只变一点，直接跟手；一下子变很多（点「还原」）时用 0.2 秒过渡过去</summary>
        DispatcherTimer scaleTimer;
        double shownScale;
        void AnimateScale(double target)
        {
            scaleTimer?.Stop();
            var from = shownScale > 0 ? shownScale : Scale;
            if (Math.Abs(target - from) <= 0.06) { shownScale = target; ApplyScale(target); return; }
            var start = DateTime.Now;
            scaleTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
            scaleTimer.Tick += (_, __) =>
            {
                var k = Math.Min(1, (DateTime.Now - start).TotalSeconds / 0.2);
                shownScale = from + (target - from) * (1 - Math.Pow(1 - k, 3));
                ApplyScale(shownScale);
                if (k >= 1) { scaleTimer.Stop(); if (dock != null) ApplyDock(); }   // 贴着边时调完大小重新对齐边缘
            };
            scaleTimer.Start();
        }

        /// <summary>tab：停在哪个标签页（null = 上次看的那页）；窗口已经开着就切过去</summary>
        void OpenSettings(string tab = null)
        {
            if (settings == null) { settings = new SettingsWindow(this, env); settings.Closed += () => settings = null; }
            settings.Show();
            if (tab != null) settings.ShowTab(tab);
        }

        /// <summary>换角色窗口（右键「换角色…」、设置里的按钮）：大立绘 + 衣服卡 + 角色卡，可以拖大小，记住上次的大小</summary>
        void OpenCharacterWindow()
        {
            if (characterWindow == null)
            {
                var size = Store.Settings.TryGetValue("characterWindow", out var v) && v is Dictionary<string, object> d ? d : null;
                double W(string k, double def) => size != null && size.TryGetValue(k, out var x) && x != null ? Convert.ToDouble(x) : def;
                characterWindow = new SettingsWindow(this, env, "characters.html", "CrossPet 换角色", W("w", 760), W("h", 740));
                characterWindow.Closed += () =>
                {
                    var s = characterWindow.Size;
                    if (s.Width > 0 && s.Height > 0) { Store.Settings["characterWindow"] = new Dictionary<string, object> { ["w"] = Math.Round(s.Width), ["h"] = Math.Round(s.Height) }; Store.SaveSettings(); }
                    characterWindow = null;
                };
            }
            characterWindow.Show();
        }

        /// <summary>设置窗口、换角色窗口开着哪个就推给哪个</summary>
        void PushSettings() { settings?.Push(); characterWindow?.Push(); }

        List<string> integrated;   // 已接入的 AI（设置窗口打开时查一次，接入 / 撤销后再查）
    }
}
