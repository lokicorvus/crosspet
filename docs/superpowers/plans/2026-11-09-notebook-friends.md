# 小本子第二页、批注多样化、桌宠互动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小本子加第二页「朋友留言」和「最近她们聊了什么」，第一页批注按数字分档变化；桌面上每对台词变多变长、对彼此的事有反应、三只以上会群聊，对话停留更久。

**Architecture:** 全部在网页层（app/web），纯函数 + 文案数据各一个文件，主桌宠页面（index.html）接线；外壳只多转一个 `slept` 消息。小本子记录（notebook.js）多存按对的在场分钟和最近对话。

**Tech Stack:** 原生 JS（UMD 式 `;(function (root) {…})`，同 pair-chat.js），node:test，页面测试用 tests/page_harness.cjs。

**Spec:** `docs/superpowers/specs/2026-11-09-notebook-friends-design.md`

## Global Constraints

- 只有七个上线角色写专属文案：claude、deepseek、gpt、gemini、glm、grok、qwen；别的角色用通用文案，不参与群聊。
- 桌面气泡一句不超过 14 个字（现有规矩，pair_chat.test.js 的 checkExchange）；带数字填空的句子按数字填 99999 算，不超过 16 个字。
- 本子上的留言一句不超过 24 个字；回复不超过 14 个字。
- 气泡停留：至少 12 秒，最多 20 秒。接话间隔约 4–5.4 秒。
- 闲聊间隔至少 8 分钟（`GAP_MS = 8 * 60_000`）。
- 反应冷却：同一种事同一对 10 分钟一次，所有反应全局 2 分钟一次。
- 朋友最多显示 4 个；「最近聊了什么」每个角色显示 5 段，全局存 30 段。
- 不画新立绘、不加新特效；文案文件改了要重跑 `python3 tools/build-notebook-fonts.py`。
- 不 `git add -A`；只 add 本任务的文件。

## Review Focus

1. 友谊记录里有已经删掉 / 没装的角色（`claude+kimi` 这种）：第二页跳过她，不报错 → Task 2 `friends_skip_uninstalled`。
2. 自定义角色当本子主人或朋友：用通用文案、`w-other` 字体，不空白 → Task 7 `generic_owner_and_friend`、Task 8 `custom_writer_font`。
3. 旧的 notebook.json（没有 pairs / chats）和新的合并：不丢、不报错 → Task 2 `merge_old_without_pairs`。
4. 填空数字很大（轮数 12,345）：桌面气泡不超长 → Task 4 `data_lines_fit_big_numbers`。
5. 主桌宠在演彩蛋 / 干活 / 页面藏着时发生的事：不反应，也不占冷却 → Task 5 `no_reaction_while_busy`。

---

### Task 1: 对话时长、三句来回、记进小本子

**Files:**
- Modify: `app/web/pair-chat.js`（`GAP_MS`、新 `bubbleMs`、`replyAfter`、`schedule`；`pick` 接受 3 句的段）
- Modify: `app/web/index.html`（`chat` 多一个 ms 参数；新 `speak(lines)` 统一放段、记小本子；`tryPairChat` 和关系升级改走 `speak`）
- Modify: `app/web/notebook.js`（`logChat`）
- Test: `tests/pair_chat.test.js`、`tests/notebook.test.js`、`tests/notebook_page_test.cjs`

**Interfaces:**
- Produces: `PairChat.bubbleMs(text) → ms`（`clamp(12000 + max(0, len − 6) × 600, 12000, 20000)`）；`PairChat.replyAfter(text) → ms`（`4000 + min(len, 14) × 100`）；`PairChat.schedule(lines) → [{ who, text, pose, at, ms }]`（第一句 at 0，后一句 at = 前一句 at + replyAfter(前一句)）；`Notebook.logChat(store, lines, nowMs) → store`（`store.chats` 新的在前，最多 30，`lines` 只存 `[[角色, 台词]]`）；页面 `speak(lines)`、`chat(line, look, fx, ms)`；额外那只的 `companionCall` chat args 第四项是 ms。

