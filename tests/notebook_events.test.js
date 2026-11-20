// 小本子第二页「事」的留言模板和挑法（notebook-events.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const E = require('../app/web/notebook-events.js')
const NF = require('../app/web/notebook-friends.js')

const FESTS = ['halloween', 'christmas', 'newyear', 'spring', 'lantern', 'dragonboat', 'midautumn', 'national']
const len = s => [...s].length
const fill = s => s.replace(/\{n\}/g, '99999').replace(/\{fest\}/g, '元宵节')
const atLeast = (list, n, what) => assert.ok(Array.isArray(list) && list.length >= n, `${what}：${list ? list.length : '没有'} 条`)

// 每种事、每个写的人要写够的条数（四套皮肤的 fest 只要求通用的）
function checkWriter(w, { allFests }) {
  const M = E.EVENT_MSG
  for (const lv of [1, 2, 3]) atLeast(M.levelup[w]?.[lv], 2, `${w} levelup ${lv}`)
  for (const k of ['chat', 'anniv', 'busy', 'reunion']) atLeast(M[k][w], 2, `${w} ${k}`)
  atLeast(M.pats[w]?.pats, 2, `${w} pats`); atLeast(M.pats[w]?.pokes, 2, `${w} pokes`)
  atLeast(M.fest[w]?.['*'], 2, `${w} fest *`)
  if (allFests) for (const f of FESTS) atLeast(M.fest[w]?.[f], 1, `${w} fest ${f}`)
  for (const k of ['levelup', 'anniv']) atLeast(E.EVENT_REPLY[k][w], 2, `${w} reply ${k}`)
}

test('every_kind_has_generic_and_base_writers', () => {
  checkWriter('*', { allFests: false })
  for (const w of NF.SEVEN) checkWriter(w, { allFests: true })
  assert.deepEqual(Object.keys(E.FEST_NAMES).sort(), [...FESTS].sort())
})

// 2026-11-18：便条要短。Gemini 第一版把「事」写到平均 17 字、三成 20 字以上，读着像散文，收紧到 18 / 12
test('lengths_fit：写的人 ≤ 18 字，回复 ≤ 12 字', () => {
  const walk = (x, out) => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v, out); return out }
  for (const s of walk(E.EVENT_MSG, [])) assert.ok(len(fill(s)) <= 18, `太长：${s}`)
  for (const s of walk(E.EVENT_REPLY, [])) assert.ok(len(s) <= 12, `太长：${s}`)
  // 回复不填数字（block 只给朋友那句填 {n}），写了空会原样显示成「{n}」
  for (const s of walk(E.EVENT_REPLY, [])) assert.ok(!/[{}]/.test(s), `回复里不能有空：${s}`)
  for (const s of walk(E.EVENT_MSG, [])) assert.ok(!/\{(?!n\}|fest\})/.test(s), `不认识的空：${s}`)
})

const ev = (kind, more) => ({ day: '2026-11-16', kind, owner: 'claude', friend: 'gemini', ...more })
const textOf = b => b.lines.map(l => l.text)

test('block_falls_back_skin_base_generic', () => {
  const b = E.block({ ev: ev('busy', { n: 40 }), owner: 'claude', friendSkin: 'no-such-skin', level: 1 })
  assert.ok(E.EVENT_MSG.busy.gemini.map(t => t.replace('{n}', 40)).includes(b.lines[0].text), b.lines[0].text)
  assert.equal(b.lines[0].who, 'gemini')
  const c = E.block({ ev: ev('busy', { n: 40, friend: 'alice' }), owner: 'claude', level: 1 })
  assert.ok(E.EVENT_MSG.busy['*'].map(t => t.replace('{n}', 40)).includes(c.lines[0].text), c.lines[0].text)
})

test('block_reply_only_for_close_friends', () => {
  assert.equal(E.block({ ev: ev('levelup', { n: 1 }), owner: 'claude', level: 1 }).lines.length, 1)
  const b = E.block({ ev: ev('levelup', { n: 2 }), owner: 'claude', level: 2 })
  assert.equal(b.lines.length, 3); assert.equal(b.lines[2].who, 'claude')  // 中间一行是送小帮手
  assert.equal(E.block({ ev: ev('chat', { q: 'x' }), owner: 'claude', level: 3 }).lines.length, 1)
})

test('block_same_day_same_text', () => {
  const a = E.block({ ev: ev('anniv', { n: 30 }), owner: 'claude', level: 2 })
  assert.deepEqual(a, E.block({ ev: ev('anniv', { n: 30 }), owner: 'claude', level: 2 }))
  assert.ok(textOf(a)[0].includes('30') || E.EVENT_MSG.anniv.gemini.some(t => !t.includes('{n}')))
})

test('fest_uses_named_festival_then_generic', () => {
  const b = E.block({ ev: ev('fest', { n: 'midautumn' }), owner: 'claude', level: 1 })
  assert.ok(E.EVENT_MSG.fest.gemini.midautumn.map(t => t.replace('{fest}', '中秋节')).includes(b.lines[0].text), b.lines[0].text)
})

