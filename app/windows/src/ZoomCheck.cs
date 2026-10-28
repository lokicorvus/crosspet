using System;

namespace CrossPet
{
    /// <summary>网页大小核对（不依赖界面，tests/windows/LogicTests 测）：平时只用来记日志；只有一种情况会改缩放，见 Fix。
    /// 1.3.4 有几位用户（系统缩放大于 100%）遇到模型、气泡被裁。1.3.5 测试查到一个原因：运行中换了系统缩放（或拖到缩放不同的屏幕），
    /// 网页控件没跟着重算网页区域（见 Pet.ResyncWebForDpi）。曾经试过量网页大小、对不上就自动改缩放，测试里没碰到一次真该改的，
    /// 倒是拖滑块时网页还没排完就量了、改错了两次——所以改成只记录：两次量到的一样、又和画布对不上，才写日志，留给下一个排查的人</summary>
    static class ZoomCheck
    {
        /// <summary>w1/h1、w2/h2：隔一会儿量的两次网页大小（innerWidth / innerHeight）。两次差 1 以内且和应有的画布差 2% 以上返回 true</summary>
        public static bool Off(double expectedW, double expectedH, double w1, double h1, double w2, double h2)
        {
            if (expectedW <= 0 || expectedH <= 0 || w1 <= 0 || h1 <= 0) return false;
            if (Math.Abs(w1 - w2) > 1 || Math.Abs(h1 - h2) > 1) return false;   // 还在变：拖滑块、换缩放的半路
            return Math.Abs(w1 / expectedW - 1) > 0.02 || Math.Abs(h1 / expectedH - 1) > 0.02;
        }

        /// <summary>换了系统缩放后网页区域还停在旧缩放的像素上（#28：150%→200% 网页 195×271、应为 260×362，正好 150/200；
        /// 200%→150% 是 346×483，正好 200/150）：ResyncWebForDpi 没对齐成功。这时不该改网页缩放（人物会跟着变大变小），
        /// 要再让网页控件按新缩放重算一次区域。宽高偏得一样多、而且正好是「旧缩放 ÷ 新缩放」才算</summary>
        public static bool StuckAtOldDpi(double expectedW, double expectedH, double w, double h, double oldDpi, double newDpi)
        {
            if (expectedW <= 0 || expectedH <= 0 || w <= 0 || h <= 0 || oldDpi <= 0 || newDpi <= 0) return false;
            if (Math.Abs(oldDpi / newDpi - 1) < 0.02) return false;   // 缩放没变
            double rw = w / expectedW, rh = h / expectedH;
            if (Math.Abs(rw / rh - 1) > 0.015) return false;
            return Math.Abs((rw + rh) / 2 / (oldDpi / newDpi) - 1) < 0.02;
        }

        /// <summary>系统缩放被算了两遍时的修正（10-17 反馈：125%、Windows 预览版、WebView2 155，网页 224×298，应为 280×372）：
        /// 网页按「人物大小 × 系统缩放 × 系统缩放」画，宽高都正好小了一个系统缩放倍，气泡被挤出窗口。
        /// 返回网页缩放该乘的系数（给网页的缩放 = 人物大小 × 系数），不用改返回 null。
        /// 只认这一种指纹，免得像 1.3.5 那样拖滑块时量早了改错：宽高偏得一样多，而且修完的系数是 1（修过又好了，撤销）或 1 / 系统缩放。
        /// w、h 是已经两次量过、稳定的网页大小（先过 Off）；fix 是现在用着的系数</summary>
        public static double? Fix(double expectedW, double expectedH, double w, double h, double dpi, double fix)
        {
            if (expectedW <= 0 || expectedH <= 0 || w <= 0 || h <= 0 || dpi <= 0 || fix <= 0) return null;
            double rw = w / expectedW, rh = h / expectedH;
            if (Math.Abs(rw / rh - 1) > 0.015) return null;   // 宽高偏得不一样：不是缩放的事
            var next = fix * (rw + rh) / 2;
            if (Math.Abs(next / fix - 1) < 0.02) return null;   // 差不多对得上
            if (Math.Abs(next - 1) < 0.02) return 1;
            if (dpi > 1.01 && Math.Abs(next * dpi - 1) < 0.02) return 1 / dpi;
            return null;
        }
    }
}