- [ ] **Step 1: 写测试**：`bubble_ms_bounds`（2 个字 → 12000，14 个字 → 16800，40 个字 → 20000）；`schedule_cumulative`（三句 at = 0, replyAfter(第1句), +replyAfter(第2句)）；`gap_is_8_minutes`（`P.GAP_MS === 480000`）；pair_chat 的 `checkExchange` 改成允许 2 或 3 句、相邻两句不是同一个人；`logChat_keeps_30_newest_first`；页面 `pair_chat_logged_to_notebook`（两只在场、`tryPairChat` 挑中后 `noteStore().chats.length === 1`，气泡在第 11 秒还没收起）。
- [ ] **Step 2: 跑测试** `node --test tests/pair_chat.test.js tests/notebook.test.js && node tests/notebook_page_test.cjs` → 新测试 FAIL。
- [ ] **Step 3: 实现**。`chat` 的收起计时和换立绘的恢复计时都用 ms（没给就 `PairChat.bubbleMs(line)`）；`speak` 按 `schedule` 逐句 `chatAs`，整段放完前调 `noteChat(lines)`（只主桌宠记，`Notebook.logChat` 后 `noteStoreWrite`）；额外那只的页面 `chat` 收到 ms 照用。
- [ ] **Step 4: 跑测试** → 全 PASS；再跑 `node --test tests/*.test.js` 和全部 `tests/*_test.cjs` 无回归。
- [ ] **Step 5: 提交**：`git add app/web/pair-chat.js app/web/index.html app/web/notebook.js tests/pair_chat.test.js tests/notebook.test.js tests/notebook_page_test.cjs && git commit -m "桌宠对话：气泡按字数停 12–20 秒、等读完再接话、三句来回、说完记进小本子"`

### Task 2: 小本子记录：按对的在场时间、朋友列表

**Files:**
- Modify: `app/web/notebook.js`（`addMinute` 记 `pairs`；`merge` 合并 `pairs`、`chats`；新 `friendsOf`）
- Test: `tests/notebook.test.js`

**Interfaces:**
- Produces: `store.pairs[key] = { first, minutes }`（同时在场的每一对每分钟 +1，first 取最早）；`Notebook.friendsOf(store, ch, { friendship, installed, nowMs }) → [{ id, key, level, hearts, first, minutes }]`（友谊记录里含 ch 的对，另一只在 installed 里，按心数降序、同心按 minutes 降序，最多 4 个）；`Notebook.chatsOf(store, ch) → [{ t, lines }]`（含 ch 的最近 5 段）。
- [ ] **Step 1: 写测试**：`addMinute_records_pairs`；`friends_sorted_capped_4`；`friends_skip_uninstalled`；`merge_old_without_pairs`（一边没有 pairs / chats）；`merge_chats_dedupe_by_t`；`chatsOf_only_involving`。
- [ ] **Step 2: 跑** `node --test tests/notebook.test.js` → FAIL。
- [ ] **Step 3: 实现**（merge：pairs 每对 minutes 取大、first 取小；chats 按 t 去重、新的在前、留 30）。
- [ ] **Step 4: 跑** → PASS。
- [ ] **Step 5: 提交**：`git commit -m "小本子记录：每对一起在桌面上的时间、朋友列表、最近对话"`

### Task 3: 每对台词扩写（A 的一半）

**Files:**
- Modify: `app/web/pair-chat.js`（`LINES`）
- Test: `tests/pair_chat.test.js`

**Interfaces:**
- Consumes: Task 1 的 3 句段规则。

