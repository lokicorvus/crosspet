# 多桌宠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开「在干活的 AI 各显示一只」后，主桌宠照旧一直在，别的客户端干活时各冒出一只，按规则去休息；外加集合 / 解散、固定主桌宠、多只在场不演彩蛋、友谊好感点记账和爱心显示。

**Architecture:** 接入层给每个会话写 `client`，并另写一份按客户端的状态文件 `<角色>@<客户端>-state.json`。所有判断放进网页层两个新纯函数模块：`companions.js` 管谁站着、谁走；`friendship.js` 管好感点。主桌宠页面每次状态变化时算出「该站着的额外桌宠」列表，交给外壳。两个外壳各加一个轻量的 Companion 窗口类，同一进程、同一个网页环境，只负责开关窗口、转发状态、拖动、贴边和精简菜单。

**Tech Stack:** Python 3（钩子）、TypeScript（Claude Code mod）、Node（DeepSeek Harness 插件）、原生 JS + node:test（网页层）、Swift/AppKit + WKWebView（macOS）、C#/WPF + WebView2CompositionControl（Windows）

**Spec:** `docs/superpowers/specs/2026-10-31-multi-pets-design.md`

## Global Constraints

- 开关默认关；关着时外壳不读 `@` 状态文件、不处理 `companions` 消息，现有行为和测试一律不变
- 判断写在 `app/web/` 的纯函数里（node 测试），外壳只做系统接口（`docs/架构.md`）
- 只该做一次的事（换衣服、Codex 重置提醒、插件更新提醒、新功能卡片、刚更新完的开心、彩蛋、检查更新、`quotaEvent`、友谊记账）只在 `role === 'main'` 的页面做
- 额外桌宠和主桌宠同一进程；Windows 共用同一个 `CoreWebView2Environment`
- 设置键：`multiPets`（布尔，默认 false）、`petsRest`（`"auto"` 默认 / `"stay"`）、`mainPet`（`""` 默认 = 跟着规则换，否则角色 id）
- 位置 / 贴边按 `<角色>@<客户端>` 记；单只时原来的键不变
- 时间常数：离开 AI 软件后 `LEAVE_AFTER = 60_000` ms；干活判定沿用 `STUCK_AFTER = 180_000` ms；终端算 AI 软件的窗口 `CLI_RECENT = 600_000` ms；主桌宠占着的客户端停下后粘住 `CLAIM_STICK = 60_000` ms；集合登场间隔 1000 ms
- 友谊：一起在场每 10 分钟 +1；同时干活 +3（同一对 10 分钟一次）；5 分钟内前后脚干完 +2；5 分钟内分别摸头 +2；每对每天上限 25；心门槛 10/40/90/160/250；不下降；同角色不算
- 测试里钩子 / 插件一律把数据目录指到临时目录（`CROSSPET_DATA_DIR` / `dataDir`）
- 每个任务：先单独跑测试看退出码，再提交；只 `git add` 本任务列出的文件，提交前 `git diff --cached --stat`
- 提交只在本地 `dev`，不推送

## Review Focus

1. **旧钩子 / 没更新接入**：会话没有 `client`、没有 `@` 状态文件 → 每个角色只按 `<角色>` 一个客户端算，不会冒出两只 Claude；主桌宠用原来的 `<角色>-state.json` 演。测试在 Task 3（`clientsOf` 无 client）和 Task 6（无 `@` 状态时主桌宠照旧演）
2. **在 AI 软件和浏览器之间 1 分钟内来回切**：额外那只不走、不闪。测试在 Task 4（`awaySince` 遇到回到 AI 软件就清零）
3. **额外桌宠页面写本机存储**：companion 页面不能写 `crosspet-quota-memory` / `crosspet-friendship` / 新功能已读这类记录。测试在 Task 7（companion 角色跑一遍完整场景后 localStorage 只读不写）
4. **主桌宠页面重载 / Windows 渲染重启**：额外桌宠按重新算出的列表重开，没有残留窗口。测试在 Task 6（`setRole('main')` 后第一次 `companions` 消息是完整列表，外壳按完整列表对齐）；外壳在 Task 9 / 11 实测
5. **集合的只数很多、屏幕放不下**：排开时不出屏幕。测试在 Task 9 / 11 的摆放函数（`companionSlots` 给出的每个位置都在可见区域内）

---

### Task 1: 钩子写 `client` 和按客户端的状态文件

