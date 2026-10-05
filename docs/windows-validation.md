# Windows 预览版验证记录

日期：2026-10-05。起点：`1076cb4`，Windows 适配尚未提交。

## 测试环境

- 用户现有 Parallels Windows 11 ARM64 虚拟机，当前登录用户 `MAC`。
- Electron 44.5.1，Python 3.13.13 官方嵌入式运行时，下载 SHA256 与官方发布页一致。
- ARM64 原生执行；x64 在同一虚拟机的 Windows x64 兼容层执行，不能视为实体 x64 硬件验证。

## 已通过

本地 6 个 Node 测试、2 个 Python 安装器测试；Windows 两种架构各 19 项自检：

- 四个角色资源实际解码和截图；透明像素与非透明像素均存在。
- 原生窗口置顶、不可激活；网页输入经过 preload / IPC 触发摸头。
- 真实 Win32 鼠标拖动，DPI 坐标正确，焦点不变，最终位置写入设置。
- 随包 Python 接收标准输入事件，写状态文件，再触发“听你说 / 写代码 / 完成”。
- 额度 JSON 可显示；此处使用测试额度，不是真实账户额度。
- Claude 标准钩子、Codex、Gemini CLI、Antigravity：隔离用户配置下安装、重复安装、cmd.exe 实际执行生成命令、卸载。
- 原生前台识别：启动 `CrossPetProbe.exe` 测试窗口，在隔离映射中关联 DeepSeek，验证自动换角色。未以此推断真实 AI 客户端的进程名或事件接口已经验证。
- 开发者控制台加载和截图。

报告及截图保存在 `build/windows-test-results/arm64-final/`、`build/windows-test-results/x64-final/`；该目录为本地证据，不进入 Git。可用 `CrossPet.exe --smoke-test "C:\新的测试结果目录"` 重现；使用新目录并确保测试桌面可交互。

通过面向用户的 `install.cmd` 实际安装到 `C:\Users\MAC\AppData\Local\Programs\CrossPet`，验证了开始菜单快捷方式、进程启动和桌面截图。测试直接调用 `.ps1` 曾被系统执行策略阻止，使用包内 `.cmd` 入口成功；未修改全局执行策略。卸载修复后另行进行了隔离的运行中卸载测试，见下文。

## 实测修复

Windows 透明窗拖动后释放鼠标可能触发 `pointercancel` 而非 `pointerup`。原实现移动成功但未保存位置。现已在取消和丢失捕获时保存已移动的位置，不触发点击动作。真实鼠标回归测试覆盖此问题。

## 未验证 / 未完成

- 真实 AI 客户端登录后的事件、信任流程和额度；目前只验证配置生成及模拟事件端到端。
- 实体 x64 机器、Windows 10、混合 DPI 多屏、独占全屏、WSL 桥接。
- Claude 增强 mod、DeepSeek Windows 宿主插件自动安装、Antigravity 额度获取。
- 代码签名、公开发布、自动更新。

现有 macOS Swift 外壳和安装脚本未改动；共用网页仅增加 Windows 开发者桥接分支。未重新构建 macOS 程序。

## 卸载占用问题修复

用户反馈双击卸载提示“仍在使用中”。隔离测试复现了安装目录已清空但根目录无法删除：卸载进程自身的 Windows 当前工作目录仍指向安装目录。PowerShell 的 Set-Location 只改变其位置状态，必须同时设置 [Environment]::CurrentDirectory 才会释放进程目录句柄。

修复同时包含：从独立窗口启动卸载、停止该安装实例及前台识别辅助进程后等待退出、短暂文件占用重试、开始菜单目录缺失时继续移除程序、保留成功/失败提示和卸载日志。

隔离测试从安装目录启动，桌宠有 4 个相关进程在运行；验证程序目录删除、测试用户数据保留、日志产生。真实用户配置下的额外复现被自动审批拦截，后续均使用隔离配置并在执行前检查开始菜单路径边界。

最终直接脚本和 uninstall.cmd 双击入口两种路径均通过：ExitCode=0、ProgramRemoved=true、DataRetained=true、LogCreated=true。测试时有 4 个桌宠进程在运行。原始测试脚本及结果保存在 build/windows-test-results/uninstall/。

## 共享下载目录启动修复

实测用户路径为 `\\Mac\Home\Downloads\CrossPet-Windows-arm64-preview\CrossPet-win32-arm64\CrossPet.exe`。旧版在这里启动后出现 renderer launch-failed、GPU process launch failed（error_code=18）并退出；同一 ARM64 运行时在 C: 本地目录能保持运行。

修复：在 Chromium 异步初始化前识别 UNC 路径，交由原生 Windows 提示确认复制到本机；完成后启动本地安装，保留角色与设置。未关闭本地桌宠的 renderer sandbox。另补充启动失败的可见提示。

已用用户实际解压目录验证 ARM64 的提示、确认、本地安装、可见桌宠及存活的 GPU/renderer 进程；新增路径识别测试，本地 Node 测试现为 7 项。x64 包同步相同启动处理，但本次共享路径交接未在 x64 单独重复实测。截图保存于 build/windows-test-results/shared-launch/。此前 19 项报告记录的是引入本修复前的测试状态，本次针对启动路径补测。
