process.env.TZ = 'Asia/Shanghai'   // fmt 用本地时间，测试固定时区
const test = require('node:test')
const assert = require('node:assert')
const R = require('../app/web/codex-resets.js')

const NOW = Date.parse('2026-10-14T15:00:00Z') / 1000
const base = (data) => ({ data: { latest_reset: null, scheduled_reset: null, active_watch: null, stats: { total: 61, last_reset_at: '2026-10-13T05:06:06.000Z', days_since_last: 1.4, avg_interval_days: 6.5 }, ...data }, meta: { api_version: 'v1' } })
const watch = (level, chance, extra = {}) => ({ level, reset_chance_percent: chance, forecast_window: 'next 48h', observed_at: '2026-10-14T10:00:00.000Z', expires_at: '2026-10-16T10:00:00.000Z', text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'https://x.com/a/status/1' }, ...extra })
const sched = (extra = {}) => ({ id: '999', status: 'scheduled', reset_type: 'regular', announced_at: '2026-10-14T12:00:00.000Z', scheduled_for: '2026-10-16T06:00:00.000Z', text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'https://x.com/a/status/999' }, ...extra })

test('parse：全空（真实接口 10-14 的样子）', () => {
  const d = R.parse(base({ latest_reset: { id: '210', reset_type: 'regular', announced_at: '2026-10-13T05:06:06.000Z', text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'u' } } }))
  assert.strictEqual(d.announced, null)
  assert.strictEqual(d.watch, null)
  assert.deepStrictEqual(d.latest, { id: '210', at: Date.parse('2026-10-13T05:06:06Z') / 1000, card: false })
  assert.deepStrictEqual(d.stats, { since: 1.4, avg: 6.5 })
})

test('parse：不认识的形状返回 null 或把那一块当没有', () => {
  for (const bad of [null, {}, { data: null }, { data: 3 }, 'x']) assert.strictEqual(R.parse(bad), null)
  const d = R.parse(base({ active_watch: { level: 'huge' }, scheduled_reset: { id: 5 }, stats: { days_since_last: 'a' } }))
  assert.strictEqual(d.watch, null)
  assert.strictEqual(d.announced, null)
  assert.strictEqual(d.stats, null)
})

test('notice：有宣布才有一行；带时间 / 不带时间', () => {
  assert.strictEqual(R.notice(R.parse(base({})), 0), '')
  assert.strictEqual(R.notice(R.parse(base({ active_watch: watch('strong', 90) })), 0), '')
  assert.strictEqual(R.notice(R.parse(base({ scheduled_reset: sched() })), 0), '🔔 官方已宣布重置 · 预计 10/16 14:00')
  assert.strictEqual(R.notice(R.parse(base({ scheduled_reset: sched({ scheduled_for: null }) })), 0), '🔔 官方已宣布重置，还没生效')
})

test('notice：宣布已执行就不显示（站点记为已执行，或我们在宣布之后看到额度重置）', () => {
  const done = R.parse(base({ scheduled_reset: sched(), latest_reset: { id: '999', reset_type: 'regular', announced_at: '2026-10-14T13:00:00.000Z', text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'u' } } }))
  assert.strictEqual(R.notice(done, 0), '')
  const d = R.parse(base({ scheduled_reset: sched() }))
  assert.strictEqual(R.notice(d, Date.parse('2026-10-14T13:00:00Z') / 1000), '')   // 宣布 12:00，13:00 我们看到重置
  assert.notStrictEqual(R.notice(d, Date.parse('2026-10-14T11:00:00Z') / 1000), '') // 宣布之前的重置不算
})

