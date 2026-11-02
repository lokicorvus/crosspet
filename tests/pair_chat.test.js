const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')
const P = require('../app/web/pair-chat.js')
const F = require('../app/web/friendship.js')

// 上线的角色（不含彩蛋、皮肤）：characters/*/character.json 里没有 egg、skinOf 的
const DIR = path.join(__dirname, '..', 'characters')
const CHARS = fs.readdirSync(DIR).filter(id => {
  try { const j = JSON.parse(fs.readFileSync(path.join(DIR, id, 'character.json'), 'utf8')); return !j.egg && !j.skinOf } catch { return false }
}).sort()
const seq = list => { let i = 0; return () => list[i++ % list.length] }

test('每一对都有台词：三档、每档至少两段，每段一问一答、两个人各说一句', () => {
  assert.ok(CHARS.length >= 7)
  for (let i = 0; i < CHARS.length; i++) for (let j = i + 1; j < CHARS.length; j++) {
    const key = F.pairKey(CHARS[i], CHARS[j])
    assert.equal(P.keyOf(CHARS[j], CHARS[i]), key)
    const tiers = P.LINES[key]
    assert.ok(tiers, `缺 ${key}`)
    assert.equal(tiers.length, 3, key)
    for (const tier of tiers) {
      assert.ok(tier.length >= 2, key)
      for (const lines of tier) {
        assert.equal(lines.length, 2, key)
        const who = lines.map(([w]) => w)
        assert.notEqual(who[0], who[1], `${key} 同一个人自问自答`)
        for (const [w, text] of lines) {
          assert.ok(key.split('+').includes(w), `${key} 里出现了 ${w}`)
          assert.ok(typeof text === 'string' && text.length > 0 && text.length <= 14, `${key} 这句太长：${text}`)
        }
      }
    }
  }
  assert.equal(Object.keys(P.LINES).length, CHARS.length * (CHARS.length - 1) / 2, '不该有多余的对')
})

test('心数分档：0–3 / 4–7 / 8–10', () => {
  assert.deepEqual([0, 3, 4, 7, 8, 10].map(P.tierOf), [0, 0, 1, 1, 2, 2])
})

const base = { present: ['claude', 'gpt'], hearts10: () => 0, nowMs: 100 * 60_000, lastAt: 0 }

test('离上次不到 12 分钟、掷没中、凑不出一对闲着的：不说', () => {
  assert.equal(P.pick({ ...base, lastAt: base.nowMs - P.GAP_MS + 1, rnd: () => 0 }), null)
  assert.equal(P.pick({ ...base, rnd: () => P.CHANCE }), null)
  assert.equal(P.pick({ ...base, busy: ['gpt'], rnd: () => 0 }), null)
  assert.equal(P.pick({ ...base, present: ['claude', 'claude'], rnd: () => 0 }), null)
})

test('挑中：按心数拿那一档；最近说过的不重复（全说过了再从头来）', () => {
  const low = P.pick({ ...base, rnd: () => 0 })
  assert.equal(low.key, 'claude+gpt'); assert.equal(low.tier, 0); assert.deepEqual(low.lines, P.LINES['claude+gpt'][0][0])
  const high = P.pick({ ...base, hearts10: k => k === 'claude+gpt' ? 9 : 0, rnd: () => 0 })
  assert.equal(high.tier, 2)
  const next = P.pick({ ...base, recent: [low.id], rnd: () => 0 })
  assert.equal(next.id, 'claude+gpt/0/1')
  const again = P.pick({ ...base, recent: ['claude+gpt/0/0', 'claude+gpt/0/1'], rnd: () => 0 })
  assert.equal(again.id, 'claude+gpt/0/0')
})

test('三只在场、一只在忙：只在闲着的两只里挑', () => {
  for (const r of [0, 0.5, 0.99]) {
    const got = P.pick({ ...base, present: ['claude', 'gpt', 'grok'], busy: ['claude'], rnd: seq([0, r, 0]) })
    assert.equal(got.key, 'gpt+grok')
  }
})
