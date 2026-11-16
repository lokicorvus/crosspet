# 小本子日记（有事才写）与友谊折叠 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小本子第二页记下「发生了事」的日子、能往回翻，平常留言轮流不重复；设置里「她们的友谊」可以收起，0 心的对折叠。

**Architecture:** 新增两个纯函数文件：`notebook-diary.js` 记事、合并、按天取事；`notebook-events.js` 放事的模板，并把一件事变成一块留言。主桌宠页面 `index.html` 在每分钟的计时和说完一段对话时记事，打开本子时把今天的事和往回翻的页一起交给面板。`notebook-themes.js` 把第二页分成几张「叶」，`notebook.html` 负责叶之间的翻页。平常留言在 `notebook-friends.js` 里从随机挑改成轮流。

**Tech Stack:** 原生 JS（浏览器全局 + CommonJS 双用）、`node --test`、`tests/page_harness.cjs` 页面测试、Python 抽字建字体。

**Spec:** `docs/superpowers/specs/2026-11-16-notebook-diary-design.md`

## Global Constraints

- 只存 id、日期（`YYYY-MM-DD`，本地日）、事的种类和数字；文字只有 `chat` 的 `q`（当时对方说的那一句）。
- 每本本子（按 `owner`）只留最近 60 个有事的日子。
- 事的种类 id：`levelup`、`chat`、`fest`、`anniv`、`busy`、`pats`、`reunion`。
- 门槛：`busy` 昨天 ≥ 30 轮；`pats` 今天摸头或戳 ≥ 20 次；`reunion` 隔 ≥ 7 天；`anniv` 认识整 7 / 30 / 100 / 365 天，以及 100 以后每个 100 的倍数（200、300、400……，和 `notebook-lines.js` 第一页落款的纪念日规则一致）；`fest` 最多 3 个朋友来写；`chat`、`levelup` 刚见面也记，其余要认识了以上（level ≥ 1）。
- 字数：写的人 ≤ 24 字（填空按数字 99999、日期「12 月 31 日」、节日名最长那个算），主人回复 ≤ 14 字。
- 挑文字先按皮肤 id，再按原角色，再按 `'*'`；每种事都要有 `'*'`。
- 平常留言每对每级最少 4 条（Task 9 才把测试门槛从 2 提到 4）。
- 「她们的友谊」：整张卡片的收起状态记在 localStorage；0 心那一行的展开状态不记。
- 不改第一页、不改 pair-chat.js 和 pet-talk.js 的挑法、不接 AI 生成。
- 文字改完要跑 `python3 tools/build-notebook-fonts.py`，新文件要加进它的抽字列表。

## Review Focus

1. **多天的节日**：春节（初一到初七）和国庆（10-01 到 10-07）`festivalOf` 连着 7 天都返回同一个 id，同一个节日应该只记一次，否则会连续冒出 7 页。→ Task 2 测试 `fest_multi_day_records_once`。
2. **`merge` 丢掉新字段**：现在的 `merge` 重建 `pairs` 时只留 `first`、`minutes`，新加的 `last`、`lv` 会在外壳备份并回来时被抹掉，导致升级事件重复记、重逢永远不触发。→ Task 3 测试 `merge_keeps_pair_last_and_lv`。
3. **第一次装上新版**：已有的朋友对之前没记过 `lv`，第一次计时不该把她们现有的关系全当成「刚升级」，一口气记出一堆 `levelup`。→ Task 2 测试 `first_tick_seeds_levels_without_events`。
4. **跨午夜**：`busy` 看的是「昨天」，`pats` 的今日计数要在过了零点后归零，不能把昨天的次数算到今天。→ Task 2 测试 `pats_today_resets_after_midnight`、Task 3 测试 `bump_today_counter_rolls_over`。
5. **对话里只有一只、或有彩蛋 / 不在名单里的角色**：`recordChat` 只给两只都在 `installed` 里的对记事，彩蛋访客不记。→ Task 2 测试 `chat_ignores_unknown_speakers`。

---

