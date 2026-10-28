# 额度条样式 Implementation Plan（2026-10-26 按 #32 合并后的代码重写）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「设置 → 额度」里可以把额度从文字换成进度条：单家每个额度一行（名字、条、剩余 %、短重置时间），合并显示时沿用现有表格、每格换成短条；条按剩余分三档变色。

**Architecture:** 新纯函数模块 `app/web/quota-bars.js`：把一个额度对象 `q` 变成「条行 / 文字行」，并给出颜色档位 `level(pct)`。Gemini 已经由 #32 交出 `bars`（带 `group`），挑窗口复用 `quota-aggregate.js` 的 `pickBar`（导出给它用）。合并显示不重排：`compact()` 给百分比那一块标上 `pct`，`render()` 在额度条样式下把这种格子画成短条。GPT（`codex-quota.js`）和 Claude 增强版 mod 补交 `bars`。外壳只存取设置 `quotaStyle`。

**Tech Stack:** 原生 JS + node:test、TypeScript（node 24 直接剥类型跑测试）、Swift、C#。

**Spec:** `docs/superpowers/specs/2026-10-21-quota-bars-design.md`（含末尾「2026-10-26 更新」，以更新为准）

## Global Constraints

- 默认 `quotaStyle` 是 `"text"`，这时额度区和现在完全一样
- 条长 = 剩余比例；颜色三档：剩余 > 30% 蓝 `#4f7fd8`，10%–30%（含 30）橙 `#e0902f`，≤ 10% 红 `#c0392b`；百分比文字同色
- 额度条样式下 `#quota` 不加 `low` 类（不出现整块红底）
- 单家重置时间短写：24 小时内 `H:mm`（小时不补零），7 天内 `周一`…`周日`，再远 `M/D`；按本机时区。拆字兜底时用文字里原样的时间
- 过了重置时间、没有新数据的窗口：100%、不写时间
- 合并显示的格子：短条 + 百分比；窗口名（`5h` `周` `今日` `5小时` `本周`）不写，池名（`Arg`、`C/G` 等其他标签）保留；不写重置时间
- 只在 dev 上做；`git add` 只加具体文件；提交末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 测试：`node --test $(ls tests/*.test.js tests/*.test.mjs | grep -v deepseek_plugin_ledger)`（那个文件有已知的偶发失败，与本计划无关）；Windows `cd tests/windows/LogicTests && ~/.dotnet/dotnet run`

## Review Focus

1. 旧版 Claude mod 只给 `text`：额度条照样画（拆字）——Task 1
2. 文字里拆不动的段（余额）：原样文字，不丢——Task 1
3. Gemini 五个窗口：单家只画每个池一条（3 条），不是 5 条——Task 1
4. 额度条撑破底栏（重置提醒行 + 峰谷条 + 多行）：自动退回文字——Task 2 浏览器验证
5. 30% / 31%、10% / 11% 的颜色边界——Task 1

---

### Task 1: `quota-bars.js` 纯函数

**Files:** Create `app/web/quota-bars.js`；Test `tests/quota_bars.test.js`；Modify `app/web/quota-aggregate.js`（导出 `pickBar`、`windowOf`；node 下 `quota-bars.js` 用 `require('./quota-aggregate.js')`，浏览器用 `root.QuotaAggregate`）

**Interfaces（`window.QuotaBars` / `module.exports`）:**
- `level(pct: number): 'ok' | 'mid' | 'low'` —— `> 30` ok，`> 10` mid，否则 low
- `shortWhen(resetSec, nowSec): string`
- `of(q, nowSec): { rows: Row[], note: string | null } | null`
  - `Row = { kind: 'bar', label, pct, level, when } | { kind: 'text', text, low }`
  - 有 `q.bars`：按 `group` 分组；只有一组时每项一行（标签就是 `label`）；有几组时每组用 `pickBar(list, group)` 挑一项，标签用那一项的 `label`（已经是「池名 窗口名」）
  - 没有 `q.bars`：`q.text` 按 `｜` 拆段，正则 `/^(.+?) 剩余 (\d+)%(?: · (\S+) 重置)?(.*)$/`；尾巴「· HH:MM 的数据」进 `note`；拆不动的段是文字行（`low = !!q.low`）
  - `q.note` 优先当 `note`；过期（`reset <= now`）→ 100%、`when: null`
- `render(el, result)` —— `div.qbar.<level>` 里 `span.ql` / `span.qtrack > i`（宽 = pct%）/ `span.qp` / `span.qt`；文字行 `div`（low 加 `low` 类）；有 note 最后加 `div.qnote`

- [ ] Step 1 失败测试：`level` 边界（31 ok、30 mid、11 mid、10 low、0 low）；`shortWhen`（`TZ=Asia/Shanghai`，now = 2026-10-21 10:00 周三：+5.6h → `15:36`，次日 3:40 → `3:40`，10/26 → `周一`，11/2 → `11/2`）；有 bars 单组；**Gemini 五项三组 → 三行，标签「Gemini 本周」「Argon 本周」「Claude/GPT 本周」（用 #32 的 multi-pool 那组数据：5h 满了取周）**；拆字（含时间、note）；拆不动保留文字行；过期算满；null
- [ ] Step 2 跑 → FAIL；Step 3 实现；Step 4 PASS；Step 5 提交

