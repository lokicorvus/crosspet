# 久坐提醒、喝水提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主桌宠按设置的间隔提醒起来活动、喝水（默认关，只按时间算）。

**Architecture:** 计时规则是纯函数模块 `app/web/break-reminders.js`（网页和 node 测试共用）；`index.html` 每分钟调一次，决定说不说、演什么；设置页两行开关 + 下拉；macOS / Windows 外壳只存设置并调 `setBreakReminders(...)`。

**Tech Stack:** 原生 JS（无构建）、node:test、自带的假 DOM 页面测试（tests/page_harness.cjs）、Swift（AppKit + WKWebView）、C#（WinForms + WebView2）。

**Spec:** docs/superpowers/specs/2026-11-17-break-reminders-design.md

## Global Constraints

- 默认关；间隔选项 30 / 45 / 60 / 90 / 120 分钟；默认久坐 45、喝水 60。
- 到点演 30 秒（`BREAK_SHOW_MS = 30000`），不用点；点她 = 照常摸头（`show('pat')` 会清 `revertTimer`，自然收起）。
- 夜里 23:00–7:00（本机时间）不说，到点就重新计时，不攒。
- 忙就等，最多 10 分钟，超了跳过并重新计时；同时到点只说久坐，喝水推后 5 分钟。
- 藏起来 / 屏幕睡着连续 ≥ 5 分钟：久坐计时清零；喝水不清零。藏着时不说。
- 只有主桌宠（`role === 'main'`）；额外那只的初始化串里不加。
- 久坐演 `stretch`；喝水演 `drink`，`POSE_FALLBACK.drink = 'happy'`。台词键 `remindSit` / `remindWater`，角色 `lines` 同名键优先。
- 设置键：`sitRemind`(bool) `sitEvery`(int) `waterRemind`(bool) `waterEvery`(int)。
- 只暂存自己改的文件；提交信息结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不推送。

## Review Focus

1. 改间隔 / 关了再开：从那一刻重新算，不能一改就立刻提醒（Task 1 `restart` 测试）。
2. 跨夜：22:50 开始的 30 分钟计时，夜里不说、7:00 后不立刻补说（Task 1 测试 `night_skips_and_restarts`）。
3. 她睡着（sleeping，气泡挂着 zZz）时照样提醒，不当成「忙」（Task 2 页面测试）。
4. 提醒演到一半 AI 开始干活：AI 姿态盖过去，30 秒后不把她拉回待机（`revertTimer` 被 `show` 清掉；Task 2 页面测试）。
5. 下拉存的值不在选项里（手改配置）：外壳退回默认值（Task 4/5 的读取函数）。

---

### Task 1: 计时规则模块

**Files:**
- Create: `app/web/break-reminders.js`
- Test: `tests/break_reminders.test.js`

**Interfaces:**
- Produces（`window.BreakReminders` / `module.exports`）:
  - `CHOICES = [30, 45, 60, 90, 120]`，`DEFAULTS = { sit: 45, water: 60 }`
  - `fresh(nowMs) -> State`，`State = { sit: { from, waitFrom }, water: { from, waitFrom } }`（毫秒；`waitFrom` 为 null 或开始等的时刻）
  - `restart(state, kind, nowMs) -> State`（kind: 'sit' | 'water'）
  - `back(state, hiddenMs, nowMs) -> State`：`hiddenMs >= 5 * 60000` 时 `sit` 重新计时
  - `isNight(nowMs) -> bool`：本机 `getHours()` ≥ 23 或 < 7
  - `tick(state, cfg, nowMs, busy) -> { state, say: 'sit' | 'water' | null }`，`cfg = { sit: 分钟或 0, water: 分钟或 0 }`（0 = 关）
  - 全是纯函数，返回新对象，不改入参。

