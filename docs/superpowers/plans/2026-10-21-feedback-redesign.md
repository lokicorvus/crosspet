# 反馈功能重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 反馈窗口改成「选现象 → 补一个 → 还在吗 → 一句话」，每份反馈只附这一类排查用得上的信息；为此先建五样记录（Mac 运行日志、钩子事件记录、桌宠处理记录、换角色记录、网页自报）。

**Architecture:** 记录各由产生它的一方写（钩子 / 插件写事件记录，外壳写桌宠处理记录和换角色记录，网页在内存里记自己的判断）。反馈时网页按类型向外壳要「原始段落」，选哪些段、怎么筛日志、怎么排版、超长怎么缩，全在网页层一个纯函数模块里（`docs/架构.md`：判断只写一份）。

**Tech Stack:** Python 3（钩子）、Node ESM（DeepSeek Harness 插件）、TypeScript（Claude Code mod）、Swift / AppKit + WKWebView（Mac）、C# / WPF + WebView2 / net48（Windows）、原生 JS 网页、node:test、python unittest、Windows LogicTests（net8）。

**Spec:** `docs/superpowers/specs/2026-10-21-feedback-redesign-design.md`

## Global Constraints

- 在 `dev` 分支做；只 `git add` 自己改的文件，提交前看 `git diff --cached --stat`；不推送、不发版
- 任何记录、任何反馈段落都**不得**出现：prompt、tool_input、tool_response、last_assistant_message、对话记录路径、工作目录、API Key、令牌、账号、邮箱；路径里的用户名隐去（沿用两端现有 redact）
- 记录只留最近 200 行；超过 240 行时一次截回 200 行（不必每次写都重写文件）
- 钩子事件记录放 **数据目录** 下 `events/<接入名>.jsonl`；接入名只用：`codex`、`claude-hooks`、`claude-mod`、`deepseek`、`antigravity`、`gemini`、`qwen`、`workbuddy`、`zcode`、`hermes`
- 桌宠处理记录 `events/pet.jsonl`、换角色记录 `switches.jsonl`，都在数据目录
- 数据目录：Mac `~/Library/Application Support/CrossPet`，Windows `%LOCALAPPDATA%\CrossPet`（设了 `CROSSPET_DATA_DIR` 就用它）
- Mac 运行日志 `~/Library/Logs/CrossPet.log`，超过 1 MB 删掉重来（和 Windows `windows.log` 同一规则）
- 飞书单条消息 ≤ 19000 字节；缩减顺序：先相关日志，再记录条数（保留最新），开头和用户写的话不缩
- 写记录失败一律吞掉，不能影响钩子 / 插件 / 外壳本身
- 九个类型 id：`gone` `action` `character` `quota` `display` `update` `perf` `idea` `other`（文案见 spec 第一节表格，原样照抄）
- 反馈窗口顶上那条「CrossPet 由我一人……优先处理。」说明原样保留

## Review Focus

1. **带敏感内容的事件**（prompt 里有密钥、tool_input 里有文件内容）：记录里绝不能出现——Task 1、2 的测试构造这种事件，断言记录文件里搜不到那些字符串
2. **多个钩子进程同时写同一份记录**（好几个会话一起干活）：每行都是完整 JSON、不交错——Task 1 测试并发写 20 次后逐行能解析
3. **某家没有事件记录**（插件早于 1.3.8 / 从没收到）：反馈写明是哪一种，而不是空白——Task 5 测试
4. **段落很长**（日志几千行、诊断很长）：卡片 ≤ 19000 字节，开头和用户的话完整——Task 5 测试
5. **桌宠网页冻住、不回应**：反馈窗口不能卡住，网页自报那段写「网页没有回应」——Task 7、8 的取数设 2 秒超时，Task 6 用假数据验证显示

---

### Task 1: 钩子事件记录（crosspet-hook.py）

**Files:**
- Modify: `integrations/crosspet-hook.py`
- Test: `tests/hook_ledger_test.py`（新建，跑法同 `tests/codex_turn_test.py`：子进程调钩子，`CROSSPET_STATE_DIR` / `CROSSPET_DATA_DIR` 指到临时目录）