- [ ] **Step 1: 改测试**：每对每档 `tier.length >= 6`、每档至少 1 段 3 句（A → B → A）；全部 LINES 里没有重复的句子（同一对内）。
- [ ] **Step 2: 跑** `node --test tests/pair_chat.test.js` → FAIL（现在每档 2 段）。
- [ ] **Step 3: 写文案**：21 对 × 3 档，每档补到 6 段以上（新写 ≥ 4 段，其中 ≥ 1 段三句）。口吻按已有台词和 README 的人设；0 档客气生疏、1 档熟络、2 档亲密；多写对方的梗（DeepSeek 白饭 / 胖、GLM 涨价、Gemini 猫和反重力、Grok 毒舌和 is this true、千问奶茶和金卡、GPT 冷淡和额度重置、Claude 规矩和 You're absolutely right）。
- [ ] **Step 4: 跑** → PASS；现有的「挑中」类测试仍过（它们取 `[0][0]`，扩写时不动每档原来的第 1、2 段的位置）。
- [ ] **Step 5: 提交**：`git commit -m "每对台词：三档各扩到 6 段以上，加三句来回"`（只 add 这两个文件）

### Task 4: 看数字说话、群聊（A 的另一半 + C）

**Files:**
- Create: `app/web/pet-talk.js`（`root.PetTalk`）
- Modify: `app/web/index.html`（引入脚本；`tryPairChat` 接上）
- Test: `tests/pet_talk.test.js`、`tests/notebook_page_test.cjs`

**Interfaces:**
- Consumes: `Notebook` 记录（`chars[ch].days[今天]`、`pats`；Task 2 的 `pairs`）。
- Produces:
  - `PetTalk.dataExchanges(a, b, facts) → [{ id, lines }]`；`facts = { today: {角色: 轮数}, pats: {角色: 次}, togetherMin, knownDays }`。四种：`rounds`（两边今天都 >0 且不相等，多的那只先说）、`pats`（差 ≥10）、`together`（≥60 分钟，填小时）、`known`（≥7 天，填天数）。文案按「先说的那只」写：`DATA[kind][角色] = [模板…]`，回话 `DATA_REPLY[kind][角色] = [句…]`，占位 `{n}` `{m}`（对方的数）`{h}` `{d}`；别的角色用 `DATA[kind]['*']`。
  - `PetTalk.TOPICS = [{ id, open: {角色: 句}, follow: {…}, close: {…} }]`（≥ 8 个，七个角色每个位置都写）；`PetTalk.groupPick({ present, busy, levelOf, nowMs, lastAt, recent, rnd }) → { id, lines } | null`：闲着的七个角色里 ≥ 3 只、两两 `levelOf(key) >= 1`、`nowMs - lastAt >= PairChat.GAP_MS`、`rnd() < GROUP_CHANCE (0.4)`；挑三只按 open / follow / close 拼 3 句（有第四只时可加一句 follow，共 4 句）。
  - `PairChat.pick` 多一个可选参数 `extra(a, b, tier) → [{ id, lines }]`，并进这一对的候选。
- [ ] **Step 1: 写测试**：`data_rounds_needs_both_today`；`data_lines_fit_big_numbers`（每个模板填 99999 后 ≤ 16 字）；`data_every_kind_has_all_seven_and_generic`；`topics_cover_all_positions`（≥ 8 个，每个位置七个角色都有、≤ 14 字）；`group_needs_three_acquainted`（两两有一对 level 0 → null）；`group_distinct_speakers`；页面 `group_chat_when_gathered`（三只在场、心都 ≥1 档、rnd 固定 → 三句、记进小本子）。
- [ ] **Step 2: 跑** `node --test tests/pet_talk.test.js` → FAIL（文件不存在）。
- [ ] **Step 3: 实现 + 写文案**。`tryPairChat`：升级优先；然后闲着的 ≥3 只时先试 `groupPick`，没中再 `pick({ …, extra: (a, b) => PetTalk.dataExchanges(a, b, noteFacts(a, b)) })`；群聊和闲聊共用 `pairChatAt`、`pairChatRecent`。
- [ ] **Step 4: 跑** → PASS，全量无回归。
- [ ] **Step 5: 提交**：`git commit -m "桌宠闲聊：看数字说话、三只以上群聊"`

### Task 5: 对彼此的事有反应（B）