test('answer：各档的动作、台词键和填空', () => {
  const a = (data) => R.answer(R.parse(base(data)), NOW, 0)
  assert.deepStrictEqual(a({ scheduled_reset: sched() }), { tier: 'announced', pose: 'reset_bell', key: 'resetAnnounced', vars: { when: '10/16 14:00' } })
  assert.deepStrictEqual(a({ active_watch: watch('strong', 85) }), { tier: 'high', pose: 'reset_hope', key: 'resetHigh', vars: { chance: 85, window: '接下来 48 小时内' } })
  assert.strictEqual(a({ active_watch: watch('elevated', 70) }).tier, 'high')
  assert.strictEqual(a({ active_watch: watch('elevated', 50) }).tier, 'mid')
  assert.strictEqual(a({ active_watch: watch('elevated', 50) }).pose, 'reset_maybe')
  assert.strictEqual(a({ active_watch: watch('elevated', 10) }).pose, 'reset_nope')
  assert.strictEqual(a({ active_watch: watch('elevated', 29) }).tier, 'low')
  assert.strictEqual(a({ active_watch: watch('strong', null) }).tier, 'mid')     // 没给概率但等级高：不能说「不太像」
  assert.strictEqual(a({ active_watch: watch('elevated', null) }).tier, 'low')
  assert.deepStrictEqual(a({}), { tier: 'none', pose: 'reset_nope', key: 'resetNone', vars: { since: '1.4', avg: '6.5' } })
  assert.strictEqual(R.answer(R.parse(base({ stats: null })), NOW, 0).key, 'resetQuiet')
  assert.deepStrictEqual(R.answer(null, NOW, 0), { tier: 'offline', pose: 'reset_nope', key: 'resetOffline', vars: {} })
  assert.strictEqual(R.answer(R.parse(base({ scheduled_reset: sched({ scheduled_for: null }) })), NOW, 0).vars.when, '很快')
})

test('answer：宣布之后已经重置了（站点记为已执行，或我们看到额度重置）→ 说已经重置了，不说没风声', () => {
  const done = R.parse(base({ scheduled_reset: sched(), latest_reset: { id: '999', reset_type: 'regular', announced_at: '2026-10-14T13:00:00.000Z', text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'u' } } }))
  assert.deepStrictEqual(R.answer(done, NOW, 0), { tier: 'done', pose: 'reset', key: 'resetDone', vars: {} })
  const seen = R.parse(base({ scheduled_reset: sched() }))
  assert.strictEqual(R.answer(seen, NOW, Date.parse('2026-10-14T13:00:00Z') / 1000).tier, 'done')
  assert.strictEqual(R.toAnnounce(seen, NOW, Date.parse('2026-10-14T13:00:00Z') / 1000, []), null)   // 已经重置了：不主动说
})

test('answer：过期的预测按没有预测回答', () => {
  const d = R.parse(base({ active_watch: watch('strong', 90, { expires_at: '2026-10-14T14:00:00.000Z' }) }))
  assert.strictEqual(R.answer(d, NOW, 0).tier, 'none')
})

test('toAnnounce：新的强预测 / 新宣布说一次，说过的、弱的、过期的不说', () => {
  const strong = R.parse(base({ active_watch: watch('strong', 60) }))
  assert.deepStrictEqual(R.toAnnounce(strong, NOW, 0, []), { id: 'w:2026-10-14T10:00:00.000Z' })
  assert.strictEqual(R.toAnnounce(strong, NOW, 0, ['w:2026-10-14T10:00:00.000Z']), null)
  assert.ok(R.toAnnounce(R.parse(base({ active_watch: watch('elevated', 75) })), NOW, 0, []))
  assert.strictEqual(R.toAnnounce(R.parse(base({ active_watch: watch('elevated', 50) })), NOW, 0, []), null)
  assert.strictEqual(R.toAnnounce(R.parse(base({ active_watch: watch('elevated', null) })), NOW, 0, []), null)
  assert.strictEqual(R.toAnnounce(R.parse(base({ active_watch: watch('strong', 90, { expires_at: '2026-10-14T14:00:00.000Z' }) })), NOW, 0, []), null)
  assert.deepStrictEqual(R.toAnnounce(R.parse(base({ scheduled_reset: sched(), active_watch: watch('strong', 90) })), NOW, 0, []), { id: 'a:999' })
  assert.strictEqual(R.toAnnounce(null, NOW, 0, []), null)
})

