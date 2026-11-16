// 小本子第二页：朋友留言的文案和挑法（notebook-friends.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const NF = require('../app/web/notebook-friends.js')

const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen', 'kimi']
const facts = { first: new Date(2026, 9, 28, 10).getTime(), minutes: 600, days: 12, rounds: 340, pats: 128 }
const days = n => Array.from({ length: n }, (_, i) => { const d = new Date(2026, 10, 1 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
const sig = b => JSON.stringify(b)

test('same_day_same_block：同一天打开看到的一样', () => {
  const a = NF.block({ owner: 'claude', friend: 'deepseek', level: 2, facts, day: '2026-11-09' })
  const b = NF.block({ owner: 'claude', friend: 'deepseek', level: 2, facts, day: '2026-11-09' })
  assert.equal(sig(a), sig(b))
})

test('next_day_may_change：30 天里至少出现 2 种', () => {
  for (const level of [0, 1, 2, 3]) {
    const seen = new Set(days(30).map((day, i) => sig(NF.block({ owner: 'claude', friend: 'deepseek', level, facts: { ...facts, days: facts.days + i }, day }).lines)))
    assert.ok(seen.size >= 2, `level ${level} 只有 ${seen.size} 种`)
  }
})

test('level_controls_amount：刚见面一句；好朋友有回复、贴纸；挚友来回几句、贴纸、合照', () => {
  for (const day of days(10)) {
    const l0 = NF.block({ owner: 'claude', friend: 'gpt', level: 0, facts, day })
    assert.equal(l0.lines.length, 1)
    assert.equal(l0.lines[0].who, 'gpt')
    assert.equal(l0.sticker, null); assert.equal(l0.photo, null); assert.ok(l0.hint)
    const l2 = NF.block({ owner: 'claude', friend: 'gpt', level: 2, facts, day })
    assert.ok(l2.lines.length >= 2 && l2.lines.some(l => l.who === 'claude'), sig(l2))
    assert.ok(l2.sticker); assert.equal(l2.photo, null); assert.ok(l2.hint)
    const l3 = NF.block({ owner: 'claude', friend: 'gpt', level: 3, facts, day })
    assert.ok(l3.lines.length >= 2 && l3.lines.some(l => l.who === 'claude') && l3.lines.some(l => l.who === 'gpt'), sig(l3))
    assert.ok(l3.sticker); assert.deepEqual(l3.photo, { date: facts.first }); assert.equal(l3.hint, null)
    assert.equal(NF.block({ owner: 'claude', friend: 'gpt', level: 3, facts: { ...facts, first: 0 }, day }).photo, null)
  }
})

test('msg_all_directed_pairs：七个角色两两、两个方向，好朋友和挚友每格至少 4 条', () => {
  for (const w of SEVEN) for (const o of SEVEN) if (w !== o) for (const level of [2, 3]) {
    const list = NF.MSG[w]?.[o]?.[level]
    assert.ok(list && list.length >= 4, `${w}→${o} ${level}`)
  }
})

test('lengths：写的人每句不超过 24 字，回复不超过 14 字，数字模板填满后不超过 24 字', () => {
  const said = (who, t, max) => assert.ok(t.length > 0 && [...t].length <= max, `${who}: ${t}`)
  for (const w of Object.keys(NF.MSG)) for (const o of Object.keys(NF.MSG[w])) for (const level of [2, 3]) for (const m of NF.MSG[w][o][level]) {
    for (const [who, t] of m.t) said(`${w}→${o}`, t, who === w ? 24 : 14)
    if (m.r) said(`${w}→${o} 回复`, m.r, 14)
  }
  for (const [w, by] of Object.entries(NF.GREET)) for (const level of [0, 1]) {
    assert.ok(by[level].length >= 3, `GREET ${w} ${level}`)
    for (const m of by[level]) for (const t of m.t) said(w, t, 24)
  }
  for (const [w, by] of Object.entries(NF.DATA_MSG)) for (const level of [1, 2, 3]) {
    assert.ok(by[level].length >= 2, `DATA_MSG ${w} ${level}`)
    for (const t of by[level]) said(w, t.replace(/\{date\}/g, '12 月 31 日').replace(/\{[hdnp]\}/g, '99999'), 24)
  }
  for (const w of [...SEVEN, '*']) {
    assert.ok(NF.GREET[w] && NF.DATA_MSG[w] && NF.STICKER[w]?.length && NF.CAMEO[w]?.length, w)
    for (const c of NF.CAMEO[w]) assert.ok((c.text && [...c.text].length <= 24) || (c.stamp && [...c.stamp].length <= 6), JSON.stringify(c))
  }
  for (const level of [0, 1, 2]) assert.ok(NF.HINT[level])
})

test('数字留言填的是真数字；用不上的数（没一起站满一小时）不挑', () => {
  const seen = new Set()
  for (const day of days(60)) for (const l of NF.block({ owner: 'claude', friend: 'deepseek', level: 1, facts: { ...facts, minutes: 30 }, day }).lines) {
    assert.ok(!/\{|\}/.test(l.text), l.text)
    assert.ok(!/ 0 个小时| 0 小时/.test(l.text), l.text)
    seen.add(l.text)
  }
  assert.ok([...seen].some(t => /12|340|128|10 月 28 日/.test(t)), [...seen].join(' / '))
})

test('generic_owner_and_friend：自定义角色（kimi）用通用的，不空', () => {
  for (const level of [0, 1, 2, 3]) for (const [owner, friend] of [['kimi', 'claude'], ['claude', 'kimi'], ['kimi', 'alice']]) {
    const b = NF.block({ owner, friend, level, facts, day: '2026-11-09' })
    assert.ok(b.lines.length >= 1 && b.lines.every(l => l.text), `${owner}/${friend}/${level}: ${sig(b)}`)
    assert.equal(b.lines[0].who, friend)
  }
})

test('cameo_rules：至少两个朋友、有一个好朋友以上才有；隔天出现；说话的是另一个朋友', () => {
  const day = '2026-11-09'
  assert.equal(NF.cameo({ owner: 'claude', friends: [{ id: 'grok', level: 3 }], day }), null)
  assert.equal(NF.cameo({ owner: 'claude', friends: [{ id: 'grok', level: 1 }, { id: 'gpt', level: 1 }], day }), null)
  const friends = [{ id: 'deepseek', level: 3 }, { id: 'grok', level: 2 }, { id: 'gpt', level: 1 }]
  const got = days(10).map(day => NF.cameo({ owner: 'claude', friends, day }))
  const shown = got.filter(Boolean)
  assert.ok(shown.length >= 2 && shown.length <= 8, `10 天出现 ${shown.length} 次`)
  for (const c of shown) {
    assert.notEqual(c.who, 'deepseek', '插嘴的不是第一个（心最多的）那个')
    assert.ok(['grok', 'gpt'].includes(c.who))
    assert.ok(c.text || c.stamp)
  }
  assert.equal(sig(NF.cameo({ owner: 'claude', friends, day })), sig(NF.cameo({ owner: 'claude', friends, day })))
})

test('rotate_cycles_without_repeat：一轮里不重复，下一轮从头来', () => {
  const list = ['a', 'b', 'c', 'd']
  const got = [0, 1, 2, 3].map(i => NF.rotate(list, 'claude|gpt|msg', i))
  assert.equal(new Set(got).size, 4)
  assert.equal(NF.rotate(list, 'claude|gpt|msg', 4), got[0])
})

test('block_rotates_by_days：按认识的天数轮流，和哪天打开无关', () => {
  const n = NF.MSG.gpt.claude[3].length
  const text = (days, day) => NF.block({ owner: 'claude', friend: 'gpt', level: 3, day, facts: { days } }).lines.map(l => l.text).join()
  const seen = new Set()
  for (let d = 0; d < n; d++) seen.add(text(d, '2026-11-01'))
  assert.equal(seen.size, n)
  assert.equal(text(1, '2026-11-01'), text(1, '2026-12-25'))
})
