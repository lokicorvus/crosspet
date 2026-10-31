const test = require('node:test')
const assert = require('node:assert/strict')
const F = require('../app/web/friendship.js')

// 用本地时间构造，日期边界跟着本机时区走，不依赖时区
const at = (d, h, min = 0) => new Date(2026, 9, d, h, min).getTime()

test('pairKey 按字典序用 + 连起来；同角色为 null', () => {
  assert.equal(F.pairKey('gpt', 'claude'), 'claude+gpt')
  assert.equal(F.pairKey('claude', 'gpt'), 'claude+gpt')
  assert.equal(F.pairKey('gpt', 'gpt'), null)
})

test('同角色、未知 kind 不加点，store 不变', () => {
  const store = { 'claude+gpt': { points: 5, day: '2026-10-31', today: 5, lastCowork: 0 } }
  assert.deepEqual(F.award(store, 'gpt', 'gpt', 'together', at(31, 10)), store)
  assert.deepEqual(F.award(store, 'gpt', 'claude', 'hug', at(31, 10)), store)
})

test('四种加点：together +1、cowork +3、cofinish +2、pats +2', () => {
  const now = at(31, 10)
  assert.equal(F.award({}, 'gpt', 'claude', 'together', now)['claude+gpt'].points, 1)
  assert.equal(F.award({}, 'gpt', 'claude', 'cowork', now)['claude+gpt'].points, 3)
  assert.equal(F.award({}, 'gpt', 'claude', 'cofinish', now)['claude+gpt'].points, 2)
  assert.equal(F.award({}, 'gpt', 'claude', 'pats', now)['claude+gpt'].points, 2)
  const rec = F.award({}, 'claude', 'gpt', 'together', now)['claude+gpt']
  assert.deepEqual(rec, { points: 1, day: '2026-10-31', today: 1, lastCowork: 0 })
})

test('award 返回新对象，不改原对象', () => {
  const store = { 'claude+gpt': { points: 5, day: '2026-10-31', today: 5, lastCowork: 0 } }
  const snapshot = JSON.parse(JSON.stringify(store))
  const next = F.award(store, 'gpt', 'claude', 'pats', at(31, 10))
  assert.notEqual(next, store)
  assert.deepEqual(store, snapshot)
  assert.equal(next['claude+gpt'].points, 7)
})

test('10 分钟内两次 cowork 只加 3；过了 10 分钟再加', () => {
  let s = F.award({}, 'gpt', 'claude', 'cowork', at(31, 10, 0))
  s = F.award(s, 'claude', 'gpt', 'cowork', at(31, 10, 9))
  assert.equal(s['claude+gpt'].points, 3)
  s = F.award(s, 'gpt', 'claude', 'cowork', at(31, 10, 10))
  assert.equal(s['claude+gpt'].points, 6)
})

test('每对每天最多 +25，部分加点会被截到上限；跨天重新算', () => {
  let s = {}
  for (let i = 0; i < 24; i++) s = F.award(s, 'gpt', 'claude', 'together', at(31, 10))
  assert.equal(s['claude+gpt'].points, 24)
  s = F.award(s, 'gpt', 'claude', 'cowork', at(31, 11))
  assert.equal(s['claude+gpt'].points, 25)
  s = F.award(s, 'gpt', 'claude', 'pats', at(31, 12))
  assert.equal(s['claude+gpt'].points, 25)
  // 别的对不受影响
  s = F.award(s, 'gpt', 'deepseek', 'pats', at(31, 12))
  assert.equal(s['deepseek+gpt'].points, 2)
  // 第二天（本地日期）重新算
  s = F.award(s, 'gpt', 'claude', 'pats', new Date(2026, 10, 1, 0, 5).getTime())
  assert.equal(s['claude+gpt'].points, 27)
  assert.equal(s['claude+gpt'].today, 2)
  assert.equal(s['claude+gpt'].day, '2026-11-01')
})

test('hearts：门槛 10/40/90/160/250，到下一档一半加 0.5', () => {
  const cases = [[0, 0], [9, 0], [10, 1], [24, 1], [25, 1.5], [39, 1.5], [40, 2], [65, 2.5],
    [90, 3], [125, 3.5], [160, 4], [205, 4.5], [249, 4.5], [250, 5], [999, 5]]
  for (const [p, h] of cases) assert.equal(F.hearts(p), h, `points ${p}`)
})

test('rows：只列 points > 0，按点数从高到低，label 用名字（没有名字用 id）', () => {
  const store = {
    'claude+gpt': { points: 12, day: '2026-10-31', today: 12, lastCowork: 0 },
    'deepseek+gpt': { points: 40, day: '2026-10-31', today: 25, lastCowork: 0 },
    'claude+deepseek': { points: 0, day: '2026-10-31', today: 0, lastCowork: 0 },
    'claude+qwen': { points: 3, day: '2026-10-31', today: 3, lastCowork: 0 },
  }
  const names = { claude: 'Claude', gpt: 'GPT', deepseek: 'DeepSeek' }
  assert.deepEqual(F.rows(store, names), [
    { a: 'deepseek', b: 'gpt', label: 'DeepSeek ♥ GPT', hearts: 2 },
    { a: 'claude', b: 'gpt', label: 'Claude ♥ GPT', hearts: 1 },
    { a: 'claude', b: 'qwen', label: 'Claude ♥ qwen', hearts: 0 },
  ])
  assert.deepEqual(F.rows({}, names), [])
})

test('间隔常量', () => {
  assert.equal(F.TOGETHER_MS, 600_000)
  assert.equal(F.COFINISH_MS, 300_000)
  assert.equal(F.PATS_MS, 300_000)
})