- [ ] **Step 1: 写测试** `tests/break_reminders.test.js`（开头 `process.env.TZ = 'UTC'`，`const B = require('../app/web/break-reminders.js')`，`T = s => Date.parse('2026-11-17T' + s + ':00Z')`，`MIN = 60000`）：
  - `off_never_says`：cfg `{sit:0, water:0}`，从 09:00 起每分钟 tick 到 12:00，`say` 一直 null。
  - `sit_due_after_interval`：`fresh(T('09:00'))`，cfg `{sit:45, water:0}`；09:44 → null，09:45 → 'sit'，之后 `state.sit.from === T('09:45')`，10:29 → null，10:30 → 'sit'。
  - `restart_resets`：09:40 `restart(s,'sit',T('09:40'))` 后 09:45 → null，10:25 → 'sit'。
  - `busy_waits_then_says`：09:45 busy=true → null 且 `waitFrom === T('09:45')`；09:50 busy=false → 'sit'。
  - `busy_too_long_skips`：09:45–09:54 每分钟 busy=true 都 null；09:55 busy=true → null 且 `sit.from === T('09:55')`、`waitFrom === null`；10:39 不忙 → null；10:40 → 'sit'。
  - `both_due_sit_first_water_5min_later`：cfg `{sit:60, water:60}`，10:00 → 'sit'；10:04 → null；10:05 → 'water'。
  - `night_skips_and_restarts`：`fresh(T('22:50'))` cfg `{sit:30, water:0}`；每分钟 tick 到 07:00 次日，全部 null；07:00 时 `sit.from >= T('06:59') + 次日偏移`；07:29 前 null，07:30（或 from+30 分钟）→ 'sit'。（日期用 `Date.parse('2026-11-18T07:00:00Z')`）
  - `isNight_bounds`：22:59 false，23:00 true，06:59 true，07:00 false。
  - `back_short_hide_keeps_sit`：`back(s, 4*MIN, now)` 不改 `sit.from`；`back(s, 5*MIN, now)` 后 `sit.from === now`；两种都不改 `water.from`。
  - `pure`：`tick` 后入参 `state` 的 JSON 和调用前一样。

- [ ] **Step 2: 跑测试确认失败**
  Run: `node --test tests/break_reminders.test.js` → FAIL（Cannot find module）

- [ ] **Step 3: 实现** `app/web/break-reminders.js`，结构同 `peak-hours.js`（IIFE，`root.BreakReminders = api`，`module.exports`）。常量 `WAIT_MAX = 10 * 60000`，`HIDE_RESET = 5 * 60000`，`WATER_DELAY = 5 * 60000`。`tick` 规则，每个开着的 kind 依次：
  - 没到点（`now - from < every*60000`）：跳过；
  - 到点且夜里：`from = now`，`waitFrom = null`；
  - 到点且忙：`waitFrom ??= now`；`now - waitFrom >= WAIT_MAX` 则 `from = now, waitFrom = null`；
  - 到点、不忙、不是夜里：候选。
  候选里有 sit 就说 sit（`sit.from = now`），这时 water 也是候选则 `water.from = now - water*60000 + WATER_DELAY`、`waitFrom = null`；只有 water 就说 water。关着的 kind 不动（开的时候由 `restart` 起算）。文件头写一行中文说明 + 设计文档路径。

- [ ] **Step 4: 跑测试确认通过**
  Run: `node --test tests/break_reminders.test.js` → 全部 pass

- [ ] **Step 5: 提交**
```bash
git add app/web/break-reminders.js tests/break_reminders.test.js docs/superpowers/specs/2026-11-17-break-reminders-design.md docs/superpowers/plans/2026-11-17-break-reminders.md
git commit -m "久坐、喝水提醒：计时规则"
```

### Task 2: 主桌宠页面接线

**Files:**
- Modify: `app/web/index.html`（`<script src>` 列表 ~235 行；`LOCAL_LINES` ~282；`POSE_FALLBACK` ~288；`setPageHidden` ~1283；新增一段「久坐、喝水提醒」放在 Codex 重置提醒之前）
- Modify: `tests/page_harness.cjs:113`（脚本列表加 `'break-reminders.js'`）
- Test: `tests/break_reminders_page_test.cjs`（新，写法同 `page_switch_test.cjs`）

