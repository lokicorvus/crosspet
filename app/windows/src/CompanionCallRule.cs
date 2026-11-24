namespace CrossPet
{
    /// <summary>主桌宠页面让某只额外的桌宠做的事（companionCall 的 fn）：额度庆祝（celebrate）、每对台词里她那句（chat）、
    /// 集合时答到（answerRoll）、送礼那一幕（miniGift）；别的不认。
    /// 要和页面（app/web/index.html 里 toShell({ companionCall: … }) 的那几处，送礼在 playGift）、macOS（App+Companions.swift 的 companionCall）对齐：页面新加一种，这里和 macOS 都要加</summary>
    static class CompanionCallRule
    {
        static readonly string[] Fns = { "celebrate", "chat", "answerRoll", "miniGift" };

        public static bool Allows(string fn) => fn != null && System.Array.IndexOf(Fns, fn) >= 0;
    }
}