**Files:**
- Modify: `integrations/crosspet-hook.py`（`state = {...}` 附近 ~848、写状态 ~866–878、`update_sessions` 调用 ~925）
- Test: `tests/hook_client_test.py`（新建，沿用 `tests/hook_test.py` 的沙箱写法）

**Interfaces:**
- Produces：
  - 会话条目 `{pose, event, ts, client}`
  - 状态文件 `<角色>@<客户端>-state.json`，内容和 `<角色>-state.json` 相同，并加上 `client`
  - `client` 取值：Claude 钩子读环境变量 `CLAUDE_CODE_ENTRYPOINT`：`claude-desktop` → `"claude-desktop"`，其他值或没有 → `"claude-cli"`；其他宿主用接入名（`source_host`，Codex 是 `"codex"`）
  - 客户端名只允许 `[a-z0-9-]`，否则不写 `@` 文件
  - 事件记录 `events/<接入名>.jsonl` 每行多一个 `client`（反馈排查用）；`test_claude_desktop_entrypoint` 顺带断言这一项

- [ ] **Step 1: 写失败测试** `HookClientTests`：
  - `test_claude_desktop_entrypoint`：带 `CLAUDE_CODE_ENTRYPOINT=claude-desktop` 跑一次 PreToolUse。断言 `claude-sessions.json` 的条目 `client == 'claude-desktop'`，`claude@claude-desktop-state.json` 存在且 `pose == 'running'`，`claude-state.json` 照写
  - `test_claude_cli_default`：不带这个环境变量，断言 `client == 'claude-cli'`，写的是 `claude@claude-cli-state.json`
  - `test_codex_client`：用 Codex 的参数跑，断言 `gpt@codex-state.json`
  - `test_after_carried_per_client`：同一客户端 PreToolUse 后 1 秒内 PostToolUse，`@` 文件里也带上 `after`；另一个客户端的 PostToolUse 不捎带这边的 `after`
- [ ] **Step 2:** `python3 -m unittest tests.hook_client_test -v`，预期 FAIL（没有 `client`）
- [ ] **Step 3: 实现**
  - 加 `client = detect_client(source_host)`
  - `after` 捎带改成读 `<角色>@<客户端>-state.json` 的上一份（没有就退回读 `<角色>-state.json`）
  - 写完 `<角色>-state.json` 后，用同样的临时文件加重试方式写 `@` 文件
  - 写失败只记 ledger，不影响主文件
- [ ] **Step 4:** 跑新测试和已有测试：`python3 -m unittest tests.hook_client_test tests.hook_test tests.hook_dataflow_test tests.hook_order_isolation_test tests.hook_ledger_test tests.codex_turn_test -v`，全部 PASS
- [ ] **Step 5: 提交**：`git add integrations/crosspet-hook.py tests/hook_client_test.py`，提交说明「钩子：会话和状态带上客户端（Claude 桌面 / 终端按 CLAUDE_CODE_ENTRYPOINT 分）」

### Task 2: Claude Code mod 和 DeepSeek Harness 插件写 `client`

**Files:**
- Modify: `integrations/claude-code/mod/hooks/register.ts`（写 state ~105、sessions ~108）
- Modify: `integrations/deepseek/dsh-plugin-crosspet/lib/index.js`（写 state ~101、sessions ~213–235）
- Test: `tests/claude_mod_client.test.mjs`、`tests/deepseek_plugin_client.test.mjs`（新建，沿用 `claude_mod_quota.test.mjs`、`deepseek_plugin_ledger.test.mjs` 的写法）

**Interfaces:**
- Consumes：Task 1 的文件名规则和 `client` 取值
- Produces：
  - mod：`client` 按 `process.env.CLAUDE_CODE_ENTRYPOINT` 判断，规则同 Task 1；写 `claude@<client>-state.json`
  - DSH 插件：`client = "deepseek"`；按模型换角色时写 `<角色>@deepseek-state.json`

- [ ] **Step 1: 写失败测试**
  - mod：`ENTRYPOINT=claude-desktop` 时 sessions 条目带 `client: 'claude-desktop'`，并写出 `claude@claude-desktop-state.json`
  - 插件：一轮事件后，`deepseek-sessions.json` 条目带 `client: 'deepseek'`，并写出 `deepseek@deepseek-state.json`
  - 插件测试等「预期的最后一条事件写出来」再断言，不用固定的毫秒数等待