**Files:**
- Modify: `app/web/pet-talk.js`（`REACT`、`react`）
- Modify: `app/web/index.html`（`friendEvent(actor, kind)` 和六处触发；额外那只睡着时发 `{ slept: true }`）
- Modify: `app/mac/Companion.swift`、`app/windows/src/Companion.cs`（`slept` → 主桌宠页面 `friendEvent(角色, 'sleep')`）
- Test: `tests/pet_talk.test.js`、`tests/notebook_page_test.cjs`

**Interfaces:**
- Produces: `PetTalk.REACT[kind][说话的角色 | '*'][档]`（档 = `min(level, 2)`，每档 ≥ 3 句；可选按对特例 `REACT_PAIR[kind]['说话者>事主']`）；`PetTalk.react({ kind, actor, present, busy, levelOf, nowMs, last, exclude = [], rnd }) → { speaker, key, marks: [string], lines } | null`。kind ∈ `done | redhot | jealous | sleep | poke | oops`，门槛 `MIN_LEVEL = { done: 1, redhot: 0, jealous: 2, sleep: 1, poke: 1, oops: 1 }`；`last` 是 `{ [mark]: ms }`，mark 为 `'*'`（全局，2 分钟）和 `` `${kind}:${key}` ``（10 分钟）；说话者从 `present` 里闲着的、不是 actor、不在 exclude、够门槛的里挑。lines 两句：说话者一句，事主回一句（`REACT_BACK[kind][事主 | '*']`；睡着的不回）。
- 触发：干完一轮且 ≥ 2 分钟 → `done`（noteNotebookEvent 结束处）；`noteAngry` → `redhot`；`notePoke` → `poke`；`notePat(ch)` 后对 5 分钟内没被摸的那几只 → `jealous`（exclude 被摸过的）；主桌宠睡着 / 收到 `slept` → `sleep`；状态 pose `oops` → `oops`。`friendEvent` 在主桌宠干活 / 彩蛋 / 页面藏着 / 正在说话（`speaking` 标记）时直接返回，不写冷却；说之前等 1.5 秒。

- [ ] **Step 1: 写测试**：`react_respects_min_level`；`react_cooldowns`（同 kind 同对 10 分钟内 null、全局 2 分钟内 null）；`react_excludes_actor_and_patted`；`react_all_seven_each_kind_three_per_tier`；`sleep_has_no_reply`；页面 `poke_companion_triggers_reaction`、`no_reaction_while_busy`（主桌宠 aiActivity 时戳 → 无对话、之后立刻再戳能反应）。
- [ ] **Step 2: 跑** → FAIL。
- [ ] **Step 3: 实现 + 写文案**（七个角色 × 6 种 × 3 档 × ≥3 句，回话每角色每种 ≥2 句；口吻要分得出是谁：Grok 毒、GPT 冷、DeepSeek 傻乐、GLM 精明、千问温柔大方、Gemini 猫、Claude 认真温柔）。外壳：Mac `Companion.swift` 处理 `d["slept"]`，Windows `Companion.cs` 处理 `slept`，都调主桌宠 `friendEvent(角色, 'sleep')`。
- [ ] **Step 4: 跑** → PASS；`app/build.sh`、`~/.dotnet/dotnet build app/windows/CrossPet.csproj -c Release` 成功；全量无回归。
- [ ] **Step 5: 提交**：`git commit -m "桌宠互相反应：干完夸、红温劝、吃醋、嘘、戳、出错"`

### Task 6: 第一页批注按档、落款按情况（notebook-lines.js）

**Files:**
- Create: `app/web/notebook-lines.js`（`root.NotebookLines`）
- Modify: `app/web/notebook.js`（`view` 多给 `todayRounds`、`lastEnd`）
- Modify: `app/web/notebook-themes.js`（`noteFor`/`signFor` 改为：`character.json` 的覆盖优先，否则用 `view.notesPicked` / `view.signPicked`）
- Modify: `app/web/notebook.html`（引入脚本）、`app/web/index.html`（`notebookFor` 挑好放进 view）
- Test: `tests/notebook_lines.test.js`、`tests/notebook_themes.test.js`