### Task 1: 平常留言轮流用（notebook-friends.js）

**Files:**
- Modify: `app/web/notebook-friends.js`（`block` 里挑 `GREET`、`MSG`、`DATA_MSG` 的地方）
- Test: `tests/notebook_friends.test.js`

**Interfaces:**
- Produces: `NotebookFriends.rotate(list, seed: string, i: number) → item`。按 `seed` 洗一次牌（用文件里现成的 `seeded`），返回第 `i % list.length` 个。`block` 改用 `rotate(list, \`${owner}|${friend}|<哪张表>\`, facts.days || 0)`。贴纸、`rnd() < 0.5` 那种「要不要先写数字」的分支照旧按天随机。

- [ ] **Step 1: 写失败的测试** `tests/notebook_friends.test.js` 加：
  - `rotate_cycles_without_repeat`：`list = ['a','b','c','d']`，`i` 从 0 到 3 取出的 4 个两两不同，`i = 4` 和 `i = 0` 一样。
  - `block_rotates_by_days`：`owner 'claude' friend 'gpt' level 3`，`facts.days` 从 0 到 `MSG.gpt.claude[3].length - 1`，每次取出的留言（`lines.map(l => l.text).join()`）两两不同；`day` 字符串不同但 `facts.days` 相同时，取出的留言一样。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook_friends.test.js`，应该报 `rotate is not a function`。
- [ ] **Step 3: 实现** `rotate` 并让 `block` 用它；导出 `rotate`。
- [ ] **Step 4: 跑测试，确认通过**：`node --test tests/notebook_friends.test.js tests/skin_lines.test.js` 全部通过。`skin_lines` 那条「30 天里挑到的都在表里」应该照样通过。
- [ ] **Step 5: 提交** `git commit -m "小本子：平常留言按认识的天数轮流用，一轮用完才重复"`

### Task 2: 记事（notebook-diary.js）

**Files:**
- Create: `app/web/notebook-diary.js`
- Test: `tests/notebook_diary.test.js`

**Interfaces:**
- Consumes: `Friendship.level(points)`（`friendship.js`）；`Notebook.pairKey`、`Notebook.localDay`（`notebook.js`）。两个都用 `root.X || require(...)` 拿，和 `notebook.js` 拿 `Friendship` 一样。
- Produces（`window.NotebookDiary`，`module.exports` 同一个对象）：
  - `KINDS = ['levelup','chat','fest','anniv','busy','pats','reunion']`，`KEEP = 60`。
  - `recordChat(store, lines: [[who, text]], nowMs, { levelOf: (a, b) => 0..3, installed: string[] }) → store`。说话的人里每两只（都在 `installed` 里、不一样）各给对方的本子记一条 `{ day, kind: 'chat', owner, friend, q }`，`q` 是这段里 `friend` 说的第一句。同一 `day+kind+owner+friend` 已有的不记。
  - `tick(store, { nowMs, present: string[], friendship: { [key]: { points } }, fest: string | null, installed: string[] }) → store`。必须在同一分钟的 `Notebook.addMinute` **之前**调（要用到上一次的 `pairs[key].last`）。做这几件事：
    - `levelup`：`Friendship.level(points)` 大于 `pairs[key].lv` 时两边各记一条（`n` = 新关系），再把 `lv` 写回。没有 `lv` 的对只写 `lv`，不记事。
    - `reunion`：`present` 里的每一对，`pairs[key].last` 存在、而且离今天 ≥ 7 天时两边各记一条（`n` = 天数）。
    - `anniv`：`pairs[key].first` 到今天正好是 7 / 30 / 100 / 365 天，或者 > 100 且是 100 的倍数（规则抄 `notebook-lines.js` 的 `ANNIV`），两边各记一条（`n` = 天数）。只给 level ≥ 1 的对记。
    - `fest`：`fest` 不为空，而且这本本子 7 天内没记过同一个 `n` 的 `fest` 时，给心最多的至多 3 个、level ≥ 1 的朋友各记一条（`owner` = 本子主人，`friend` = 写的人，`n` = 节日 id）。
    - `busy`：`chars[owner].days[昨天] ≥ 30`，由心最多的那个 level ≥ 1 的朋友记一条（`n` = 轮数）。
    - `pats`：`chars[owner].today` 是今天，`pats ≥ 20` 或 `pokes ≥ 20`，同上记一条（`n` = 次数，`m` = `'pats'` 或 `'pokes'`，两个都够时取多的）。
    - 记完按 `owner` 剪到最近 `KEEP` 个有事的日子。
  - `eventsOn(store, owner, day) → event[]` 和 `daysOf(store, owner) → string[]`（有事的日子，新的在前）。
  - `mergeEvents(a: event[], b: event[]) → event[]`：按 `day+kind+owner+friend` 去重，按 `day` 新的在前，再按 `owner` 剪到 `KEEP`。
  - 事的形状：`{ day: 'YYYY-MM-DD', kind, owner, friend, n?, m?, q? }`，存在 `store.events`。

- [ ] **Step 1: 写失败的测试** `tests/notebook_diary.test.js`。钟用固定的本地时间（`new Date(2026, 10, 16, 12).getTime()` 这种），每条一个 `test(...)`：
  - `chat_records_both_books_once_per_day`：`recordChat` 同一段（claude、gpt 各说一句）记两次，`events` 只有 2 条，`owner/friend` 互换，`q` 各是对方的那句。
  - `chat_ignores_unknown_speakers`：说话的人有 `egg-claude` 或不在 `installed` 里的 `alice` 时，不给含这只的对记事；只有一个说话人时什么都不记。
  - `group_chat_records_each_pair`：三只的群聊记 6 条。
  - `first_tick_seeds_levels_without_events`：`pairs` 里没有 `lv`、`friendship` 已经是好朋友，`tick` 之后 `events` 为空、`pairs[key].lv === 2`。
  - `levelup_records_both_sides`：`lv: 1` 再 `tick` 到好朋友的分数，记 2 条 `levelup`、`n === 2`；再 `tick` 一次不再记。
  - `reunion_after_seven_days`：`last` 在 8 天前、两只都在 `present`，记 2 条 `reunion`，`n === 8`；`last` 在 6 天前不记。
  - `anniv_on_exact_days`：level 1 的对，`first` 在 7、30、100、200、365、400 天前时各记一条，`n` 等于天数；29、366、450 天前不记；level 0 的对 30 天前也不记。
  - `fest_multi_day_records_once`：`fest: 'spring'` 连续 7 天每天 `tick`，这本本子 `fest` 事件只有 1 天有。
  - `fest_top_three_friends`：5 个朋友都是 level ≥ 1，只记心最多的 3 个。
  - `busy_reads_yesterday`：`days[昨天] = 30` 记，`= 29` 不记；记的 `friend` 是心最多的朋友。
  - `pats_today_resets_after_midnight`：`today: { day: 昨天, pats: 25 }` 不记；`today: { day: 今天, pokes: 21, pats: 3 }` 记，`m === 'pokes'`、`n === 21`。
  - `keeps_sixty_days_per_owner`：给 claude 塞 61 个不同日子的事，`tick` 后 claude 只剩 60 天，gpt 的不受影响。
  - `merge_events_dedupes`：两份有一条相同、各有一条不同，合并后 3 条，新的在前。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook_diary.test.js`，应该报找不到 `../app/web/notebook-diary.js`。
