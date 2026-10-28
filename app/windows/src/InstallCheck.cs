using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CrossPet
{
    /// <summary>安装目录是否完整（不依赖界面，tests/windows/LogicTests 测）。
    /// #24：一键更新时安装脚本先删旧目录再复制，钩子正占着 python\python.exe 删不掉，删到一半就停了——
    /// characters、integrations 没了，之后每次启动都崩，用户只看到「打不开」。1.3.7 起安装脚本不再原地删（见 install.ps1），
    /// 这里是兜底：启动前看一眼，缺了就提示，有下载好的安装包就用它修</summary>
    static class InstallCheck
    {
        public static readonly string[] Required = { "characters", "web", "integrations", "tools", "python" };

        /// <summary>安装目录里缺了哪些必需的文件夹（按 Required 的顺序）</summary>
        public static List<string> Missing(string installDir) =>
            Required.Where(d => !Directory.Exists(Path.Combine(installDir, d))).ToList();

        /// <summary>一键更新下载过的安装包（%TEMP%\CrossPet-update\&lt;版本&gt;\CrossPet）里，版本最新、本身完整、带 install.ps1 的那个；没有返回 null</summary>
        public static string RepairPackage(string updateRoot)
        {
            if (!Directory.Exists(updateRoot)) return null;
            return Directory.GetDirectories(updateRoot)
                .Select(v => (ver: Path.GetFileName(v), pkg: Path.Combine(v, "CrossPet")))
                .Where(x => File.Exists(Path.Combine(x.pkg, "install.ps1")) && Missing(x.pkg).Count == 0)
                .OrderByDescending(x => VersionKey(x.ver))
                .Select(x => x.pkg)
                .FirstOrDefault();
        }

        public enum Place { Installed, Package, InsideZip, Other }

        /// <summary>CrossPet.exe 是从哪儿打开的（#28：直接运行解压出来的 exe，容易以为装好了，接入 AI 时钩子却记着下载文件夹的路径）。
        /// Installed：就在安装目录；Package：解压出来的完整安装包（有 install.ps1、文件夹齐全），可以一键安装；
        /// InsideZip：在资源管理器里直接双击压缩包里的 exe，Windows 只把它取到临时文件夹（路径里有「xxx.zip」这一层），要先解压；
        /// Other：别的（开发时从编译目录跑），照常启动</summary>
        public static Place Locate(string exeDir, string installDir)
        {
            string Full(string d) { try { return Path.GetFullPath(d).TrimEnd('\\', '/'); } catch { return d.TrimEnd('\\', '/'); } }
            if (string.Equals(Full(exeDir), Full(installDir), StringComparison.OrdinalIgnoreCase)) return Place.Installed;
            // 先认压缩包：有的解压方式会把整包取到临时文件夹，看着齐全，可关掉压缩包窗口就被清掉，不能从那儿装
            if (exeDir.Split('\\', '/').Any(seg => seg.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))) return Place.InsideZip;
            if (File.Exists(Path.Combine(exeDir, "install.ps1")) && Missing(exeDir).Count == 0) return Place.Package;
            return Place.Other;
        }

        // v1.3.10 → 「0001.0003.0010」：按数字比，不按字母比（1.3.10 比 1.3.9 新）
        static string VersionKey(string tag) =>
            string.Join(".", tag.TrimStart('v', 'V').Split('-')[0].Split('.').Select(n => (int.TryParse(n, out var i) ? i : 0).ToString("D4")));
    }
}
