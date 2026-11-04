namespace CrossPet
{
    static class RunningClient
    {
        /// <summary>在跑的程序（exe 名，小写）算哪个客户端，要和钩子在会话里写的 client 对得上（不然「程序开着就在」时同一个 AI 出两只）。
        /// Claude 桌面（有窗口的 claude.exe）是 claude-desktop，没窗口的是终端里的 Claude Code，不算（返回 null）；
        /// Codex 和 ChatGPT 桌面版都是 codex：ChatGPT 桌面版里跑的就是 Codex，钩子写的 client 是 codex（1.3.10-test.1：ChatGPT 开着时多出一只不动的 GPT）；
        /// Antigravity 是 antigravity；其余用它在对照表里的名字（多模型宿主是宿主名，其余是角色名，和钩子写的接入名一致）</summary>
        public static string Of(string exe, string mapped, bool hasWindow)
        {
            switch (exe)
            {
                case "claude.exe": return hasWindow ? "claude-desktop" : null;
                case "codex.exe":
                case "chatgpt.exe": return "codex";
                case "antigravity.exe": return "antigravity";
                default: return mapped;
            }
        }
    }
}