**Interfaces:**
- Produces（记录行格式，Task 2、3、5 都照它）：每行一个 JSON 对象
  `{"t": 1792571450.12, "ev": "PreToolUse", "tool": "bash", "sid": "a1b2c3", "turn": true, "result": "shown", "detail": "gpt running"}`
  - `t` 秒（保留 2 位小数）；`tool` 只有工具名，小写，没有就 `""`；`sid` = `sha1(session_id)` 前 6 位，没有会话就 `""`；`turn` 事件带不带 turn_id
  - `result` ∈ `shown` / `dropped` / `error`；`detail`：shown 时 `"<角色> <姿态>"`，dropped 时规则名，error 时异常类名
  - 丢弃规则名：`codex-memory`（工作目录在 Codex 配置目录里）、`codex-suggestion`（对话记录文件不存在）、`turn-finished`（轮次已结束）、`unknown-event`（认得的事件但这次不演，即走到最后 pose 为空且不是 SessionEnd）、`bad-json`（读不出事件）
- Produces（Python 内部）：`integration_name(argv: list[str]) -> str`——`claude`→`claude-hooks`，`gpt`→`codex`，`gemini` 且带第二个参数→`antigravity`，其余原样（`gemini` `qwen` `workbuddy` `zcode` `hermes` `deepseek`）；`ledger(result: str, detail: str) -> None`

- [ ] **Step 1: 写失败的测试** `tests/hook_ledger_test.py`，至少这些：
  - `test_shown_event_is_recorded`：发 `UserPromptSubmit`（host `gpt`，带存在的 transcript 文件）→ `events/codex.jsonl` 最后一行 `result == "shown"`、`detail` 以 `"gpt "` 开头、`ev == "UserPromptSubmit"`
  - `test_drop_rules_named`：分别构造 cwd 在 `CODEX_HOME` 下、transcript 指向不存在的文件、Stop 之后的同轮迟到事件 → 最后一行 `detail` 依次为 `codex-memory`、`codex-suggestion`、`turn-finished`
  - `test_bad_json`：stdin 写 `not json` → `detail == "bad-json"`
  - `test_no_content_leaks`：事件带 `prompt: "SECRET-PROMPT-123"`、`tool_input: {"command": "cat SECRET-FILE-456"}`、`tool_response: "SECRET-OUT-789"`、`cwd: "/Users/someone/proj-SECRET-DIR"`、`transcript_path` 含 `SECRET-TP` → 记录文件全文搜不到任何 `SECRET`
  - `test_integration_names`：host 参数 `claude` / `gpt` / `gemini`（不带 / 带第二参数）/ `qwen` 各发一条 → 文件分别是 `claude-hooks.jsonl` `codex.jsonl` `gemini.jsonl` `antigravity.jsonl` `qwen.jsonl`
  - `test_trim`：连发 245 条 → 文件行数 ≤ 240 且 ≥ 200，最后一行是最后发的那条
  - `test_concurrent_writes`：并发起 20 个钩子进程 → 每行都能 `json.loads`
  - `test_session_hashed`：`session_id: "abc"` → `sid == hashlib.sha1(b"abc").hexdigest()[:6]`，记录里没有 `"abc"` 原文以外的会话 id

- [ ] **Step 2: 跑测试确认失败**
  Run: `python3 -m unittest tests.hook_ledger_test -v` → Expected: FAIL（没有 events 目录）

- [ ] **Step 3: 实现**：在读完事件后（现在 `if not isinstance(event, dict)` 附近）定义 `integration_name` / `ledger`；写入用 `events/.<接入名>.lock` 加锁追加（锁法照 `update_sessions`），追加后行数 > 240 时截回最后 200 行。在 `sys.exit(0)` 的三处丢弃点（codex-memory、codex-suggestion、turn_gate 返回 False）前各写一条 dropped；`bad-json` 写在事件不是 dict 的地方；正常走到最后：`pose` 有值写 `shown "<character> <pose>"`，否则（且不是 SessionEnd）写 `dropped unknown-event`，SessionEnd 写 `shown "<character> sleeping"`；用 `sys.excepthook` 兜住未捕获异常写 `error <类名>` 再交还原 excepthook。`ledger` 内部任何异常都吞掉