test('windowText / fill', () => {
  assert.strictEqual(R.windowText('next 48h'), '接下来 48 小时内')
  assert.strictEqual(R.windowText('next 2 days'), '接下来 2 天内')
  assert.strictEqual(R.windowText('within 24h'), '24 小时内')   // 站点 10 月实际给的写法（@chin190 在 #16 报的）
  assert.strictEqual(R.windowText('Within 2 days'), '2 天内')
  assert.strictEqual(R.windowText('in 12 hours'), '12 小时内')
  assert.strictEqual(R.windowText('this week'), '')   // 认不出：不硬塞英文进句子
  assert.strictEqual(R.fill('{chance}%，{window}', { chance: 85, window: '接下来 48 小时内' }), '85%，接下来 48 小时内')
  assert.strictEqual(R.fill('没有 {x}', {}), '没有 {x}')
})

test('LINES：每个台词键都有默认句', () => {
  for (const k of ['resetAnnounced', 'resetDone', 'resetCard', 'resetHigh', 'resetMid', 'resetLow', 'resetNone', 'resetNoneCard', 'resetQuiet', 'resetOffline'])
    assert.ok(Array.isArray(R.LINES[k]) && R.LINES[k].length, k)
})

test('answer：窗口认不出时不带 window', () => {
  const d = R.parse(base({ active_watch: watch('strong', 85, { forecast_window: 'sometime soon' }) }))
  const a = R.answer(d, NOW, 0)
  assert.strictEqual(a.tier, 'high')
  assert.deepStrictEqual(a.vars, { chance: 85 })
  assert.deepStrictEqual(R.answer(R.parse(base({ active_watch: watch('strong', 85, { forecast_window: 'within 24h' }) })), NOW, 0).vars, { chance: 85, window: '24 小时内' })
})

test('usableLines：只挑数据齐全的句子，角色的都用不了时退回默认句', () => {
  const own = ['{chance}%。{window}，可以期待一下。', '{chance}%，这次真有戏。']
  assert.deepStrictEqual(R.usableLines(own, 'resetHigh', { chance: 85 }), ['{chance}%，这次真有戏。'])
  assert.deepStrictEqual(R.usableLines(own, 'resetHigh', { chance: 85, window: '24 小时内' }), own)
  assert.deepStrictEqual(R.usableLines(['{window}……要重置了吧？吧？'], 'resetHigh', { chance: 85 }), R.LINES.resetHigh.filter(l => !l.includes('{window}')))
  assert.ok(R.usableLines(['{window}……'], 'resetHigh', { chance: 85 }).length > 0)
  assert.deepStrictEqual(R.usableLines(['有点风声，{chance}% 吧'], 'resetMid', {}), ['有点风声……别太指望。'])
  assert.deepStrictEqual(R.usableLines(['{x}'], 'nope', {}), [''])
})

