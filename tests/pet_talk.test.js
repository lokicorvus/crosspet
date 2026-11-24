// 看数字说话（每对闲聊里填小本子的数字）和三只以上的群聊（pet-talk.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const T = require('../app/web/pet-talk.js')

const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen', 'kimi', 'doubao']
const facts = (o = {}) => ({ today: {}, pats: {}, togetherMin: 0, knownDays: 0, ...o })
const kinds = list => list.map(x => x.id.split('/')[1])

test('data_rounds_needs_both_today：两边今天都干了、轮数不一样才说，多的那只先开口', () => {
  assert.deepEqual(kinds(T.dataExchanges('claude', 'gpt', facts({ today: { claude: 5 } }))), [])
  assert.deepEqual(kinds(T.dataExchanges('claude', 'gpt', facts({ today: { claude: 5, gpt: 5 } }))), [])
  const got = T.dataExchanges('claude', 'gpt', facts({ today: { claude: 3, gpt: 12 } }))
  assert.deepEqual(kinds(got), ['rounds'])
  assert.equal(got[0].lines[0][0], 'gpt')
  assert.equal(got[0].lines[1][0], 'claude')
  assert.match(got[0].lines[0][1], /12/)
})

test('其他三种的门槛：摸头差 10 次、一起站满 1 小时、认识满 7 天', () => {
  assert.deepEqual(kinds(T.dataExchanges('claude', 'gpt', facts({ pats: { claude: 9, gpt: 0 }, togetherMin: 59, knownDays: 6 }))), [])
  const got = T.dataExchanges('claude', 'gpt', facts({ pats: { claude: 30, gpt: 2 }, togetherMin: 150, knownDays: 12 }))
  assert.deepEqual(kinds(got).sort(), ['known', 'pats', 'together'])
  const pats = got.find(x => x.id.includes('/pats/'))
  assert.equal(pats.lines[0][0], 'gpt', '被摸得少的那只先抱怨')
  assert.match(pats.lines[0][1], /30/)
  assert.match(got.find(x => x.id.includes('/together/')).lines[0][1], /2/)
  assert.match(got.find(x => x.id.includes('/known/')).lines[0][1], /12/)
})

test('data_lines_fit_big_numbers：每个模板填 99999 后不超过 16 个字，回话不超过 14 个字', () => {
  for (const [kind, by] of Object.entries(T.DATA)) for (const [ch, list] of Object.entries(by)) for (const t of list) {
    const s = t.replace(/\{[nmhd]\}/g, '99999')
    assert.ok([...s].length <= 16, `${kind}/${ch}: ${s}`)
    assert.ok(/\{[nmhd]\}/.test(t), `${kind}/${ch} 没填数字：${t}`)
  }
  for (const [kind, by] of Object.entries(T.DATA_REPLY)) for (const [ch, list] of Object.entries(by)) for (const t of list)
    assert.ok([...t].length <= 14 && t.length > 0, `${kind}/${ch}: ${t}`)
})

test('data_every_kind_has_all_seven_and_generic', () => {
  for (const kind of ['rounds', 'pats', 'together', 'known']) for (const ch of [...SEVEN, '*']) {
    assert.ok(T.DATA[kind]?.[ch]?.length >= 1, `DATA ${kind}/${ch}`)
    assert.ok(T.DATA_REPLY[kind]?.[ch]?.length >= 1, `DATA_REPLY ${kind}/${ch}`)
  }
  // 别的角色用通用的
  const got = T.dataExchanges('alice', 'bob', facts({ knownDays: 9 }))
  assert.equal(got.length, 1)
  assert.match(got[0].lines[0][1], /9/)
})

test('topics_cover_all_positions：至少 8 个话题，每个位置七个角色都写了、每句不超过 14 字', () => {
  assert.ok(T.TOPICS.length >= 8)
  const ids = new Set()
  for (const t of T.TOPICS) {
    assert.ok(!ids.has(t.id), t.id); ids.add(t.id)
    for (const pos of ['open', 'follow', 'close']) for (const ch of SEVEN) {
      const s = t[pos]?.[ch]
      assert.ok(typeof s === 'string' && s.length > 0 && [...s].length <= 14, `${t.id}/${pos}/${ch}: ${s}`)
    }
  }
})

const all = () => 1
const base = { busy: [], levelOf: all, nowMs: 10 * 60_000, lastAt: 0, recent: [], rnd: () => 0 }

test('group_needs_three_acquainted：不到三只、有一对没认识、刚说过、没掷中都不说', () => {
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt'] }), null)
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'], busy: ['grok'] }), null)
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'], levelOf: k => k === 'gpt+grok' ? 0 : 1 }), null)
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'], lastAt: base.nowMs - 60_000 }), null)
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'], rnd: () => 0.5 }), null)
  // 别的角色不参与：两只七人里的 + 一只自定义的，凑不成
  assert.equal(T.groupPick({ ...base, present: ['claude', 'gpt', 'alice'] }), null)
})

