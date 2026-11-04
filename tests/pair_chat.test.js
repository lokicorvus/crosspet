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
const POSES = ['happy', 'listening', 'puffed', 'pat']
// 一段：两句、两个人各说一句、都是这一对里的人、每句不长（气泡放得下），写了立绘的必须是认得的
function checkExchange(key, who, lines) {
  assert.equal(lines.length, 2, key)
  assert.notEqual(lines[0][0], lines[1][0], `${key} 同一个人自问自答`)
  for (const [w, text, pose] of lines) {
    assert.ok(who.includes(w), `${key} 里出现了 ${w}`)
    assert.ok(typeof text === 'string' && text.length > 0 && text.length <= 14, `${key} 这句太长：${text}`)
    assert.ok(pose === undefined || POSES.includes(pose), `${key} 立绘 ${pose}`)
  }
}
const skinOf = id => { try { return JSON.parse(fs.readFileSync(path.join(DIR, id, 'character.json'), 'utf8')).skinOf } catch { return undefined } }

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
      for (const lines of tier) checkExchange(key, key.split('+'), lines)
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
  assert.equal(low.key, 'claude+gpt'); assert.equal(low.tier, 0)
  assert.deepEqual(low.lines.map(([w, t]) => [w, t]), P.LINES['claude+gpt'][0][0])
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

test('性格不一样的皮肤：和每个别的角色都有整套（三档、每档至少两段）；皮肤真的存在', () => {
  for (const [skin, pairs] of Object.entries(P.SKIN_PAIRS)) {
    const own = skinOf(skin)
    assert.ok(CHARS.includes(own), `${skin} 不是哪个角色的皮肤`)
    for (const other of CHARS.filter(c => c !== own)) {
      const tiers = pairs[other]
      assert.ok(tiers && tiers.length === 3, `${skin} 缺和 ${other} 的`)
      for (const tier of tiers) { assert.ok(tier.length >= 2); for (const lines of tier) checkExchange(`${skin}+${other}`, [own, other], lines) }
    }
  }
  for (const [key, tiers] of Object.entries(P.COMBOS)) {
    const who = key.split('+').map(w => skinOf(w) || w)
    assert.ok(who.every(w => CHARS.includes(w)), key)
    assert.equal(tiers.length, 3, key)
    for (const tier of tiers) { assert.ok(tier.length >= 2); for (const lines of tier) checkExchange(key, who, lines) }
  }
  for (const [skin, replies] of Object.entries(P.OUTFITS)) {
    assert.ok(CHARS.includes(skinOf(skin)), skin)
    for (const r of replies) assert.ok(r.length <= 14, r)
  }
  for (const [w, line] of Object.entries(P.PRAISE)) { assert.ok(CHARS.includes(skinOf(w) || w), w); assert.ok(line.length <= 14, line) }
})

const only = (wear, present, hearts = 0) => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    const r = [0, 0, ...Array(40).fill(0)].map((_, k) => k < 2 ? 0 : ((i * 7 + k) % 10) / 10)
    const got = P.pick({ present, hearts10: () => hearts, wear: ch => wear[ch] || '', nowMs: 1e9, recent: [...seen], rnd: seq(r) })
    seen.add(got.id)
  }
  return [...seen]
}

test('穿圣女的 Claude 和 DeepSeek：用圣女那套，不用原版', () => {
  const ids = only({ claude: 'claude-saint' }, ['claude', 'deepseek'])
  assert.ok(ids.length >= 2 && ids.every(id => id.startsWith('claude-saint+deepseek/0/')), ids.join())
  const got = P.pick({ present: ['claude', 'deepseek'], hearts10: () => 0, wear: ch => ch === 'claude' ? 'claude-saint' : '', nowMs: 1e9, rnd: () => 0 })
  assert.deepEqual(got.lines.map(([w, t]) => [w, t]), P.SKIN_PAIRS['claude-saint'].deepseek[0][0])
})

test('DeepSeek 穿 Claude 卫衣碰上 Claude（原版 / 圣女）：专属那组，不夸衣服', () => {
  for (const [wear, key] of [[{ deepseek: 'deepseek-hoodie' }, 'claude+deepseek-hoodie'], [{ deepseek: 'deepseek-hoodie', claude: 'claude-saint' }, 'claude-saint+deepseek-hoodie']]) {
    const ids = only(wear, ['claude', 'deepseek'], 9)
    assert.ok(ids.every(id => id.startsWith(key + '/2/')), ids.join())
  }
  const ids = only({ claude: 'claude-saint', gpt: 'gpt-onesie' }, ['claude', 'gpt'], 5)
  assert.ok(ids.every(id => id.startsWith('claude-saint+gpt-onesie/1/')), ids.join())
})

