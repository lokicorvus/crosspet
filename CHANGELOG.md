# 更新记录

## 1.2.0 · Windows 版 + 等你回答（2026-10-06）

**Windows 版**
- 第一次正式发布：Windows 11，x64 和 ARM64 同一个安装包，约 22 MB。用系统自带的 WebView2 显示，不另装运行库
- 和 macOS 版功能对齐：透明置顶的桌宠、托盘、跟随前台程序 / 工作事件换角色、接入 Claude Code（标准钩子 / 增强版 mod）、Codex、DeepSeek Harness、Antigravity、Gemini CLI、GPT / Gemini 额度、DeepSeek 余额、开发者控制台（Shift + 右键）、每天检查更新
- 在 Parallels 虚拟机（Windows 11 ARM64）里测试；Claude 增强版 mod 的额度、Gemini 额度还没测过，详见 [Windows 说明](docs/windows.md)

**新动作**
- 等你回答：AI 停下来问你问题、让你选选项，或者请求授权时，她会一直看着你等回答（Claude Code、Codex、DeepSeek Harness、Gemini CLI；Antigravity 没有这个信号）

**DeepSeek**
- 没填 API Key 时，用 Harness 里登录的账号查余额
- 插件自带诊断记录 `deepseek-plugin.json`，余额不显示时能看出卡在哪一步
- 修复插件同时写两次文件时的冲突

**其他**
- 钩子脚本一律按 UTF-8 读事件（Windows 中文系统下带中文的事件不再失效）
- 接入工具认 `DSH_HOME`、`CLAUDE_CONFIG_DIR` 环境变量

**升级提示**：这一版新加了「等你回答」用的钩子事件，已经接入过的 AI 要再接入一次才会生效——macOS 运行一次安装命令或 `./update.sh`；Windows 在右键「接入 AI」里逐个「接入 / 更新」。Codex 之后要在 `/hooks` 里重新信任。

## 1.1.0 · 正式版（2026-10-05）

第一个正式版，汇总了 1.0.x 测试期间的所有改动。

**支持的 AI**
- Claude（Claude Code 标准钩子 / 增强版 mod）、GPT（Codex）、DeepSeek（DeepSeek Harness 插件）、Gemini（**Antigravity** 钩子，Gemini CLI 也能接）
- 切到哪个 AI 的 App，就换成哪个角色；Antigravity 和 Gemini 桌面版都会换成 Gemini

**额度**
- Claude 5 小时 / 每周、GPT 的 Codex 额度（含 Plus 的 5 小时窗口）、DeepSeek 余额、Gemini 的 Antigravity 额度
- 统一显示「剩余」，多个窗口 / 额度池分行显示；快用完时她会累

**动作和立绘**
- Gemini 全套立绘；所有姿态里人物一样高（张翅膀、带道具的姿态不再被缩小）
- 大成功时四个角色戴上各自设计的皇冠
- 通用：压缩上下文（往小箱子里硬塞东西）、派子任务（每个角色派出自己的小帮手）
- 社区梗：Claude 抱 Clawd、被纠正时「You're absolutely right!」；GPT 额度提前 reset；DeepSeek 充值后抱大碗开吃；Gemini 香蕉画笔（Nano Banana）、反重力漂浮
- DeepSeek 专属：吃白饭、摸鱼、游泳、深度思考、被戳生气
- 彩蛋：DeepSeek cos Claude / GPT / Gemini

**体验**
- 换图交叉淡入、换角色「噗」一下过渡，不再闪烁或两个角色叠在一起
- 特效统一画法，不压到人物；读文件时飘的字符颜色跟着角色
- Antigravity 快速连续调工具时，每个动作都能演到
- 每天自动检查新版本

**开发者**
- 开发者控制台（按住 ⌥ 再右键）：逐个检查姿态、跑场景演练、看实时事件、记录反馈
- `tools/prepare.py` 自动去掉生图 AI 画的漂浮碎片、地面影子和光晕，小帮手对齐地面
- `tools/fxcheck` 按姿态检查特效重叠；`tools/readme_images.py` 按真实布局生成 README 配图

## 1.0.x · 测试版（2026-10-03 ～ 10-05）

1.0.0 首次发布，之后 18 个小版本的改动都已汇总进 1.1.0。各版本的代码仍可在 git 标签 `v1.0.0` ～ `v1.0.18` 找到。
