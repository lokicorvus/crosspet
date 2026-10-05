# CrossPet · 跨 AI 桌宠

![CrossPet 跨 AI 桌宠：Claude、GPT、DeepSeek、Gemini 四个角色](docs/images/cover.webp)

[![最新版本](https://img.shields.io/github/v/release/lokicorvus/crosspet?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/lokicorvus/crosspet/releases/latest)
![macOS 13+](https://img.shields.io/badge/macOS-13%2B-lightgrey)
[![代码 MIT](https://img.shields.io/badge/%E4%BB%A3%E7%A0%81-MIT-blue)](LICENSE)
[![立绘 CC BY-NC-SA 4.0](https://img.shields.io/badge/%E7%AB%8B%E7%BB%98-CC%20BY--NC--SA%204.0-orange)](characters/LICENSE.md)

一只浮在桌面角落的小桌宠。**你切到哪个 AI，她就变成哪个 AI 娘；AI 干什么活，她就跟着做什么动作。**

![Claude、GPT、DeepSeek、Gemini 四个角色，名牌下显示各自的额度和余额](docs/images/characters.webp)

> 非官方同人项目，与 Anthropic、OpenAI、DeepSeek、Google 无关。角色形象来自社区二创，见 [致谢与授权](#致谢与授权)。

## 她会做什么

![思考、读文件、跑命令、吃饭、画画、大成功、查资料、游泳、派子任务等动作](docs/images/actions.webp)

- **跟着 AI 干活**：思考、读文件、写代码、跑命令、上网查资料、画图、派子任务、出错、完成。每个状态都有一张立绘，身边配一个小动画（小终端、浏览器、画板、任务清单……）。一轮里用了 8 次以上工具的大活干完，她会戴上自己的皇冠得意一下；AI 压缩上下文时，她会把一大堆东西往小箱子里硬塞。
- **看着额度**：名牌下面显示 Claude 的 5 小时 / 每周额度、GPT 的 Codex 额度、DeepSeek 的账户余额、Gemini 的 Antigravity 额度。快用完时她会露出累了的样子。
- **自己待着**：闲着会哼歌、伸懒腰、打哈欠，十分钟没动静就睡着。单击摸摸头，右键能戳她一下。
- **各有性格，还懂社区梗**：
  - **Claude**：闲着会抱着 Clawd 发呆；刚出错就被你纠正时，会先来一句「You're absolutely right!」
  - **GPT**：Codex 额度在该重置之前突然满血（reset）时，平时冷静的她会难得地笑出来
  - **DeepSeek**：闲着会扒白饭、摸鱼、游泳，被戳会生气，想得太久会揉太阳穴；余额变多时抱着比脑袋还大的饭碗开吃
  - **Gemini**：生图时拿香蕉当画笔（Nano Banana）；闲着会反重力飘起来

## 支持的 AI

| AI | 自动换形象 | 跟着干活 | 额度 / 余额 |
|---|:---:|---|---|
| **Claude**（Claude Code、Claude 桌面版） | ✅ | ✅ 钩子或增强版 mod | ✅ 用增强版 mod 时 |
| **GPT**（Codex、ChatGPT 桌面版） | ✅ | ✅ Codex 钩子 | ✅ 可选，读 Codex 会话记录 |
| **DeepSeek**（DeepSeek Harness 桌面版） | ✅ | ✅ 插件 | ✅ 插件查余额 |
| **Gemini**（Antigravity、Gemini 桌面版） | ✅ | ✅ Antigravity 钩子 | ✅ 可选，询问本机 Antigravity |

Gemini 桌面版没有对外接口，切过去只会换形象；Antigravity 的桌面版和命令行都能跟着干活。

## 快速开始

**要求**：macOS 13 及以上，Apple 芯片和 Intel 都行。

### 方式一：一条命令（推荐）

打开「终端」，粘贴这一行回车：

```bash
curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash
```

它会下载最新版装进「应用程序」并打开，再挨个问你要接入哪些 AI（回答 `y` 或直接回车跳过）。不用 git，不用编译，**第一次打开也不用去系统设置里放行**。

> 为什么不用放行：macOS 只拦带「从网上下载」标记的文件。浏览器下载的会带这个标记，终端里用 `curl` 下载的不会。脚本内容就在仓库里的 [get.sh](get.sh)，可以先看一眼再运行。

以后**更新**：再运行一次同一行命令。**卸载**：

```bash
curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash -s -- uninstall
```

### 方式二：手动下载

1. 到 [Releases](https://github.com/lokicorvus/crosspet/releases/latest) 下载 `CrossPet.zip`，解压后把 `CrossPet.app` 拖进「应用程序」。
2. 第一次打开时 macOS 会拦一下（本项目没有付费的苹果开发者签名），按你的系统版本放行一次，以后就能正常双击：
   - **macOS 15 及以上**：双击 CrossPet，弹出「无法验证」时点「完成」；打开「系统设置 → 隐私与安全性」，拉到最下面，在「已阻止使用 CrossPet」旁边点「仍要打开」，输入开机密码，再点「打开」。
   - **macOS 13、14**：在「应用程序」里**右键点 CrossPet →「打开」→ 再点「打开」**。
3. 这样装好后，切到各个 AI 的 App 时她会换形象；想让她**跟着 AI 干活**，还要接入 AI：运行一次方式一的命令（已经装好的 App 会直接替换成同一版），或者用方式三。

### 方式三：从源码安装

需要苹果命令行工具（没有的话运行 `xcode-select --install`）：

```bash
git clone https://github.com/lokicorvus/crosspet.git
cd crosspet
./install.sh
```

会编译、装到 `~/Applications`，然后挨个问你要接哪些 AI。只想接某一个也行：

```bash
python3 tools/integrate.py install codex     # 可选：claude-hooks、claude-mod、codex、deepseek、antigravity、gemini
python3 tools/integrate.py status            # 看看现在接了哪些
```

### 接入 AI 改了什么

不管用哪种方式，接入都只**添加** CrossPet 自己的条目，不碰你原有的配置，改之前都会备份，撤销后恢复原样。每个 AI 改了哪个文件、要不要重启、怎么手动接，都写在 [接入教程](docs/接入教程.md) 里。

> **Codex 用户注意**：新加的钩子要在 Codex 里输入 `/hooks` 亲自「信任」一次才会运行。
> **接入需要 python3**：macOS 自带。如果提示要安装「命令行开发者工具」，点安装就行。

## 和她互动

| 操作 | 效果 |
|---|---|
| 单击 | 摸摸头 |
| 拖动 | 换个位置（会记住） |
| 右键 | 菜单：戳一下、召唤彩蛋、换角色、给角色改名、显示 GPT / Gemini 额度、登录时自动启动、打开角色文件夹、检查更新……（按住 ⌥ 再右键，还有「开发者控制台」） |

## 彩蛋

用 Claude、GPT 或 Gemini 的时候，偶尔会「噗」地冒出一条穿着她们衣服的 DeepSeek，装模作样地学人说话。**单击她就能揪出来**，她会慌慌张张地溜走；没人理的话，她会得意地自己走掉。等不及的话，右键「召唤彩蛋」。

![DeepSeek 分别 cos 成 Claude、GPT、Gemini](docs/images/eggs.webp)

## 自定义

- **改名**：右键 →「给当前角色改名…」，留空就恢复默认。
- **换立绘、改台词、加新角色**：看 [自定义角色](docs/自定义角色.md)。改完可以**按住 ⌥ 再右键**打开「开发者控制台」，把每个姿态和场景挨个过一遍。一个文件夹就是一个角色，放几张图、写个 `character.json` 就能用。
- **用 AI 画新立绘**：[角色生图提示词](docs/prompts/角色生图提示词.md) · [彩蛋生图提示词](docs/prompts/彩蛋生图提示词.md)，配好了参考图。

## 隐私

- 钩子只拿到「哪个事件、用了哪个工具」，写到本机 `/tmp/crosspet/`，不保存任何对话内容。
- GPT 额度默认关闭。打开后只从 Codex 会话记录里提取额度那几个数字。
- Gemini 额度默认关闭。打开后向本机正在运行的 Antigravity 后台服务问一次额度（和它自己界面上显示额度的方式一样），用的是它每次启动随机生成、只在本机有效的令牌，不碰你的 Google 账号凭据。
- DeepSeek 余额：插件通过 DeepSeek Harness 官方的凭据接口取 Key，只用来调官方余额接口，不写盘、不上传别处。
- CrossPet 自己只联网做一件事：每天查一次 GitHub 上有没有新版本。

## 更新与卸载

- 有新版本时她会在气泡里提醒你，右键菜单顶上会出现「⬆️ 有新版本」。
- **一条命令装的**：再运行一次安装命令就是更新；卸载命令见上面「方式一」。
- **手动下载的**：下载新的 `CrossPet.zip` 替换旧 App 即可；已接入的钩子、插件、mod 会在新版第一次启动时自动更新。
- **从源码装的**：`./update.sh` 更新，`./uninstall.sh` 卸载。

遇到问题先看 [常见问题](docs/常见问题.md)。各版本改了什么见 [更新记录](CHANGELOG.md)。

## 致谢与授权

角色形象都是社区二创的再创作，CrossPet 只是把她们做成桌宠，立绘由 AI 生图工具按这些设定绘制：

- **DeepSeek 娘**：原型「溟月」由 **上善无形** 创作（2025-06，CC BY-NC-SA 4.0）；深蓝女仆鲸鱼娘（社区昵称「大肥鱼」）由 B 站 **ZipZipPipe** 二创。
- **GPT 娘（白龙）**：社区通称「御姐白龙」，出自 B 站 **ZipZipPipe**。
- **Gemini 娘**、**Claude 娘**：参考社区流行的 AI 娘设定（如 [ai-school-op](https://github.com/lshhhhhhh/ai-school-op)、[openpet-ai-girls](https://github.com/AwesomeHou/openpet-ai-girls)）。
- 「Claude」「GPT」「ChatGPT」「Codex」「DeepSeek」「Gemini」「Antigravity」是各自公司的商标，本项目仅用于指代对应产品。

如果你是原作者并且对使用方式有异议，请提 Issue，我会第一时间修改或下架。

**授权**

- 代码：[MIT](LICENSE)
- 角色立绘与设定（`characters/`、`docs/prompts/`、`docs/images/`）：[CC BY-NC-SA 4.0](characters/LICENSE.md)。可以转载和二创，须署名、**不得商用**，衍生作品用同样的协议。

README 里的配图由 `python3 tools/readme_images.py` 按 App 的真实布局生成，顶部横幅和宣传图由 `python3 tools/promo_images.py` 生成。
