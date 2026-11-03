using System;
using System.Collections.Generic;
using System.Linq;

namespace CrossPet
{
    /// <summary>多桌宠：额外那几只第一次出现放在哪。纯计算（tests/windows/LogicTests 测），物理像素、y 向下。
    /// 规则和 macOS 的 App.companionSlots 一样（那边 y 向上，测试 tests/companion_place_probe.sh）：
    /// 先排主桌宠左边（由近到远），左边放不下放右边，再放不下往上一排（上面的排里主桌宠正上方先放），还不够往下一排；
    /// 每个格子都整个在 visible 里、两两不重叠、不压着主桌宠。
    /// 整窗口排不下（比如笔记本屏幕只放得下一排）：上下两排改成压着下面那排顶上的气泡空白排，人物照样不重叠；
    /// 主桌宠在屏幕中间、和她对齐排不下第二排时，改从屏幕底边（再不行顶边）开始排；
    /// 还不够，左右相邻的再压着两边的透明边排（11-03：笔记本上主桌宠在中间时左边放两列差一点，第 5、6 只叠到了前面那只上），再不够才叠着放。
    /// 格子不够（屏幕太小）时剩下的错开叠在已有的格子上，照样夹在 visible 里。
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

        /// <summary>窗口最上面这一截是给气泡留的空白（画布 362 里的 59；字放大时这一截占得只会更多），人物不在里面</summary>
        public const double BubbleShare = 59.0 / 362.0;
        /// <summary>窗口去掉顶上气泡那截：人物和名牌、额度所在的部分（y 向下，去掉的是上边）</summary>
        public static Rect Body(Rect r, double? tuck = null)
        {
            var t = tuck ?? r.H * BubbleShare;
            return new Rect(r.X, r.Y + t, r.W, r.H - t);
        }
        /// <summary>窗口左右两边各有一截透明边（画布比人物、名牌、额度条都宽）：排不下时左右相邻的窗口可以压着这截排。
        /// 量过（11-03）：人物左右各空 15%–19%，最宽的 Grok（斧头）一边只空 4.5%；两只相对的两边加起来都够 13%</summary>
        public const double SideShare = 0.065;
        /// <summary>比重叠用的部分：去掉气泡空白、再去掉左右两截透明边</summary>
        public static Rect Core(Rect r)
        {
            var b = Body(r); var d = r.W * SideShare;
            return new Rect(b.X + d, b.Y, b.W - 2 * d, b.H);
        }

        /// <summary>还空着的格子（互相之间也不重叠，后面一只一只放进去不会叠）</summary>
        public static List<Rect> FreeSlots(IEnumerable<Rect> slots, IEnumerable<Rect> taken)
        {
            var used = taken.ToList(); var o = new List<Rect>();
            foreach (var s in slots) if (!used.Any(t => Core(s).Intersects(Core(t), 1))) { o.Add(s); used.Add(s); }
            return o;
        }

        public static Rect[] Slots(Rect main, int count, Size size, Rect visible)
        {
            if (count <= 0 || size.W <= 0 || size.H <= 0) return new Rect[0];
            double w = size.W, h = size.H, vx = visible.X, vy = visible.Y, vr = visible.Right, vb = visible.Bottom;
            bool Fits(Rect r) => r.X >= vx - 0.01 && r.Right <= vr + 0.01 && r.Y >= vy - 0.01 && r.Bottom <= vb + 0.01;
            // 第一排和主桌宠底边对齐（主桌宠藏出屏幕时夹回来）
            double top0 = Math.Min(Math.Max(main.Bottom - h, vy), Math.Max(vy, vb - h));
            // 每排的格子：同一排里左右相邻不重叠（右边从主桌宠和格子里较宽的那个之后开始）；
            // tuck：上下排可以压着的那截（0 = 整窗口不重叠）。往上一排压着第一排和主桌宠的气泡空白，主桌宠正上方那格才不压着她
            // side：左右相邻压着的那截（0 = 不压）
            double side = 0;
            List<Rect> Row(double y, bool center)
            {
                var o = new List<Rect>();
                if (center) o.Add(new Rect(main.X, y, w, h));
                for (var x = main.X - w + side; x >= vx - 0.01; x -= w - side) o.Add(new Rect(x, y, w, h));
                for (var x = main.X + Math.Max(w, main.W) - side; x + w <= vr + 0.01; x += w - side) o.Add(new Rect(x, y, w, h));
                return o;
            }
            Rect Narrow(Rect r) => new Rect(r.X + side / 2, r.Y, r.W - side, r.H);
            List<Rect> Keep(List<Rect> c, double tuck)
            {
                var mainBody = Narrow(Body(main, tuck > 0 ? main.H * BubbleShare : 0));
                return c.Where(r => Fits(r) && !Narrow(Body(r, tuck)).Intersects(mainBody, 0.5)).ToList();
            }
            // 第一排和主桌宠底边对齐，往上、往下各排几排
            List<Rect> Layout(double tuck)
            {
                double mainTuck = tuck > 0 ? main.H * BubbleShare : 0, pitch = h - tuck;
                var c = Row(top0, false);
                for (var y = Math.Min(top0 + tuck, main.Y + mainTuck) - h; y >= vy - 0.01; y -= pitch) c.AddRange(Row(y, true));
                for (var y = top0 + pitch; y + h <= vb + 0.01; y += pitch) c.AddRange(Row(y, true));
                return Keep(c, tuck);
            }
            // 主桌宠在屏幕中间时，和她对齐往上、往下都差一点排不下第二排：改成从屏幕底边（或顶边）开始一排一排排，
            // 压着主桌宠的格子去掉（11-02：以前这时后几只错开叠在前几只上）
            List<Rect> Grid(double tuck, bool fromTop)
            {
                double pitch = h - tuck;
                var c = new List<Rect>();
                for (var y = fromTop ? vy : vb - h; y >= vy - 0.01 && y + h <= vb + 0.01; y += fromTop ? pitch : -pitch) c.AddRange(Row(y, true));
                return Keep(c, tuck);
            }
            var tight = h * BubbleShare;
            var cands = Layout(0);
            foreach (var s in new[] { 0, w * 2 * SideShare })
            {
                side = s;
                foreach (var next in new Func<List<Rect>>[] { () => Layout(0), () => Layout(tight), () => Grid(0, false), () => Grid(tight, false), () => Grid(0, true), () => Grid(tight, true) })
                {
                    if (cands.Count >= count) break;
                    var more = next();
                    if (more.Count > cands.Count) cands = more;
                }
            }
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
