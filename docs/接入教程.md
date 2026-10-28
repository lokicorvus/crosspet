# 接入教程

CrossPet 本身只是一个会读状态文件的小窗。要让它跟着 AI 动，需要在各个 AI 那边装一个「通知」：AI 每做一步，就往 `/tmp/crosspet/` 写一个小文件，桌宠读到就换动作。

每个 AI 都有两种接法：

- **自动**：README「方式一」的一条命令（`curl … get.sh | bash`）或源码里的 `./install.sh` 都会挨个问你；也可以单独运行下面每节里的那条命令（需要先克隆仓库）。
- **手动**：按每节里的步骤自己改配置文件。

查看现在接了哪些：

```bash
python3 tools/integrate.py status
```

> 自动接入只会**添加** CrossPet 自己的条目，不动你原有的配置；改动前会把原文件备份成 `<文件名>.bak-crosspet-<时间>`。撤销用 `uninstall` 代替 `install`。

下文的 `crosspet-hook.py` 指 `~/Library/Application Support/CrossPet/crosspet-hook.py`，CrossPet 第一次启动时会自动放好。

---

## Cursor

```bash
python3 tools/integrate.py install cursor
```

- 写入 `~/.cursor/hooks.json`，保留其它工具的钩子和个人设置。桥只观察事件并写本地状态，不修改提示词、工具返回或模型选择。
- 按每条事件里的模型换角色：Claude 模型演 Claude、GPT 演 GPT、Gemini、Grok、DeepSeek、GLM、千问同理，规则和其他多模型宿主一样；每个对话各算各的，切回 Cursor 窗口时按它最近用的模型换。Cursor 自家的 Composer、Auto 这类认不出的模型由当前角色来演；想让它们固定由某个角色来演，在各条 `crosspet-cursor-bridge.py` 命令末尾统一加上角色文件夹 id（例如 `grok`）。
- 重复接入、更新或 `refresh` 保留已有一致的角色参数，清理退役事件中的本桥旧条目，避免重复安装。若多条命令的角色 id 不一致或命令含无法识别的自定义参数，会保留整个原配置并提示原因，请先统一后再更新。
- 钩子在新开的 Cursor 会话中生效。每条观察钩子的 `timeout` 为 2 秒、`failClosed` 为 `false`；接入没有阻止 AI 工作的输出。
- **使用前需要先打开 CrossPet**。当前桥不自动拉起已退出的桌宠。没有显示 Cursor 额度，也没有真实 Cursor 会话或 GUI 自动出现的通过结论；自动化回归只验证钩子输入、状态文件和安装配置处理。
- Windows 使用随包 Python 和数据目录中的桥副本，接入工具自动转换路径；macOS 使用系统 `python3` 和 `~/Library/Application Support/CrossPet/crosspet-cursor-bridge.py`。已安装的桥随更新刷新，不给未接入用户创建副本。

## Grok Build

```bash
python3 tools/integrate.py install grok
```

- 写入 `~/.grok/hooks/crosspet.json`（CrossPet 单独占这一个文件，撤销时直接删掉，你自己的钩子文件不动）。格式和 Claude Code 的钩子一样，事件带 `GROK_HOOK_EVENT` 环境变量。
- Grok Build 的事件里没有模型名，所以一律由 Grok 来演。
- **在一个文件夹里第一次用时，要先在 Grok 里用 `/hooks-trust`（或启动时加 `--trust`）信任这个文件夹**，之前连个人钩子都不跑；`grok -p` 无界面运行时当作已信任。
- Grok Build 也会读 `~/.claude/settings.json` 里的钩子：只接了 Claude 标准钩子的话，Grok 干活时由 Grok 来演，不会当成 Claude；两边都接了，Claude 那份被 Grok 触发时会自动跳过，不会演两遍。Cursor 的钩子（`~/.cursor/hooks.json` 里的本桥条目）Grok 目前不执行，不会串。
- 不显示额度：Grok 的额度只在它自己的 `/usage` 窗口里，要拿登录凭据去问服务器，CrossPet 不碰凭据。

---

## Claude

Claude 有两种接法，二选一：

| | 标准钩子 | 增强版 mod |
|---|---|---|
| 要求 | 任意版本的 Claude Code | 终端里的 Claude Code **2.1.287 以上**（桌面 App 自带的从 2.1.286 起）；公司 / 组织账号被管理员禁了自己装的 mod、或者在 WSL 里用时不会运行 |
| 跟随工作状态 | ✅ | ✅ |
| 显示额度（5 小时 / 每周） | ❌ | ✅ |
| 识别「被打断」 | ❌ | ✅ |