- [ ] **Step 4: 跑测试确认通过**，并跑全部 Python 测试
  Run: `python3 -m unittest discover -s tests -p "*_test.py"` → Expected: OK（原有 44 项 + 新测试）

- [ ] **Step 5: 提交** `git add integrations/crosspet-hook.py tests/hook_ledger_test.py` → `git commit -m "钩子事件记录：events/<接入名>.jsonl，记处理结果和丢弃规则，不记内容"`

### Task 2: DeepSeek Harness 插件的事件记录

**Files:**
- Modify: `integrations/deepseek/dsh-plugin-crosspet/lib/index.js`
- Test: `tests/deepseek_plugin_ledger.test.mjs`（新建，用 `tests/deepseek_plugin_poll.test.mjs` 的假 Harness 写法）

**Interfaces:**
- Consumes: Task 1 的行格式；接入名固定 `deepseek`
- Produces: 插件内 `ledger(ev, tool, sid, result, detail)`；数据目录用插件里已有的 `appData`（Mac 是 Application Support，Windows 是 `data`），测试里通过 `config.dataDir`（新加，仅测试用，没写就用默认）指到临时目录

- [ ] **Step 1: 写失败的测试**：
  - 发一次 `agent/pre-step` → `events/deepseek.jsonl` 最后一行 `result === "shown"`，`detail` 以 `deepseek ` 开头（或切到别家模型时那个角色）
  - 事件里带 `messages: [{role:'user', content:'SECRET-DS-1'}]` 和工具参数 `SECRET-DS-2` → 文件全文不含 `SECRET`
  - 连发 245 条 → 行数在 200–240 之间
- [ ] **Step 2: 跑** `node --test tests/deepseek_plugin_ledger.test.mjs` → FAIL
- [ ] **Step 3: 实现**：在 `state(pose, event, tool)` 里写 shown；插件内部丢掉事件的地方（读不出 session、没有角色等，照现有分支）写 dropped，规则名用 `no-session` / `no-character`（只给这两种起名，其他分支不记）；单进程，不需要锁，追加后超过 240 行截回 200。`PLUGIN_VERSION` 保持 `"1.3.8"`（1.3.8 还没发，不再升）
- [ ] **Step 4: 跑** `node --test tests/*.test.js tests/*.test.mjs` → 全部 PASS
- [ ] **Step 5: 提交** `git add integrations/deepseek/dsh-plugin-crosspet/lib/index.js tests/deepseek_plugin_ledger.test.mjs` → `git commit -m "DeepSeek 插件事件记录（同钩子格式）"`

### Task 3: Claude Code 增强版 mod 的事件记录

**Files:**
- Modify: `integrations/claude-code/mod/hooks/register.ts`

**Interfaces:**
- Consumes: Task 1 的行格式；接入名固定 `claude-mod`；数据目录：沿用 mod 里找 `charactersDir` 的方式取 CrossPet 数据目录

- [ ] **Step 1: 实现** `ledger($, ev, tool, sid, result, detail): Promise<void>`：在 `setState` 里写 shown（`detail` = `"<who> <pose>"`），追加 + 超 240 截回 200，异常吞掉。仓库里没有 mod 的自动测试，不新建测试框架（YAGNI）
- [ ] **Step 2: 人工核对**：`git diff` 里只出现事件名、工具名、会话 id 的 sha1 前 6 位；和 Task 1 行格式逐字段对照
- [ ] **Step 3: 提交** `git add integrations/claude-code/mod/hooks/register.ts` → `git commit -m "Claude Code mod 事件记录（同钩子格式）"`

### Task 4: 网页自报与网页的判断记录（index.html）

**Files:**
- Modify: `app/web/index.html`

**Interfaces:**
- Produces: 全局函数 `diagnoseDisplay() -> object`，外壳在反馈时调用一次并 `JSON.stringify`：
  `{ char, pose, skin, img: {file, complete, w, h}, spare: {file, complete}, swapping, tucked, egg, pageHidden, imageErrors: [{file, t}], verdicts: [{t, id, ev, pose, verdict}] }`
  - `file` 只要文件名（不含路径）；`imageErrors` 最近 5 条；`verdicts` 最近 40 条
  - `verdict` ∈ `shown` / `not-current` / `egg` / `multi` / `shaking` / `no-pose`——在 `applyCharState` 里各个 `return` 之前记。spec 第四节 3 的「网页收到的不是当前角色就不演」由这里记，外壳的 `pet.jsonl` 只记外壳自己丢的（stale / paused / front-ai / answer-stale），两份在反馈 `action` 类里一起附（对应现有的 egg、`id !== charId || !s.pose`、multi、shakingUntil 分支，其余走到底记 shown）