// 官方没提前宣布、直接发「已经重置」（10-20 那次就是这样）：重置后 5 小时内算「刚重置过」
const latestAt = (sec) => ({ id: 'r1', reset_type: 'regular', announced_at: new Date(sec * 1000).toISOString(), text: 't', source: { type: 'x_post', author: 'thsottiaux', url: 'u' } })
test('刚重置过：5 小时内问她答 recent，过了答 none', () => {
  const d = R.parse(base({ latest_reset: latestAt(NOW - 2 * 3600) }))
  const a = R.answer(d, NOW, 0)
  assert.strictEqual(a.tier, 'recent')
  assert.strictEqual(a.pose, 'reset')
  assert.strictEqual(a.key, 'resetRecent')
  assert.strictEqual(a.vars.ago, '2 小时前')
  assert.strictEqual(R.answer(R.parse(base({ latest_reset: latestAt(NOW - 20 * 60) })), NOW, 0).vars.ago, '20 分钟前')
  assert.strictEqual(R.answer(R.parse(base({ latest_reset: latestAt(NOW - 6 * 3600) })), NOW, 0).tier, 'none')
})
test('刚重置过：额度下方的一行', () => {
  assert.strictEqual(R.notice(R.parse(base({ latest_reset: latestAt(NOW - 2 * 3600) })), 0, NOW), '✨ 2 小时前刚重置过')
  assert.strictEqual(R.notice(R.parse(base({ latest_reset: latestAt(NOW - 6 * 3600) })), 0, NOW), '')
})
test('刚重置过：新宣布优先于「刚重置过」', () => {
  const d = R.parse(base({ latest_reset: latestAt(NOW - 3600), scheduled_reset: sched() }))
  assert.strictEqual(R.answer(d, NOW, 0).tier, 'announced')
  assert.ok(R.notice(d, 0, NOW).startsWith('🔔'))
})
test('刚重置过：主动说一次；说过或我们自己已经看到重置就不说', () => {
  const d = R.parse(base({ latest_reset: latestAt(NOW - 3600) }))
  assert.deepStrictEqual(R.toAnnounce(d, NOW, 0, []), { id: 'r:r1' })
  assert.strictEqual(R.toAnnounce(d, NOW, 0, ['r:r1']), null)
  assert.strictEqual(R.toAnnounce(d, NOW, NOW - 600, []), null)   // 额度变化已经判出重置、庆祝过了
  assert.strictEqual(R.toAnnounce(R.parse(base({ latest_reset: latestAt(NOW - 6 * 3600) })), NOW, 0, []), null)
})
test('LINES：resetRecent 有默认句', () => {
  assert.ok(R.LINES.resetRecent.length && R.LINES.resetRecent.every(l => l.includes('{ago}') || !l.includes('{')))
})

// 11-01 官方两次都是发重置卡（reset_type: banked，「Banked 1/2」「Banked 2/2」）：额度不会自己满，不能说「刚重置过、额度满满」
const cardAt = (sec, id = 'c1') => ({ ...latestAt(sec), id, reset_type: 'banked' })
test('发重置卡：一天内问她答 card，不算刚重置过；过了一天答 none 但说上次是卡', () => {
  const a = R.answer(R.parse(base({ latest_reset: cardAt(NOW - 3 * 3600) })), NOW, 0)
  assert.deepStrictEqual(a, { tier: 'card', pose: 'reset_hope', key: 'resetCard', vars: { ago: '3 小时前' } })
  const b = R.answer(R.parse(base({ latest_reset: cardAt(NOW - 30 * 3600) })), NOW, 0)
  assert.strictEqual(b.tier, 'none')
  assert.strictEqual(b.key, 'resetNoneCard')
  assert.strictEqual(R.answer(R.parse(base({ latest_reset: latestAt(NOW - 30 * 3600) })), NOW, 0).key, 'resetNone')
})
test('发重置卡：额度下方写「发了重置卡」，主动说一次（c: 开头），说过不再说', () => {
  const d = R.parse(base({ latest_reset: cardAt(NOW - 3 * 3600) }))
  assert.strictEqual(R.notice(d, 0, NOW), '🎟️ 3 小时前发了重置卡，要自己去用')
  assert.deepStrictEqual(R.toAnnounce(d, NOW, 0, []), { id: 'c:c1' })
  assert.strictEqual(R.toAnnounce(d, NOW, 0, ['c:c1']), null)
  assert.strictEqual(R.notice(R.parse(base({ latest_reset: cardAt(NOW - 30 * 3600) })), 0, NOW), '')
})
test('没有 reset_type 的旧数据照旧当直接重置', () => {
  const l = latestAt(NOW - 2 * 3600); delete l.reset_type
  assert.strictEqual(R.answer(R.parse(base({ latest_reset: l })), NOW, 0).tier, 'recent')
})
