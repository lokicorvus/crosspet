namespace CrossPet
{
    /// <summary>让开：鼠标在她身上（能点的那几块）时按一下 Ctrl，她变透明、鼠标穿过她点到后面的东西；松开 Ctrl 也保持，鼠标离开她才回来。
    /// 松开键再点，后面的程序收到的是普通点击（按着 Ctrl 点浏览器会在新标签页打开）。不用 Alt：单按一下 Alt 很多程序的菜单栏会拿到焦点。
    /// 规则同 macOS（App+ClickThrough.swift 的 yieldNext，那边用 ⌥）</summary>
    static class YieldRule
    {
        /// <summary>没让开：鼠标在她身上 + 只按着 Ctrl → 让开；让开着：鼠标还在她身上就一直让开</summary>
        public static bool Next(bool yielding, bool over, bool key) => yielding ? over : over && key;

        /// <summary>只按着 Ctrl（没有 Shift / Alt / Win，免得撞上 Ctrl+Shift 之类的快捷键）。按键状态：VK → 按着没有</summary>
        public static bool OnlyCtrl(System.Func<int, bool> down) =>
            down(0x11) && !down(0x10) && !down(0x12) && !down(0x5B) && !down(0x5C);
    }
}
