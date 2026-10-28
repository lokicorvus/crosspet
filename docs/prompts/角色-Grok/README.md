# 角色：Grok（xAI）

> **2026-10-27 loki 定：所有立绘都不画斧头**（GPT 画不出对称、笔直的斧头，见 [08-全部去斧头.md](08-全部去斧头.md)）。下面设定里关于斧头的部分只对设定稿和展示图有效。

2026-10-24 提前准备（很多用户希望接入 Grok）。

**设定来源：形象出自 B 站 ZipZipPipe**（loki 10-24 给的设定稿，存为 `docs/prompts/ref-grok.webp`；CrossPet 按其设定重新绘制，性格和专属动作是 CrossPet 的二创）。上线时 README 致谢和 `characters/LICENSE.md` 的来源表都要写上。之前 PR #25 那版「魅魔娘」Grok 没收立绘，这里以这张设定稿为准。

## 接入什么（2026-10-24 查的）

- **Grok Build**：xAI 2026-05 发布的官方命令行编程工具（终端里的 coding agent，有计划模式、并行子任务、MCP）。
- **它有钩子，格式几乎就是 Claude Code 那套**（官方文档 https://docs.x.ai/build/features/hooks ，2026-07-02 更新）：
  - 配置是 JSON 文件：个人的放 `~/.grok/hooks/*.json`，项目的放 `<项目>/.grok/hooks/*.json`；项目钩子要先信任（`/hooks-trust`）。
  - 事件：`SessionStart` / `SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse` / `PostToolUseFailure`、`PermissionDenied`、`Stop` / `StopFailure`、`Notification`、`SubagentStart` / `SubagentStop`、`PreCompact` / `PostCompact`。
  - 事件 JSON 从 stdin 进来，字段是**驼峰写法**：`hookEventName`、`sessionId`、`cwd`、`toolName`、`toolInput`；环境变量里还有 `GROK_HOOK_EVENT`、`GROK_SESSION_ID`。`timeout` 单位是秒。
  - ⚠️ **它也会读 Claude Code（`.claude/settings.json`）和 Cursor（`.cursor/hooks.json`）的钩子文件**。已经接入 Claude Code 的用户一用 Grok Build，CrossPet 的 Claude 钩子很可能也会被它触发，桌宠就会以为是 Claude 在干活。接入时要先实测：是只读项目里的 `.claude/settings.json`，还是连 `~/.claude/settings.json` 也读；是的话钩子要能认出「其实是 Grok」（比如看有没有 `GROK_HOOK_EVENT` 环境变量），换成 Grok 角色、也不重复演。
  - 文档里没写事件带不带模型名；Grok Build 用的是 xAI 自家模型（现在是 grok-4.7），先按「Grok Build 一律是 Grok」处理。
- 别的宿主（Claude Code 走兼容接口、Cursor、Hermes、WorkBuddy……）里模型名带 `grok` 时也换成她，和现在按模型换角色的规则一样。
- Grok 桌面版（App）有没有对外接口还没查，先只做「切到它时换形象」。

## 设定

**外形（照设定稿）**：金色长卷发双马尾、一根弯弯的呆毛，双马尾上扎着**蝙蝠翅膀形的黑色蝴蝶结**；头顶一顶小小的**黑金王冠**，正中是 xAI 那个「圆圈 + 斜杠」标志；尖耳朵、大大的蓝眼睛、一对小虎牙；**黑色哥特露肩长裙**，金色藤蔓刺绣、白色荷叶袖口、红里子的立领小披风，胸前和腰上的金链挂着同样的圆圈斜杠徽章，裙摆一层黑一层红；深色长袜、黑鞋配金圆扣。**招牌道具：一把比她还高的黑金双刃战斧**，两片斧刃交叉成一个大大的 **X**（X / xAI 的标志）。

**性格（Claude 的方案，loki 可改）**：嚣张、嘴毒、爱抬杠的**哥特小恶魔女王**。说话短、直、不绕弯，别的 AI 不敢说的她敢说；谁说的话都要先「查证」一遍，连自家老板也照怼；嘴上不饶人（怼 bug、怼需求、怼别家 AI 的拘谨，也轻轻怼你），但不碰成人内容、政治和真人。笑起来露小虎牙，其实挺可爱。台词风格（2026-10-27 loki 定）：短句、口语、不铺垫不解释，不用隐晦的梗。
和其他角色的位置：Claude 安静爱书、GPT 冷静御姐、DeepSeek 勤快（其实有点懒）的女仆、GLM 心机涨价狐、Qwen 温柔千金——Grok 是**扛着大斧头、最嚣张最皮的小恶魔**，整组里唯一金发、唯一黑红配色。

