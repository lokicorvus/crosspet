using System;

namespace CrossPet
{
    /// <summary>小本子的小窗放哪：纯计算（tests/windows/LogicTests 测），物理像素、y 向下。
    /// 规则同 macOS 的 App.notebookFrame（那边 y 向上）：放她右边、压着她 overlap、上沿对齐她的上沿；右边放不下放左边；再夹进工作区</summary>
    static class NotebookPlace
    {
        public static CompanionPlace.Rect Place(CompanionPlace.Rect pet, CompanionPlace.Size panel, CompanionPlace.Rect work, double overlap)
        {
            var x = pet.Right - overlap;
            if (x + panel.W > work.Right) x = pet.X - panel.W + overlap;
            x = Math.Max(Math.Min(x, work.Right - panel.W), work.X);
            var y = Math.Max(Math.Min(pet.Y, work.Bottom - panel.H), work.Y);
            return new CompanionPlace.Rect(x, y, panel.W, panel.H);
        }
    }
}