test('group_distinct_speakers：三只各说一句，四只时多一句接话；说的都在场、不重样', () => {
  const three = T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'] })
  assert.equal(three.lines.length, 3)
  assert.equal(new Set(three.lines.map(l => l[0])).size, 3)
  const topic = T.TOPICS.find(t => `group/${t.id}` === three.id)
  assert.ok(topic, three.id)
  assert.equal(three.lines[0][1], topic.open[three.lines[0][0]])
  assert.equal(three.lines[2][1], topic.close[three.lines[2][0]])
  const four = T.groupPick({ ...base, present: ['claude', 'gpt', 'grok', 'qwen'] })
  assert.equal(four.lines.length, 4)
  assert.equal(new Set(four.lines.map(l => l[0])).size, 4)
  for (const l of four.lines) assert.ok(['claude', 'gpt', 'grok', 'qwen'].includes(l[0]))
  // 说过的话题先不重复
  const next = T.groupPick({ ...base, present: ['claude', 'gpt', 'grok'], recent: [three.id] })
  assert.notEqual(next.id, three.id)
})

// ---- 对彼此的事有反应 ----
const KINDS = ['done', 'redhot', 'jealous', 'sleep', 'poke', 'oops']
const rbase = { present: ['claude', 'gpt'], busy: [], levelOf: () => 1, nowMs: 100 * 60_000, last: {}, rnd: () => 0 }

test('react_respects_min_level：门槛够了才说（红温刚见面也行，吃醋要好朋友）', () => {
  assert.equal(T.react({ ...rbase, kind: 'done', actor: 'claude', levelOf: () => 0 }), null)
  assert.ok(T.react({ ...rbase, kind: 'redhot', actor: 'claude', levelOf: () => 0 }))
  assert.equal(T.react({ ...rbase, kind: 'jealous', actor: 'claude', levelOf: () => 1 }), null)
  const got = T.react({ ...rbase, kind: 'jealous', actor: 'claude', levelOf: () => 2 })
  assert.equal(got.speaker, 'gpt')
  assert.equal(got.key, 'claude+gpt')
  assert.deepEqual(got.lines.map(l => l[0]), ['gpt', 'claude'])
})

test('react_cooldowns：同一种事同一对 10 分钟一次，所有反应合起来 2 分钟一次', () => {
  const got = T.react({ ...rbase, kind: 'poke', actor: 'claude' })
  assert.deepEqual(got.marks.sort(), ['*', 'poke:claude+gpt'])
  const at = ms => Object.fromEntries(got.marks.map(m => [m, ms]))
  assert.equal(T.react({ ...rbase, kind: 'poke', actor: 'claude', last: at(rbase.nowMs - 9 * 60_000) }), null)
  assert.ok(T.react({ ...rbase, kind: 'poke', actor: 'claude', last: at(rbase.nowMs - 10 * 60_000) }))
  assert.equal(T.react({ ...rbase, kind: 'oops', actor: 'claude', last: { '*': rbase.nowMs - 60_000 } }), null)
  assert.ok(T.react({ ...rbase, kind: 'oops', actor: 'claude', last: { '*': rbase.nowMs - 2 * 60_000 } }))
})

test('react_excludes_actor_and_patted：事主自己、忙着的、刚被摸过的不说；事主不在场不说', () => {
  const present = ['claude', 'gpt', 'grok']
  for (const r of [0, 0.5, 0.99]) {
    const got = T.react({ ...rbase, present, kind: 'jealous', actor: 'claude', levelOf: () => 2, exclude: ['gpt'], rnd: () => r })
    assert.equal(got.speaker, 'grok')
  }
  assert.equal(T.react({ ...rbase, present, kind: 'poke', actor: 'claude', busy: ['gpt', 'grok'] }), null)
  assert.equal(T.react({ ...rbase, present: ['gpt', 'grok'], kind: 'poke', actor: 'claude' }), null)
})

test('react_all_seven_each_kind_three_per_tier：够得着的每档每个角色至少 3 句、不超过 14 字；回话每人至少 2 句', () => {
  for (const kind of KINDS) for (const ch of [...SEVEN, '*']) {
    for (let tier = Math.min(T.MIN_LEVEL[kind], 2); tier <= 2; tier++) {
      const list = T.REACT[kind]?.[ch]?.[tier]
      assert.ok(list && list.length >= 3, `${kind}/${ch}/${tier}`)
      for (const s of list) assert.ok(s.length > 0 && [...s].length <= 14, `${kind}/${ch}/${tier}: ${s}`)
    }
    if (kind === 'sleep') continue
    const back = T.REACT_BACK[kind]?.[ch]
    assert.ok(back && back.length >= 2, `back ${kind}/${ch}`)
    for (const s of back) assert.ok([...s].length <= 14, `back ${kind}/${ch}: ${s}`)
  }
  for (const by of Object.values(T.REACT_PAIR)) for (const list of Object.values(by)) for (const s of list) assert.ok([...s].length <= 14, s)
})

test('sleep_has_no_reply：睡着的不回话；别的回一句', () => {
  const sleep = T.react({ ...rbase, kind: 'sleep', actor: 'claude' })
  assert.equal(sleep.lines.length, 1)
  assert.equal(sleep.lines[0][0], 'gpt')
  assert.equal(T.react({ ...rbase, kind: 'oops', actor: 'claude' }).lines.length, 2)
})

test('按对的特例优先：Grok 看 DeepSeek 红温', () => {
  const got = T.react({ ...rbase, present: ['deepseek', 'grok'], kind: 'redhot', actor: 'deepseek' })
  assert.ok(T.REACT_PAIR.redhot['grok>deepseek'].includes(got.lines[0][1]), got.lines[0][1])
})