- [ ] **Step 3: 实现** `app/web/notebook-diary.js`（外层写法照 `notebook.js` 的 IIFE + `root` + `module.exports`）。
- [ ] **Step 4: 跑测试，确认通过**：`node --test tests/notebook_diary.test.js`。
- [ ] **Step 5: 提交** `git commit -m "小本子：记下发生了事的日子（升级、聊过、节日、纪念日、忙、被摸、重逢）"`

### Task 3: notebook.js 的配合（pairs.last、今天的摸戳次数、合并）

**Files:**
- Modify: `app/web/notebook.js`（`addMinute`、`bump`、`blank`、`merge`）
- Test: `tests/notebook.test.js`

**Interfaces:**
- Consumes: `NotebookDiary.mergeEvents`（Task 2）。`notebook.js` 用 `root.NotebookDiary || require('./notebook-diary.js')` 拿；`notebook-diary.js` 不能反过来在顶层 require `notebook.js`，`pairKey`、`localDay` 在函数里用到时再取，避免循环依赖。
- Produces：
  - `addMinute` 写 `pairs[key].last = nowMs`。
  - `bump` 在 `rec.today = { day, pats, pokes }` 上加一（换天先归零；`angry` 不算）。
  - `merge`：`pairs` 合并时 `last` 取晚的、`lv` 取大的；`events` 用 `mergeEvents`。

