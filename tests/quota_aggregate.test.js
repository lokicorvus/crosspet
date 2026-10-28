const test = require('node:test')
const assert = require('node:assert')
const { rows, compact } = require('../app/web/quota-aggregate.js')

const names = { claude: 'Claude', gpt: 'GPT', deepseek: 'DeepSeek', gemini: 'Gemini' }
const nameOf = id => names[id] || id
const ALL = ['claude', 'deepseek', 'gemini', 'gpt']
const flat = parts => parts.map(p => p.text).join('')
const text = r => r.cells.map(flat)

test('一家一行；窗口名缩写，重置时间标在原来的那个窗口上', () => {
  const quota = { claude: { text: '5小时 剩余 98% · 07:50 重置 ｜ 本周 剩余 99%', low: false } }
  const [r] = rows(quota, 'claude', ALL, nameOf)
  assert.strictEqual(r.name, 'Claude')
  assert.deepStrictEqual(text(r), ['5h 98% · 07:50', '周 99%'])
})

test('当前角色排最前，其余按角色顺序', () => {
  const quota = {
    claude: { text: '5小时 剩余 80%', low: false },
    gpt: { text: '5小时 剩余 97%', low: false },
    deepseek: { text: '余额 ¥6.29', low: false },
  }
  assert.deepStrictEqual(rows(quota, 'gpt', ALL, nameOf).map(r => r.id), ['gpt', 'claude', 'deepseek'])
})

test('没有额度的 AI（没接入、没打开、读不到、空文本）不占行', () => {
  const quota = { claude: null, gpt: { text: '', low: false }, deepseek: { text: '余额 ¥1.00', low: false } }
  assert.deepStrictEqual(rows(quota, 'claude', ALL, nameOf).map(r => r.id), ['deepseek'])
  assert.deepStrictEqual(rows({}, 'claude', ALL, nameOf), [])
})

test('只有剩余 ≤ 10% 的百分比标红，别的部分不动', () => {
  const [r] = rows({ gpt: { text: '5小时 剩余 6% · 04:31 重置 ｜ 本周 剩余 78%', low: true } }, 'gpt', ALL, nameOf)
  const lows = r.cells.map(c => c.filter(p => p.low).map(p => p.text))
  assert.deepStrictEqual(lows, [['6%'], []])
  assert.strictEqual(compact('本周 剩余 10%', false).find(p => p.low).text, '10%')
  assert.strictEqual(compact('本周 剩余 11%', false).find(p => p.low), undefined)
})

test('认不出的句式（余额、模型池）原样显示，来源标了 low 才整段红', () => {
  assert.deepStrictEqual(compact('余额 ¥6.29', false), [{ text: '余额 ¥6.29', low: false }])
  assert.deepStrictEqual(compact('余额 ¥0.20', true), [{ text: '余额 ¥0.20', low: true }])
  assert.strictEqual(flat(compact('Gemini/Claude 剩余 80% · 14:20 重置', false)), 'Gemini/Claude 80% · 14:20')
})

test('GPT 问不到、用的是旧数时，「· 11:30 的数据」跟在后面', () => {
  const [r] = rows({ gpt: { text: '5小时 剩余 9% · 12:30 重置 · 11:30 的数据', low: true } }, 'gpt', ALL, nameOf)
  assert.deepStrictEqual(text(r), ['5h 9% · 12:30 · 11:30 的数据'])
})

test('当前角色不在列表里（自定义角色）：只排别家，不报错', () => {
  const quota = { claude: { text: '5小时 剩余 80%', low: false } }
  assert.deepStrictEqual(rows(quota, 'iris', ALL, nameOf).map(r => r.id), ['claude'])
})

test('名字太长按显示宽度截断（中日韩字符算 2 格），短名字原样', () => {
  const { shortName } = require('../app/web/quota-aggregate.js')
  assert.strictEqual(shortName('Claude'), 'Claude')
  assert.strictEqual(shortName('Geoffrey Everest Hinton'), 'Geoffrey Ev…')
  assert.strictEqual(shortName('亚历山大·冯·洪堡'), '亚历山大·冯…')
  assert.strictEqual(shortName('亚历山大·冯'), '亚历山大·冯')
})

