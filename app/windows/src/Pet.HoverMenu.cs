using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Forms = System.Windows.Forms;

namespace CrossPet
{
    sealed partial class Pet
    {
        DirectHost hoverHost;
        Forms.ContextMenuStrip hoverModel;
        Companion hoverCompanion;
        DirectHost HoverAnchor => hoverCompanion?.Host ?? Host;
        string HoverOwnerCharacter => hoverCompanion?.Character ?? current;
        bool HoverOwnerReady => hoverCompanion != null ? hoverCompanion.HoverReady : ready && !concealed && !sessionLocked;
        void HoverOwnerJs(string code) { if (hoverCompanion != null) hoverCompanion.Js(code); else Js(code); }
        internal void OpenCompanionHover(Companion owner)
        {
            if (!HoverMenuEnabled || owner == null || !owner.HoverReady) return;
            if (hoverShown) CloseHoverMenu();
            if (!hoverOpening) _ = OpenHoverMenu(owner);
        }
        internal void CloseCompanionHover(Companion owner)
        { if (ReferenceEquals(hoverCompanion, owner)) CloseHoverMenu(); }
        readonly Dictionary<string, Forms.ToolStripMenuItem> hoverActions = new Dictionary<string, Forms.ToolStripMenuItem>();
        bool hoverOpening, hoverShown, hoverReady;
        int hoverGeneration;
        string hoverCharacter, hoverNonce;
        double hoverOutsideSince = -1;
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        static double HoverClock => Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
        static bool HoverMenuEnabled => Store.Flag("hoverMenu");
        static int HoverMenuDelay => HoverMenuLayout.Delay(Store.Settings.TryGetValue("hoverMenuDelay", out var v) ? v : null);
        internal string HoverMenuOptionsJs => "setHoverMenuOptions(" + Store.Json.Serialize(new { enabled = HoverMenuEnabled, delayMs = HoverMenuDelay }) + ")";

        void CloseHoverMenuForLookChange(bool mainOnly = false)
        {
            if ((hoverShown || hoverOpening) && (!mainOnly || hoverCompanion == null)) CloseHoverMenu();
        }

        void SetHoverMenuSetting(string key, object value)
        {
            Store.Settings[key] = key == "hoverMenu" ? (object)(value is bool b && b) : HoverMenuLayout.Delay(value);
            Store.SaveSettings();
            CloseHoverMenu();
            Js(HoverMenuOptionsJs);
            CompanionsJs(HoverMenuOptionsJs);
        }

        bool HandleHoverMenu(Dictionary<string, object> message)
        {
            if (!message.TryGetValue("hoverMenu", out var value)) return false;
            if (Equals(value, "open") && ready && HoverMenuEnabled && Host != null &&
                !Host.ForcePassThrough && Host.Alpha != 0 && openMenu == null &&
                Forms.Control.MouseButtons == Forms.MouseButtons.None)
            { if (hoverShown) CloseHoverMenu(); if (!hoverOpening) _ = OpenHoverMenu(); }
            return true;
        }

        void HoverMenuTick()
        {
            // Closed menus do no mouse/window polling. The page sends one request
            // after a continuous dwell, using its real pointer enter/leave events.
            if (!hoverShown) return;
            var anchor = HoverAnchor;
            if (anchor == null || anchor.IsDisposed) { CloseHoverMenu(); return; }
            var now = HoverClock;
            var over = anchor.MouseOverHit;
            var blocked = !HoverOwnerReady || !HoverMenuEnabled || anchor.ForcePassThrough || anchor.Alpha == 0 || (hoverCompanion == null && openMenu != null);
            if (blocked || HoverOwnerCharacter != hoverCharacter || (GetAsyncKeyState(0x1B) & 0x8000) != 0)
            { CloseHoverMenu(); return; }
            var p = Forms.Cursor.Position;
            var area = hoverHost.Bounds; area.Inflate(10, 10);
            var overMenu = area.Contains(p);
            if (!overMenu && Forms.Control.MouseButtons != Forms.MouseButtons.None)
            { CloseHoverMenu(); return; }
            if (over || overMenu) hoverOutsideSince = -1;
            else if (hoverOutsideSince < 0) hoverOutsideSince = now;
            else if (now - hoverOutsideSince > 900) CloseHoverMenu();
        }

        async Task EnsureHoverHost()
        {
            if (hoverHost != null && !hoverHost.IsDisposed && hoverReady) return;
            hoverHost?.Dispose();
            hoverReady = false;
            hoverHost = new DirectHost(false) { Text = "CrossPet · 角色悬停菜单", Topmost = true };
            hoverHost.Show();
            await hoverHost.Web.EnsureCoreWebView2Async(env);
            var core = hoverHost.Web.CoreWebView2;
            Map(core);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.ProcessFailed += (_, e) => { CloseHoverMenu(); hoverReady = false; };
            core.WebMessageReceived += (_, e) =>
            {
                try
                {
                    if (!(Store.Json.DeserializeObject(e.WebMessageAsJson) is Dictionary<string, object> m)) return;
                    if (hoverShown && (!HoverOwnerReady || HoverOwnerCharacter != hoverCharacter)) { CloseHoverMenu(); return; }
                    if (!hoverShown || !m.TryGetValue("nonce", out var n) || !Equals(n, hoverNonce)) return;
                    if (m.TryGetValue("closeHoverMenu", out var close) && close is bool b && b) { CloseHoverMenu(); return; }
                    if (m.TryGetValue("hoverAction", out var id) && id is string key && hoverActions.TryGetValue(key, out var item) && item.Enabled)
                    {
                        var model = hoverModel;
                        hoverModel = null;
                        CloseHoverMenu();
                        try { item.PerformClick(); Store.Log("角色悬停菜单执行: " + item.Text); }
                        catch (Exception ex) { Store.Log("悬停菜单操作失败: " + ex.Message); }
                        finally { model?.Dispose(); }
                    }
                }
                catch (Exception ex) { Store.Log("悬停菜单消息失败: " + ex.Message); }
            };
            var loaded = new TaskCompletionSource<bool>();
            core.NavigationCompleted += (_, e) => loaded.TrySetResult(e.IsSuccess);
            core.Navigate(Store.PageUrl("hover-menu.html"));
            if (await Task.WhenAny(loaded.Task, Task.Delay(8000)) != loaded.Task || !await loaded.Task)
                throw new IOException("Hover menu page did not load");
            hoverHost.Hide();
            hoverReady = true;
        }