- [ ] **Step 1: 写失败的测试** `tests/notebook.test.js` 加：
  - `addminute_sets_pair_last`：两只一起 `addMinute`，`pairs[key].last === nowMs`。
  - `bump_today_counter_rolls_over`：昨天 `bump` 3 次 pats，今天 `bump` 1 次，`today` 是 `{ day: 今天, pats: 1, pokes: 0 }`。
  - `merge_keeps_pair_last_and_lv`：local `{ first: 1, minutes: 5, last: 100, lv: 1 }`、saved `{ first: 2, minutes: 9, last: 50, lv: 2 }`，合并后 `{ first: 1, minutes: 9, last: 100, lv: 2 }`。
  - `merge_combines_events`：两边的 `events` 合并去重。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook.test.js`。
- [ ] **Step 3: 实现** 上面三处。
- [ ] **Step 4: 跑测试，确认通过**：`node --test tests/notebook.test.js tests/notebook_diary.test.js tests/notebook_backfill.test.js`。
- [ ] **Step 5: 提交** `git commit -m "小本子：记下每对上次同框和关系、今天摸戳次数，合并时保留"`

### Task 4: 事的模板和挑法（notebook-events.js）——代码、通用、8 个原角色

**Files:**
- Create: `app/web/notebook-events.js`
- Modify: `tools/build-notebook-fonts.py`（抽字列表加 `notebook-events.js`）
- Test: `tests/notebook_events.test.js`

**Interfaces:**
- Produces（`window.NotebookEvents`，`module.exports` 同一个对象）：
  - `FEST_NAMES = { halloween: '万圣节', christmas: '圣诞节', newyear: '元旦', spring: '春节', lantern: '元宵节', dragonboat: '端午节', midautumn: '中秋节', national: '国庆节' }`。
  - `EVENT_MSG`：`levelup[写的人] = { 1: [...], 2: [...], 3: [...] }`；`fest[写的人] = { <节日 id>: [...], '*': [...] }`；`pats[写的人] = { pats: [...], pokes: [...] }`；`chat`、`anniv`、`busy`、`reunion` 是 `[写的人] = [...]`。空位：`{n}` 数字、`{fest}` 节日名。
  - `EVENT_REPLY = { levelup: { [主人]: [...] }, anniv: { [主人]: [...] } }`。
  - `block({ ev, owner, ownerSkin = '', friendSkin = '', level }) → { lines: [{ who, text }], quote: string | null }`。挑法：种子 `${ev.day}|${owner}|${ev.friend}|${ev.kind}`；表的退路是皮肤 → 原角色 → `'*'`；`fest` 先找这个节日，没有用 `'*'`；`levelup` 按 `ev.n`；`levelup`、`anniv` 在 `level >= 2` 时加主人一句回复；`chat` 的 `quote` 是 `ev.q`。说话的人记原角色 id（和 `NotebookFriends.block` 的 `whoOf` 一样）。
- 文字量（这个 Task 只写 `'*'` 和 8 个原角色）：每种事每个写的人至少 2 条；`levelup` 每级至少 2 条；`fest` 每个原角色 8 个节日各至少 1 条，外加 `'*'` 至少 2 条；`pats` 的 `pats`、`pokes` 各至少 2 条；`EVENT_REPLY` 每种每个主人至少 2 条。口吻照各角色在 `notebook-friends.js` 里的留言。

- [ ] **Step 1: 写失败的测试** `tests/notebook_events.test.js`：
  - `every_kind_has_generic_and_base_writers`：对 `['*', ...NotebookFriends.SEVEN]` 的每个写的人、每种事都满足上面的条数。
  - `lengths_fit`：所有写的人那句填空后（`{n}` → 99999，`{fest}` → `'元宵节'`）≤ 24 字；所有回复 ≤ 14 字。用 `[...s].length` 数。
  - `block_falls_back_skin_base_generic`：`friendSkin: 'gemini-magician'` 但表里没写魔术师时，挑出来的在 gemini 的表里；写的人是 `alice` 时，挑出来的在 `'*'` 里。
  - `block_reply_only_for_close_friends`：`levelup`，`level: 1` 只有 1 行；`level: 2` 有 2 行、第二行 `who === owner`。
  - `block_same_day_same_text`：同一个 `ev` 调两次结果一样。
  - `chat_block_quotes`：`ev.q = '你好呀'`，`quote === '你好呀'`。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook_events.test.js`。
