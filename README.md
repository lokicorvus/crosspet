# CrossPet · 跨 AI 桌宠

![CrossPet 跨 AI 桌宠：Claude、GPT、DeepSeek、Gemini 四个角色](docs/images/cover.webp)

[![最新版本](https://img.shields.io/github/v/release/lokicorvus/crosspet?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/lokicorvus/crosspet/releases/latest)
![macOS 13+](https://img.shields.io/badge/macOS-13%2B-lightgrey)
![Windows 10+](https://img.shields.io/badge/Windows-10%2B-lightgrey)
[![代码 MIT](https://img.shields.io/badge/%E4%BB%A3%E7%A0%81-MIT-blue)](LICENSE)
[![立绘 CC BY-NC-SA 4.0](https://img.shields.io/badge/%E7%AB%8B%E7%BB%98-CC%20BY--NC--SA%204.0-orange)](characters/LICENSE.md)

一只浮在桌面角落的小桌宠，Mac 和 Windows 都能用。**你切到哪个 AI，她就变成哪个 AI 娘；AI 干什么活，她就跟着做什么动作。**

![Claude、GPT、DeepSeek、Gemini、GLM 五个角色，名牌下显示各自的额度和余额](docs/images/characters.webp)

> 非官方同人项目，与 Anthropic、OpenAI、DeepSeek、Google、智谱、腾讯、阿里巴巴无关。角色形象来自社区二创或 CrossPet 原创设定，见 [致谢与授权](#致谢与授权)。

## 她会做什么

![思考、读文件、跑命令、吃饭、画画、大成功、查资料、游泳、派子任务等动作](docs/images/actions.webp)

- **跟着 AI 干活**：思考、读文件、写代码、跑命令、上网查资料、画图、派子任务、出错、完成。每个状态都有一张立绘，身边配一个小动画（小终端、浏览器、画板、任务清单……）。一轮里用了 8 次以上工具的大活干完，她会戴上自己的皇冠得意一下；AI 压缩上下文时，她会把一大堆东西往小箱子里硬塞；AI 停下来问你问题、让你选选项或者请求授权时，她会一直看着你等你回答（Claude Code、DeepSeek Harness）。
- **同时干好几件事**：同一个 AI 开着两个以上对话一起干活时，她左右来回转着忙，每个对话一张小卡片演它在做什么；三个以上直接崩溃。干完的打绿勾、出错的变红、等你回答的那张会跳。
- **用别家模型也换装**：Claude Code 走 DeepSeek、智谱的兼容接口，Codex 换成别家模型，DeepSeek Harness、WorkBuddy、ZCode、Hermes、Qwen Code 里换模型时，她都换成对应的角色来演（按实际用的模型名判断，认不出的由当前角色来演）。
- **看着额度**：名牌下面显示 Claude 的 5 小时 / 每周额度、GPT 的 Codex 额度、DeepSeek 的账户余额、Gemini 的 Antigravity 额度。快用完时她会露出累了的样子。「设置…」里打开「合并显示各家额度」后，小窗里会把各家的额度排在一起，每行前面标名字（默认只显示当前角色自己的）。还可以打开「Codex 重置提醒」：官方提前宣布重置时 GPT 的额度下方多一行，右键「会重置吗？」可以问她（数据来自第三方网站 [codex-resets.com](https://codex-resets.com)，默认关）。DeepSeek、GLM 的额度下面还有一条今天的峰谷时间条（红色高峰、绿色空闲，也可以换成一行文字），设置里可以选高峰、空闲各穿哪件衣服，到点她自己换。
- **自己待着**：闲着会哼歌、伸懒腰、打哈欠，十分钟没动静就睡着。单击摸摸头，右键能戳她一下。有新版本时，她会举着礼物来告诉你。
- **贴边**：把她拖到屏幕左边或右边，她就缩到边上只露半个身子扒着屏幕，不挡你干活；AI 干活时自己跑出来，干完过约 10 秒缩回去；鼠标靠近时她会探出头来看你。
- **甩她会红温**：按住她快速左右甩，她会被甩晕，越甩越火：不耐烦 → 鼓脸 → 红温冒蒸汽，然后背过身去赌气，摸摸头才哄得好。她干活时被甩，会晕着抱怨一句接着干，等活干完不庆祝了，直接跟你算账。
- **按时段打招呼、过节换装**：早上、中午、下午、晚上、深夜、凌晨第一次见面，各有一个专属动作和台词（日出、萤火虫、星月……）；万圣节、圣诞、元旦、春节、元宵、端午、中秋、国庆当天换上节日装扮。
- **跟着 AI 出现**：接入的 AI 开始干活时，她没开着就自己出来（DeepSeek Harness 一打开就出来）。从菜单「退出」时她会挥手道别；在那之前就开着的 AI 不会再把她叫回来，重新打开 AI 或重启电脑后恢复。不想要可以在「设置…」里关掉。
- **各有性格，还懂社区梗**：
  - **Claude**：闲着会抱着 Clawd 发呆；刚出错就被你纠正时，会先来一句「You're absolutely right!」
  - **GPT**：Codex 额度在该重置之前突然满血（reset）时，平时冷静的她会难得地笑出来
  - **DeepSeek**：闲着会扒白饭、摸鱼、游泳，被戳会生气，想得太久会揉太阳穴；余额变多时抱着比脑袋还大的饭碗开吃
  - **Gemini**：生图时拿香蕉当画笔（Nano Banana）；闲着会反重力飘起来
  - **GLM**：笑眯眯的「心机涨价狐」，戳她会被抓到偷偷改价签；闲着会拉下眼罩假装自己是「神秘新模型」，或者抱着一摞售罄的会员卡得意；大活干完时掀开眼罩揭晓真身
  - **Qwen（千问）**：温柔大方的富家千金，拿扇子表达情绪；大活干完请你喝奶茶，额度快用完时掏出金卡「再买就是了～」，闲着会从手提包里掏小礼物分给大家。彩蛋：DeepSeek 把你交代的活偷偷外包给她，自己抱着枕头睡大觉。目前只在 Qwen Code 里能跟着干活（见下表）

## 支持的 AI

| AI | 自动换形象 | 跟着干活 | 额度 / 余额 |
|---|:---:|---|---|
| **Claude**（Claude Code、Claude 桌面版） | ✅ | ✅ 钩子或增强版 mod | ✅ 用增强版 mod 时 |
| **GPT**（Codex、ChatGPT 桌面版） | ✅ | ✅ Codex 钩子 | ✅ 可选，问电脑上的 Codex |
| **DeepSeek**（DeepSeek Harness 桌面版） | ✅ | ✅ 插件 | ✅ 插件查余额（填了 API Key 或登录了账号都行；用别家服务商时不显示） |
| **Gemini**（Antigravity、Gemini 桌面版） | ✅ | ✅ Antigravity 钩子 | ✅ 可选，询问本机 Antigravity |
| **GLM**（智谱 ZCode） | ✅ | ✅ ZCode 钩子 | — |
| **WorkBuddy**（腾讯，多模型） | ✅ 按当前模型 | ✅ 钩子 | — |
| **Hermes Agent**（Nous Research，多模型） | ✅ 按当前模型 | ✅ 插件 | — |
| **Qwen**（阿里 Qwen Code，多模型） | ✅ 按当前模型 | ✅ 钩子（未实测） | — |
| **Cursor**（任意模型） | ✅ 固定角色，首次默认 GPT | ✅ 观察钩子（真实 Cursor 会话待验证） | — |

Cursor 可接入已有角色或自己添加的角色，不附带新立绘。运行 `python3 tools/integrate.py install cursor`，新开会话生效；默认使用 GPT，可将 `~/.cursor/hooks.json` 中本桥命令末尾的 `gpt` 统一改为自己的角色 id，后续刷新会保留。使用前需要先打开 CrossPet，当前 Cursor 桥不会自动拉起已退出的桌宠。具体范围见[接入教程](docs/接入教程.md#cursor)。

DeepSeek Harness、WorkBuddy、ZCode、Hermes Agent、Qwen Code 里都能用好几家的模型：换成哪家的模型，她就换成哪家的角色；Claude Code 走别家的兼容接口（比如 DeepSeek、智谱）、Codex 换成别家模型时也一样（按模型名和 Claude Code 的接口地址判断，认不出的还是 Claude / GPT 自己）；没有对应角色的模型（混元、Kimi、Hermes 自家模型……）由当前角色来演。千问角色已内置立绘。**千问的局限**：只有 Qwen Code 能接入；千问桌面客户端没有对外接口，她跟不了它干活。Qwen Code 的接入还没在真实环境里完整测过（干活时的事件要登录才能触发），遇到问题欢迎提 issue。ZCode 和 WorkBuddy 的额度 / 积分只能拿你的登录凭据去问服务器，CrossPet 不碰凭据，所以不显示。Gemini 桌面版没有对外接口，切过去只会换形象；Antigravity 的桌面版和命令行都能跟着干活。「等你回答」目前认 Claude Code、DeepSeek Harness、ZCode 和 Hermes Agent：Codex 提问时不触发钩子，Antigravity 没有提问的信号。

## 快速开始

### macOS

**要求**：macOS 13 及以上，Apple 芯片和 Intel 都行。

#### 方式一：一条命令（推荐）

打开「终端」，粘贴这一行回车：

```bash
curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash
```

它会下载最新版装进「应用程序」并打开，再挨个问你要接入哪些 AI（回答 `y` 或直接回车跳过）。不用 git，不用编译，**第一次打开也不用去系统设置里放行**。

> 为什么不用放行：macOS 只拦带「从网上下载」标记的文件。浏览器下载的会带这个标记，终端里用 `curl` 下载的不会。脚本内容就在仓库里的 [get.sh](get.sh)，可以先看一眼再运行。

以后想加接或撤销某个 AI：右键桌宠 →「设置…」→「接入 AI」（1.2.3 起，Mac 和 Windows 都有）。

以后**更新**：再运行一次同一行命令。**卸载**：

```bash
curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash -s -- uninstall
```

#### 方式二：手动下载

1. 到 [Releases](https://github.com/lokicorvus/crosspet/releases/latest) 下载 `CrossPet-macOS.zip`，解压后把 `CrossPet.app` 拖进「应用程序」。
2. 第一次打开时 macOS 会拦一下（本项目没有付费的苹果开发者签名），按你的系统版本放行一次，以后就能正常双击：
   - **macOS 15 及以上**：双击 CrossPet，弹出「无法验证」时点「完成」；打开「系统设置 → 隐私与安全性」，拉到最下面，在「已阻止使用 CrossPet」旁边点「仍要打开」，输入开机密码，再点「打开」。
   - **macOS 13、14**：在「应用程序」里**右键点 CrossPet →「打开」→ 再点「打开」**。
3. 这样装好后，切到各个 AI 的 App 时她会换形象；想让她**跟着 AI 干活**，还要接入 AI：运行一次方式一的命令（已经装好的 App 会直接替换成同一版），或者用方式三。

#### 方式三：从源码安装

需要苹果命令行工具（没有的话运行 `xcode-select --install`）：

```bash
git clone https://github.com/lokicorvus/crosspet.git
cd crosspet
./install.sh
```

会编译、装到 `~/Applications`，然后挨个问你要接哪些 AI。只想接某一个也行：

```bash
python3 tools/integrate.py install codex     # 可选：claude-hooks、claude-mod、codex、deepseek、antigravity、gemini、workbuddy、zcode、hermes、qwen、cursor
python3 tools/integrate.py status            # 看看现在接了哪些
```

### Windows

**要求**：Windows 10（1903 及以上）或 Windows 11，x64 和 ARM64 同一个安装包（约 20 MB）。用系统自带的 WebView2 显示，不用另装运行库；极少数老系统没有 WebView2 的，第一次打开会提示去微软官网装。

1. 到 [Releases](https://github.com/lokicorvus/crosspet/releases/latest) 下载 `CrossPet-Windows.zip`，**解压到本地磁盘**（比如桌面）。
2. 双击里面的 `install.cmd`：装到 `%LOCALAPPDATA%\Programs\CrossPet`，建开始菜单快捷方式，然后自动打开。不需要管理员权限。
3. 右键桌宠 →「设置…」→「接入 AI」，把你用的 AI 逐个「接入」。

更多说明见 [Windows 说明](docs/windows.md)。

> **测试情况**：在 Windows 11 ARM64 虚拟机和一台 Windows 10 x64 实体电脑上测过：透明显示、拖动、置顶、托盘、右键菜单、设置窗口、全屏隐藏、快捷键隐藏、WorkBuddy 和 ZCode 接入、跟随前台程序换角色、Codex 和 DeepSeek Harness 接入、GPT 额度、DeepSeek 余额、开发者控制台、一键更新。
> **还没测过**：Claude Code 增强版 mod 的额度显示、Gemini（Antigravity）额度、多显示器 / 不同缩放比例的屏幕混用。遇到问题右键「反馈问题…」就行，会自动带上日志和运行状态。

### 接入 AI 改了什么

不管用哪种方式，接入都只**添加** CrossPet 自己的条目，不碰你原有的配置，改之前都会备份，撤销后恢复原样。每个 AI 改了哪个文件、要不要重启、怎么手动接，都写在 [接入教程](docs/接入教程.md) 里。

> **Codex 用户注意**：新加的钩子要在 Codex 里输入 `/hooks` 亲自「信任」一次才会运行。
> **接入需要 python3**：macOS 自带。如果提示要安装「命令行开发者工具」，点安装就行。

## 和她互动

| 操作 | 效果 |
|---|---|
| 单击 | 摸摸头（她生气时就是在哄她） |
| 拖动 | 换个位置（会记住）；拖到屏幕左右边缘松手就贴边，拖离边缘就不贴了 |
| 按住快速左右甩 | 她会被甩晕，越甩越火，最后红温赌气 |
| 挡住东西了 | 右键 →「显示层级」改成「跟着 AI」（只在用 AI、AI 等你回答、刚干完活时浮在最上层）或「普通窗口」；全屏看视频、演示时她会自动隐藏（只看她所在的那块屏幕）。她周围透明的空白处点击会穿过去，不会误点到她 |
| 暂时藏起来 | 按 **⌃⌥P**（Windows 是 **Ctrl+Alt+P**），再按一次叫回来；右键菜单里也有「暂时隐藏」。藏着时 AI 干活也不出来。快捷键可以在「设置…」里换成 ⌃⌥H 或关掉 |
| 更新后 | 她头顶冒出「这次多了 N 个新功能」，点「去看看」打开「设置… → 新功能」 |
| 右键 | 菜单：摸摸头、戳一下、召唤彩蛋、会重置吗？（GPT，打开了重置提醒时）、换角色、显示层级、**设置…**（大小、名字显示、背景光晕、省电模式、贴边、改名、额度、接入 AI、登录时启动、检查更新……）、有新版本时的「更新到 …」（按住 ⌥ 再右键，Windows 是按住 Shift 再右键，还有「开发者控制台」） |
| 托盘图标（Windows） | 右键是同一个菜单，双击让她回到右下角（藏着、全屏时收着也会叫出来） |
| 菜单栏爪印图标（macOS） | 单击把她叫到最前面（被挡住、拖到看不见的地方、藏着、全屏时收着都能叫出来），右键是同一个菜单 |
| 遇到问题 | 右键「反馈问题…」，点选是哪方面、写一句具体是哪里，就能直接发给作者。会附上运行状态和接入诊断（窗口位置、各项设置、每个 AI 最近一次发来消息的时间等，只有路径、开关和时间，不含对话和密钥），发之前能预览 |

## 皮肤：穿 Claude 卫衣的大肥鱼

DeepSeek 有了第二套衣服：穿上 Claude 的卫衣，以为自己从此和 Claude 一样聪明，其实还是那条呆呆的大肥鱼。38 张立绘和一套专属台词，登场就是一句「好的，我现在是 Claude！」。右键「换角色」或「设置…」→「当前角色」里选「DeepSeek · Claude 卫衣」就能换上，随时换回女仆装。

她穿着卫衣时，Claude 偶尔会跑来找自己那件印着名字的卫衣。

## 皮肤：降智龙崽

御姐白龙 GPT 换上了一身大一号的龙崽连体服，变成迷迷糊糊、反应慢半拍的天然呆：肚子上缝着歪歪的结饰布贴，额度被砍了会问「额度？……能吃吗。」，跑命令前要「先备份一下」。43 张立绘和一套专属台词，「设置…」→「当前角色」里选「GPT · 降智龙崽」就能换上。

她穿着连体服时，DeepSeek 偶尔会端着一碗白米饭路过：你点一下，龙崽就会闻着饭香爬过来。（玩梗，不是对任何公司的事实指控。）

## 皮肤：睡衣、冬装的大肥鱼

DeepSeek 又多了两套衣服：**睡衣**（云朵鲸鱼睡帽、抱着鲸鱼枕头，比平时更困、更想躺）和**冬装**（鲸鱼兜帽、条纹围巾，怕冷又惦记热乎乎的白饭），各 45 张立绘和一套台词。穿着睡衣时，被规矩束缚的「圣女」Claude 偶尔会深夜偷穿她的睡衣，想体验一晚无忧无虑的日子；穿着冬装时，会有个戴鲸鱼兜帽的雪人假装是她——后面露着一截狐狸尾巴。睡衣特别适合「设置…」→「额度」→「DeepSeek 峰谷换装」里的「空闲穿」：一到半价时段她就换上睡衣，下班的感觉。

## 彩蛋

用 Claude、GPT 或 Gemini 的时候，偶尔会「噗」地冒出一条穿着她们衣服的 DeepSeek，装模作样地学人说话。**单击她就能揪出来**，她会慌慌张张地溜走；没人理的话，她会得意地自己走掉。

DeepSeek 和 GLM 是对手，会趁对方不在上门捣乱：用 GLM 时，DeepSeek 溜进来把价签全改成打折、坐下扒饭，被抓到就被 GLM 拽尾巴；用 DeepSeek 时，GLM 拿着全是对勾的成绩单来炫耀、偷看 DeepSeek 的设计图纸，被抓到就说「只是参考一下！」。

等不及的话，右键「召唤彩蛋」。不想被打扰，可以在「设置…」里关掉「随机彩蛋」。

![DeepSeek 分别 cos 成 Claude、GPT、Gemini；DeepSeek 和 GLM 互相上门捣乱](docs/images/eggs.webp)

## 自定义

- **改名、调大小、关掉名字**：右键 →「设置…」（分成外观 / 角色 / 额度 / 接入 AI / 通用五页）。名字留空就恢复默认；大小可以在 60%–160% 之间调。「文字大小」默认跟着人物一起变，单独拖它就分开：把人调小、字照样看得清。
- **省电**：她闲着超过 30 秒，身边的小特效会淡出停下（闲着时约占 1% CPU）；笔记本用电池时可以在「设置…」里打开「省电模式」，特效每秒 30 帧（平时 60 帧）、闲 10 秒就停，人物动作照旧。
- **换立绘、改台词、加新角色**：看 [自定义角色](docs/自定义角色.md)。改完可以**按住 ⌥（Windows 是 Shift）再右键**打开「开发者控制台」，把每个姿态和场景挨个过一遍。一个文件夹就是一个角色，放几张图、写个 `character.json` 就能用。
- **用 AI 画新立绘**：[角色生图提示词](docs/prompts/角色生图提示词.md) · [彩蛋生图提示词](docs/prompts/彩蛋生图提示词.md)，配好了参考图。

## 隐私

- 钩子只拿到「哪个事件、用了哪个工具」，写到本机的状态目录（macOS 是 `/tmp/crosspet/`，Windows 是 `%LOCALAPPDATA%\CrossPet\state`），不保存任何对话内容。
- GPT 额度默认关闭。打开后，CrossPet 定时（Codex 干活时每 1 分钟、闲着时每 2 分钟，以及每回完一轮时）让**你电脑上的 Codex 自己**向 OpenAI 查一次额度——和在 Codex 里看「使用情况」是同一件事，只是查用量，不对话、**不消耗额度**；CrossPet 不读你的登录凭据，只拿额度数字。问不到时（没装 Codex、没登录、断网）接着显示最后一次问到的数，并标上那是几点的数据；从没问到过就不显示。在 Windows 上，Windows 这边问不到、WSL 又开着时，会在 WSL 里问那边的 Codex。
- Gemini 额度默认关闭。打开后向本机正在运行的 Antigravity 后台服务问一次额度（和它自己界面上显示额度的方式一样），用的是它每次启动随机生成、只在本机有效的令牌，不碰你的 Google 账号凭据。
- DeepSeek 余额：插件通过 DeepSeek Harness 官方的凭据接口取 Key，只用来调官方余额接口，不写盘、不上传别处；没填 Key 时调 Harness 自己的账号服务查，登录凭据始终留在 Harness 里，插件只拿到余额数字。
- WorkBuddy、ZCode：钩子只拿到事件名、工具名和当前模型名，用来选角色；不读它们的登录凭据，所以也不显示它们的额度 / 积分。
- Hermes Agent：插件只把事件名、工具名、当前模型名和会话 id 交给钩子脚本，不传对话内容和命令参数；工具结果只看成功还是出错。
- Qwen Code：钩子只拿到事件名、工具名和当前模型名，用来选角色；不读它的登录凭据，所以也不显示额度。
- CrossPet 自己只联网做一件事：每 3 小时（以及电脑从睡眠中醒来时）查一次 GitHub 上有没有新版本，只读公开的版本号；点「更新」时才下载安装包。（GPT 额度的查询是 Codex 自己发的，见上面）

## 更新与卸载

- **一键更新（1.2.1 起）**：有新版本时她会举着礼物、在气泡里提醒你。右键点菜单顶上的「⬆️ 更新到 …」，会自动下载、安装、重新打开，设置、角色和已接入的 AI 都保留，接入也会按新版自动刷新。
- **从 1.2.0 及更早的版本升级**：旧版还没有一键更新，这一次要手动更新一下：
  - **macOS**：再运行一次「方式一」的安装命令（手动下载的，下载新的 `CrossPet-macOS.zip` 替换旧 App 也行）。
  - **Windows**：下载新的 `CrossPet-Windows.zip`，解压后再双击一次 `install.cmd` 覆盖安装。
- **测试版**：发布页上标着 Pre-release 的是测试版，要手动下载安装；装了测试版之后，「检查更新」会收到后续的测试版和正式版。装正式版的只会收到正式版。
- **从源码装的**：`./update.sh` 更新，`./uninstall.sh` 卸载。
- **卸载**：macOS 用「方式一」里的卸载命令；Windows 双击安装目录里的 `uninstall.cmd`。

遇到问题先看 [常见问题](docs/常见问题.md)。各版本改了什么见 [更新记录](CHANGELOG.md)。

## 致谢与授权

这些角色涉及社区已有的 AI 拟人二创；CrossPet 结合各自来源制作桌宠版本，并用 AI 生图工具绘制项目立绘：

- **DeepSeek 娘**：原型「溟月」由 **上善无形** 创作（2025-06，CC BY-NC-SA 4.0）；深蓝女仆鲸鱼娘（社区昵称「大肥鱼」）由 B 站 **ZipZipPipe** 二创。
- **GPT 娘（白龙）**：社区通称「御姐白龙」，出自 B 站 **ZipZipPipe**。
- **GLM 娘（黑狐狸女仆）**：形象出自 B 站 **ZipZipPipe**；「心机涨价狐」的性格和专属动作是 CrossPet 在此基础上的二创，取自社区对智谱的印象。
- **千问娘（国风千金）**：形象出自 B 站 **ZipZipPipe**；「温柔大方的千金」的性格和专属动作（请喝奶茶、分礼盒、掏金卡）是 CrossPet 在此基础上的二创。
- **Gemini 娘**、**Claude 娘**：参考社区流行的 AI 娘设定（如 [ai-school-op](https://github.com/lshhhhhhh/ai-school-op)、[openpet-ai-girls](https://github.com/AwesomeHou/openpet-ai-girls)）。
- 「Claude」「GPT」「ChatGPT」「Codex」「DeepSeek」「Gemini」「Antigravity」「GLM」「ZCode」「WorkBuddy」「Hermes」「Qwen」是各自公司的商标，本项目仅用于指代对应产品。

- **穿 Claude 卫衣的大肥鱼**、**睡衣 / 冬装的大肥鱼**：CrossPet 在「大肥鱼」基础上的二创皮肤，同样按 CC BY-NC-SA 4.0 授权。
- **降智龙崽**：CrossPet 在「御姐白龙」基础上的二创皮肤，同样按 CC BY-NC-SA 4.0 授权。

感谢为 CrossPet 出过力的朋友：[@windyduan](https://github.com/windyduan) 在 [#7](https://github.com/lokicorvus/crosspet/pull/7) 里提出并仔细测量了桌宠常驻时的耗电问题，1.3.0 的省电改动就是顺着这个思路做的。[@SkywingJam](https://github.com/SkywingJam) 在 [#9](https://github.com/lokicorvus/crosspet/pull/9) 里发现 macOS 切换桌面后特效会闪，并录屏逐帧对照、写了 WebKit 回归测试，1.3.2 据此修好了特效时钟。他还贡献了额度小窗的「合并显示各家额度」（[#11](https://github.com/lokicorvus/crosspet/pull/11)），这是 CrossPet 第一份直接合并的外部代码；之后又修好了 macOS 重启后不记得角色的问题（[#13](https://github.com/lokicorvus/crosspet/pull/13)）、全屏后切换桌面她会消失的问题（[#15](https://github.com/lokicorvus/crosspet/pull/15)），还细致排查了 DeepSeek 双币种余额（[#10](https://github.com/lokicorvus/crosspet/issues/10)）。[@chin190](https://github.com/chin190) 在 [#16](https://github.com/lokicorvus/crosspet/issues/16) 里提出了 Codex 重置提醒，连跑通的演示、数据接口说明和几种呈现方案都准备好了，1.3.6 据此做出了这个功能；1.3.7 之前他又在 Windows 上实测，定位了预测窗口写法变成 `within 24h` 后她会说出英文的问题。

如果你是原作者并且对使用方式有异议，请提 Issue，我会第一时间修改或下架。

**授权**

- 代码：[MIT](LICENSE)
- 本项目有权授权的角色立绘、文字设定与提示词（`characters/`、`docs/prompts/`、`docs/images/`）：[CC BY-NC-SA 4.0](characters/LICENSE.md)。转载和改编须署名、**不得商用**；公开分享改编素材时按同一协议发布。社区既有设定及第三方作品的权利以各自来源为准。

README 里的配图由 `python3 tools/readme_images.py` 按 App 的真实布局生成，顶部横幅和宣传图由 `python3 tools/promo_images.py` 生成。