**Interfaces:**
- Produces: `NotebookLines.BANDS = { rounds: [0, 1, 10, 100, 1000], work: [0, 1, 10, 100]（小时）, pats: [0, 1, 20, 100] }`；`bandOf(stat, value) → 档下标`；`NOTES[角色 | '*'][stat][档] = [句…]`（0 档可以是空数组）；`SIGNS[角色 | '*'] = { night, busy, miss, anniv, normal }`；`notesFor(id, view, rnd) → [3 × string|null]`；`signFor(id, view, nowMs, rnd) → string`（优先级 anniv（认识 7/30/100/365 天及之后每 100 天当天）> night（0–5 点）> busy（todayRounds ≥ 30）> miss（lastEnd 距今 ≥ 3 天）> normal）。
- [ ] **Step 1: 写测试**：`band_edges`（rounds 9 → 1、10 → 2、1000 → 4；work 59 分钟 → 0）；`seven_plus_generic_have_three_per_band`（0 档除外，每句 ≤ 10 字，批注在数字旁边放得下）；`sign_priority`；`old_override_wins`（view.notes 三条字 / view.sign 时照旧用它）。
- [ ] **Step 2: 跑** → FAIL。
- [ ] **Step 3: 实现 + 写文案**。
- [ ] **Step 4: 跑** → PASS，全量无回归。
- [ ] **Step 5: 提交**：`git commit -m "小本子：批注按数字分档随机挑，落款按深夜 / 忙 / 好久不见 / 纪念日换"`

### Task 7: 第二页留言文案（notebook-friends.js）

**Files:**
- Create: `app/web/notebook-friends.js`（`root.NotebookFriends`）
- Test: `tests/notebook_friends.test.js`

**Interfaces:**
- Consumes: Task 2 `friendsOf` 的条目。
- Produces:
  - `GREET[写的人 | '*'][level 0|1] = [{ t: [句…], r?: 回复 }]`（≥ 3 条）——对谁都能说的。
  - `MSG[写的人][本子主人][level 2|3] = [{ t: [句…], r?: 回复 }]`（七个角色两两、两个方向，每格 ≥ 2 条；level 3 的 t 有 2–3 句来回时，回复交错写成 `t: [[写的人, 句], [主人, 句], …]`）。
  - `DATA_MSG[写的人 | '*'][level 1|2|3] = [模板…]`（占位 `{h}` 一起站的小时、`{d}` 认识的天、`{date}` 初见日期、`{n}` 主人的总轮数、`{p}` 主人被摸次数），≥ 2 条。
  - `STICKER[写的人 | '*'] = [emoji…]`；`CAMEO[写的人 | '*'] = [{ text } | { stamp }]`（Grok 的 stamp 是「已阅·还行」等）；`HINT[level 0|1|2] = 句`。
  - `block({ owner, friend, level, facts, day }) → { lines: [{ who, text }], sticker: string|null, photo: { date }|null, hint: string|null }`：按 `day|owner|friend` 的哈希挑（同一天同样）；level 0 一条 GREET；1 一条 GREET 或 DATA_MSG；2 一条 MSG + 可能一条 DATA_MSG，带回复和贴纸；3 一条长 MSG + 贴纸 + photo（`facts.first` 有才给）。hint 只在 level < 3 给。
  - `cameo({ owner, friends, day }) → { who, text?, stamp? } | null`：有 level ≥ 2 的朋友且至少两个朋友时，隔天出现一次，说话的是另一个朋友。