**Interfaces:**
- Consumes: Task 1 的 `BreakReminders.*`
- Produces: 全局 `setBreakReminders({ sit: bool, sitEvery: int, water: bool, waterEvery: int })`（外壳调用）

- [ ] **Step 1: 写页面测试** `tests/break_reminders_page_test.cjs`：用 `page_harness` 的 `makePage`，manifest 一个角色 gpt，poses 含 `idle stretch happy pat thinking sleeping`；`init` → `setCharacter('gpt', true)` → `setPageHidden(false)`。用例：
  - `off_by_default`：前进 3 小时，`says()` 里没有通用久坐 / 喝水台词，`pose` 从未是 stretch。
  - `sit_reminder_shows_30s`：`setBreakReminders({sit:true,sitEvery:30,water:false,waterEvery:60})`，前进 30 分钟 + 1 分钟内出现 `pose === 'stretch'`，气泡是 `LOCAL_LINES.remindSit` 之一；再前进 29 秒仍是 stretch，再前进 2 秒回到 idle、气泡空。
  - `water_uses_happy_fallback`：只开喝水 30 分钟，到点 `pose === 'drink'` 而当前图是 `gpt/happy.webp`（`currentUrl` 含 `happy`）。
  - `sleeping_still_reminded`：开久坐 30；等她睡着（`SLEEP_AFTER` 10 分钟后 pose 为 sleeping），到点照样 stretch。
  - `ai_work_overrides_reminder`：到点 stretch 后 5 秒 `hook('gpt','thinking','PreToolUse')`，再前进 30 秒，pose 仍是 thinking。
  - `hidden_long_resets_sit`：开久坐 30；20 分钟后 `setPageHidden(true)`，6 分钟后 `setPageHidden(false)`，再 25 分钟内没有 stretch，30 分钟时有。
  - `companion_never_reminds`：`setRole` 成额外那只（看 harness 里现有用法，`setRole({...})`）后 `setBreakReminders` 开着，前进 2 小时无 stretch。
- [ ] **Step 2:** `node tests/break_reminders_page_test.cjs` → FAIL（setBreakReminders is not defined）
- [ ] **Step 3: 实现**
  - `<script src="break-reminders.js"></script>` 加在 `codex-resets.js` 后；harness 列表同步。
  - `LOCAL_LINES.remindSit`、`remindWater` 各 4 句（例：「坐好久啦，起来走走～」「站起来伸个懒腰吧！」；「喝口水吧～」「该喝水啦，咕嘟咕嘟」）；`POSE_FALLBACK.drink = 'happy'`。
  - 状态：`let breakCfg = { sit: 0, water: 0 }, breaks = BreakReminders.fresh(Date.now()), hiddenSince = 0`；`const BREAK_SHOW_MS = 30000`。
  - `setBreakReminders(o)`：`role !== 'main'` 直接 return；新 cfg 的分钟数不在 `CHOICES` 里就用 `DEFAULTS`；关→0；和旧值不同的 kind 调 `restart`。
  - `setPageHidden(h)`：变成 hidden 时记 `hiddenSince = Date.now()`；从 hidden 变回来且 `hiddenSince` 有值时 `breaks = BreakReminders.back(breaks, Date.now() - hiddenSince, Date.now())`。
  - `breakBusy()`：`egg || multi || updatingNow || farewellLine !== null || tucked || characterTimer || devHeld() || devActive || aiActivity() || !['idle','tired','sleeping'].includes(pose) || (pose === 'idle' && !$('bubble').classList.contains('hide'))`。
  - `setInterval(..., 60000)`：`role !== 'main' || pageHidden || !charId || char()?.egg` 就 return；`({ state: breaks, say: k } = BreakReminders.tick(breaks, breakCfg, Date.now(), breakBusy()))`；有 k 就 `remindBreak(k)`。
  - `remindBreak(k)`：`clearTimeout(pending); clearTimeout(revertTimer); lastActive = Date.now(); shownAt = Date.now(); setPose(k === 'sit' ? 'stretch' : 'drink', true); say(pick(linesOf(k === 'sit' ? 'remindSit' : 'remindWater') || ['']))`；`revertTimer = characterTimeout(() => { setPose(restPose()); say('') }, BREAK_SHOW_MS)`。