- 现有 `addEventListener('error', …)` 同时把文件名推进 `imageErrors`

- [ ] **Step 1: 实现** 上述两处；不改 `applyCharState` 的行为，只在分支处记一笔
- [ ] **Step 2: 浏览器核对**：用仓库根目录起 `python3 -m http.server 8794 --bind 127.0.0.1`，打开 `app/web/index.html`，在控制台 `init(...)`、`setCharacter('deepseek', true)`、`applyCharState('gpt', {pose:'running', event:'PreToolUse'})`、`applyCharState('deepseek', {pose:'running', event:'PreToolUse'})` 后调 `diagnoseDisplay()`：verdicts 依次是 `not-current`、`shown`；`img.file` 是不带路径的文件名
- [ ] **Step 3: 跑** `node --test tests/*.test.js tests/*.test.mjs` → 全部 PASS
- [ ] **Step 4: 提交** `git add app/web/index.html` → `git commit -m "网页自报显示状态 diagnoseDisplay，记录收到状态后的判断"`

### Task 5: 反馈规则模块（网页层，纯函数）

**Files:**
- Create: `app/web/feedback-plan.js`（UMD 写法同 `app/web/peak-hours.js`：挂 `window.FeedbackPlan`，`module.exports` 给测试）
- Test: `tests/feedback_plan.test.js`

**Interfaces:**
- Consumes: Task 1 行格式；Task 4 `diagnoseDisplay` 的形状；外壳给的 `facts`（形状定义在这里，Task 7、8 照它）：
  ```
  facts = {
    header: { version, platform, os, install, character, skin, uptimeMin },
    integrations: [接入名…], characters: [{id, name}], quotas: [来源 id…],   // 第二步的选项
    sections: { <段落 id>: string }                                         // 外壳已打码的原始文本
  }
  ```
  段落 id（外壳只给它拿得到的，拿不到就不给）：`window` `displays` `front` `hidden` `page`（`diagnoseDisplay()` 的 JSON 字符串，或 `"网页没有回应"`）`renderRestart` `crashes` `install` `log`（运行日志最后 400 行）`updateLog` `seen`（JSON：接入名 → 秒）`diag`（`integrate.py diagnose` 全文，**不再截 4000 字**）`events:<接入名>`（jsonl 原文）`petEvents`（jsonl 原文）`switches`（jsonl 原文）`state:<角色>`（该角色 state / sessions / turns / host 文件的内容，各一行）`settings` `characters`（文件夹对照表）`quota:<来源>` `perf` `dpi`
- Produces:
  - `KINDS`：九个类型 `{id, label, sub, follow: 'ai'|'character'|'quota'|null, askStill: bool, hint}`，文案照 spec 表格；`idea` 的 `askStill` 为 false
  - `followOptions(kind, facts) -> [{id, label}]`：`ai` 列 `facts.integrations`，`codex` 额外多一项 `{id:'codex-desktop', label:'ChatGPT 桌面版'}`，末尾 `{id:'unsure', label:'不确定'}`；`character` 列角色加 `{id:'missing', label:'角色列表里少了'}`；`quota` 列 `facts.quotas`
  - `sectionsFor(kind, target) -> string[]`：按 spec 第三节逐类给出段落 id 顺序（`action` + `codex-desktop` 取 `events:codex`；`unsure` 取所有已接入的 `events:*` 各 10 条）
  - `sliceDiag(diag, integration) -> string`：按诊断里的 `[Codex]` `[Claude]` `[DeepSeek Harness]` `[Gemini CLI]` `[Qwen Code]` `[Antigravity]` `[ZCode]` `[Hermes]` 标题切出这一家那段（`claude-hooks` / `claude-mod` 都取 `[Claude]`；`workbuddy` 取以 `WorkBuddy` 开头的那一行）
  - `filterLog(text, kind) -> string`：按类型的关键词表筛行（`gone`：全屏 窗口 置顶 层级 渲染 启动 崩溃 界面异常 藏 立绘加载失败；`action`：状态 接入 自动出现 钩子；`character`：同步角色 换角色 角色；`quota`：额度 余额；`display`：缩放 画布 网页大小；`perf`：渲染 定时任务；`other`：不筛），最多最后 60 行
  - `formatLedger(jsonl, n) -> string`：每行 `HH:MM:SS 事件 工具 → 结果 详情`（会话短 id 附在后面）；空字符串时返回 `"没有记录（插件版本早于 1.3.8，或从没收到消息）"`
  - `buildCard({kind, target, still, text, attach, facts}) -> object`：飞书 `interactive` 卡片；开头字段：版本（平台）、系统、机器（install 前 8 位）、角色和衣服、已运行、类型 / 补选 / 还在吗；`attach` 为 false 时只有版本、平台、三项选择和用户的话；超过 19000 字节按「日志 → 记录条数」缩