- [ ] **Step 2:** `node --test tests/claude_mod_client.test.mjs tests/deepseek_plugin_client.test.mjs`，预期 FAIL
- [ ] **Step 3: 实现**两处。`@` 文件写失败吞掉，和主文件一样处理
- [ ] **Step 4:** `node --test tests/claude_mod_client.test.mjs tests/deepseek_plugin_client.test.mjs tests/claude_mod_quota.test.mjs tests/deepseek_plugin_ledger.test.mjs tests/deepseek_plugin_poll.test.mjs tests/deepseek_character_for.test.mjs`，全部 PASS
- [ ] **Step 5: 提交**：`git add` 上面 4 个文件

### Task 3: `companions.js`：客户端、主桌宠占着谁、算不算在 AI 软件里

**Files:**
- Create: `app/web/companions.js`（UMD 写法同 `follow-policy.js`：`root.Companions = {...}`，并 `module.exports`）
- Test: `tests/companions.test.js`

**Interfaces:**
- Produces：
  - `Companions.WORKING_EXCLUDED = new Set(['idle','sleeping','happy','proud','tired'])`
  - `Companions.CLI_CLIENTS = new Set(['claude-cli','codex','deepseek','gemini','qwen','grok'])`
  - `clientsOf(sessionsByChar: {[char]: {[sid]: {pose, event, ts, client?}}}, nowMs) → Client[]`
    - `Client = { key, character, client, working, lastTs }`
    - `key = character + '@' + client`；没有 `client` 时用 `character`
    - `working`：pose 不在排除集里，并且 `now - ts*1000 < STUCK_AFTER`
    - `asking` 算 working
    - 同一个 key 的多个会话合并：任一 working 就是 working，`lastTs` 取最大
  - `mainClaim({ mainCharacter, foreground, clients, last, nowMs }) → { key | null, since }`
    - `foreground = { kind: 'ai'|'terminal'|'ours'|'other', character?, client? }`
    - 规则见设计第二节「主桌宠」，含粘住 `CLAIM_STICK`
    - `mainCharacter` 换了，粘住就失效
  - `inAISoftware({ foreground, clients, nowMs }) → boolean`
    - `ai` / `ours` → true
    - `terminal` → 有 `CLI_CLIENTS` 里的客户端 `now - lastTs*1000 < CLI_RECENT`
    - `other` → false

- [ ] **Step 1: 写失败测试**
  - `clientsOf`：
    - 无 `client` 的旧条目 → 一个 key `claude@claude`
    - `claude-desktop` 和 `claude-cli` 各一条 → 两个 key
    - `proud` 不算 working
    - 4 分钟前的 `running` 不算 working
  - `mainClaim`：
    - 前台 `claude-desktop` 时占着 `claude@claude-desktop`
    - 前台 `other` 时占着最近有事件的那个
    - 已经占着 desktop、desktop 还在干活，cli 有更新的事件 → 不换
    - desktop 停了 59 秒不换，61 秒换
    - 换了 `mainCharacter` 立刻重新选
  - `inAISoftware`：
    - 终端在前台、9 分钟前 codex 干过活 → true；11 分钟 → false
    - 终端在前台、只有 `claude-desktop` 干过活 → false
    - `ours` → true
- [ ] **Step 2:** `node --test tests/companions.test.js`，预期 FAIL（模块不存在）
- [ ] **Step 3: 实现**这三个函数
- [ ] **Step 4:** `node --test tests/companions.test.js`，PASS
- [ ] **Step 5: 提交**：`git add app/web/companions.js tests/companions.test.js`

### Task 4: `companions.js`：谁站着、谁走（含一直留着、集合、让她先回去、reactTo）

**Files:**
- Modify: `app/web/companions.js`
- Test: `tests/companions.test.js`

**Interfaces:**
- Consumes：Task 3 的 `Client`、`mainClaim`、`inAISoftware`
- Produces：

```
decide({
  nowMs, clients, claimKey, mainCharacter, inAI,
  rest: 'auto' | 'stay',
  gathered: string[],          // 集合叫出来的角色 id，按登场顺序
  running: Set<string> | null, // 有窗口的程序还开着的 key；null = 外壳没给
  coveredByStandIn: Set<string>, // reactTo 代演的角色
  prev: DecideState | null,
}) → {
  pets: Pet[],                 // 该站着的，按出现先后
  leaving: string[],           // 这次要说 bye 走的 key
  state: DecideState,
}
Pet = { key, character, client: string | null, via: 'work' | 'gather', quota: boolean }
DecideState = { pets: Pet[], awaySince: number | null, sentHome: { [key]: number }, gatherKeys: { [character]: string | null } }
```

