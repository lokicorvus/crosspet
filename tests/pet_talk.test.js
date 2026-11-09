// 看数字说话（每对闲聊里填小本子的数字）和三只以上的群聊（pet-talk.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const T = require('../app/web/pet-talk.js')

const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen']
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