test('顺序：当前角色置顶，其余按角色清单的顺序（角色目录名的字母序），不受名字影响', () => {
  const all = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'iris']
  const quota = Object.fromEntries(all.map(id => [id, { text: '余额 ¥1.00', low: false }]))
  const renamed = id => ({ claude: '小蓝', gpt: 'Zed' }[id] || id)   // 改名不改变位置
  assert.deepStrictEqual(rows(quota, 'gemini', all, renamed).map(r => r.id), ['gemini', 'claude', 'deepseek', 'glm', 'gpt', 'iris'])
  assert.deepStrictEqual(rows(quota, 'iris', all, renamed).map(r => r.id), ['iris', 'claude', 'deepseek', 'gemini', 'glm', 'gpt'])
})

test('表放不下时名字可以截得更短（最大宽度作参数）', () => {
  const { shortName } = require('../app/web/quota-aggregate.js')
  assert.strictEqual(shortName('Geoffrey Everest Hinton', 9), 'Geoffrey…')
  assert.strictEqual(shortName('亚历山大·冯·洪堡', 9), '亚历山大…')
  assert.strictEqual(shortName('DeepSeek', 9), 'DeepSeek')
})

test('5 小时窗口是满的（100%）：不标重置时间，重置时间落在用得最多的周窗口上，日期格式 M/d', () => {
  // GPT 的真实形态：5h 没用过，「用得最多」的是周窗口，重置时间标在它身上
  const [r] = rows({ gpt: { text: '5小时 剩余 100% ｜ 本周 剩余 78% · 10/18 重置', low: false } }, 'gpt', ALL, nameOf)
  assert.deepStrictEqual(text(r), ['5h 100%', '周 78% · 10/18'])
  assert.deepStrictEqual(r.cells.map(c => c.filter(p => p.low).length), [0, 0])   // 100% 和 78% 都不紧张
})

test('顺序不依赖传进来的清单顺序（macOS 上清单每次启动的顺序都不同）', () => {
  const quota = Object.fromEntries(['claude', 'deepseek', 'gemini', 'gpt'].map(id => [id, { text: '余额 ¥1.00', low: false }]))
  const shuffled = ['gpt', 'gemini', 'claude', 'deepseek']
  assert.deepStrictEqual(rows(quota, 'iris', shuffled, nameOf).map(r => r.id), ['claude', 'deepseek', 'gemini', 'gpt'])
  assert.deepStrictEqual(rows(quota, 'gpt', shuffled, nameOf).map(r => r.id), ['gpt', 'claude', 'deepseek', 'gemini'])
})

test('4 行以上不管宽不宽都要收紧（底栏高度预算：3 行正常字号 / 4 行收紧后）', () => {
  const { isCrowded } = require('../app/web/quota-aggregate.js')
  assert.deepStrictEqual([0, 1, 2, 3].map(isCrowded), [false, false, false, false])
  assert.deepStrictEqual([4, 5, 6].map(isCrowded), [true, true, true])
})

const now = () => Math.floor(Date.now() / 1000)
const bar = (label, left, group, resetIn) => ({ label, left, group, ...(resetIn == null ? {} : { reset: now() + resetIn }) })
const H = 3600, D = 86400