- 出现 / 留着 / 离开：照设计第二节
  - `awaySince`：`inAI` 为 false 时开始计时，为 true 时清空
  - `LEAVE_AFTER` 到了，并且不 working，才走
  - 一个 key 的会话全部消失（上次在、这次没了）直接走，不等 1 分钟
- `rest === 'stay'`：不看 `awaySince`；只在会话全部消失，或 `running` 里没有它（`running` 非 null 且是有窗口的客户端）时走
- 集合：
  - `gathered` 里每个角色一只，`client: null`
  - 这个角色有客户端开始干活、而且没有自己的那只时，这只**收编**它：`client` 改成那个客户端，key 改成那个 key，位置沿用集合时的
  - 集合来的不按 auto 规则走
  - 不在 `gathered` 里了（解散）就走
  - 这是对设计「占着默认客户端」的细化：免得 Claude 桌面在干活时又多冒一只 Claude
- `sentHome[key]`：记下送回去的时间。这个 key 出现新一轮（有会话 `ts` 晚于送回时间，并且 working）之前不出现
- `quota`：
  - 同一个角色有好几只时，只有一只为 true：主桌宠是这个角色时都为 false，否则是最先出现的那只
  - 合并额度开着时，额外的全部 false。合并额度由调用方处理，`decide` 不管
- `claimKey` 对应的 key 不出现；`coveredByStandIn` 里的角色不出现（集合来的也不出现）

- [ ] **Step 1: 写失败测试**（每条一个 `test`）
  - Claude 主桌宠占着 desktop，codex 干活 → `pets` 有 `gpt@codex`
  - codex 干完、`inAI` 为 true 过了 5 分钟 → 还在
  - `inAI` 为 false 持续 59 秒 → 还在；61 秒 → 在 `leaving` 里
  - 走开 50 秒、回到 AI 软件 1 秒、再走开 50 秒 → 还在（Review Focus 2）
  - codex 会话全部消失 → 立刻在 `leaving` 里
  - `rest:'stay'` 时走开 10 分钟 → 还在；`running` 不含它 → 走
  - `sentHome` 后同一 key 旧会话还在 → 不出现；新一轮 working → 出现
  - 集合 `['gpt','deepseek']` → 两只 `via:'gather'`、`client:null`；codex 开始干活 → gpt 那只收编为 `gpt@codex`，只有一只 gpt
  - 解散（`gathered:[]`）→ 两只都在 `leaving`
  - 主桌宠 Claude 占着 desktop、cli 也在干活 → 冒一只 `claude@claude-cli`，`quota:false`
  - 主桌宠是 GPT，两只 Claude → 先出现的那只 `quota:true`
  - `coveredByStandIn` 含 `gpt` → codex 干活不冒
- [ ] **Step 2:** `node --test tests/companions.test.js`，预期新用例 FAIL
- [ ] **Step 3: 实现** `decide`
- [ ] **Step 4:** `node --test tests/companions.test.js`，PASS
- [ ] **Step 5: 提交**

### Task 5: `friendship.js`：好感点和心

**Files:**
- Create: `app/web/friendship.js`（UMD，`root.Friendship`）
- Test: `tests/friendship.test.js`

**Interfaces:**
- Produces：
  - `pairKey(a, b) → string`：两个 id 按字典序，用 `+` 连起来；`a === b` 返回 `null`
  - `award(store, a, b, kind, nowMs) → store`（返回新对象，不改原对象）
    - `kind`：`'together'`（+1）、`'cowork'`（+3，同一对 10 分钟内只算一次）、`'cofinish'`（+2）、`'pats'`（+2）
    - 每对每天（本地日期 `YYYY-MM-DD`）最多 +25
    - `store = { [pair]: { points, day, today, lastCowork } }`
  - `hearts(points) → number`：0–5，可以是 x.5
    - 门槛 `[10, 40, 90, 160, 250]`
    - 过了上一档、并且到了下一档一半的点数，加 0.5
  - `rows(store, names: {[id]: string}) → [{ a, b, label: 'Claude ♥ GPT', hearts }]`
    - 按点数从高到低
    - 只列 `points > 0` 的
  - `TOGETHER_MS = 600_000`、`COFINISH_MS = 300_000`、`PATS_MS = 300_000`