- [ ] **Step 1: 写失败的测试** `tests/feedback_plan.test.js`：
  - `sectionsFor('action','codex')` 含 `events:codex`、`petEvents`、`state:gpt`，不含 `updateLog`、`characters`；`sectionsFor('update')` 含 `updateLog`；`sectionsFor('idea')` 为 `[]`
  - `followOptions('ai', {integrations:['codex','deepseek']})` 依次是 codex、ChatGPT 桌面版、deepseek、不确定
  - `sliceDiag(真实格式的诊断样本, 'codex')` 只含 `[Codex]` 段，不含 `[Claude]`；样本从本次对话里用户贴的反馈「接入诊断」原文改写（去掉路径里的个人信息）
  - `formatLedger('', 10)` 返回含「插件版本早于 1.3.8」的说明
  - `buildCard` 在 `facts.sections.log` 为 50000 字的情况下 `JSON.stringify` 结果 ≤ 19000 字节，且卡片里包含用户写的话全文和版本号
  - `buildCard({attach:false, …})` 不含系统版本、机器编号
- [ ] **Step 2: 跑** `node --test tests/feedback_plan.test.js` → FAIL
- [ ] **Step 3: 实现** `app/web/feedback-plan.js`
- [ ] **Step 4: 跑** `node --test tests/*.test.js tests/*.test.mjs` → 全部 PASS
- [ ] **Step 5: 提交** `git add app/web/feedback-plan.js tests/feedback_plan.test.js` → `git commit -m "反馈规则模块：按类型选段落、筛日志、排版、缩减"`

### Task 6: 反馈窗口（feedback.html）

**Files:**
- Modify: `app/web/feedback.html`

**Interfaces:**
- Consumes: Task 5 `FeedbackPlan`
- Produces（和外壳的消息，Task 7、8 照它）：
  - 页面 → 外壳：`{cmd:'get'}`（打开时，外壳回 `setFacts(facts)`，只带 header / integrations / characters / quotas，sections 为空）；`{cmd:'collect', kind, target, want}`（用户选完类型和补选、或点「看看会发什么」时发；`want` = `FeedbackPlan.sectionsFor(kind, target)`，外壳只收集 `want` 里的段落，再调 `setFacts(facts)`）；`{cmd:'send', body}`（同现在）
  - 外壳 → 页面：`setFacts(facts)`、`onSent(ok, message)`（同现在）
- [ ] **Step 1: 实现** 一页排开的四步：类型用两列大按钮（单选）；第二步按 `follow` 出现（用 `followOptions`）；第三步三个选项「还在 / 刚过去（几分钟内）/ 更早」（`idea` 不出现）；第四步输入框沿用现有字数规则（`idea` 可不填，其余 ≥ 2 字）。发送按钮在必选都选了才可用。预览区显示 `buildCard` 实际会发的文本。顶上那条说明原样保留
- [ ] **Step 2: 浏览器核对**（起 8794 本地服务）：控制台调 `setFacts({header:{version:'1.3.8-beta.2',platform:'mac',os:'macOS 26',install:'abcdef1234',character:'gpt',uptimeMin:5}, integrations:['codex','deepseek'], characters:[{id:'gpt',name:'GPT'}], quotas:['gpt'], sections:{}})`，逐个类型点一遍：第二步出现 / 隐藏正确，`idea` 没有第三步，预览随选择变化；截图给 loki 看
- [ ] **Step 3: 提交** `git add app/web/feedback.html` → `git commit -m "反馈窗口改成四步，一页排开，按类型附信息"`

