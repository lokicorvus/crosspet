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

test('lengths_fit：写的人 ≤ 24 字，回复 ≤ 14 字', () => {
  const walk = (x, out) => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v, out); return out }
  for (const s of walk(E.EVENT_MSG, [])) assert.ok(len(fill(s)) <= 24, `太长：${s}`)
  for (const s of walk(E.EVENT_REPLY, [])) assert.ok(len(fill(s)) <= 14, `太长：${s}`)
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
  assert.equal(b.lines.length, 2); assert.equal(b.lines[1].who, 'claude')
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

test('pats_picks_by_kind', () => {
  const b = E.block({ ev: ev('pats', { n: 25, m: 'pokes' }), owner: 'claude', level: 1 })
  assert.ok(E.EVENT_MSG.pats.gemini.pokes.map(t => t.replace('{n}', 25)).includes(b.lines[0].text), b.lines[0].text)
})
