# Ubuntu 24.04 / X11

Linux 版使用 Python 3、GTK3、WebKitGTK 4.1，直接加载与 macOS / Windows 共用的 `app/web` 页面、角色和 AI 钩子。
首版支持 **Ubuntu 24.04 的 X11（Ubuntu on Xorg）会话**。原生 Wayland 尚不支持，启动器会明确提示切换会话。

## 安装与启动

在终端确认 `echo "$XDG_SESSION_TYPE"` 输出 `x11`。若为 `wayland`，注销，在登录界面选择用户后点齿轮，选择 **Ubuntu on Xorg**。

安装系统依赖：

```bash
sudo apt install python3 python3-gi python3-gi-cairo \
  gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-wnck-3.0 \
  gir1.2-ayatanaappindicator3-0.1
```

在仓库根目录运行：

```bash
./install.sh
```

安装到当前用户的 `~/.local`，不需要管理员权限；添加应用菜单入口并打开桌宠。之后可以从应用菜单打开 **CrossPet**，也可以运行：

```bash
~/.local/bin/crosspet
~/.local/bin/crosspet --settings
~/.local/bin/crosspet --show
~/.local/bin/crosspet --toggle
~/.local/bin/crosspet --quit
```

`--show` 会解除手动隐藏并将桌宠放回右下角；在全屏应用所在屏幕上，仍遵守“全屏时隐藏”设置。
重复启动只会通知现有进程，不会多开。可用 `python3 app/linux/install.py --prefix /指定目录` 改变安装前缀。

开发时也可以直接运行，依赖 GI 的外壳请用 Ubuntu 的系统 Python：

```bash
/usr/bin/python3 app/linux/main.py --check
/usr/bin/python3 app/linux/main.py
```

## AI 接入

右键桌宠 → **设置 → 接入 AI**，选择电脑上已安装的宿主。也可以在仓库运行：

```bash
python3 tools/integrate.py install codex
python3 tools/integrate.py install claude-hooks
python3 tools/integrate.py install qwen
python3 tools/integrate.py status
```

先安装或启动一次桌宠，以部署钩子脚本。接入后需新建 AI 会话；Codex 的钩子仍须在宿主里信任。只接入用户选中的宿主，安装桌宠本身不会修改任何 AI 配置。

Qwen Code 可在「设置 → 接入 AI」里接入或撤销，并显示接入状态和最近事件时间；先安装并运行一次 Qwen Code。接入保留其原有设置和其他钩子，按当前模型匹配已安装的角色。

仍使用原有的 JSON 状态协议和事件解析；终端中的 AI 工作事件会自动切换角色。前台应用跟随使用 X11 的 WM_CLASS，可在 `~/.config/crosspet/apps.json` 增加精确映射，例如：

```json
{"codex": "gpt", "antigravity": "gemini", "my-ai-app": "claude"}
```

键用小写的 WM_CLASS 类名。终端和浏览器中的不同 AI 无法只凭 WM_CLASS 区分，应使用钩子事件跟随。

## 已实现与限制

- 透明、无边框、不抢焦点的窗口；矩形区域点击穿透、拖动、甩动、左右贴边。
- 拖到屏幕外侧边缘松手即收起；鼠标停在露出部分会探头，移开后缩回。AI 有新工作时出来、恢复空闲后收回。相邻显示器之间的接缝不吸附。
- 原有立绘、皮肤、台词、动画、彩蛋和多会话表现。
- 共享设置页与开发者控制台；角色改名、人物 / 文字缩放及设置持久化。
- 峰谷时段支持时间条、文字或关闭；「高峰穿 / 空闲穿」配置会保存并在启动时恢复。按共享网页的北京时间规则自动换装，只换已有皮肤；后台角色换装不会切走当前角色。修改配置从下一时段生效，修改其他设置不重置换装记录。
- 前台 AI 应用跟随、三种窗口层级、同屏全屏时隐藏。
- Ctrl+Alt+P 隐藏 / 显示；可改为 Ctrl+Alt+H，检测快捷键占用。
- 托盘菜单（需要 Ayatana AppIndicator 和桌面托盘支持；Ubuntu 默认桌面通常已带托盘扩展）。缺少托盘时仍可通过右键、快捷键和 `--show` 操作。
- 登录自启动、AI 唤起、手动退出抑制、单实例。
- Claude / DeepSeek 插件写入的额度文件直接显示；Codex 额度通过本地 CLI 查询，失败时保留上次数据并标记过期。
- **暂未实现** Antigravity 的 Linux 额度采集，设置中已禁用并说明原因。其工作事件接入仍可使用。
- Linux 更新目前使用源码安装流程；“检查更新”打开发布记录。反馈按钮打开 GitHub issue 页面。
- 原生 Wayland、不同行为的其他桌面环境、多显示器混合缩放仍需后续验证。WebKit 的 SVG 特效性能和字体效果也取决于显卡及系统字体。

