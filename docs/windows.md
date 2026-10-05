# Windows 版

支持 Windows 10（1903 及以上）和 Windows 11，x64 和 ARM64 共用一个安装包。需要系统里有「Microsoft Edge WebView2 运行时」（Windows 11 自带，Windows 10 一般已经通过系统更新装好），没有的话第一次打开会提示去微软官网装。

> 为什么是 1903：桌宠的透明窗口用到了 Windows 10 1903（2019 年 5 月更新）起才有的屏幕捕获接口。

## 测试情况

作者手边没有 Windows 电脑，这一版是在 Apple 芯片 Mac 上的 Parallels 虚拟机（Windows 11 ARM64）里测试的。

| 功能 | 状态 |
|---|---|
| 透明显示、拖动、置顶、托盘、右键菜单、改名、开机启动 | ✅ 已测 |
| 跟随前台程序换角色 | ✅ 已测 |
| Codex 接入、DeepSeek Harness 接入、DeepSeek 余额（API Key 和账号登录两种） | ✅ 已测 |
| 开发者控制台 | ✅ 已测 |
| Claude Code 标准钩子 / 增强版 mod（额度）、Gemini（Antigravity）额度、Antigravity / Gemini CLI 钩子 | ⚠️ 没测过（虚拟机里没装） |
| 实体 x64 电脑、多显示器、Windows 10 | ⚠️ 没测过 |

遇到问题欢迎提 Issue，附上 `%LOCALAPPDATA%\CrossPet\windows.log`。

## 安装

1. 下载 `CrossPet-Windows.zip`，**解压到本地磁盘**（比如桌面）。
2. 双击里面的 `install.cmd`：装到 `%LOCALAPPDATA%\Programs\CrossPet`，建开始菜单快捷方式，然后自动打开。不需要管理员权限。
3. 右键桌宠 →「接入 AI」，把你用的 AI 逐个「接入 / 更新」。

**更新**：下载新包，解压后再双击一次 `install.cmd`，覆盖安装即可。设置、改的名字、自己加的角色都会保留。装好后建议把用到的 AI 再「接入 / 更新」一次。

**卸载**：双击 `uninstall.cmd`。会撤销所有 AI 的接入（只删 CrossPet 自己加的条目），删除程序和开机启动；角色和设置留在 `%LOCALAPPDATA%\CrossPet`，不需要的话手动删掉。

## 使用

- 单击摸头；拖动换位置（会记住）；右键菜单；按住 **Shift** 再右键，菜单里多一项「开发者控制台」。
- 任务栏右下角的托盘图标：右键是同一个菜单，双击让桌宠回到右下角。
- 切到 Claude、ChatGPT / Codex、DeepSeek Harness、Antigravity 时自动换角色。按程序名识别，对照表在 `%LOCALAPPDATA%\CrossPet\windows-apps.json`，可以自己改。
- 在终端里用 AI 时，没有对应的窗口：桌宠跟着最新一条工作事件换角色（右键可以关掉）。
- 桌宠始终在最上层，切换窗口时会重新置顶。
- 每天检查一次新版本，有新版时气泡提醒、右键菜单顶上出现下载入口。

## 接入 AI

| AI | 接入后 |
|---|---|
| Claude Code | 标准钩子：跟着工作状态动。增强版 mod：另外显示 5 小时 / 每周额度、识别被打断（需要支持 mod 的 Claude Code 版本），两者选一个 |
| Codex | 跟着工作状态动。新钩子要在 Codex 里输入 `/hooks` 亲自信任一次 |
| DeepSeek Harness | 工作状态 + 余额。余额优先用你填的 API Key 查；没填 Key 就用 Harness 里登录的账号查。接入后要从托盘完全退出 Harness 再打开 |
| Antigravity | 跟着工作状态动 |
| Gemini CLI | 跟着工作状态动 |

- GPT 额度：右键勾选「显示 GPT 额度」，从 Codex 会话记录里只读额度数字。
- Gemini 额度：右键勾选「显示 Gemini 额度」，需要 Antigravity 开着。和 macOS 版一样，只在本机向 Antigravity 后台服务问额度（用它每次启动随机生成、只在本机有效的令牌），不碰账号凭据。
- 钩子命令用随包的 Python 运行，不需要另装 Python。用户名里没有空格时，命令里不带任何引号，cmd、PowerShell、Git Bash 都能直接跑。

## 数据在哪

| 内容 | 位置 |
|---|---|
| 程序 | `%LOCALAPPDATA%\Programs\CrossPet` |
| 设置、角色、日志 | `%LOCALAPPDATA%\CrossPet`（可用环境变量 `CROSSPET_DATA_DIR` 改） |
| AI 写给桌宠的状态 | `%LOCALAPPDATA%\CrossPet\state`（可用 `CROSSPET_STATE_DIR` 改，桌宠和 AI 两边要一致） |
| 日志 | `%LOCALAPPDATA%\CrossPet\windows.log` |

内置角色每次启动整份覆盖（这样更新后能拿到新立绘）；想改内置角色，复制一份换个文件夹名再改，见 [自定义角色](自定义角色.md)。

## 从源码打包

在 macOS 上就能打（不需要 Windows）：先装 .NET 8 SDK（`curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0`，装到 `~/.dotnet`），然后：

```bash
tools/build-windows.sh
```

输出 `build/CrossPet-Windows.zip`。外壳在 `app/windows/`（C# + WPF，跑在 Windows 自带的 .NET Framework 4.8 上），桌宠画面、开发者控制台、钩子脚本、接入工具都和 macOS 版共用。
