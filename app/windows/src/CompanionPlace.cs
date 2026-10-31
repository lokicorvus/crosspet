using System;
using System.Collections.Generic;
using System.Linq;

namespace CrossPet
{
    /// <summary>多桌宠：额外那几只第一次出现放在哪。纯计算（tests/windows/LogicTests 测），物理像素、y 向下。
    /// 规则和 macOS 的 App.companionSlots 一样（那边 y 向上，测试 tests/companion_place_probe.sh）：
    /// 先排主桌宠左边（由近到远），左边放不下放右边，再放不下往上一排（上面的排里主桌宠正上方先放），还不够往下一排；
    /// 每个格子都整个在 visible 里、两两不重叠、不压着主桌宠。格子不够（屏幕太小）时剩下的错开叠在已有的格子上，照样夹在 visible 里。
    /// 自己定义 Rect / Size：LogicTests 跑在 macOS 的 .NET 8 上，没有 WPF 的 System.Windows.Rect</summary>
    static class CompanionPlace
    {
        public struct Rect
        {
            public double X, Y, W, H;
            public Rect(double x, double y, double w, double h) { X = x; Y = y; W = w; H = h; }
            public double Right => X + W;
            public double Bottom => Y + H;
            /// <summary>两块有没有重叠；inset：这块先往里缩多少再判断（贴着边不算重叠）</summary>
            public bool Intersects(Rect o, double inset = 0) =>
                X + inset < o.Right && o.X < Right - inset && Y + inset < o.Bottom && o.Y < Bottom - inset;
        }
        public struct Size
        {
            public double W, H;
            public Size(double w, double h) { W = w; H = h; }
        }

        public static Rect[] Slots(Rect main, int count, Size size, Rect visible)
        {
            if (count <= 0 || size.W <= 0 || size.H <= 0) return new Rect[0];
            double w = size.W, h = size.H, vx = visible.X, vy = visible.Y, vr = visible.Right, vb = visible.Bottom;
            bool Fits(Rect r) => r.X >= vx - 0.01 && r.Right <= vr + 0.01 && r.Y >= vy - 0.01 && r.Bottom <= vb + 0.01;
            // 第一排和主桌宠底边对齐（主桌宠藏出屏幕时夹回来）
            double top0 = Math.Min(Math.Max(main.Bottom - h, vy), Math.Max(vy, vb - h));
            // 每排的格子：同一排里左右相邻不重叠（右边从主桌宠和格子里较宽的那个之后开始）；
            // 第一排往上隔的是格子和主桌宠里较高的那个，主桌宠正上方那格才不压着她
            List<Rect> Row(double y, bool center)
            {
                var o = new List<Rect>();
                if (center) o.Add(new Rect(main.X, y, w, h));
                for (var x = main.X - w; x >= vx - 0.01; x -= w) o.Add(new Rect(x, y, w, h));
                for (var x = main.X + Math.Max(w, main.W); x + w <= vr + 0.01; x += w) o.Add(new Rect(x, y, w, h));
                return o;
            }
            var cands = Row(top0, false);
            for (var y = top0 + h - Math.Max(h, main.H) - h; y >= vy - 0.01; y -= h) cands.AddRange(Row(y, true));
            for (var y = top0 + h; y + h <= vb + 0.01; y += h) cands.AddRange(Row(y, true));
            cands = cands.Where(r => Fits(r) && !r.Intersects(main, 0.5)).ToList();
            var output = cands.Take(count).ToList();
            // 放不下了：在已有的格子上错开一点叠着放（躲不开重叠），夹在可见区里
            Rect Clamp(Rect r) => new Rect(Math.Min(Math.Max(r.X, vx), Math.Max(vx, vr - w)), Math.Min(Math.Max(r.Y, vy), Math.Max(vy, vb - h)), w, h);
            for (int i = 0; output.Count < count; i++)
            {
                var b = cands.Count == 0 ? new Rect(main.X - w, top0, w, h) : cands[i % cands.Count];
                var step = (i / Math.Max(cands.Count, 1) + 1) * 24.0;
                output.Add(Clamp(new Rect(b.X - step, b.Y - step, w, h)));
            }
            return output.ToArray();
        }

        /// <summary>把一块夹进可见区（记下的位置所在的屏幕变小了、换了分辨率）</summary>
        public static Rect Clamp(Rect r, Rect visible) =>
            new Rect(Math.Min(Math.Max(r.X, visible.X), Math.Max(visible.X, visible.Right - r.W)),
                     Math.Min(Math.Max(r.Y, visible.Y), Math.Max(visible.Y, visible.Bottom - r.H)), r.W, r.H);
    }
}