- [ ] **Step 3: 实现** 挑法和 `'*'` + 8 个原角色的文字。
- [ ] **Step 4: 跑测试，确认通过**：`node --test tests/notebook_events.test.js`。
- [ ] **Step 5: 提交** `git commit -m "小本子：事的留言模板（通用和八个原角色）"`

### Task 5: 四套性格皮肤的事模板

**Files:**
- Modify: `app/web/notebook-events.js`
- Test: `tests/notebook_events.test.js`

**Interfaces:**
- Consumes: Task 4 的表结构。
- 写 `gpt-onesie`、`deepseek-hoodie`、`claude-saint`、`gemini-magician`。每种事每套至少 2 条（`fest` 只要求 `'*'` 2 条，具体节日可选），`EVENT_REPLY` 每种每套 2 条。口吻照 `characters/<皮肤>/character.json` 和 `notebook-friends.js` 里这几套已经写好的留言。

- [ ] **Step 1: 写失败的测试**：`skins_have_their_own`，四套皮肤每种事都有自己的、条数够；`lengths_fit` 已经覆盖长度。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook_events.test.js`。
- [ ] **Step 3: 写文字。**
- [ ] **Step 4: 跑测试，确认通过。**
- [ ] **Step 5: 提交** `git commit -m "小本子：四套性格皮肤的事留言"`

### Task 6: 主桌宠页面接上记事、把今天的事和往回翻的页交给面板

**Files:**
- Modify: `app/web/index.html`（加载两个新脚本，放在 `notebook.js` 前后都行，但 `notebook-diary.js` 要在 `notebook.js` 之前；`noteChat`；每分钟的 `setInterval`；`notebookPage2`）
- Test: `tests/notebook_page_test.cjs`

**Interfaces:**
- Consumes: `NotebookDiary.recordChat / tick / eventsOn / daysOf`（Task 2）、`NotebookEvents.block / FEST_NAMES`（Task 4）、`festivalOf(date)`（`index.html` 里现成的）。
- `noteChat(lines)`：在 `logChat` 之后再 `NotebookDiary.recordChat(...)`，`levelOf` 用 `Friendship.level(friendStoreRead()[Notebook.pairKey(a, b)]?.points || 0)`，`installed` 用非彩蛋的角色。
- 每分钟那段：在 `Notebook.addMinute` 之前 `store = NotebookDiary.tick(store, { nowMs, present, friendship: friendStoreRead(), fest: festivalOf(new Date(nowMs)), installed })`。
- `notebookPage2` 的返回值多两项：
  - `today: item[]`：今天的事。
  - `history: [{ day, label, items: item[] }]`：今天以前有事的日子，新的在前。`label` 是「11 月 14 日」，那天是节日的话写成「11 月 14 日 · 中秋节」（看那天有没有 `fest` 事，`FEST_NAMES` 取名字）。
  - `item = { id: 写的人, name, image, levelName, hearts, kind, block }`，`block` 是 `NotebookEvents.block(...)` 的结果。`levelName`、`hearts` 取现在这一对的。写的人已经不在名单里（卸载了）的事跳过。

- [ ] **Step 1: 写失败的测试** `tests/notebook_page_test.cjs` 的 `cases` 里加：
  - `chat_becomes_today_event`：`more = ['gpt']`，调 `noteChat([['claude','你好'],['gpt','嗯。']])`（`speak` 说完会调它，测试直接调它就行），`notebookFor('claude').page2.today` 里有一条 `kind === 'chat'`、`id === 'gpt'`、`block.quote === '嗯。'`。
  - `yesterday_events_show_in_history`：`restoreNotebook` 一份昨天有 `levelup` 事的存储，`page2.history[0].items[0].kind === 'levelup'`，`today` 为空。
  - `history_label_names_festival`：那天有 `fest`、`n: 'midautumn'` 的事，`label` 以「· 中秋节」结尾。
- [ ] **Step 2: 跑测试，确认失败**：`node tests/notebook_page_test.cjs`。
- [ ] **Step 3: 实现** 上面几处。
- [ ] **Step 4: 跑测试，确认通过**：`node tests/notebook_page_test.cjs && node tests/page_switch_test.cjs`。
- [ ] **Step 5: 提交** `git commit -m "小本子：主桌宠记事，打开本子时带上今天的事和往回翻的页"`

### Task 7: 第二页的叶和翻页（notebook-themes.js、notebook.html）

**Files:**
- Modify: `app/web/notebook-themes.js`（`friendsPage`）、`app/web/notebook-themes.css`、`app/web/notebook.html`（点击处理；`?demo=` 造几天的假事）
- Test: `tests/notebook_themes.test.js`

**Interfaces:**
- Consumes: Task 6 的 `page2.today`、`page2.history`。
- `friendsPage` 输出的 `.pg2` 里放若干 `.leaf`：
  - 第 0 张是今天：最上面「今天的事」（`today` 的 item 一块一块，每块和现在的留言块同一个样式，`quote` 用小字放在她的话下面），下面照旧是平常留言、路过插一嘴、最近聊了什么。
  - 后面每张是 `history` 的一天。一天超过 4 块就拆成几张，页头写 `label`，拆开的写成「`label` · 1/2」。
  - 每张页脚有 `<button class="leaf-prev" data-leaf="<下标+1>">` 和 `<button class="leaf-next" data-leaf="<下标-1>">`。第 0 张没有 next，最后一张的 prev 加 `disabled`。
  - 只有第 0 张一开始带 `class="leaf on"`。
- `notebook.html`：`data-leaf` 的点击切 `.on`，翻页效果沿用 `flipTo` 那套翻纸 CSS（换一个类名，`reduced()` 时直接换）。翻到第一页再翻回第二页时回到第 0 张。

- [ ] **Step 1: 写失败的测试** `tests/notebook_themes.test.js` 加：
  - `page2_has_today_leaf_first`：`history` 为空时只有 1 张 `.leaf`，带 `on`，没有 `leaf-next`。
  - `history_day_splits_after_four`：`history` 一天 5 块，生成 2 张，页头分别含「1/2」「2/2」。
  - `last_leaf_prev_disabled`：最后一张的 `.leaf-prev` 带 `disabled`。
  - `chat_quote_rendered`：`today` 里 `chat` 那块的 HTML 含转义过的 `quote`。
- [ ] **Step 2: 跑测试，确认失败**：`node --test tests/notebook_themes.test.js`。
- [ ] **Step 3: 实现** 渲染、CSS、点击和 demo 数据。
- [ ] **Step 4: 跑测试，确认通过**；起预览 `crosspet-web`，打开 `http://localhost:8791/app/web/notebook.html?demo=claude`，翻到第二页，往回翻两三张、再翻回来，`read_console_messages` 没有报错。截图留证。
- [ ] **Step 5: 提交** `git commit -m "小本子第二页：今天一张，往回翻有事的那几天"`