        List<object> HoverMenuItems(Forms.ToolStripItemCollection items, bool parentEnabled = true)
        {
            var result = new List<object>();
            foreach (var item in items.OfType<Forms.ToolStripMenuItem>().Where(i => i.Available))
            {
                var id = Guid.NewGuid().ToString("N");
                var entry = new Dictionary<string, object> {
                    ["id"] = id, ["label"] = item.Text.Replace("&", ""),
                    ["enabled"] = parentEnabled && item.Enabled, ["checked"] = item.Checked
                };
                if (item.HasDropDownItems) entry["children"] = HoverMenuItems(item.DropDownItems, parentEnabled && item.Enabled);
                else if (parentEnabled && item.Enabled) hoverActions[id] = item;
                result.Add(entry);
            }
            return result;
        }

        async Task OpenHoverMenu(Companion companion = null)
        {
            if (hoverOpening || hoverShown) return;
            hoverOpening = true;
            var generation = hoverGeneration;
            var owner = companion?.Character ?? current;
            var anchor = companion?.Host ?? Host;
            // Track the owner before WebView initialization, so a companion's
            // close/drag/session-change can invalidate this pending request too.
            hoverCompanion = companion;
            try
            {
                await EnsureHoverHost();
                if (generation != hoverGeneration || !HoverMenuEnabled || anchor == null || anchor.IsDisposed ||
                    anchor.ForcePassThrough || anchor.Alpha == 0 || Forms.Control.MouseButtons != Forms.MouseButtons.None ||
                    (companion != null ? !companion.HoverReady || companion.Character != owner : !ready || concealed || sessionLocked || openMenu != null || current != owner) ||
                    !anchor.MouseOverHit) return;
                hoverModel?.Dispose();
                hoverModel = new Forms.ContextMenuStrip();
                if (companion == null) FillMenu(hoverModel, false); else companion.FillHoverMenu(hoverModel);
                hoverActions.Clear();
                hoverNonce = Guid.NewGuid().ToString("N");
                var items = HoverMenuItems(hoverModel.Items);
                var scale = Math.Max(.85, Math.Min(1.15, Scale));
                var dpi = anchor.DpiScale;
                var bounds = HoverMenuLayout.Place(anchor.Bounds, Forms.Screen.FromHandle(anchor.Handle).WorkingArea,
                                      (int)Math.Round(360 * scale * dpi), (int)Math.Round(284 * scale * dpi));
                hoverHost.Bounds = bounds;
                hoverHost.Web.ZoomFactor = scale;
                hoverHost.SetHitRects(new[] { new Rectangle(8, 8, bounds.Width - 16, bounds.Height - 16) });
                hoverCharacter = owner;
                var data = new { nonce = hoverNonce, character = owner, name = Store.Names.TryGetValue(owner, out var name) ? name : Characters().FirstOrDefault(c => c.id == owner).name,
                    items, side = bounds.Left > anchor.Left ? "right" : "left" };
                await hoverHost.Web.CoreWebView2.ExecuteScriptAsync("renderHoverMenu(" + Store.Json.Serialize(data) + ")");
                if (generation != hoverGeneration || !HoverMenuEnabled || anchor.IsDisposed || anchor.ForcePassThrough || anchor.Alpha == 0 ||
                    HoverOwnerCharacter != owner || !HoverOwnerReady || !anchor.MouseOverHit ||
                    Forms.Control.MouseButtons != Forms.MouseButtons.None) { CloseHoverMenu(); return; }
                hoverShown = true; hoverOutsideSince = -1;
                HoverOwnerJs("setHoverMenuArt(true)");
                hoverHost.ForcePassThrough = false;
                hoverHost.SetVisible(true);
                hoverHost.Show();
                hoverHost.Topmost = true;
                Native.BringToTop(hoverHost.Handle);
                Store.Log("角色悬停菜单展开: " + owner);
            }
            catch (Exception e)
            {
                Store.Log("悬停菜单加载失败: " + e.Message);
                CloseHoverMenu();
                hoverReady = false;
            }
            finally
            {
                // Early returns (for example the pointer leaving during loading)
                // also release the pending owner and any menu model.
                if (!hoverShown && generation == hoverGeneration) CloseHoverMenu();
                hoverOpening = false;
            }
        }

        void CloseHoverMenu()
        {
            hoverGeneration++;
            hoverNonce = null;
            if (hoverHost != null && !hoverHost.IsDisposed)
            { hoverHost.ForcePassThrough = true; hoverHost.Hide(); }
            if (hoverShown) { HoverOwnerJs("setHoverMenuArt(false)"); Store.Log("角色悬停菜单收起: " + hoverCharacter); }
            hoverShown = false; hoverOutsideSince = -1;
            hoverActions.Clear();
            HoverOwnerJs("if (typeof hoverMenuDismissed === 'function') hoverMenuDismissed()");
            hoverCompanion = null;
            hoverModel?.Dispose(); hoverModel = null;
        }
    }
}
