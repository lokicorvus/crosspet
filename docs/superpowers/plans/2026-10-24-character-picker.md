# 角色页卡片墙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置的「角色」页改成卡片墙（上面当前角色的衣服大卡、下面所有角色小卡），右键「换角色」改成打开这一页。

**Architecture:** 卡片怎么排、用哪张图、哪张高亮写成网页层纯函数 `app/web/character-cards.js`（node 测试）；`settings.html` 只负责画和发消息（沿用现有 `{cmd:'skin', id, skin}`，它在两端都会顺带切换角色）。两个外壳给设置页的角色数据里加 `accent` 和卡片图地址（`portrait` / `idle`），扫立绘时排除 `portrait`，右键菜单改成打开设置角色页（已有 `openSettingsAt(tab:)` / `OpenSettings(tab)`）。

**Tech Stack:** 原生 JS + node:test、Swift、C#（WPF + WebView2）。

**Spec:** `docs/superpowers/specs/2026-10-20-character-picker-design.md`

## Global Constraints

- 点角色卡 = `{ cmd: 'skin', id, skin: '' }`（换成她、穿原版、记住的衣服也改成原版）；点衣服卡 = `{ cmd: 'skin', id: 当前角色, skin }`
- 卡片图：有 `portrait` 用 `portrait`，没有用 `idle`；两个都没有显示名字首字的色块（不出破图）
- 卡片底色：角色 `accent`（没有用 `#e0b48a`）的浅色渐变
- 彩蛋角色不出现；皮肤不单独占角色卡；角色卡右上角标衣服套数（只有一套不标）
- 峰谷换装（「高峰穿 / 空闲穿」）从额度页搬到角色页，只显示当前角色那一组（当前角色在 `PeakHours.RULES` 里且有别的衣服才显示）
- 名字、跟随前台 AI、跟随工作事件、随机彩蛋这些控件保留原 id / data-key，只换位置
- 「召唤彩蛋」不动；只有一个角色时右键不显示「换角色」
- `git add` 只加具体文件；提交末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；测试 `node --test tests/*.test.js tests/*.test.mjs`、Windows `cd tests/windows/LogicTests && ~/.dotnet/dotnet run`

## Review Focus

1. 当前角色穿着皮肤时，上排「原版」那张卡要显示原版的图，不是正在穿的皮肤的图——Task 1 测试「原版卡用角色自己文件夹的图」
2. 用户自定义角色没有 `portrait`、甚至没有 `idle.webp`（只有 `default`）——Task 1「两张都没有时 image 为 null」，Task 3 画色块
3. 文件夹里多了 `portrait.webp` 后，桌宠不能多出一个叫 portrait 的姿态——Task 2 两端扫描排除，LogicTests / 探针检查
4. 设置页打开着时在别处换了角色（跟随前台），卡片高亮要跟着变——Task 3 浏览器验证里再推一次状态
5. 角色多到一行放不下：换行，不横向滚动、不挤扁——Task 3 CSS 用 `grid-template-columns: repeat(auto-fill, minmax(…))`

---

### Task 1: 纯函数 `character-cards.js`

**Files:** Create `app/web/character-cards.js`；Test `tests/character_cards.test.js`

**Interfaces（Produces，`window.CharacterCards` / `module.exports`）:**
- 输入是设置状态里的 `characters` 数组，每项：`{ id, name, accent?, images: { portrait?, idle? }, skins?: [{ id, name, images }], skin? }`（`skins[0]` 是原版，`id: ''`，它的 `images` 由外壳给角色自己文件夹的图）
- `imageOf(images): string | null` —— `images?.portrait || images?.idle || null`
- `outfitCards(chars, currentId): [{ id: 皮肤 id（原版是 ''）, name, image, on: boolean }]` —— 当前角色没有 `skins` 时返回一张：`{ id: '', name: '原版', image: imageOf(c.images), on: true }`；有 `skins` 时每套一张，`on` = `skin.id === (c.skin || '')`
- `characterCards(chars, currentId): [{ id, name, image, accent, count, on }]` —— `image` 用角色自己的 `images`（原版），`count = skins?.length || 1`，`on = id === currentId`，顺序同输入

- [ ] **Step 1: 写失败测试**：`outfitCards` 有皮肤 / 没皮肤 / 穿着皮肤时原版卡用角色自己的图（「原版卡用角色自己文件夹的图」）；`characterCards` 的 `count`、`on`、`image`；`imageOf` portrait 优先、只有 idle、两张都没有时 `null`
- [ ] **Step 2:** `node --test tests/character_cards.test.js` → FAIL
- [ ] **Step 3:** 实现（IIFE 写法同 `peak-hours.js`）
- [ ] **Step 4:** PASS
- [ ] **Step 5:** 提交

### Task 2: 外壳：卡片图数据、排除 portrait、右键菜单