- [ ] **Step 4:** `node tests/break_reminders_page_test.cjs` 和 `node tests/page_switch_test.cjs`、`node tests/notebook_page_test.cjs` 都通过。
- [ ] **Step 5: 提交** `git add app/web/index.html tests/page_harness.cjs tests/break_reminders_page_test.cjs` → `久坐、喝水提醒：主桌宠到点演一下`

### Task 3: 设置页两行

**Files:**
- Modify: `app/web/settings.html`（「通用」卡片里「不睡觉」那行后面；`setState` ~257；事件绑定 ~465）
- Test: `tests/settings_multi_pets_test.cjs`（加用例）

**Interfaces:**
- Produces: 设置页发给外壳 `{cmd:'set', key:'sitRemind'|'waterRemind', value: bool}`（现有 `input[data-key]` 机制自动发）和 `{cmd:'set', key:'sitEvery'|'waterEvery', value: int}`；读 `s.sitEvery` / `s.waterEvery`（缺省 45 / 60）。

- [ ] **Step 1: 写测试**（按文件现有用例写法）：
  - `break_rows_render`：`setState({... sitRemind:false, sitEvery:45, waterRemind:true, waterEvery:90})` 后 `#sitEvery` 的值 '45'、`#waterEvery` 的值 '90'，`[data-key=waterRemind]` checked；选项依次 30/45/60/90/120 分钟。
  - `break_every_posts_number`：把 `#waterEvery` 设为 '30' 并触发 onchange，发出 `{cmd:'set', key:'waterEvery', value:30}`（数字）。
  - `break_every_defaults`：state 里没有这两个键时显示 45 / 60。
- [ ] **Step 2:** `node tests/settings_multi_pets_test.cjs` → FAIL
- [ ] **Step 3: 实现**：两行 `.item`，标签「久坐提醒」`<small>坐久了她提醒你起来走走；夜里 11 点到早上 7 点不提醒</small>`、「喝水提醒」`<small>隔一阵提醒你喝口水；夜里 11 点到早上 7 点不提醒</small>`；ctl 里 `<select id="sitEvery">`（`每 30 分钟`…`每 120 分钟`）+ 开关 `data-key="sitRemind"`。`setState` 里设下拉值（焦点在下拉上时不改）；`onchange` 发 `Number(value)`。
- [ ] **Step 4:** `node tests/settings_multi_pets_test.cjs` 通过。
- [ ] **Step 5: 提交** `git add app/web/settings.html tests/settings_multi_pets_test.cjs` → `久坐、喝水提醒：设置页`

### Task 4: macOS 外壳

**Files:**
- Modify: `app/mac/App+Dock.swift`（`noSleep` 附近加读取属性）、`app/mac/App+Integrations.swift`（`handleSettings` 的 set 分支、`settingsState()`）、`app/mac/App+Update.swift:242`（主桌宠初始化 js 串）

**Interfaces:**
- Consumes: Task 2 的 `setBreakReminders`、Task 3 的设置键。
- Produces: `var breakRemindersJS: String`，形如 `setBreakReminders({sit:false,sitEvery:45,water:false,waterEvery:60})`。

