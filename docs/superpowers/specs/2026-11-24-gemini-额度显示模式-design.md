# Gemini（Antigravity）额度显示模式

## 为什么

2026-11-24 起 Antigravity 把 Argon 并进了 Gemini 额度，现在固定两组：Gemini、Claude/GPT，各有 5 小时和本周两个窗口。现在每组只挑一行（一般是 5 小时），所以本周的看不到，Claude/GPT 那组又占掉一行。loki：很多人不在意 Claude/GPT 在 Antigravity 里的额度（本来就少），更想看周额度；5 小时最重要。

## 要做的

设置「额度」页，「显示 Gemini 额度」下面加一行「显示哪些」，两种模式：

| 模式 | 名牌下面 | 说明 |
|---|---|---|
| **5小时和本周**（默认） | Gemini 5 小时一行、Gemini 本周一行 | 不显示 Claude/GPT |
| **5小时和 Claude/GPT** | Gemini 一行、Claude/GPT 一行 | 就是现在的样子（每组按原来的挑法：一般是 5 小时，某个窗口剩 ≤10% 时换成它） |

- 关掉「显示 Gemini 额度」时这一行藏起来。
- 文字、额度条、合并显示三种样式都按模式来。
- 非目标：不做更多组合，不改 Mac / Windows 的额度解析，不动别家的额度。

## 做法（loki 选的）

网页层改：外壳照旧把完整的 `{text, low, bars}` 交给 `setQuota('gemini', q)`。网页里留一份原始的，按模式算出要显示的那份再存进 `quota.gemini`；换模式时用原始的重算。

- 「5小时和本周」：只留 `group === 'Gemini'` 的 bars，label 去掉「Gemini 」前缀（只剩「5小时」「本周」，和 Claude 自己的额度一样，条也更宽）；按这些 bars 重拼 text，**和 GPT 的额度一模一样**（`app/web/codex-quota.js` 的 view）：`5小时 剩余 89% · 15:35 重置 ｜ 本周 剩余 95%`——只在剩得最少的那个窗口后面标重置时间（24 小时内写 HH:mm、再远写月/日），过了重置时间的窗口写「剩余 100%」；low = 最少的剩余 ≤10%。额度条、合并显示也因此和 GPT / Claude 一样排（一组按窗口一行 / 「5小时 | 周」两格）。
- 「5小时和 Claude/GPT」：原样不动。
- 没有 bars（旧版 Antigravity 走 GetUserStatus 的退路）或 bars 里没有 Gemini 组：原样不动。
- 合并显示：只剩一组时 `QuotaAggregate` 自己会排成「5小时 | 周」两格，不用另改。

另外考虑过、没选的：
- 在 Mac / Windows 的解析里按模式出 text：两边各改一遍、要把设置传到解析那层，换模式还得等下次查询才生效。
- 两个独立开关（也显示 5 小时 / 显示 Claude/GPT）：loki 定了只要两种模式。

设置项：`agyQuotaMode`，`"week"`（默认）/ `"cg"`。外壳像 `minisFrom` 一样存、读、在 `setSettings` 状态里交给设置页、启动和换设置时调 `setAgyQuotaMode(...)`（Mac：App+Settings / Integrations / Update / Companions；Windows：Pet.Settings / Integrations / Companions / Pet.cs）。

## 测试

- 新的纯函数（放 `app/web/agy-quota.js`，Node 测试）：两种模式、没有 bars、没有 Gemini 组、text 和 low 拼得对、5 小时排在本周前面。
- 页面测试：设模式后 `#quota` 里的行对得上；换模式立即重画。
- 设置页测试：两个按钮、`agyQuota` 关掉时这一行藏起来、点了发 `{cmd:'set', key:'agyQuotaMode'}`。
- Mac `swiftc -typecheck`、Windows `tools/build-windows.sh` 编译通过；加进 Windows 实测文档第 6 项。

## 留给实现的

- 设置页上的说明小字怎么写。
- 更新日志那一行。