test('只是换装：原版台词照用，再多一段对方夸衣服、她按衣服回', () => {
  const ids = only({ deepseek: 'deepseek-knit' }, ['deepseek', 'grok'])
  assert.ok(ids.includes('deepseek-knit+grok/outfit') && ids.some(id => id.startsWith('deepseek+grok/0/')), ids.join())
  let got
  for (let i = 0; i < 50 && !(got && got.id.endsWith('/outfit')); i++) got = P.pick({ present: ['deepseek', 'grok'], hearts10: () => 0, wear: ch => ch === 'deepseek' ? 'deepseek-knit' : '', nowMs: 1e9, rnd: seq([0, 0, 0.99, i % 2 ? 0.9 : 0]) })
  assert.equal(got.lines[0][0], 'grok'); assert.equal(got.lines[0][1], P.PRAISE.grok)
  assert.equal(got.lines[1][0], 'deepseek'); assert.ok(P.OUTFITS['deepseek-knit'].includes(got.lines[1][1]))
})

test('说话时挑立绘：写了用写的，没写按字面（胖 → 鼓脸，！～ → 开心，？ → 倾听，别的不换）', () => {
  assert.equal(P.poseOf('你不许说我胖哦'), 'puffed')
  assert.equal(P.poseOf('借、借来穿一下嘛！'), 'happy')
  assert.equal(P.poseOf('就碰一下嘛 :3'), 'happy')
  assert.equal(P.poseOf('那件卫衣……是我的？'), 'listening')
  assert.equal(P.poseOf('……规矩的卷轴。'), null)
  const got = P.pick({ present: ['claude', 'gpt'], hearts10: () => 9, wear: ch => ch === 'gpt' ? 'gpt-onesie' : '', nowMs: 1e9, rnd: seq([0, 0, 0.6]) })
  assert.deepEqual(got.lines[1], ['gpt', '嗯……软的哦。', 'pat'])
})

test('升级台词：每个角色和每套皮肤都有三档，不长', () => {
  const skins = fs.readdirSync(DIR).filter(id => CHARS.includes(skinOf(id)))
  for (const w of [...CHARS, ...skins]) {
    const lines = P.LEVEL_LINES[w]
    assert.ok(lines && lines.length === 3, `缺 ${w}`)
    for (const l of lines) assert.ok(l.length > 0 && l.length <= 14, `${w} 这句太长：${l}`)
  }
})

test('升级台词的立绘：每句一张、各角色都画了，不是一律同一张', () => {
  const skins = fs.readdirSync(DIR).filter(id => CHARS.includes(skinOf(id)))
  for (const w of [...CHARS, ...skins]) {
    const poses = P.LEVEL_POSES[w]
    assert.ok(poses && poses.length === 3, `缺 ${w}`)
    const files = fs.readdirSync(path.join(DIR, w))
    for (const p of poses) assert.ok(files.some(f => f === p + '.webp' || f.startsWith(p + '-')), `${w} 没画 ${p}`)
  }
  assert.ok(new Set(Object.values(P.LEVEL_POSES).flat()).size >= 4)
})

test('levelUp：升了级没演过才演；只演最高那档；在忙的不算；按穿的说', () => {
  const base = { present: ['claude', 'gpt', 'grok'], shownOf: () => 0, rnd: () => 0 }
  assert.equal(P.levelUp({ ...base, levelOf: () => 0 }), null)
  const up = P.levelUp({ ...base, levelOf: k => k === 'gpt+grok' ? 2 : 0, wear: ch => ch === 'gpt' ? 'gpt-onesie' : '' })
  assert.equal(up.key, 'gpt+grok'); assert.equal(up.level, 2)
  assert.deepEqual(up.lines, [['gpt', P.LEVEL_LINES['gpt-onesie'][1], P.LEVEL_POSES['gpt-onesie'][1], 'friend_up'], ['grok', P.LEVEL_LINES.grok[1], P.LEVEL_POSES.grok[1], 'friend_up']])
  assert.equal(P.levelUp({ ...base, levelOf: () => 2, shownOf: () => 2 }), null)
  assert.equal(P.levelUp({ ...base, busy: ['grok'], levelOf: k => k === 'gpt+grok' ? 1 : 0 }), null)
  assert.equal(P.levelUp({ ...base, levelOf: () => 3, shownOf: () => 1 }).level, 3)
})