test('bars（Antigravity）：Gemini + Argon 一行，Claude/GPT 的 5h | 周另起一行「Agy C/G」，行名按角色名', () => {
  const bars = [bar('Gemini 5小时', 1, 'Gemini', 5 * H), bar('Gemini 本周', 0.99, 'Gemini', 3 * D), bar('Argon 本周', 0.46, 'Argon', 4 * D),
                bar('Claude/GPT 5小时', 1, 'Claude/GPT', 5 * H), bar('Claude/GPT 本周', 1, 'Claude/GPT', 6 * D)]
  const list = rows({ claude: { text: '5小时 剩余 98% · 07:50 重置 ｜ 本周 剩余 99%' }, gemini: { text: '不会被用到 剩余 1%', bars } }, 'claude', ['claude', 'gemini'], nameOf)
  assert.deepStrictEqual(list.map(r => r.name), ['Claude', 'Gemini', 'Agy C/G'])
  assert.deepStrictEqual(list.map(r => r.id), ['claude', 'gemini', 'gemini'])
  const [, main, cg] = list.map(text)
  assert.match(main[0], /^周 99% · \d+\/\d+$/)       // Gemini 池：5h 满了，用最紧的周窗口；池名不重复（名字那列就是 Gemini）
  assert.match(main[1], /^Arg 46% · \d+\/\d+$/)      // 独立池：Argon → Arg，只有一个窗口不写窗口名
  assert.match(cg[0], /^5h 100% · \d\d:\d\d$/)       // Claude/GPT 池：每个窗口一格，短窗口在前
  assert.match(cg[1], /^周 100% · \d+\/\d+$/)
})

test('bars 挑窗口：5h 没满就用 5h；一样紧取重置更晚的；最紧 ≤10% 时不被 5h 盖住；0 算用完', () => {
  const one = bars => text(rows({ gemini: { text: 'x 剩余 1%', bars: [...bars, bar('Claude/GPT 本周', 1, 'Claude/GPT', D)] } }, 'gemini', ['gemini'], nameOf)[0])[0]
  assert.match(one([bar('Gemini 5小时', 0.5, 'Gemini', H), bar('Gemini 本周', 0.5, 'Gemini', 3 * D)]), /^5h 50% · /)
  assert.match(one([bar('Gemini 本周', 0.5, 'Gemini', 3 * D), bar('Gemini 5小时', 0.5, 'Gemini', H)]), /^5h 50% · /)
  assert.match(one([bar('Gemini 5小时', 0.8, 'Gemini', H), bar('Gemini 本周', 0.05, 'Gemini', 3 * D)]), /^周 5% · /)
  assert.match(one([bar('Gemini 5小时', 0, 'Gemini', H), bar('Gemini 本周', 0, 'Gemini', 3 * D)]), /^周 0% · /)   // 都用完：周更晚重置，限制你的是它
  assert.match(one([bar('Gemini 今日', 0.4, 'Gemini', H), bar('Gemini 本周', 1, 'Gemini', 3 * D)]), /^今日 40% · /)
})

test('bars 只有一个池（Claude / GPT 这类，没有 group）：合并显示照旧拆 text；没有 bars 也照旧拆 text', () => {
  const claude = rows({ claude: { text: '5小时 剩余 91% ｜ 本周 剩余 59%', bars: [{ label: '5小时', left: 0.91, reset: now() + 2 * H }, { label: '本周', left: 0.59 }] } }, 'claude', ['claude'], nameOf)
  assert.strictEqual(claude.length, 1)
  assert.deepStrictEqual(text(claude[0]), ['5h 91%', '周 59%'])
  assert.deepStrictEqual(text(rows({ gemini: { text: 'Gemini 剩余 80% ｜ Claude/GPT 剩余 70%', bars: [] } }, 'gemini', ['gemini'], nameOf)[0]), ['Gemini 80%', 'Claude/GPT 70%'])
})

