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
            menu.Items.Add(Item("召唤彩蛋", () => Js("playEgg(true)")));
            if (CodexResets && current == "gpt") menu.Items.Add(Item("会重置吗？", () => Js("askReset()")));   // 只有 GPT 有这个需求
            Sep();
            // 角色和衣服多了，名单一长串要翻半天：改成打开设置的角色页（卡片墙），看着图选
            if (Characters().Count > 1) { menu.Items.Add(Item("换角色…", OpenCharacterWindow)); Sep(); }
            var layer = new Forms.ToolStripMenuItem("显示层级");
            foreach (var (mode, title) in new[] { ("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）") })
            {
                var m = mode;
                layer.DropDownItems.Add(Item(title, () => { Store.Settings["layer"] = m; Store.SaveSettings(); ApplyLayer(); }, LayerMode == m));
            }
            menu.Items.Add(layer);
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