### Task 7: Mac 外壳（运行日志、两份记录、反馈取数）

**Files:**
- Create: `app/mac/App+Log.swift`（`func appLog(_ text: String)`：写 `~/Library/Logs/CrossPet.log`，一行 `yyyy-MM-dd HH:mm:ss 文本`，> 1 MB 删掉重来）
- Create: `app/mac/Ledger.swift`（`enum Ledger { static func append(_ url: URL, _ line: [String: Any], keep: Int = 200) }`：追加一行 JSON，> 240 行截回 `keep`；异常吞掉）
- Modify: `app/mac/App+State.swift`（`pollStates`）、`app/mac/App+Characters.swift`（`switchTo`）及其 8 处调用、`app/mac/App+Feedback.swift`、现有 `NSLog` 调用处
**Interfaces:**
- Consumes: Task 4 `diagnoseDisplay()`；Task 6 的消息；Task 5 的 `facts` 形状
- Produces:
  - `events/pet.jsonl` 行：`{"t", "char", "ev", "pose", "result": "played"|"skipped", "detail"}`，skipped 原因：`stale`（> 10 分钟）、`paused`（预演中）、`front-ai`（`followEvent` 里规则挡掉的那个事件角色）、`answer-stale`（`followEvent` 回调里情况变了）
  - `switches.jsonl` 行：`{"t", "from", "to", "skin", "why", "via"}`，`why` ∈ `front` `event` `host` `manual` `startup` `peak` `skin` `fallback`；`switchTo(_ id: String, why: String, via: String = "")`——**8 处调用逐个改成明确的 why**，不给 why 默认值
- [ ] **Step 1: 实现 `appLog`**，把 `App+Integrations.swift:103` 的 NSLog 和这些事件写进去：启动（版本、系统）、全屏收 / 放、层级变化、贴边、换角色（why）、接入刷新、额度查询失败、立绘加载失败（来自网页 `imageError` 消息）
- [ ] **Step 2: 实现两份记录**（`pollStates` 里 stale / paused 两处、`followEvent` 的拦下和过时答复两处、交给 `applyCharState` 处记 played）
- [ ] **Step 3: 反馈取数**：处理 `get` / `collect`；按 Task 5 的段落 id 收集（只收集 `FeedbackPlan.sectionsFor` 会用到的那些——由页面在 `collect` 里带上需要的段落 id 列表 `want: [...]`，外壳照单收集）；`page` 段调 `diagnoseDisplay()`，2 秒没回就填 `"网页没有回应"`；`crashes` 只数 `~/Library/Logs/DiagnosticReports/CrossPet*` 的数量和最新一份的修改时间；`log` 读 `CrossPet.log` 最后 400 行；`updateLog` 读 `CrossPet-update.log` 最后 100 行；`diag` 去掉现在的 `.prefix(4000)`；所有文本过一遍现有 `redact`
  各段内容（Task 8 同）：
  | 段落 | 内容 |
  |---|---|
  | `window` | 位置大小、在不在屏幕里、显示中、透明度、置顶、层级、贴边 |
  | `displays` / `dpi` | 每块屏幕分辨率、缩放、相对位置、桌宠在哪块；`dpi` 另加网页缩放、画布实际 / 应有大小、人物 / 文字大小 |
  | `front` | 前台程序名、是不是桌面 / 任务栏、是否被别的窗口挡住 |
  | `hidden` | 全屏收着、快捷键藏着、用户退出标记、锁屏 各是 / 否 |
  | `characters` | 安装目录和数据目录每个角色 / 皮肤文件夹一行：json 能读、有 idle、立绘数、加载了没有、没加载的原因 |
  | `quota:gpt` | 最近读到的值 / 时间 / 耗时、最近失败原因、codex 程序路径和版本 |
  | `quota:gemini` | 有没有找到 Antigravity 服务进程、监听端口数、两个接口各自的 HTTP 状态和字段是否齐（不要正文） |
  | `quota:deepseek` | `deepseek-plugin.json` 自检、余额来源、币种、最近读到的值 |
  | `perf` | 本进程和网页进程的 CPU、内存（取一次）、省电、各定时查询间隔、屏幕刷新率 |
  | `settings` | 跟随前台、跟随事件、AI 干活自动出现、衣服、峰谷换装 |
