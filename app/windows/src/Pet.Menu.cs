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
        /// <summary>target：右键的那一只。菜单只有一份（托盘 / 右键共用），但动作要作用在你点的那只身上</summary>
        void FillMenu(Forms.ContextMenuStrip menu, bool developer, Pet target = null)
        {
            target = target ?? this;
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
            menu.Items.Add(Item("摸摸头", () => target.Js("handleClick('pat')")));
            menu.Items.Add(Item("戳一下", () => target.Js("handleClick('poke')")));
            menu.Items.Add(Item("召唤彩蛋", () => target.Js("playEgg(true)")));
            Sep();
            var switchTo = new Forms.ToolStripMenuItem("换角色");
            // 有别的衣服（皮肤）的角色展开成几项：「DeepSeek · 女仆装」「DeepSeek · Claude 卫衣」
            foreach (var (id, name) in Characters())
            {
                var cid = id;
                if (Store.SkinChoices.TryGetValue(id, out var skins) && skins.Count > 0)
                {
                    var worn = Store.Skins != null && Store.Skins.TryGetValue(id, out var w) ? w as string ?? "" : "";
                    var baseName = Store.BaseOutfit.TryGetValue(id, out var bo) && bo != null ? bo : "原版";
                    switchTo.DropDownItems.Add(Item($"{name} · {baseName}", () => { Wear(cid, ""); SwitchTo(cid); }, cid == current && worn == ""));
                    foreach (var (sid, sname) in skins) { var k = sid; switchTo.DropDownItems.Add(Item($"{name} · {sname}", () => { Wear(cid, k); SwitchTo(cid); }, cid == current && worn == k)); }
                }
                else switchTo.DropDownItems.Add(Item(name, () => SwitchTo(cid), cid == current));
            }
            menu.Items.Add(switchTo);
            menu.Items.Add(Item("按工作模型显示多个桌宠", () => SetMultiOption("multiPet", !MultiPet), MultiPet));
            menu.Items.Add(Item("全部空闲时隐藏桌宠", () => SetMultiOption("hideIdlePets", !HideIdle), HideIdle));
            Sep();
            var layer = new Forms.ToolStripMenuItem("显示层级");
            foreach (var (mode, title) in new[] { ("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）") })
            {
                var m = mode;
                layer.DropDownItems.Add(Item(title, () => { Store.Settings["layer"] = m; Store.SaveSettings(); ApplyLayer(); foreach (var pet in companions.Values) pet.ApplyLayer(); }, LayerMode == m));
            }
            menu.Items.Add(layer);
            menu.Items.Add(Item("设置…", OpenSettings));
            menu.Items.Add(Item("反馈问题…", OpenFeedback));
            if (developer) menu.Items.Add(Item("开发者控制台…", OpenDev));
            menu.Items.Add(Item("回到右下角", target.Recenter));
            menu.Items.Add(Item(HotkeyLabel != null ? $"暂时隐藏（{HotkeyLabel}）" : "暂时隐藏", () => SetUserHidden(true)));
            Sep();
            menu.Items.Add(Item("退出 CrossPet", UserQuit));
        }
    }
}