Codex CLI 必须在桌宠的 PATH 中。应用菜单启动时若找不到 npm / nvm 安装的 CLI，可从终端设置 `CROSSPET_CODEX_BIN=/绝对路径/codex` 后启动桌宠。

如果桌宠能运行但顶部状态栏没有图标，Ubuntu 默认桌面通常只需补装 `sudo apt install gir1.2-ayatanaappindicator3-0.1`，然后退出并重新打开 CrossPet。使用精简桌面时还需安装并启用 `gnome-shell-extension-appindicator`。这一步需要系统管理员权限；无托盘时右键菜单和快捷键照常可用。

## 文件位置

| 用途 | 默认路径 |
|---|---|
| 安装文件 | `~/.local/share/crosspet/runtime/` |
| 网页、角色、钩子、启动配置、日志 | `~/.local/share/crosspet/` |
| 设置 / 应用映射 | `~/.config/crosspet/settings.json`、`apps.json` |
| AI 状态、心跳 | `/tmp/crosspet/`，沿用现有接入协议 |
| 登录自启动 | `~/.config/autostart/crosspet.desktop` |

支持 `XDG_DATA_HOME`、`XDG_CONFIG_HOME` 和 `CROSSPET_DATA_DIR`、`CROSSPET_CONFIG_DIR`、`CROSSPET_STATE_DIR`。
使用自定义目录时，桌宠与 AI 插件须使用相同目录；标准钩子安装器会将数据和状态目录写进生成的命令。配置与角色保留，内置网页和内置角色在启动时从安装包同步。

源码更新后重新运行 `./install.sh`；已安装的旧进程会先正常退出。`./update.sh` 会先快进拉取仓库，再重新安装。卸载用 `./uninstall.sh`：撤销检测到的 AI 接入、删除程序和启动入口，保留用户角色及设置。

## 验证

不依赖桌面的回归：

```bash
python3 -m unittest tests.linux_test tests.integrate_test tests.hook_stdin_test tests.hook_test tests.codex_turn_test
node --test tests/*.test.js tests/*.test.mjs
```

真实 X11 / WebKit 验证：

```bash
python3 app/linux/main.py --smoke-test build/linux-smoke
```

测试使用 `/tmp` 下独立的数据、设置与状态目录，打开短暂的测试窗口；通过真实钩子子进程驱动原有网页，并验证设置消息、缩放、贴边、X11 输入区域和真实鼠标穿透 / 拖动 / 全局快捷键。测试会短暂移动鼠标，结束后恢复位置；请等待测试结束再操作桌面。

成功时输出 `CROSSPET_LINUX_SMOKE_OK` 和 `CROSSPET_LINUX_EXIT_OK`；报告与截图保存在 `build/linux-smoke/`。这项测试不修改真实 AI 配置，不调用真实额度服务。额度协议使用 `tests/fake_codex.py` 验证。

在继续使用桌面的同时验证输入，推荐使用独立的 Xephyr 显示：

```bash
sudo apt install xserver-xephyr
python3 tools/test-linux-x11.py
```

报告位于 `build/linux-smoke-x11/`，不会移动主桌面的指针。Xephyr 默认没有合成器，透明合成仍需在真实桌面检查；可以用 `python3 app/linux/main.py --smoke-test build/linux-smoke-local --smoke-no-input` 验证主桌面的渲染与设置，不模拟鼠标键盘。

2026-10-20 本机验证：Ubuntu 24.04.3、GNOME 46、X11，主屏 2 倍缩放。初版 Python 回归 34 项、共享 JavaScript 回归 68 项通过。贴边修复后，Linux 回归 14 项、主桌面 17 项渲染及桥接检查、独立 Xephyr 的 28 项窗口及输入检查通过。原生窗口为 32 位 RGBA，透明角像素的 alpha 为 0；真实鼠标穿透、点击、拖动和全局快捷键均通过。贴边检查包括左右拖动触发、探头、移开回缩、AI 工作时出来及空闲后收回。安装后的用户目录副本通过依赖检查并成功启动。

本轮 AI 验证使用真实钩子子进程和隔离状态文件，Codex 额度使用模拟 CLI；未连接实际 AI 账号查询额度，也未在本机编译 macOS / Windows 外壳。多显示器混合缩放、完整全屏应用矩阵和托盘仍需单独验收；本机缺少可选的 Ayatana GIR 组件，已验证无托盘时可正常启动。