- [ ] **Step 1: 写测试**：`same_day_same_block`、`next_day_may_change`（30 天里至少出现 2 种）；`level_controls_amount`（0 → 1 句无回复无贴纸；3 → ≥ 2 句、有贴纸、有 photo）；`msg_all_directed_pairs`（42 个方向 × level 2、3 每格 ≥ 2 条）；`lengths`（每句 ≤ 24 字，回复 ≤ 14 字，DATA_MSG 填 99999 后 ≤ 24 字）；`generic_owner_and_friend`（owner 或 friend 是 `kimi` 时用 `'*'`，不空）；`cameo_rules`。
- [ ] **Step 2: 跑** → FAIL。
- [ ] **Step 3: 实现 + 写文案**（量大：MSG 42 × 2 × ≥ 2 = ≥ 168 条；口吻同 Task 3；好朋友提真实的事，挚友更亲、会开玩笑、会翻旧账）。
- [ ] **Step 4: 跑** → PASS。
- [ ] **Step 5: 提交**：`git commit -m "小本子第二页：朋友留言文案（按关系档、按天换、插嘴、贴纸）"`

### Task 8: 第二页画出来、翻页、各人的字

**Files:**
- Modify: `app/web/notebook-themes.js`（`panel` 出两页 + 书签；新 `friendsPage(v, t)`）、`app/web/notebook-themes.css`（第二页、书签、翻页动画、`.w-<角色>` 字体和颜色、合照、贴纸、章）、`app/web/notebook.html`（引入 notebook-friends.js、notebook-lines.js；书签 / 翻页角点击 `flipTo(1|2)`）
- Modify: `app/web/index.html`（`notebookFor` 加 `page2`）、`tools/build-notebook-fonts.py`（`wanted_text` 加 notebook-lines.js、notebook-friends.js、pair-chat.js、pet-talk.js）、`app/web/fonts/notebook/*.woff2`（重跑）
- Test: `tests/notebook_themes.test.js`、`tests/notebook_page_test.cjs`

**Interfaces:**
- Consumes: Task 2、6、7。
- Produces: `view.page2 = { friends: [{ id, name, image, levelName, hearts, block }], cameo, chats: [{ t, lines: [{ who, name, text }] }] }`；页面 `flipTo(n)`、body 类 `p2`；两页叠在同一个 grid 格子里（`grid-area: 1 / 1`），高度取高的那页，翻页时窗口不变；`.w-claude … .w-qwen` 用各自本子的 `--hand` 字体和 `--note` 颜色，`.w-other` 回退系统手写体。
- [ ] **Step 1: 写测试**：`panel_has_two_pages_and_tabs`；`friends_page_writer_fonts`（每条留言带 `w-<写的人>`、回复带 `w-<主人>`）；`custom_writer_font`（写的人是 kimi → `w-other`）；`empty_friends_message`；`chats_section_five_max`；页面 `notebookFor_has_page2`。
- [ ] **Step 2: 跑** → FAIL。
- [ ] **Step 3: 实现**；重跑 `python3 tools/build-notebook-fonts.py`（源字体在 ~/.cache/crosspet-fonts）。
- [ ] **Step 4: 跑** → PASS；`node --test tests/*.test.js`、全部 `*_test.cjs` 无回归；在预览服务器（crosspet-notebook-8780）`app/web/notebook.html?demo=<角色>` 七个角色各截图看第二页、翻页、字体（demo 数据加上 page2）。
- [ ] **Step 5: 提交**：`git commit -m "小本子第二页：书签翻页、朋友留言、合照贴纸、最近聊了什么，每人用自己的字"`（woff2 一起 add）

### Task 9: 实机、文档

**Files:**
- Modify: `README.md`、`CHANGELOG.md`（「未发布」里小本子那条补第二页；桌宠互动、对话时长各一条）、`docs/自定义角色.md`（没有新字段就不动）、`~/Projects/crosspet-test/Windows-下一测试版-小本子.md`（加第二页、反应、群聊、`slept` 的检查）
- [ ] **Step 1**：`app/build.sh` 装到 ~/Applications，打开本子翻到第二页、集合看群聊和反应（有 computer-use 授权就截图；没有就写进台账待 loki 看）。
- [ ] **Step 2**：改文档；全量测试；提交 `git commit -m "小本子第二页、桌宠互动：文档和测试步骤"`。