test('chat_block_quotes', () => {
  assert.equal(E.block({ ev: ev('chat', { q: '你好呀' }), owner: 'claude', level: 0 }).quote, '你好呀')
  assert.equal(E.block({ ev: ev('busy', { n: 30 }), owner: 'claude', level: 1 }).quote, null)
})

// 「聊过」下面引的是她当时随口说的一句，常常不是问句（「下雨就睡觉！」）：开头写「问你的」就接不上
test('chat_intro_fits_any_quote：开头以冒号结尾，不说「问」', () => {
  for (const [id, list] of Object.entries(E.EVENT_MSG.chat)) for (const t of list) {
    assert.ok(/[：:]$/.test(t), `${id} 要以冒号结尾：${t}`)
    assert.ok(!t.includes('问'), `${id} 下面引的不一定是问句：${t}`)
  }
})

test('pats_picks_by_kind', () => {
  const b = E.block({ ev: ev('pats', { n: 25, m: 'pokes' }), owner: 'claude', level: 1 })
  assert.ok(E.EVENT_MSG.pats.gemini.pokes.map(t => t.replace('{n}', 25)).includes(b.lines[0].text), b.lines[0].text)
})

test('skins_have_their_own：四套性格皮肤每种事都有自己的', () => {
  for (const s of ['gpt-onesie', 'deepseek-hoodie', 'claude-saint', 'gemini-magician']) checkWriter(s, { allFests: false })
})

test('levelup_two_adds_gift_line：好朋友那句后面多一句送小帮手，在主人回复之前', () => {
  const ev = { kind: 'levelup', n: 2, friend: 'deepseek', day: '2026-11-20' }
  const b = E.block({ ev, owner: 'claude', level: 2 })
  assert.equal(b.lines.length, 3)
  assert.equal(b.lines[0].who, 'deepseek'); assert.equal(b.lines[1].who, 'deepseek'); assert.equal(b.lines[2].who, 'claude')
  assert.ok(E.GIFT_LINE.deepseek.includes(b.lines[1].text))
  assert.deepEqual(E.block({ ev, owner: 'claude', level: 2 }), b)
  const one = E.block({ ev: { ...ev, n: 1 }, owner: 'claude', level: 1 })
  assert.equal(one.lines.length, 1)
  const three = E.block({ ev: { ...ev, n: 3 }, owner: 'claude', level: 3 })
  assert.equal(three.lines.length, 2)
  // 皮肤退回原角色，没写的退回 '*'
  const sk = E.block({ ev: { ...ev, friend: 'gpt' }, owner: 'claude', friendSkin: 'gpt-onesie', level: 2 })
  assert.ok(E.GIFT_LINE.gpt.includes(sk.lines[1].text))
  const un = E.block({ ev: { ...ev, friend: 'mine' }, owner: 'claude', level: 2 })
  assert.ok(E.GIFT_LINE['*'].includes(un.lines[1].text))
  for (const id of ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'kimi', 'qwen']) {
    assert.ok(E.GIFT_LINE[id].length >= 1)
    for (const t of E.GIFT_LINE[id]) assert.ok(len(t) <= 22, t)
  }
})

test('gift_line_follows_gift_flag：有 gift 字段按它，旧记录按 n===2', () => {
  const ev = { kind: 'levelup', friend: 'deepseek', day: '2026-11-20' }
  const lv = (e, level) => E.block({ ev: { ...ev, ...e }, owner: 'claude', level }).lines
  assert.equal(lv({ n: 3, gift: true }, 3).length, 3)   // 1 直接跳到 3
  assert.equal(lv({ n: 3, gift: false }, 3).length, 2)  // 2 升 3
  assert.equal(lv({ n: 2 }, 2).length, 3)               // 旧记录没 gift 字段
  assert.equal(lv({ n: 3 }, 3).length, 2)
})

test('gift_line_keeps_old_lines：加了送小帮手那句，旧的好朋友记录里别的句子一字不变', () => {
  // gift: false 走的就是加这句之前的路（只有好友那句 + 主人回复），拿它当「以前写出来的样子」
  let checked = 0
  for (const owner of ['claude', 'gpt', 'deepseek', 'gemini'])
    for (const friend of ['claude', 'gpt', 'deepseek', 'gemini', 'kimi', 'glm']) {
      if (friend === owner) continue
      for (let d = 1; d <= 30; d++) {
        const ev = { kind: 'levelup', n: 2, friend, day: `2026-11-${String(d).padStart(2, '0')}` }
        const now = E.block({ ev, owner, level: 2 }).lines
        const before = E.block({ ev: { ...ev, gift: false }, owner, level: 2 }).lines
        assert.equal(now.length, 3); assert.equal(before.length, 2)
        assert.deepEqual([now[0], now[2]], before, `${owner}/${friend}/${ev.day}`)
        checked++
      }
    }
  assert.ok(checked > 300)
})