- [ ] **Step 4: 编译** `bash app/build.sh` → 「已编译」；装到 `~/Applications` 重启，打开反馈窗口每类点「看看会发什么」，核对：`action`+codex 能看到 `events/codex.jsonl` 里的记录；`character` 有文件夹对照表；`update` 有更新日志、别的类没有；`idea` 什么都不附
- [ ] **Step 5: 提交** 只 add 改动的 Swift 文件 → `git commit -m "Mac：运行日志、桌宠处理记录、换角色记录、按类型取反馈信息"`

### Task 8: Windows 外壳（两份记录、反馈取数）

**Files:**
- Create: `app/windows/src/Ledger.cs`（`static class Ledger { public static void Append(string path, IDictionary<string, object> line, int keep = 200); public static string Line(IDictionary<string, object> line) }`，不依赖界面，LogicTests 编译它）
- Modify: `app/windows/src/Pet.Web.cs`（`Poll`、`SwitchTo`）、`app/windows/src/Pet.Foreground.cs`（`FollowEvent`）、`SwitchTo` 的 8 处调用、`app/windows/src/Pet.Feedback.cs`、`tests/windows/LogicTests/Program.cs`、`tests/windows/LogicTests/LogicTests.csproj`
**Interfaces:**
- Consumes / Produces: 与 Task 7 相同的行格式、`why` 取值、段落 id 和消息；`SwitchTo(string id, string why, string via = "")`，8 处调用逐个给明确的 why
- [ ] **Step 1: 写失败的测试**（LogicTests）：`Ledger.Line` 输出能被 `System.Text.Json` 解析且字段齐；向临时文件 `Append` 245 次后行数在 200–240、最后一行是最后写的
- [ ] **Step 2: 跑** `cd tests/windows/LogicTests && ~/.dotnet/dotnet run` → 编译失败（没有 Ledger）
- [ ] **Step 3: 实现** `Ledger.cs`、两份记录（`Poll` 里 stale / Paused、`FollowEvent` 两处、`applyCharState` 处 played）、`SwitchTo` 记录、反馈取数（同 Task 7 Step 3；`renderRestart` 读 `render-restart.txt`；`install` 用 `InstallCheck`；`log` 读 `windows.log` 最后 400 行；`updateLog` 读 `update.log`；`page` 用 `Eval("JSON.stringify(diagnoseDisplay())")` 加 2 秒超时）
- [ ] **Step 4: 跑** LogicTests → 「全部通过」；`~/.dotnet/dotnet build app/windows/CrossPet.csproj -c Release` → Build succeeded
- [ ] **Step 5: 提交** 只 add 改动的文件 → `git commit -m "Windows：桌宠处理记录、换角色记录、按类型取反馈信息"`

### Task 9: 文档、更新记录、Windows 测试

**Files:**
- Modify: `docs/架构.md`（加「记录」一节：三种记录的位置、行格式、谁写、200 行上限、绝不记的字段）、`CHANGELOG.md`（未发布：反馈窗口改版一条）、`docs/常见问题.md`（「反馈时会发什么」一段按新分类改写）
- Create: `~/Projects/crosspet-test/Windows-1.3.8-反馈改版测试.md`（给 Codex：每类点一遍预览、核对 `action` 有事件记录、`update` 才有更新日志、`attach` 关掉只剩版本和选择、发一份真实反馈到飞书）
- [ ] **Step 1: 写文档**
- [ ] **Step 2: 全部测试**：`node --test tests/*.test.js tests/*.test.mjs`、`python3 -m unittest discover -s tests -p "*_test.py"`、LogicTests、两端编译 → 全部通过
- [ ] **Step 3: 提交** `git add docs/架构.md CHANGELOG.md docs/常见问题.md` → `git commit -m "文档：三种记录的格式和隐私边界；反馈改版"`