### Task 2: 单家显示 + 设置开关（网页）

**Files:** `app/web/index.html`（脚本标签放在 `quota-aggregate.js` 后；CSS；`renderQuota` 非合并分支；外壳调用注释）、`app/web/settings.html`

- [ ] Step 1 `let quotaStyle = 'text'`；`setQuotaStyle(s)`（只认 `'bars'`，其余 `'text'`）后 `renderQuota()`
- [ ] Step 2 非合并分支：`quotaStyle === 'bars'` 且 `QuotaBars.of(q, now)` 不是 null → `QuotaBars.render`，`el.className = 'bars'`；照旧追加重置提醒、峰谷条；之后底栏超出 `62 * max(1, k)`（同 `appendPeakBar`）就按文字样式重画（不改 `quotaStyle`）
- [ ] Step 3 CSS：`.qbar` 一行 flex；`.qtrack` flex:1、高 5px×k、圆角、底 `#e4dcd6`；`.qbar.ok i / .qp` 蓝、`.mid` 橙、`.low` 红；`.qt` 小一号浅色；`.qnote` 小字
- [ ] Step 4 `settings.html`：「额度栏显示峰谷时段」上方加「额度显示样式」seg（文字 / 额度条），写法照 `peakStyle`
- [ ] Step 5 浏览器验证（Claude 两行三种颜色、Gemini 三行、余额文字、撑破预算退回文字、切回文字一模一样），截图；全部测试 PASS；提交

### Task 3: 合并显示的短条格子

**Files:** `app/web/quota-aggregate.js`（`compact` 的百分比块加 `pct: number`、标签块加 `label: true`；`render(el, list, nameWidth, style)`）、`app/web/index.html`（合并分支传 `quotaStyle`，CSS `.qc .qtrack` 宽 34px×k）、`tests/quota_aggregate.test.js`

- [ ] Step 1 失败测试：`compact('5小时 剩余 98% · 07:50 重置')` 的百分比块 `pct === 98`；新纯函数 `barCell(parts): { label: string | null, pct, level } | null` —— 窗口名标签（5h 周 今日 5小时 本周）→ `label: null`，`Arg`、`C/G 周` → 去掉窗口名后的池名（`Arg`、`C/G`）；没有 pct 块（余额）→ null；不传样式时 `rows`/`render` 结果不变
- [ ] Step 2 FAIL；Step 3 实现：`render` 在 `style === 'bars'` 时，`barCell` 不是 null 的格子画成「池名（有就画）+ 短条 + 百分比」，格子加 level 类；其余照旧
- [ ] Step 4 PASS；浏览器四家合并（含 Gemini 并回一行）看宽高不超、颜色对；提交

### Task 4: GPT 和 Claude 交 `bars`

**Files:** `app/web/codex-quota.js`（`view` 加 `bars`，stale 时加 `note`）、`tests/codex_quota_view.test.js`；`integrations/claude-code/mod/hooks/register.ts`（`export function quotaOf`，加 `bars`）、Create `tests/claude_mod_quota.test.mjs`

- [ ] Step 1 失败测试：`view` 返回 `bars` = 每个窗口 `{ label, left: (100-used)/100, reset? }`、stale 时 `note: 'HH:MM 的数据'`；`quotaOf([{kind:'five_hour', percentUsed: 9, resetsAt:'2026-10-21T05:00:00Z'}, {kind:'seven_day', percentUsed: 41}]).bars` 等于 `[{label:'5小时', left:0.91, reset:1792558800}, {label:'本周', left:0.59}]`，`text` 不变
- [ ] Step 2 FAIL；Step 3 实现（只加字段）；Step 4 PASS；提交

### Task 5: 外壳设置、文档、实测

**Files:** Mac `App+Dock.swift`、`App+Integrations.swift`、`App+Settings.swift`、`App+Update.swift`、`App+Feedback.swift`；Windows `Pet.Dock.cs`、`Pet.Integrations.cs`、`Pet.cs`、`Pet.Feedback.cs`（全部照 `peakStyle` 的写法加 `quotaStyle`）；`CHANGELOG.md`、`README.md`、`app/web/whats-new.js`（1.3.8 加一条，若还没有 1.3.8 版块就新建）

- [ ] Step 1 两端照 `peakStyle` 加；两端编译；LogicTests 通过
- [ ] Step 2 文档和新功能文案
- [ ] Step 3 Mac 实测：装到 `~/Applications`，设置切「额度条」看真实的 Claude / GPT / Gemini（有哪个看哪个），重开设置还在，合并显示；截图给 loki
- [ ] Step 4 提交
