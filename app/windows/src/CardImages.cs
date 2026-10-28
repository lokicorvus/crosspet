using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CrossPet
{
    /// <summary>设置「角色」页卡片墙用的图：角色文件夹里专门画的展示立绘 portrait（衣服卡）、探头头像 avatar（角色卡），和待机图 idle。
    /// portrait-card 是 portrait 按卡片大小缩好的小图（Windows 上大图缩太狠会糊）。portrait、portrait-card、avatar 不是姿态，扫立绘时要排除（不然桌宠会多出一个叫 portrait 的动作）。
    /// 只给存在的文件，页面按「展示图 → 待机图 → 色块」退。和 macOS 版 cardImages 一致；不依赖 Windows，LogicTests 在 macOS 上测</summary>
    static class CardImages
    {
        public static bool IsSprite(string stem) => stem != "portrait" && stem != "portrait-card" && stem != "avatar";

        public static Dictionary<string, object> Of(string charactersRoot, string id, string host)
        {
            var d = new Dictionary<string, object>();
            var dir = Path.Combine(charactersRoot, id);
            if (!Directory.Exists(dir)) return d;
            foreach (var stem in new[] { "portrait", "portrait-card", "avatar", "idle" })
            {
                var file = new[] { ".webp", ".png" }.Select(ext => stem + ext).FirstOrDefault(f => File.Exists(Path.Combine(dir, f)));
                if (file != null) d[stem] = $"https://{host}/characters/{Uri.EscapeDataString(id)}/{Uri.EscapeDataString(file)}";
            }
            return d;
        }
    }
}