test('bars（Antigravity）：总行数超过 4 行（底栏放不下）时，「Agy C/G」并回 Gemini 那一行，只挑一格、不写重置时间', () => {
  const bars = [bar('Gemini 5小时', 1, 'Gemini', 5 * H), bar('Gemini 本周', 0.99, 'Gemini', 3 * D), bar('Argon 本周', 0.46, 'Argon', 4 * D),
                bar('Claude/GPT 5小时', 1, 'Claude/GPT', 5 * H), bar('Claude/GPT 本周', 0.7, 'Claude/GPT', 6 * D)]
  const quota = { claude: { text: '5小时 剩余 98% ｜ 本周 剩余 99%' }, gpt: { text: '5小时 剩余 12% ｜ 本周 剩余 78%' },
                  deepseek: { text: '余额 ¥23.60' }, gemini: { text: 'x 剩余 1%', bars } }
  const list = rows(quota, 'gemini', ['claude', 'gpt', 'deepseek', 'gemini'], nameOf)
  assert.strictEqual(list.length, 4)
  assert.deepStrictEqual(list.map(r => r.name), ['Gemini', 'Claude', 'DeepSeek', 'GPT'])
  const gem = text(list[0])
  assert.strictEqual(gem.length, 3)
  assert.deepStrictEqual(gem, ['周 99%', 'Arg 46%', 'C/G 周 70%'])   // Claude/GPT 池按同样的规则挑一格；并成一行时不写重置时间，不然太宽
  // 不拥挤时照旧拆成两行
  assert.deepStrictEqual(rows({ claude: quota.claude, gemini: quota.gemini }, 'claude', ['claude', 'gemini'], nameOf).map(r => r.name), ['Claude', 'Gemini', 'Agy C/G'])
})

// ---- 额度条样式的合并显示：每格换成短条（quota-bars 设计 2026-10-26 更新）----
test('compact 给百分比那一块标上 pct、标签那一块标上 label', () => {
  const parts = compact('5小时 剩余 98% · 07:50 重置', false)
  assert.strictEqual(parts.find(p => p.pct != null).pct, 98)
  assert.strictEqual(parts.find(p => p.label != null).label, '5h')
  assert.strictEqual(compact('余额 ¥4.96', false).some(p => p.pct != null), false)
})

test('barCell：窗口名（5h、周、今日）不写，池名（Arg、C/G）留着；颜色三档；余额不是条', () => {
  const { barCell, level } = require('../app/web/quota-aggregate.js')
  assert.deepStrictEqual(barCell(compact('5小时 剩余 98% · 07:50 重置', false)), { label: null, pct: 98, level: 'ok' })
  assert.deepStrictEqual(barCell(compact('本周 剩余 22%', false)), { label: null, pct: 22, level: 'mid' })
  assert.deepStrictEqual(barCell(compact('Arg 剩余 8%', false)), { label: 'Arg', pct: 8, level: 'low' })
  assert.deepStrictEqual(barCell(compact('C/G 周 剩余 70%', false)), { label: 'C/G', pct: 70, level: 'ok' })
  assert.deepStrictEqual(barCell(compact('Gemini 本周 剩余 40%', false)), { label: 'Gemini', pct: 40, level: 'ok' })
  assert.strictEqual(barCell(compact('余额 ¥4.96', false)), null)
  assert.deepStrictEqual([31, 30, 11, 10].map(level), ['ok', 'mid', 'mid', 'low'])
})

test('GPT、Claude 带 bars（没有 group）时，合并显示和只给 text 时一模一样（bars 只给额度条样式的单家显示用）', () => {
  const { view } = require('../app/web/codex-quota.js')
  const NOW = Math.floor(Date.now() / 1000)
  const v = view({ source: 'stale', at: NOW - 3600, rateLimits: { primary: { usedPercent: 10.5, windowDurationMins: 300, resetsAt: NOW + 7200 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: NOW - 60 } } }, NOW)
  const claude = { text: '5小时 剩余 70% ｜ 本周 剩余 40% · 10/29 重置', low: false, bars: [{ label: '5小时', left: 0.7, reset: NOW + 3600 }, { label: '本周', left: 0.4, reset: NOW + 3 * 86400 }] }
  const withBars = rows({ gpt: v, claude }, 'gpt', ['gpt', 'claude'], nameOf)
  const textOnly = rows({ gpt: { text: v.text, low: v.low }, claude: { text: claude.text, low: claude.low } }, 'gpt', ['gpt', 'claude'], nameOf)
  assert.deepStrictEqual(withBars.map(text), textOnly.map(text))
})