### Task 8: 她们的友谊可以折叠（settings.html）

**Files:**
- Modify: `app/web/settings.html`（`#friendship` 卡片的标题、渲染 `friendRows` 那段、样式）
- Test: `tests/settings_multi_pets_test.cjs`

**Interfaces:**
- 标题改成按钮 `<button id="friendToggle" aria-expanded="true">她们的友谊 ▾</button>`。点了切换 `#friendRows` 显隐和 ▾ / ▸，状态存 `localStorage['crosspet-friendship-folded']`（读写包 try/catch）。
- 0 心：`hearts` 为 0 且 `partial` 为 0。这些对放进 `<div id="friendZero" hidden>`，前面一行 `<button id="friendZeroToggle">还有 N 对还没亮心 ▸</button>`，点开变「收起 ▴」。没有 0 心的对时这一行不出现；全部是 0 心时也只显示这一行。

- [ ] **Step 1: 写失败的测试** 在现有友谊用例旁边加：
  - `zero_heart_pairs_folded`：3 行里 1 行是 0 心，默认看得见 2 行，`friendZeroToggle` 文字含「还有 1 对」；点一下后看得见 3 行。
  - `no_zero_no_toggle`：全部有心时没有 `friendZeroToggle`（或者是隐藏的）。
  - `card_fold_remembered`：点 `friendToggle` 收起，重新 `push` 同样的数据后照旧收着（同一个页面实例的 localStorage）。