- [ ] **Step 1:** `App+Dock.swift` 加 `sitRemind`/`waterRemind`（`defaults.bool`，默认 false）、`sitEvery`/`waterEvery`（`defaults.integer`，不在 `[30,45,60,90,120]` 里退回 45 / 60）、`breakRemindersJS`。
- [ ] **Step 2:** set 分支：`case "sitRemind", "waterRemind":` 存 Bool；`case "sitEvery", "waterEvery":` 值在选项里才存（`value as? Int`，也接 `Double`）；都 `js(breakRemindersJS)`。`settingsState()` 加四个键。初始化串末尾加 `; \(breakRemindersJS)`（不加到 `App+Companions.swift`）。
- [ ] **Step 3: 编译检查**：按 `app/build.sh` 里的 swiftc 命令编译（或直接 `bash app/build.sh`，看它产物在哪、会不会覆盖用户东西，先读脚本），无错误。
- [ ] **Step 4: 提交** `git add app/mac/App+Dock.swift app/mac/App+Integrations.swift app/mac/App+Update.swift` → `久坐、喝水提醒：macOS 外壳存设置`

### Task 5: Windows 外壳

**Files:**
- Modify: `app/windows/src/Pet.Dock.cs`（`NoSleep` 附近）、`app/windows/src/Pet.Integrations.cs`（设置推送 ~146、set 分支 ~218）、`app/windows/src/Pet.cs:174`（初始化串）

**Interfaces:** 同 Task 4，属性 `static string BreakRemindersJs`。

- [ ] **Step 1:** 按 `NoSleep` / `PeakStyle` 的写法加 `SitRemind`、`WaterRemind`、`SitEvery`、`WaterEvery`（数值读取兼容 `int`/`long`/`double`/`JsonElement`，看 `Store.Settings` 现有数值键怎么读的照抄），不在选项里退回默认。
- [ ] **Step 2:** set 分支：bool 两个键在现有 bool switch 里加；数值两个键另起分支，在选项里才存；都 `Js(BreakRemindersJs)`。设置推送字典加四个键。`Pet.cs` 初始化串末尾加 `; {BreakRemindersJs}`（不加到 `Pet.Companions.cs`）。
- [ ] **Step 3:** 若仓库有 `tests/windows` 下的静态检查脚本就跑；本机没有 dotnet 时如实记下「Windows 未编译」。
- [ ] **Step 4: 提交** `git add app/windows/src/Pet.Dock.cs app/windows/src/Pet.Integrations.cs app/windows/src/Pet.cs` → `久坐、喝水提醒：Windows 外壳存设置`

### Task 6: 更新记录 + 全量验证

**Files:**
- Modify: `CHANGELOG.md`（「未发布」最上面一条）

- [ ] **Step 1:** 写一条：`- 新增：久坐提醒、喝水提醒（默认关）：在设置「通用」页打开，间隔可选 30 / 45 / 60 / 90 / 120 分钟（默认久坐 45、喝水 60）。到点主桌宠伸个懒腰或开心地提醒一句，半分钟后自己收起，不用点；她正在干活时等手上的事停下再说，夜里 11 点到早上 7 点不提醒。屏幕睡着或把她藏起来 5 分钟以上，算你起来过，久坐重新计时`
- [ ] **Step 2: 全量测试**：
  - `node --test tests/*.test.js tests/*.test.mjs`
  - `for f in tests/*_test.cjs; do node $f || echo FAIL $f; done`
  - `python3 -m unittest discover -s tests -p "*_test.py"`
  全部通过。
- [ ] **Step 3: 浏览器预览**：用预览打开 `app/web/settings.html` 看两行显示正常（浅色 / 深色）；打开 `app/web/index.html` 喂一个真实角色清单（读 `characters/*/character.json` 的方式参照 `.claude/launch.json` 或 devconsole），控制台调 `setBreakReminders({sit:true,sitEvery:30,...})` 并把 `breaks.sit.from` 往前拨，看到伸懒腰 + 台词，截图。
- [ ] **Step 4: 提交** `git add CHANGELOG.md` → `更新记录：久坐、喝水提醒`
