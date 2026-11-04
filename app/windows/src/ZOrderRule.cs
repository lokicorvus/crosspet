namespace CrossPet
{
    static class ZOrderRule
    {
        /// <summary>桌面、任务栏（全屏判断也排除它们）</summary>
        public static bool IsShell(string cls) =>
            cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd";

        /// <summary>盖住整块屏幕的前台窗口是不是只是「最大化的普通窗口」。任务栏设成自动隐藏时，最大化的浏览器、资源管理器、QQ……
        /// 也盖住整块屏幕，以前被当成全屏、她一直藏着（1.3.8 用户反馈：置顶了却只有 Codex 和桌面上能看见）。
        /// 真全屏的窗口没有标题栏和可拖边框（Chromium/Electron 进全屏前会先取消最大化、去掉这两样；游戏、播放器用无边框弹出窗口），
        /// 所以「最大化 + 有标题栏或可拖边框」就不算全屏。style 是 GWL_STYLE</summary>
        public static bool JustMaximized(bool zoomed, int style) =>
            zoomed && (style & (0x00C00000 | 0x00040000)) != 0;   // WS_CAPTION | WS_THICKFRAME

        /// <summary>取消置顶时要不要插到前台窗口正下方（这样不会盖住你正在用的程序）。
        /// 只对普通程序窗口这么做：前台是桌面时插到它下面，桌宠就被壁纸整个盖住、哪里都找不到（1.3.7 用户反馈：
        /// 「跟着 AI」层级下右键几次、换个角色她就不见了，托盘和进程都还在）；前台是 CrossPet 自己的右键菜单、设置窗口时也不插</summary>
        public static bool TuckBelow(string frontClass, bool frontIsOurs) =>
            !frontIsOurs && !string.IsNullOrEmpty(frontClass) && !IsShell(frontClass);

        /// <summary>该不该置顶。mode：always / ai / normal；aiActive：AI 程序在前台，或刚干完活、在等你回答。
        /// 「跟着 AI」时前台是桌面、任务栏也置顶：你没在用任何程序，她挡不着谁；不然按 Win+D 回到桌面时，
        /// 桌面会把不置顶的她和别的窗口一起盖住，一直不出来（loki 实测：开 Chrome 再 Win+D 她就没了）</summary>
        public static bool Top(string mode, bool aiActive, bool frontIsShell) =>
            mode == "always" || (mode == "ai" && (aiActive || frontIsShell));
    }
}
