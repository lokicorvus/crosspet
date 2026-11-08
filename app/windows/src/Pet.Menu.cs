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
        // ---------------- 菜单 ----------------
        void FillMenu(Forms.ContextMenuStrip menu, bool developer)
        {
            menu.Items.Clear();
            Forms.ToolStripMenuItem Item(string text, Action click, bool? check = null)
            {
                var i = new Forms.ToolStripMenuItem(text);
                if (check.HasValue) i.Checked = check.Value;
                i.Click += (_, __) => { try { click(); } catch (Exception e) { Store.Log("菜单出错: " + e); } };
                return i;
            }
            void Sep() => menu.Items.Add(new Forms.ToolStripSeparator());

            if (latestRelease is var (tag, url))
            {
                if (updateZip != null) menu.Items.Add(Item(updating ? $"⬆️ 正在更新到 {tag}…" : $"⬆️ 更新到 {tag}", () => _ = SelfUpdate()));
                else menu.Items.Add(Item($"⬆️ 有新版本 {tag}，点这里下载", () => Open(url)));
                Sep();
            }
            menu.Items.Add(Item("摸摸头", () => Js("handleClick('pat')")));
            menu.Items.Add(Item("戳一下", () => Js("handleClick('poke')")));
            var eggItem = Item("召唤彩蛋", () => Js("playEgg(true)"));
            eggItem.Enabled = eggAllowed;   // 有别的桌宠在场时不演彩蛋（页面发 eggAllowed:false）
            menu.Items.Add(eggItem);
            // 多桌宠：集合不受开关限制，一直在；正集合着（包括叫了一只出来）时多一项「解散」，「集合！」把还没来的都叫来
            menu.Items.Add(Item("集合！", GatherCompanions));
            if (pageGathering) menu.Items.Add(Item("解散", DismissCompanions));
            // 叫她出来：只叫一个角色来陪着（不用两个 AI 同时干活）。主桌宠演着的不列，已经站着的打勾、点不了（送走用她的「让她先回去」）
            var others = Characters().Where(c => c.id != current).ToList();
            if (others.Count > 0)
            {
                var standing = new HashSet<string>(companions.Values.Select(c => c.Character));
                var call = new Forms.ToolStripMenuItem("叫她出来");
                foreach (var (id, name) in others)
                {
                    var cid = id;
                    var item = Item(name, () => CallCompanion(cid));
                    if (standing.Contains(id)) { item.Checked = true; item.Enabled = false; }
                    call.DropDownItems.Add(item);
                }
                menu.Items.Add(call);
            }
            if (CodexResets && current == "gpt") menu.Items.Add(Item("会重置吗？", () => Js("askReset()")));   // 只有 GPT 有这个需求
            Sep();
            // 右键直接换（用户要回来的）：一项一套，有别的衣服（皮肤）的角色展开成几项：「DeepSeek · 女仆装」「DeepSeek · Claude 卫衣」。
            // 最下面「看图选…」打开角色窗口（卡片墙）
            if (Characters().Count > 1)
            {
                var switchTo = new Forms.ToolStripMenuItem("换角色");
                foreach (var (id, name) in Characters())
                {
                    var cid = id;
                    if (Store.SkinChoices.TryGetValue(id, out var skins) && skins.Count > 0)
                    {
                        var worn = Store.Skins != null && Store.Skins.TryGetValue(id, out var w) ? w as string ?? "" : "";
                        var baseName = Store.BaseOutfit.TryGetValue(id, out var bo) && bo != null ? bo : "原版";
                        switchTo.DropDownItems.Add(Item($"{name} · {baseName}", () => { Wear(cid, ""); SwitchTo(cid, "skin", ""); }, cid == current && worn == ""));
                        foreach (var (sid, sname) in skins) { var k = sid; switchTo.DropDownItems.Add(Item($"{name} · {sname}", () => { Wear(cid, k); SwitchTo(cid, "skin", k); }, cid == current && worn == k)); }
                    }
                    else switchTo.DropDownItems.Add(Item(name, () => SwitchTo(cid, "manual", "menu"), cid == current));
                }
                switchTo.DropDownItems.Add(new Forms.ToolStripSeparator());
                switchTo.DropDownItems.Add(Item("看图选…", OpenCharacterWindow));
                menu.Items.Add(switchTo);
                Sep();
            }
            var layer = new Forms.ToolStripMenuItem("显示层级");
            foreach (var (mode, title) in new[] { ("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）") })
            {
                var m = mode;
                layer.DropDownItems.Add(Item(title, () => { Store.Settings["layer"] = m; Store.SaveSettings(); ApplyLayer(); }, LayerMode == m));
            }
            menu.Items.Add(layer);
            menu.Items.Add(Item("悬停展开专属菜单", () => {
                SetHoverMenuSetting("hoverMenu", !HoverMenuEnabled);
                PushSettings();
            }, HoverMenuEnabled));
            menu.Items.Add(Item("设置…", () => OpenSettings()));
            menu.Items.Add(Item("反馈问题…", OpenFeedback));
            if (developer)
            {
                menu.Items.Add(Item("开发者控制台…", OpenDev));
                menu.Items.Add(Item("测试渲染失败并重启…", () =>
                {
                    if (MessageBox.Show("这会主动触发渲染失败的恢复流程，桌宠及设置窗口会关闭，然后尝试自动重开。是否继续？",
                        "CrossPet 开发测试", MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes)
                        Program.InjectRenderFailure();
                }));
            }
            menu.Items.Add(Item("回到右下角", Recenter));
            menu.Items.Add(Item(HotkeyLabel != null ? $"暂时隐藏（{HotkeyLabel}）" : "暂时隐藏", () => SetUserHidden(true)));
            Sep();
            menu.Items.Add(Item("退出 CrossPet", UserQuit));
        }
    }
}