- [ ] **Step 1: 写失败测试**
  - 同角色 `pairKey` 为 null，`award` 不变
  - `award` 四种加点
  - 10 分钟内两次 `cowork` 只加 3
  - 一天加到 25 封顶；跨天重新算
  - `hearts`：9 → 0；10 → 1；25 → 1.5；40 → 2；250 → 5；999 → 5
  - `rows` 的排序和 label
- [ ] **Step 2:** `node --test tests/friendship.test.js`，预期 FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4:** PASS
- [ ] **Step 5: 提交**

### Task 6: 主桌宠页面接线（index.html + follow-policy.js）

**Files:**
- Modify: `app/web/index.html`：加载两个新模块；新增外壳调用；改 `applyCharState`（~1318）、`setSessions`（~1164）、`playEgg`（~1675）
- Modify: `app/web/follow-policy.js`
- Test: `tests/follow_policy.test.js`；`tests/page_switch_test.cjs` 新增场景

**Interfaces:**
- Consumes：Task 3–5 的全部函数
- Produces（外壳调用的全局函数，两端一致）：
  - `setRole(role: 'main' | 'companion', info?: { character, client, label })`：默认 `'main'`
  - `setMultiPets({ on: boolean, rest: 'auto'|'stay', mainPet: string })`
  - `setForeground({ kind, character?, client? })`
  - `setRunning(keys: string[] | null)`
  - `applyClientState(character, client, s)`：主页面拿来判断占着的客户端演什么，以及「同时干活 / 前后脚干完」
  - `gather()`：集合
  - `dismiss()`：解散
  - `sendHome(key)`：让她先回去
  - `notePat(character)`
- 页面发给外壳：
  - `toShell({ companions: [{ key, character, client, quota, label }] })`
    - 每次结果变了就发，并且总是发完整列表
    - `label` 只在同角色两只时为 `'桌面'` 或 `'终端'`，否则为 `''`
  - `toShell({ companionLeave: key })`：外壳收到后调那只的 `leaveNow()`
  - `toShell({ companionCall: { key, fn: 'celebrate', args } })`
  - `toShell({ eggAllowed: boolean })`：菜单「召唤彩蛋」变灰用
- `FollowPolicy.eventTarget` 加参数 `multiPets`：为 true 时返回 null
- 新增 `FollowPolicy.foregroundTarget({ foregroundId, current, mainPet, standing: string[] }) → id | null`：
  - `mainPet` 非空时返回 null
  - `standing` 包含 `foregroundId` 时返回 null
  - 其余返回 `foregroundId`（等于 `current` 时返回 null）

- [ ] **Step 1: 写失败测试**
  - `follow_policy.test.js`：
    - `multiPets:true` 时 `eventTarget` 为 null
    - `foregroundTarget` 三种情况各一条：固定、已站着、正常
  - `page_switch_test.cjs` 新场景：
    - `multi_off_untouched`：不调 `setMultiPets`，跑现有场景，没有任何 `companions` 消息
    - `main_emits_companion_for_codex`：`setMultiPets({on:true})` 加 Claude 主桌宠加 gpt sessions（codex 干活），收到 `companions` 含 `gpt@codex`
    - `main_plays_only_claimed_client`：两个 Claude 客户端，主页面只按占着的那个的 `applyClientState` 换姿态
    - `no_client_files_fallback`：只有 `applyCharState`、没有 `applyClientState` 时照旧演（Review Focus 1）
    - `egg_blocked_with_companions`：有额外桌宠时 `playEgg(true)` 返回 false；彩蛋正演着时冒出额外桌宠，彩蛋收掉、恢复原角色；发出 `eggAllowed:false`
    - `reload_resends_full_list`：页面重载后第一次 `companions` 是完整列表（Review Focus 4）
    - `gather_staggered`：`gather()` 后按 1 秒间隔逐个出现在列表里，不包括主桌宠的角色和彩蛋角色
- [ ] **Step 2:** `node --test tests/follow_policy.test.js && node tests/page_switch_test.cjs`，预期新用例 FAIL
- [ ] **Step 3: 实现**
  - 主页面在 `setSessions`、`applyClientState`、`setForeground`、`setRunning`、`gather`、`dismiss`、`sendHome` 之后，以及每 5 秒，调一次 `Companions.decide`
  - 结果和上次不同才 `toShell`
  - `leaving` 逐个发 `companionLeave`
  - `gather` 把角色按 1 秒间隔逐个推进 `gathered`
  - `mainPet` 非空时，`setMultiPets` 让主桌宠换成那个角色（走现有 `setCharacter`）
