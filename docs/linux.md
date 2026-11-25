# CrossPet Linux 版（兼容 Hyprland / Sway / Niri / i3 等平铺式窗口管理器）

CrossPet Linux 版基于 **Python 3 + GTK 3 + WebKit2GTK 4.1 + `gtk-layer-shell` + `AyatanaAppIndicator3`** 构建，与 macOS / Windows 版共用全部网页层（`app/web/`）、角色立绘（`characters/`）和 AI 接入层（`integrations/`）。

## 平铺式窗口管理器兼容设计

1. **Wayland Layer-Shell 透明悬浮（Hyprland / Sway / River 等）**
   - 桌宠主窗口、多桌宠伙伴窗口和小本子使用 `zwlr-layer-surface-v1`（`gtk-layer-shell`），**完全不进入平铺树**，不会挤压终端或编辑器的窗口布局。
   - 透明空白区域通过 `cairo.Region` 输入形状裁剪（`input_shape_combine_region`）实现**真正的像素级点击穿透**，鼠标可以穿透空白区域直接操作底下的窗口。
   - **显示层级**直接映射到 Layer-Shell 层级：
     - `始终在最上层` → `Layer.OVERLAY`
     - `跟着 AI` → 前台为 AI 应用 / 等你回答 / 刚完成任务时在 `OVERLAY`，其余时候沉到 `BOTTOM`
     - `普通窗口` → `Layer.BOTTOM`
   - **多显示器 & HiDPI**：通过 Hyprland IPC（`j/monitors`）读取逻辑分辨率、缩放比、屏幕旋转（`transform`）和 Waybar/顶栏 `reserved` 区域，自动避让状态栏并支持跨屏拖动与贴边。
   - **全屏自动隐藏**：通过合成器 IPC 检测当前显示器是否全屏；全屏看视频/演示时自动隐藏桌宠，全屏使用 AI 工具时照常保留。
2. **Niri / i3 / bspwm / dwm / 传统桌面兼容**
   - 原生支持 **Hyprland**（`.socket.sock` / `.socket2.sock` 事件流）、**Sway / i3**（`SWAYSOCK` / `I3SOCK`）、**Niri**（`NIRI_SOCKET`）和 **X11 EWMH**（`xprop` + `XGrabKey`）。
   - 在 X11 平铺式 WM 上，桌宠窗口使用 `UTILITY` + 无边框透明 + 输入区域裁剪，自动浮动且不占用平铺槽位。
   - 设置、换角色、反馈、开发者控制台等辅助窗口均为标准可调大小的 `Gtk.Window`（`WM_CLASS` 分别为 `crosspet-settings`、`crosspet-characters`、`crosspet-feedback`、`crosspet-devconsole`）。

## 依赖安装

### Arch Linux
```bash
sudo pacman -S python-gobject gtk3 webkit2gtk-4.1 gtk-layer-shell libayatana-appindicator
```

### Ubuntu / Debian
```bash
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-gtklayershell-0.1 gir1.2-ayatanaappindicator3-0.1
```

### Fedora
```bash
sudo dnf install python3-gobject gtk3 webkit2gtk4.1 gtk-layer-shell libayatana-appindicator-gtk3
```

## 安装与启动

```bash
git clone https://github.com/lokicorvus/crosspet.git
cd crosspet
./install.sh
```

安装脚本会检查依赖、把 `crosspet` 命令装到 `~/.local/bin/crosspet`、创建桌面快捷方式，自动刷新已接入的 AI 并逐个询问新接入（与 macOS 版一致；如果想跳过询问直接安装，可运行 `CROSSPET_CONNECT=none ./install.sh`，之后在桌宠右键 →「设置…」→「接入 AI」里按需接入）。

确保 `~/.local/bin` 在你的 `PATH` 中，然后直接运行：
```bash
crosspet
```

## Hyprland 推荐配置

在 `~/.config/hypr/hyprland.conf` 中添加：

```ini
# 开机自启（也可在 CrossPet 设置 → 通用中开启「登录时自动启动」）
exec-once = crosspet

# 全局隐藏 / 显示快捷键（Wayland 下由合成器触发，不抢焦点）
bind = CTRL ALT, P, exec, crosspet --toggle

# 可选：禁止合成器对桌宠层窗口播放开关动画或模糊透明背景
layerrule = no_anim on, match:namespace crosspet
layerrule = no_anim on, match:namespace crosspet-companion
layerrule = no_anim on, match:namespace crosspet-notebook
```

> **提示**：如果你希望设置窗口、换角色窗口在 Hyprland 中浮动打开，可以加：
> ```ini
> windowrule = float on, match:class ^(crosspet-settings|crosspet-characters|crosspet-feedback|crosspet-devconsole)$
> ```

### 可用的 CLI 控制命令

| 命令 | 说明 |
|---|---|
| `crosspet` | 启动 CrossPet（若已在运行则呼出到前台） |
| `crosspet --toggle` | 切换显示 / 隐藏（适合绑定到 Hyprland / Sway 快捷键） |
| `crosspet --show` / `--hide` | 显示 / 隐藏桌宠 |
| `crosspet --bring-to-front` | 叫到最前面（拖出屏幕时重置回右下角） |
| `crosspet --settings` | 打开设置窗口 |
| `crosspet --status` | 输出运行状态 JSON |
| `crosspet --quit` | 优雅退出（挥手道别） |
| `crosspet --wm-info` | 打印当前检测到的 WM 后端、显示器、前台窗口和鼠标坐标（排查问题用） |

## 交互说明

- **单击**：摸摸头（生气时是哄她）
- **左键拖动**：移动位置；拖到屏幕左/右边缘松手即可**贴边**
- **快速左右甩**：把她甩晕 / 红温赌气
- **让开（临时点击穿透）**：鼠标停在她身上时按住 **Ctrl** 或 **Alt**，她会变半透明并让鼠标穿透到后面的窗口
- **右键**：打开菜单（按住 **Shift** 再右键可打开「开发者控制台」）
- **托盘图标**：支持 Waybar Tray / StatusNotifierItem，可呼出桌宠或打开完整菜单

## 数据与配置路径

| 内容 | 路径 |
|---|---|
| 配置、日志、自定义角色 | `~/.local/share/crosspet/`（可通过 `CROSSPET_DATA_DIR` 或 `XDG_DATA_HOME` 修改） |
| 程序映射表（窗口 class → 角色） | `~/.local/share/crosspet/linux-apps.json` |
| 运行日志 | `~/.local/share/crosspet/linux.log` |
| AI 状态目录 | `/tmp/crosspet/`（可通过 `CROSSPET_STATE_DIR` 修改） |

## 常见问题

- **WebKit 透明窗口黑底或闪烁（部分 NVIDIA / 老旧驱动）**：尝试使用环境变量启动：
  ```bash
  CROSSPET_WEBKIT_DISABLE_DMABUF=1 crosspet
  ```
- **切换窗口时没有自动换角色**：运行 `crosspet --wm-info` 查看前台窗口的 `class` / `initialClass`，将其添加到 `~/.local/share/crosspet/linux-apps.json`（小写）。
- **Antigravity / Codex 额度**：与 macOS / Windows 版一致，从本机 Antigravity daemon 或 `codex app-server` 读取，不读取登录凭据。
