using System;
using System.Globalization;

namespace CrossPet
{
    // 只管异常恢复的持久记账；启动成功并稳定两分钟后由 UI 线程清除。
    // 不依赖 WPF / WebView2，LogicTests 可以重放连续失败和时间边界。
    sealed class RenderRestartState
    {
        public const int MaxAttempts = 3;
        public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(10);
        public int Attempts { get; }
        public DateTime LastAttemptUtc { get; }
        public RenderRestartState(int attempts, DateTime at) { Attempts = attempts; LastAttemptUtc = at; }

        public bool Recent(DateTime now) => now - LastAttemptUtc < FailureWindow;
        public RenderRestartState Next(DateTime now)
        {
            var count = Recent(now) ? Attempts : 0;
            return count >= MaxAttempts ? null : new RenderRestartState(count + 1, now);
        }

        public string Serialize() => "v2|" + Attempts + "|" + LastAttemptUtc.ToString("O", CultureInfo.InvariantCulture);
        public static RenderRestartState Parse(string text, DateTime fileUtc)
        {
            var parts = (text ?? "").Trim().Split('|');
            if (parts.Length == 3 && parts[0] == "v2" && int.TryParse(parts[1], out var count) && count >= 1 && count <= MaxAttempts
                && DateTime.TryParse(parts[2], CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at) && at.Kind == DateTimeKind.Utc)
                return new RenderRestartState(count, at);
            // 旧版文件是本地时间的字符串，旧逻辑也以 mtime 计时；不猜旧字符串的时区。
            return new RenderRestartState(1, fileUtc);
        }
    }
}