- [ ] **Step 4:** 跑 Step 2 的命令，再跑 `node --test tests/*.test.js`，全部 PASS
- [ ] **Step 5: 提交**

### Task 7: 额外桌宠的页面（companion 角色）和友谊记账

**Files:**
- Modify: `app/web/index.html`
- Test: `tests/page_switch_test.cjs`、`tests/ui_ownership_test.cjs`

**Interfaces:**
- Consumes：Task 6 的 `setRole`、Task 5 的 `Friendship`
- Produces：
  - companion 页面的全局函数 `leaveNow()`：说 `bye` 台词，`poof`，然后 `toShell({ gone: true })`
  - companion 页面发给外壳：
    - 摸头时 `toShell({ patted: true })`，外壳转给主页面 `notePat(character)`
    - 菜单「让她先回去」由外壳转主页面 `sendHome(key)`
  - companion 页面的额度：
    - 外壳只在 `quota: true` 时给她 `setQuota`
    - 名字下面的小字来自 `setRole` 的 `info.label`
  - 主页面的友谊记账：
    - 每分钟按当前在场的角色（主桌宠加 `pets`，页面没藏起来时）累计每对的在场分钟数，满 10 分钟 `award(...,'together')`
    - 两个不同角色同时 working 时 `award('cowork')`
    - 一个角色的 working 变成不 working 时记下时间，5 分钟内另一个也这样时 `award('cofinish')`
    - `notePat` 5 分钟内凑齐两个不同角色时 `award('pats')`
    - 存 `localStorage['crosspet-friendship']`
    - 设置页通过外壳读 `Friendship.rows(...)`：主页面 `toShell({ friendship: rows })`，节奏和 `companions` 一样，只在变化时发

- [ ] **Step 1: 写失败测试**
  - `companion_does_no_once_only`：companion 角色加载后跑一遍事件、额度、更新提示、节日，断言没有调用 `checkPeakOutfits`、`fetchResets`、`playEgg`、新功能卡片，localStorage 没有任何写入（包装 `setItem` 计数，Review Focus 3）
  - `companion_leave_now`：`leaveNow()` 说 bye 后发 `{gone:true}`
  - `friendship_together_ten_minutes`：主页面两只在场，用假时钟推 10 分钟，存储里那一对 `points === 1`
  - `ui_ownership_test.cjs`：companion 页面不显示「新功能」卡片入口
- [ ] **Step 2:** `node tests/page_switch_test.cjs && node tests/ui_ownership_test.cjs`，预期 FAIL
- [ ] **Step 3: 实现**
  - `role === 'companion'` 时，把第四节那些入口一律跳过（在各自函数开头 `if (role !== 'main') return`）
  - 摸头 / 红温 / 气泡照常
- [ ] **Step 4:** 跑 Step 2 的命令，再跑 `node --test tests/*.test.js`，全部 PASS
- [ ] **Step 5: 提交**

### Task 8: 设置页

**Files:**
- Modify: `app/web/settings.html`（「角色」页）
- Test: `tests/ui_ownership_test.cjs`（或新建 `tests/settings_multi_pets_test.cjs`，沿用同一个假页面写法）

**Interfaces:**
- Consumes：外壳推给设置页的设置对象里多 `multiPets`、`petsRest`、`mainPet`，以及 `friendship`（`Friendship.rows` 的结果）
- Produces：设置页发给外壳 `{ set: 'multiPets', value }`、`{ set: 'petsRest', value }`、`{ set: 'mainPet', value }`，和现有开关的消息格式一致

文案（照设计稿）：
- 开关「在干活的 AI 各显示一只」，说明「同时开着几个 AI（比如 Claude 和 Codex）时，干活的那几个各出来一只；你离开 AI 软件一会儿，干完活的就先去休息」
- 「主桌宠　○ 跟着规则换　○ 固定为〔下拉〕」
- 「她们什么时候去休息　○ 干完活、你离开 AI 软件一会儿后　○ 一直留着，直到我让她回去或 AI 程序关掉」
- 「她们的友谊」：每行 `label` 加心。整颗心用 ♥，半颗心样式留给实现。没有记录时整块不显示

- [ ] **Step 1: 写失败测试**
  - 开关关着时，两个选项和友谊区灰掉或收起
  - 点开关发 `{set:'multiPets', value:true}`
  - `friendship` 有两行时渲染两行，半颗心的 class 在 `hearts` 为 x.5 时出现