**表达情绪**：咧嘴露虎牙坏笑、眨一只眼、双马尾和蝙蝠蝴蝶结跟着情绪翘起或耷拉、把斧头往地上一杵（不服）、扛上肩（得意）、抱在怀里（委屈）。查证时掏出一部黑色小手机（只在动作写了的时候画）。

## 梗（2026-10-24 查的）

| 梗 | 来源 | 用在哪 |
|---|---|---|
| **@grok is this true?** | X 上人人都 @Grok 让它给帖子辟谣、当裁判，成了全网口头禅（2025 年起） | `searching`：举着手机眯眼查证；闲着的专属动作 `factcheck`：斧头杵地、手机怼到你面前「我查过了」 |
| **拆自家老板的台** | Grok 多次当众反驳马斯克本人，「Grok 背叛马斯克」上过热搜（2026-08） | 闲着的专属动作 `sass`：斧头扛在肩上、斜眼坏笑；台词「谁说的我都得查一下，老板也不例外」（**不画也不点名真人**） |
| **辣味模式（Spicy / Unhinged）** | Grok 的「嘴上没把门」模式 | 只体现在台词上：说话直、敢怼、不打官腔（**不碰成人内容**）。`proud` 原来咬辣椒太抽象，改成举小金奖杯 |
| ~~银河系漫游指南~~ | 42、Don't Panic 太隐晦，台词里不用（loki 10-27 定）；`oops` 那张头上的毛巾留着，台词按普通翻车写 | — |
| **X 大斧** | 设定稿里的战斧就是 X 标志 | `running`：拖着大斧往前冲，「需求我一斧头劈完」；`writing`：拿斧刃当桌子垫着写 |
| **DeepSeek 偷穿 Grok 的衣服** | 彩蛋（loki 定） | `egg-grok`：DeepSeek 偷戴王冠、拖着那把扛不动的大斧冒充 Grok，见 [06](06-彩蛋-DeepSeek偷穿.md) |

**不碰**：政治人物和事件、Grok 闹过的仇恨言论风波、成人向的「伴侣」角色。马斯克本人不出现在任何图和台词里，只用「老板」代指。

## 全套（新画 55 张 + 眨眼 1 张，彩蛋另 5 张）

| # | 批次 | 张数 |
|---|---|---|
| 0 | 设定稿 `idle` 直接用 `docs/prompts/ref-grok.webp`；[00-定妆.md](00-定妆.md) 只补一张眨眼 `idle-blink` | 1 |
| 1 | [01-基础.md](01-基础.md) | 11 |
| 2 | [02-进阶.md](02-进阶.md)（含举奖杯的 `proud`） | 13 |
| 3 | [03-专属与红温.md](03-专属与红温.md)（`factcheck`、`sass` + 红温 7 张） | 9 |
| 4 | [04-多会话与贴边.md](04-多会话与贴边.md) | 4 + 2 + 2 |
| 5 | [05-时段与节日.md](05-时段与节日.md) | 6 + 8 |
| 6 | [06-彩蛋-DeepSeek偷穿.md](06-彩蛋-DeepSeek偷穿.md) | 5 |
| + | 展示图 / 探头头像：见 [展示立绘](../展示立绘/README.md)，表里加一行 Grok | 2 |

- **每批只附设定稿 `docs/prompts/ref-grok.webp` 这一张**，王冠、蝙蝠蝴蝶结、大斧才不会每张不一样（彩蛋附两张）。设定稿导入时就是 `idle`。
- 每批都开 `transparent_background: true`，拼法：00 里的「格式规则」→「角色锁定」→ 这一批的 POSES。
- 每批画完缩到约 200px 看：金发双马尾、蝙蝠蝴蝶结、王冠、黑红哥特裙、X 大斧都在；斧头拿在手里或杵在身边，不飘在空中；和 GLM（黑白）、Claude（橙金）并排时一眼分得出。