两种都对 Claude Code 命令行和 Claude 桌面版的 Code 页有效。

### 标准钩子

```bash
python3 tools/integrate.py install claude-hooks
```

手动：把 [`integrations/claude-code/hooks.json`](../integrations/claude-code/hooks.json) 里 `hooks` 下的每个事件，追加到 `~/.claude/settings.json` 的 `hooks` 里。新开的会话生效。

### 增强版 mod

```bash
python3 tools/integrate.py install claude-mod
```

手动：
1. 把 [`integrations/claude-code/mod`](../integrations/claude-code/mod) 整个文件夹复制到 `~/.claude/mods/crosspet`。
2. 在 `~/.claude/settings.json` 里加：
   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/crosspet" } }
   ```
   已经有别的路径的话，用冒号 `:` 接在后面。
3. 新开的会话生效。

**装了不起作用？**
- 在终端里运行 `claude --version`，低于 2.1.287 的先更新 Claude Code（2.1.287 之前 mod 还是「早期体验」，要手动打开开关才加载）。接入时 CrossPet 也会检查并提示。
- 在 Claude Code 里输入 `/plugin`，标签下面那行会写「N mods active」和名字；没有 `crosspet` 的话，可能是组织策略禁止了自己装的 mod（`allowManagedModsOnly`），或者设了 `disableAllHooks`。
- 这些情况下改用标准钩子就好：所有版本都能用，只是不显示额度。

---

## GPT（Codex）

```bash
python3 tools/integrate.py install codex
```

手动：把 [`integrations/codex/hooks.json`](../integrations/codex/hooks.json) 合并进 `~/.codex/hooks.json`（没有这个文件就直接复制过去）。

**还要做一步**：Codex 的安全机制要求新加的钩子必须你亲自审查并信任才会运行。下次打开 Codex 时：

- 弹出钩子审查提示的话，确认命令是 `python3 …/crosspet-hook.py gpt`，点「信任」；
- 没弹的话，在 Codex 里输入 `/hooks` 找到它们手动信任。

Codex 命令行和 ChatGPT 桌面版里的 Codex 都有效。画图（`image_gen`）时桌宠会切到「画画」。

### 显示 GPT 额度（可选）

右键桌宠 →「设置…」→ 打开「显示 GPT 额度」。

额度数字来自 Codex（App / CLI）的会话记录，只有用 Codex 时才会更新。在别的程序里用 ChatGPT 订阅（比如 DeepSeek Harness 接的 OpenAI）用掉的额度这里看不到，这种情况建议关掉这一项。

Codex 每次回复后会把额度用量记进 `~/.codex/sessions/` 的会话记录。Plus 等有 5 小时额度的账号会显示两行（`5小时 剩余 …`、`本周 剩余 …`），只有每周额度的就一行。勾选后 CrossPet 每分钟读最新那条，**只提取额度数字**（几个窗口各用了百分之多少、什么时候重置），不读也不保存对话内容。默认关闭。

---

## DeepSeek（DeepSeek Harness 桌面版）

装一个 DeepSeek Harness 插件，同时提供工作状态和余额：

```bash
python3 tools/integrate.py install deepseek
```

然后**完全退出（⌘Q）再打开 DeepSeek Harness**。

插件做的事：

- 监听 Harness 的工作事件（收到消息、调工具、子任务、一轮结束），写 `/tmp/crosspet/deepseek-state.json`；
- Harness 里切到别家模型时跟着换角色：按会话实际在用的模型名 / provider 名认（含 gpt、codex、openai → GPT；claude、anthropic → Claude；gemini、google → Gemini；认不出的算 DeepSeek），这时工作状态写到对应角色名下，比如 `gpt-state.json`。切到 Harness 窗口时，桌宠也换成当前模型的角色；
- 通过 DeepSeek Harness 官方的凭据接口拿到你已经配置好的 API Key（或用你登录的账号），在启动、发消息、一轮结束时（30 秒内只查一次）和每分钟定时调一次官方余额接口，写 `/tmp/crosspet/deepseek-quota.json`。只是要一次账户余额，不消耗 token。Key 只在内存里用，不写盘、不打日志。定时查的间隔可以在插件配置的 `balanceIntervalMs` 里改（毫秒，默认 `60000`）；写 `0` 就不定时查，只在启动、发消息、一轮结束时查，适合 Harness 常开、人又常不在的电脑；
- 账户里同时有人民币和美元时两种都显示（`余额 ¥10.00｜$4.97`）；所有币种都低于门槛（¥5、$0.7）时桌宠会喊饿。门槛可以在插件配置的 `lowBalance` 里改：写一个数是人民币门槛，按币种写成 `{ "CNY": 10, "USD": 1.5 }`。

手动安装：

1. 把 [`integrations/deepseek/dsh-plugin-crosspet`](../integrations/deepseek/dsh-plugin-crosspet) 复制到一个固定位置，比如 `~/Library/Application Support/CrossPet/dsh-plugin-crosspet`。
2. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里加：
   ```json
   "@local/dsh-plugin-crosspet": "link:/Users/<你>/Library/Application Support/CrossPet/dsh-plugin-crosspet"
   ```
3. 建一个软链接：
   ```bash
   mkdir -p ~/.dsh/profiles/desktop/node_modules/@local
   ln -s "$HOME/Library/Application Support/CrossPet/dsh-plugin-crosspet" ~/.dsh/profiles/desktop/node_modules/@local/dsh-plugin-crosspet
   ```
4. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加：
   ```yaml
   - insert:
       - id: crosspet
         name: '@local/dsh-plugin-crosspet'
   ```
5. ⌘Q 退出再打开 DeepSeek Harness。

> 另有一种不装插件的接法：用 DeepSeek Harness 自带的 `@deepseek-ai/dsh-hooks-claude-code` 运行 [`integrations/deepseek/hooks/hooks.json`](../integrations/deepseek/hooks/hooks.json)。它只有工作状态、没有余额；钩子跑在沙箱里，只能写 `/tmp`。一般用插件就好。

---

## Gemini（Antigravity）

切到 **Antigravity** 或 Gemini 桌面 App 时，桌宠都会换成 Gemini。

### Antigravity（推荐）

Antigravity 2.0 起有官方钩子，桌面版和 Antigravity CLI 共用一份配置：

```bash
python3 tools/integrate.py install antigravity
```

然后重开 Antigravity。之后它思考、读文件、改代码、跑命令、查资料、生图、出错、完成，桌宠都会跟着动。

手动：把 [`integrations/antigravity/hooks.json`](../integrations/antigravity/hooks.json) 里的 `"crosspet"` 这一项，加进 `~/.gemini/config/hooks.json`（没有这个文件就直接复制过去）。只想在某个项目里生效的话，放到项目的 `.agents/hooks.json`。格式说明见 [官方文档](https://antigravity.google/docs/hooks/)。

> 几点说明：
> - Antigravity 的钩子事件里不带事件名，所以命令最后多写了一个事件名参数（`… gemini PostToolUse`）。
> - `PreInvocation`、`Stop` 要用「扁平」写法（处理程序直接放进列表），`PostToolUse` 才要套 `matcher` + `hooks`，写错了 Antigravity 会整份忽略。
> - CrossPet 故意不挂 `PreToolUse`：Antigravity 要求这个钩子回答「放行 / 拦截」，会干扰正常的权限确认。所以动作在工具跑完时才出现，比 Claude、Codex 晚一点点。
> - 钩子没生效时看 `~/Library/Logs/Antigravity/language_server.log` 里有没有 `hooks.json` 的报错。

### 显示 Gemini 额度（可选）

右键桌宠 →「设置…」→ 打开「显示 Gemini 额度」。需要 Antigravity 开着。

Antigravity 在本机跑着一个后台服务，它自己的界面就是向这个服务要额度的。勾选后 CrossPet 每分钟做同样的事：从这个服务的启动参数里拿到本机接口用的令牌（每次启动随机生成、只在本机有效，不是账号凭据），只问一次「用户状态」、只取额度数字。令牌只在内存里用，不存盘、不外传。

Antigravity 的额度按「额度池」共享，比如所有 Gemini 模型一个池、Claude 和 GPT-OSS 一个池，所以会显示成 `Gemini 剩余 91% · 10/12 重置 ｜ Claude/GPT-OSS 剩余 100%`。24 小时内重置的显示时刻，更远的显示日期，免费版和会员都适用。

> 这个接口不是官方公开的，Antigravity 更新后可能会变，到时候额度会不显示，但不影响桌宠的其他功能。

### Gemini 桌面 App

官方桌面 App 没有对外接口，只能在你切到它时换成 Gemini 的形象，让她待机和响应点击。

### Gemini CLI

```bash
python3 tools/integrate.py install gemini
```

手动：把 [`integrations/gemini/hooks.json`](../integrations/gemini/hooks.json) 合并进 `~/.gemini/settings.json` 的 `hooks`。Gemini CLI 正在被 Antigravity CLI 取代，新用户直接接 Antigravity 就好。

---

## GLM（智谱 ZCode）

```bash
python3 tools/integrate.py install zcode
```

或者右键桌宠 →「设置…」→「接入 AI」→ ZCode。

- 写进 `~/.zcode/cli/config.json` 的 `hooks`（打开 `hooks.enabled`，事件放在 `hooks.events` 下）。原来就关着的总开关，撤销时会关回去。
- ZCode 只在会话开始时告诉钩子用的是哪个模型，CrossPet 按会话记住：用 GLM 时是 GLM 角色，自己填 Key 用别家模型时换成对应角色。还没对话过时，切到 ZCode 先当 GLM。
- 要你批准某个操作时，她会切到「等你回答」。
- **新开的 ZCode 会话生效**（配置是会话开始时读的）。
- 额度不显示：ZCode 的额度只能拿你的智谱账号凭据去问服务器，CrossPet 不碰凭据。

---

## WorkBuddy（腾讯）

```bash
python3 tools/integrate.py install workbuddy
```

或者右键桌宠 →「设置…」→「接入 AI」→ WorkBuddy。

- 桌面版里跑的是 CodeBuddy 的智能体，钩子格式和 Claude Code 一样。写进 WorkBuddy 自己的配置目录里的 `settings.json`：国际版是 `~/.workbuddy-ai`，国内版是 `~/.workbuddy`（两个都会找；专享版可以用环境变量 `WORKBUDDY_CONFIG_DIR` 指定）。
- 每条事件都带当前模型名：GPT / Claude / Gemini / DeepSeek / GLM 换成对应角色，混元、Kimi、Grok 等没有角色的模型由当前角色来演。切到 WorkBuddy 窗口时按它当前的模型换。
- 换模型后要发出消息才会切换：钩子在智能体真正开始处理消息时才触发（WorkBuddy 会先检查登录、连接 MCP 工具）。
- **完全退出再打开 WorkBuddy 生效**（Windows 上托盘图标也要退出）。
- 积分不显示：只能拿你的登录凭据去问腾讯服务器，CrossPet 不碰凭据。

---

## Qwen（阿里 Qwen Code）

> 只支持 Qwen Code（命令行）。千问桌面客户端没有对外接口，桌宠跟不了它干活。这项接入还没在真实环境里完整测过（实测过没登录时的会话开始事件，干活时的事件要登录才能触发），遇到问题欢迎提 issue。

```bash
python3 tools/integrate.py install qwen
```

或者右键桌宠 →「设置…」→「接入 AI」→ Qwen Code。

- 写进 `~/.qwen/settings.json` 的 `hooks`。Qwen Code 的钩子格式和 **Claude Code 一样**（要写 `type: "command"`，`matcher` 认 `*` / `.*`），不是它上游 Gemini CLI 的那一套；`timeout` 的单位也跟着 Claude Code 是**秒**。
- 只有会话开始时的事件带当前模型名（`SessionStart` 的 `model` 字段），CrossPet 按会话记住：用千问自家的模型时是 Qwen 角色，在 Qwen Code 里配了别家 `modelProviders` 时换成对应角色，认不出的由当前角色来演。终端里收到 Qwen Code 的工作事件时会跟着换角色。
- **新开的 Qwen Code 会话生效**（钩子在会话开始时读配置）。
- 额度不显示：只能拿你的阿里云账号凭据去问服务器，CrossPet 不碰凭据。
- **使用千问模型时自动切换为千问角色**（立绘见 `characters/qwen/`）。

---

## 自己接别的 AI

只要那个 AI 能在工作时运行一条命令，就能接：

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash"}' | python3 crosspet-hook.py <角色id>
```

`crosspet-hook.py` 认得 Claude Code / Codex / Gemini CLI / Antigravity / Qwen Code 的事件名；事件 JSON 里没有 `hook_event_name` 的话，可以把事件名作为第二个参数传进去。或者你也可以直接写 `/tmp/crosspet/<角色id>-state.json`：

```json
{ "pose": "reading", "event": "PreToolUse", "tool": "read_file", "ts": 1791000000 }
```

`pose` 可用的值见 [自定义角色](自定义角色.md#姿态)。额度写 `/tmp/crosspet/<角色id>-quota.json`：`{ "text": "余额 ¥6.29", "low": false }`。