- [ ] **Step 2:** 跑测试，FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4:** 测试 PASS；用 `preview_start` 打开 `/app/web/settings.html`，截图看一眼「角色」页
- [ ] **Step 5: 提交**

### Task 9: macOS 外壳：Companion 窗口和转发

**Files:**
- Create: `app/mac/Companion.swift`
- Create: `app/mac/App+Companions.swift`
- Modify: `app/mac/App+State.swift`（`pollStates`）、`App.swift`、`App+Settings.swift`、`Bridges.swift`（`DevBridge` 处理新消息）、`App+Layer.swift`（层级和全屏隐藏对所有窗口生效）、`App+Hotkey.swift`
- Modify: `app/mac/App+Dock.swift`：把贴边计算拆成纯函数，供主桌宠和 Companion 共用
- Test: `tests/companion_place_probe.sh`（新建，沿用 `window_place_probe.sh` 的探针写法），用来测 `companionSlots`

**Interfaces:**
- Consumes：Task 6 / 7 的网页接口
- Produces：
  - `final class Companion`：
    - `init(app: App, pet: [String: Any])`：`pet` 是 `companions` 列表里的一项
    - 属性：`key`、`panel: NSPanel`、`web: WKWebView`
    - 方法：`func js(_ code: String)`、`func leave()`（调 `leaveNow()`，收到 `gone` 或 3 秒后关窗口）、`func close()`
  - `App.companions: [String: Companion]`
  - `App.syncCompanions(_ list: [[String: Any]])`：按完整列表对齐，多的开，少的不处理（等 `companionLeave`）
  - `func companionSlots(main: NSRect, count: Int, size: NSSize, visible: NSRect) -> [NSRect]`：放在主桌宠左边，放不下放右边，再放不下往上一排，每个都夹在 `visible` 里
  - 位置存 `defaults` 的 `origin-<key>`，贴边存 `dock-<key>`
- 转发（只在 `multiPets` 为 true 时）：
  - `pollStates` 额外列出 `stateDir` 里文件名含 `@` 的 `-state.json`，有变化时：
    - 主页面 `applyClientState(char, client, json)`
    - key 对得上的 Companion `applyCharState(char, json)`
  - sessions 变化时：Companion 拿按 `client` 过滤过的那份
  - 额度：`quota: true` 的那只拿 `setQuota`
  - 前台变化（`appActivated`）时，给主页面 `setForeground`：
    - `kind`：`appToCharacter` 命中算 `ai`；终端 bundle id 名单算 `terminal`；CrossPet 自己算 `ours`；其余算 `other`
    - 终端名单：`com.apple.Terminal`、`com.googlecode.iterm2`、`dev.warp.Warp-Stable`、`com.mitchellh.ghostty`、`com.github.wez.wezterm`、`net.kovidgoyal.kitty`、`org.alacritty`、`com.microsoft.VSCode`
    - Claude 桌面 bundle id 带 `client: 'claude-desktop'`
  - 每 5 秒 `setRunning`：`NSWorkspace.runningApplications` 经 `appToCharacter` 换成角色，Claude.app 换成 `claude@claude-desktop`
  - Companion 的 `setSizes`、光晕、名字显示、省电和主桌宠一起推
- 菜单：
  - Companion 右键精简菜单：摸摸头、戳一下、让她先回去、设置…
  - 主菜单加「集合！」/「解散」，只在 `multiPets` 打开或正在集合时显示
  - 「召唤彩蛋」按 `eggAllowed` 变灰
- 「跟随前台」换角色前走 `FollowPolicy.foregroundTarget`，`standing` 取 `companions` 里的角色

- [ ] **Step 1: 写失败探针** `companion_place_probe.sh`：
  - 主桌宠在屏幕右下，`count` = 12
  - 断言每个 rect 都在 `visible` 里、两两不重叠（Review Focus 5）
- [ ] **Step 2:** `app/build.sh && tests/companion_place_probe.sh`，预期 FAIL
- [ ] **Step 3: 实现**上面的接口
- [ ] **Step 4: 验证**
  - `app/build.sh` 退出码 0
  - 探针 PASS
  - 现有 `tests/window_place_probe.sh` 照旧 PASS
