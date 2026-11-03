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

test('四种加点：together +1、cowork +2、cofinish +2、pats +2', () => {
  const now = at(31, 10)
  assert.equal(F.award({}, 'gpt', 'claude', 'together', now)['claude+gpt'].points, 1)
  assert.equal(F.award({}, 'gpt', 'claude', 'cowork', now)['claude+gpt'].points, 2)
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

test('10 分钟内两次 cowork 只加 2；过了 10 分钟再加', () => {
  let s = F.award({}, 'gpt', 'claude', 'cowork', at(31, 10, 0))
  s = F.award(s, 'claude', 'gpt', 'cowork', at(31, 10, 9))
  assert.equal(s['claude+gpt'].points, 2)
  s = F.award(s, 'gpt', 'claude', 'cowork', at(31, 10, 10))
  assert.equal(s['claude+gpt'].points, 4)
})

test('每对每天最多 +15，部分加点会被截到上限；跨天重新算', () => {
  let s = {}
  for (let i = 0; i < 14; i++) s = F.award(s, 'gpt', 'claude', 'together', at(31, 10))
  assert.equal(s['claude+gpt'].points, 14)
  s = F.award(s, 'gpt', 'claude', 'cowork', at(31, 11))
  assert.equal(s['claude+gpt'].points, 15)
  s = F.award(s, 'gpt', 'claude', 'pats', at(31, 12))
  assert.equal(s['claude+gpt'].points, 15)
  // 别的对不受影响
  s = F.award(s, 'gpt', 'deepseek', 'pats', at(31, 12))
  assert.equal(s['deepseek+gpt'].points, 2)
  // 第二天（本地日期）重新算
  s = F.award(s, 'gpt', 'claude', 'pats', new Date(2026, 10, 1, 0, 5).getTime())
  assert.equal(s['claude+gpt'].points, 17)
  assert.equal(s['claude+gpt'].today, 2)
  assert.equal(s['claude+gpt'].day, '2026-11-01')
})

test('hearts：0–10 颗整心，门槛 15/35/65/105/150/200/255/315/380/450（前快后慢）', () => {
  const cases = [[0, 0], [14, 0], [15, 1], [34, 1], [35, 2], [65, 3], [104, 3], [105, 4], [150, 5],
    [200, 6], [255, 7], [314, 7], [315, 8], [380, 9], [449, 9], [450, 10], [9999, 10]]
  for (const [p, h] of cases) assert.equal(F.hearts(p), h, `points ${p}`)
})

test('rows：只列 points > 0，按点数从高到低，label 用名字（没有名字用 id）', () => {
  const store = {
    'claude+gpt': { points: 20, day: '2026-10-31', today: 12, lastCowork: 0 },
    'deepseek+gpt': { points: 40, day: '2026-10-31', today: 15, lastCowork: 0 },
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