**Files:**
- Mac：`app/mac/App+Characters.swift`（`sprites` 里跳过文件名 `portrait`；加 `func cardImages(_ id: String) -> [String: String]`：在 `charactersDir/<id>/` 找 `portrait.webp|png`、`idle.webp|png`，返回文件 URL 的 `absoluteString`）、`App+Settings.swift`（`settingsState` 的每个角色加 `"accent"`、`"images": cardImages(id)`；`skins` 每项加 `"images"`：原版用 `cardImages(id)`，皮肤用 `cardImages(皮肤 id)`）、`App+Menu.swift`（`换角色` 子菜单换成一项 `换角色…`，action 调 `openSettingsAt(tab: "character")`）
- Windows：`app/windows/src/Store.cs`（`Sprites` 跳过 `portrait`；加 `public static Dictionary<string, object> CardImages(string id)`，URL 形如 `https://{DataHost}/characters/{id}/portrait.webp`，只在文件存在时给）、`Pet.Integrations.cs`（状态同 Mac）、右键菜单所在文件（搜「换角色」）改成一项打开 `OpenSettings("character")`
- accent 从 `character.json` 读（Mac 已有 `info`；Windows 用现有 `Store.ReadJson`）

- [ ] **Step 1:** LogicTests 加一条：建临时目录放 `idle.webp`、`idle-blink.webp`、`portrait.webp`、`happy.webp`，断言 `Store` 的扫描结果没有 `portrait` 姿态（若 `Sprites` 是 private，改成 `internal` 供测试，不改行为）；`CardImages` 对这个目录返回 portrait 和 idle、对只有 `default.webp` 的目录返回空
- [ ] **Step 2:** 跑 LogicTests → FAIL
- [ ] **Step 3:** 两端实现
- [ ] **Step 4:** LogicTests PASS；`bash app/build.sh` 成功；`~/.dotnet/dotnet build app/windows/CrossPet.csproj -c Release` 成功
- [ ] **Step 5:** 提交

### Task 3: 设置页角色页改版

**Files:** Modify `app/web/settings.html`（`<script src="character-cards.js">`；`data-tab="character"` 卡片；`renderPeakOutfits`；额度页去掉 `#peakOutfits`）

- [ ] **Step 1:** 角色页从上到下：
  1. 小标题「{当前角色名} 的衣服」+ `#outfitCards`（大卡，`repeat(auto-fill, minmax(104px, 1fr))`，卡高约 150px，图 `object-fit: contain`，底部衣服名）
  2. 名字（原 `#name` / `#saveName`）、`#peakOutfits`（只渲染当前角色）
  3. 小标题「角色」+ `#characterCards`（小卡，`minmax(70px, 1fr)`，卡高约 90px，右上角套数）
  4. 跟随前台 AI、跟随工作事件、随机彩蛋三项原样
  删掉原 `#character` 下拉和它的 `onchange`
- [ ] **Step 2:** `setState` 里用 `CharacterCards` 画两排：点衣服卡 `post({cmd:'skin', id: s.character, skin: card.id})`，点角色卡 `post({cmd:'skin', id: card.id, skin: ''})`；`on` 的卡加高亮框；`image` 为 null 时卡里画 `accent` 色块 + 名字首字；`<img>` 的 `onerror` 也退成色块
- [ ] **Step 3:** `renderPeakOutfits` 只取 `s.character` 那一个角色
- [ ] **Step 4: 浏览器验证**：`python3 -m http.server 8793 --bind 127.0.0.1`（仓库根目录，后台）打开 `/app/web/settings.html`，控制台 `setState({...})` 喂假状态（图片地址用 `/characters/<id>/idle.webp`）：DeepSeek 四套衣服、穿睡衣时原版卡显示女仆装、点卡片发出的消息（`window.webkit` 不存在时 `post` 会落到哪，先看 `post` 的实现，必要时临时打桩 `window.chrome = { webview: { postMessage: m => console.log(m) } }`）、角色多时换行、只有一套衣服的角色、没有图的角色显示色块；再 `setState` 一次换当前角色，高亮跟着变。截图
- [ ] **Step 5:** 测试全 PASS；提交

### Task 4: 文档、Mac 实测

**Files:** `docs/自定义角色.md`（可以放 `portrait.webp` 当设置页卡片图，不放用待机图）、`CHANGELOG.md`「未发布」、`README.md`（换角色的说明改成「右键 → 换角色… 打开角色页」，搜「换角色」）

- [ ] **Step 1:** 改文档
- [ ] **Step 2:** `bash app/build.sh`，装到 `~/Applications/CrossPet.app` 重启：右键「换角色…」打开到角色页；点 DeepSeek 卡 → 桌宠换成 DeepSeek 原版；点睡衣卡 → 换上睡衣；峰谷换装只在 DeepSeek / GLM 时出现；截图给 loki
- [ ] **Step 3:** 提交