- [ ] **Step 5: Mac 实测**（装到 `~/Applications/CrossPet.app`）：
  1. 开关关着一切照旧
  2. 打开后：Claude 桌面加 Codex 终端两只；Codex 干完、人在 Claude 里时留着；切到浏览器 1 分钟后走；回来干活再出现
  3. 拖动、贴边各自记住
  4. 全屏、快捷键一起藏
  5. 集合轮番登场、解散轮流离开
  6. 固定主桌宠后切到 Codex 不换
  7. 有额外桌宠时「召唤彩蛋」是灰的
- [ ] **Step 6: 提交**

### Task 10: Windows 外壳：Companion 窗口和转发

**Files:**
- Create: `app/windows/src/Companion.cs`
- Create: `app/windows/src/Pet.Companions.cs`
- Create: `app/windows/src/CompanionPlace.cs`（`companionSlots` 的纯函数，放进 LogicTests）
- Modify: `Pet.cs`（状态轮询）、`Pet.Web.cs`（处理新消息）、`Pet.Menu.cs`、`Pet.Foreground.cs`、`Pet.Layer.cs`、`Pet.Hotkey.cs`、`Pet.Settings.cs`、`Pet.Dock.cs`（贴边计算拆成纯函数共用）、`RenderRecovery.cs`（重启后额外桌宠由网页重新算）
- Test: `tests/windows/LogicTests/Program.cs`

**Interfaces:**
- 和 Task 9 一一对应：
  - `sealed class Companion`：构造函数 `Companion(Pet pet, CoreWebView2Environment env, IDictionary<string, object> info)`；属性 `Key`；方法 `Js(string)`、`Leave()`、`Close()`
  - `Pet.companions: Dictionary<string, Companion>`
  - `Pet.SyncCompanions(...)`
  - `static Rect[] CompanionPlace.Slots(Rect main, int count, Size size, Rect visible)`
- 终端 exe 名单：`windowsterminal.exe`、`cmd.exe`、`conhost.exe`、`powershell.exe`、`pwsh.exe`、`wezterm-gui.exe`、`alacritty.exe`、`code.exe`
- `claude.exe` 带 `client: 'claude-desktop'`
- `setRunning` 用 `Process.GetProcesses()` 经 `apps.json` 换成 key，每 5 秒一次
- 设置存 `Store.Settings`，键名和 Mac 相同

- [ ] **Step 1: 写失败测试**（LogicTests）：
  - `CompanionPlace.Slots` 12 只全部在可见区域内、两两不重叠
  - 屏幕只有 1280×720 时也一样
- [ ] **Step 2:** `~/.dotnet/dotnet run --project tests/windows/LogicTests`，预期 FAIL（编译不过也算）
- [ ] **Step 3: 实现**
- [ ] **Step 4: 验证**
  - LogicTests 退出码 0
  - `tools/build-windows.sh` 退出码 0（两次分开跑，看退出码）
- [ ] **Step 5: 打包**：复制到 `~/Projects/crosspet-test/安装包/CrossPet-Windows-1.3.9-test.N.zip`，发给 loki，附 Task 9 Step 5 同一套实测清单
- [ ] **Step 6: 提交**

### Task 11: 文档和收尾

**Files:**
- Modify: `CHANGELOG.md`（「未发布」）、`docs/架构.md`（网页层模块列表、测试表、状态文件多了 `@` 文件）、`README.md`（功能列表一句）、`app/web/whats-new.js`（新功能文案）
- Test: `tests/whats_new.test.js`

- [ ] **Step 1:** 在 `whats-new.js` 加一条，并加对应测试：条目存在，带去设置「角色」页的跳转
- [ ] **Step 2:** `node --test tests/whats_new.test.js` 先 FAIL 再 PASS
- [ ] **Step 3:** 写 CHANGELOG
  - 新增：多桌宠、集合、友谊
  - 注明「Claude 要分桌面和终端，需要在设置 → 接入 AI 里点一次更新」
  - 思路致谢：来源认不出记 unknown、沉默提示参考 #33（@coco2listen），Windows 多开参考 #20（@GongShun-123）。写之前用 `gh pr view 33 --json author`、`gh pr view 20 --json author` 核对作者
- [ ] **Step 4:** 全量跑一遍：
  - `node --test tests/*.test.js tests/*.test.mjs`
  - `node tests/page_switch_test.cjs`
  - `node tests/ui_ownership_test.cjs`
  - `python3 -m unittest discover -s tests -p '*_test.py'`
  - `app/build.sh`
  - `tools/build-windows.sh`

  每条单独看退出码，全部为 0
- [ ] **Step 5: 提交**（只 add 上面列出的文件）
