# Windows 预览版

Windows 11 优先。ARM64 用于 Windows on ARM（包括 Apple 芯片 Mac 上的 Parallels）；x64 用于 Intel / AMD Windows。Windows 10 尚未验证。

当前已在 Parallels Windows 11 ARM64 上通过 ARM64 原生与 x64 兼容层自检，见 [验证记录](windows-validation.md)。

## 使用

解压完整目录，双击 `CrossPet.exe` 即可试用。不要只复制 exe。若位于 Parallels 的 Mac 共享下载目录（UNC 路径），程序会提示复制到 Windows 本机后运行；确认即可。以后可以从开始菜单打开 CrossPet。映射盘符的网络目录尚未验证。

双击 `install.cmd` 安装到 `%LOCALAPPDATA%\Programs\CrossPet` 并创建开始菜单快捷方式，无需管理员权限。更新前退出 CrossPet，解压新包后再次运行安装脚本。右键角色 → 接入 AI → 选择对应工具 → 添加 / 更新钩子。移动便携目录后应重新接入，因为钩子使用随包 Python 的绝对路径。更新安装后也请重新添加 / 更新已使用的钩子。

- 单击摸头；拖动移动；右键菜单（按住 Shift 再右键多出「开发者控制台」）；托盘双击移回主屏幕。
- 桌宠置顶在最高层，切换前台窗口时会重新置顶，不会被其他程序盖住。
- 角色图片、名字、彩蛋、动画与 macOS 共用。
- 前台应用通过可执行文件名识别。映射在 `%LOCALAPPDATA%\CrossPet\windows-apps.json`，可自行修正。
- 终端内的 AI 通过最新工作事件切换；可分别关闭前台跟随、事件跟随。
- 接入菜单提供 Claude Code 标准钩子、Codex、DeepSeek Harness 插件（工作状态 + 余额）、Antigravity、Gemini CLI。钩子命令在用户名没有空格时不带任何引号，cmd / PowerShell / Git Bash 都能直接运行；DeepSeek 插件用目录联接（junction）挂进 Harness，不需要管理员权限。实际事件是否可用取决于对应工具的 Windows 版本；Codex 钩子仍需用户在 Codex 内信任。
- GPT 额度默认关闭；开启后读取 `CODEX_HOME` 或 `%USERPROFILE%\.codex` 下近期会话里的额度字段。没有记录时不显示。
- 附带 Python 3.13.13 嵌入式运行时，不需要系统 Python / Node。Python、Electron 许可证随包保留，角色授权沿用仓库原说明。

## 数据路径

默认用户数据：`%LOCALAPPDATA%\CrossPet`；状态：其下 `state` 子目录。

`CROSSPET_DATA_DIR` 可以覆盖数据目录，`CROSSPET_STATE_DIR` 可以覆盖状态目录。桌宠、钩子和插件必须一致；不同用户账户的临时目录不会自动互通。自定义环境变量须让 AI 进程和桌宠同时继承。

WSL 中的 `/tmp` 与 Windows 不互通，本预览版不自动桥接 WSL。若手动桥接，给 WSL 钩子指定 Windows 状态目录对应的 `/mnt/c/...` 路径，同时让 Windows 桌宠读同一目录；对应宿主沙箱还须允许该路径。尚未验证。

## 本阶段边界

- 尚未验证实际 AI 客户端的 Windows 会话；模拟钩子通过不等于真实客户端接入完成。
- Claude 增强 mod 暂未开放。DeepSeek 插件默认找 `%USERPROFILE%\.dsh\profiles\desktop`；Windows 版 Harness 的实际配置目录和插件加载仍需实机确认。
- Antigravity 额度接口暂未移植；不显示虚构额度。
- 每天自动检查一次新版本，有新版时气泡提醒、右键菜单顶部出现下载入口；更新仍是下载新包后运行安装脚本。
- 和 macOS 版一样，内置角色每次启动整份覆盖（这样更新后能拿到新立绘）；想改内置角色，复制一份换个文件夹名再改。
- 首版未签名。尚未验证实体 x64 电脑、多显示器混合 DPI、独占全屏和 WSL。

## 构建与测试

Node.js 22.12+，macOS 或 Windows 均可构建。构建会从 npm / GitHub / python.org 下载依赖；Python ZIP 按官方 SHA256 核验。

```sh
npm ci --ignore-scripts
npm run test:windows
python3 tests/integrate_test.py
npm run build:windows -- arm64
npm run build:windows -- x64
```

输出：`build/windows/CrossPet-win32-<架构>/`。macOS 需自带 `unzip`，Windows 用 PowerShell `Expand-Archive`。测试钩子时默认使用 `python3`，Windows 可设置 `CROSSPET_TEST_PYTHON` 指向 Python 可执行文件。

Windows 上运行 `CrossPet.exe --smoke-test "C:\路径\测试结果"` 可生成隔离目录中的自动化测试报告和截图，不接入真实 AI 配置。结束后进程退出；`failure.txt` 表示未通过。不要在已运行同一测试目录实例时重复启动。

卸载：双击 `uninstall.cmd`。移除 CrossPet 钩子、开机启动与程序，保留用户角色和设置。卸载窗口会保留结果，按回车关闭；日志位于 `%LOCALAPPDATA%\CrossPet\uninstall.log`。