- [ ] **Step 2: 跑测试，确认失败**：`node tests/settings_multi_pets_test.cjs`。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 跑测试，确认通过**：`node tests/settings_multi_pets_test.cjs && node tests/ui_ownership_test.cjs`。
- [ ] **Step 5: 提交** `git commit -m "设置：她们的友谊可以收起，没亮心的对折叠成一行"`

### Task 9: 平常留言补到每对每级 4 条

**Files:**
- Modify: `app/web/notebook-friends.js`（每个 `M(...)` 的两个数组各补到 ≥ 4 条，含四套皮肤的 `M(MG/GO/DH/CS, X)` 和 `M(X, ...)`）
- Test: `tests/notebook_friends.test.js`、`tests/skin_lines.test.js`

**Interfaces:**
- 结构不变，只加条目。三句来回的那种，每一句不能含 `/`。字数照旧：写的人 ≤ 24、主人 ≤ 14。

- [ ] **Step 1: 改测试门槛**：两个测试里「每对每级 `>= 2`」改成 `>= 4`。
- [ ] **Step 2: 跑测试，确认失败。**
- [ ] **Step 3: 写文字**：先补 8 个原角色之间的 56 个方向，再补四套皮肤的。
- [ ] **Step 4: 跑全部测试**：`node --test tests/*.test.js tests/*.test.mjs` 全部通过；`for f in tests/*_test.cjs; do node $f; done` 全部通过。
- [ ] **Step 5: 提交** `git commit -m "小本子：每对每级的平常留言补到四条以上"`

### Task 10: 收尾

**Files:**
- Modify: `CHANGELOG.md`（「未发布」下加一条新增、一条改进）、`app/web/fonts/notebook/*.woff2`（重建）

- [ ] **Step 1: 重建字体**：`python3 tools/build-notebook-fonts.py`，输出最后一行是「N 个字，一共 … KB」。
- [ ] **Step 2: 全部测试**：`node --test tests/*.test.js tests/*.test.mjs`、`for f in tests/*_test.cjs; do node $f || echo FAIL $f; done`、`python3 -m unittest discover -s tests -p "*_test.py"`，全部通过。
- [ ] **Step 3: 写 CHANGELOG**：用户能看懂的话。第二页「有事的那天会留一页，可以往回翻（最多 60 天）」；「平常留言轮流写，不再连着两天一样」；「她们的友谊可以收起，没亮心的对折叠」。
- [ ] **Step 4: 提交** `git commit -m "小本子日记：字体、更新记录"`
