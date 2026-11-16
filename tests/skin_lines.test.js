// 性格不一样的皮肤用自己的小本子和互动文字（docs/superpowers/specs/2026-11-16-notebook-skin-lines-design.md）：
// 先按皮肤 id 找，没写的那一项退回原角色；只是换衣服的皮肤（睡衣、冬装、毛衣）照旧用原版
const test = require('node:test')
const assert = require('node:assert/strict')
const L = require('../app/web/notebook-lines.js')
const NF = require('../app/web/notebook-friends.js')
const T = require('../app/web/pet-talk.js')

const MG = 'gemini-magician'
const zero = () => 0
const view = { rounds: 300, workMs: 20 * 3_600_000, pats: 50, daysKnown: 5 }
const noon = new Date(2026, 10, 16, 12).getTime()

test('第一页批注、落款：穿魔术师用她的，原皮用 Gemini 的，换衣服皮肤用原版', () => {
  assert.deepEqual(L.notesFor('gemini', view, zero, MG), ['几百场了喵！', '好久的演出', '摸头是魔法吗'])
  assert.deepEqual(L.notesFor('gemini', view, zero), L.notesFor('gemini', view, zero, ''))
  assert.equal(L.notesFor('gemini', view, zero)[0], L.NOTES.gemini.rounds[3][0])
  assert.deepEqual(L.notesFor('deepseek', view, zero, 'deepseek-knit'), L.notesFor('deepseek', view, zero))
  assert.equal(L.signFor('gemini', view, noon, zero, MG), '✦ 魔术师 Gemini')
  assert.equal(L.signFor('gemini', view, noon, zero), L.SIGNS.gemini.normal[0])
})

test('第二页留言：写的人穿魔术师换她写的话，主人穿魔术师换写给她的和她的回复；说话的人照样记 gemini', () => {
  const facts = { first: 1, minutes: 120, days: 40, rounds: 10, pats: 5 }
  const texts = b => b.lines.map(l => l.text)
  const all = (o, w) => new Set([2, 3].flatMap(lv => NF.MSG[w][o][lv].flatMap(m => [...m.t.map(([, t]) => t), m.r].filter(Boolean))))
  const wrote = new Set(), got = new Set()
  for (let d = 1; d <= 30; d++) {
    const day = `2026-11-${String(d).padStart(2, '0')}`
    const a = NF.block({ owner: 'claude', friend: 'gemini', level: 3, facts, day, friendSkin: MG })
    texts(a).forEach(t => wrote.add(t))
    assert.ok(a.lines.every(l => l.who === 'gemini' || l.who === 'claude'), JSON.stringify(a.lines))
    const b = NF.block({ owner: 'gemini', friend: 'claude', level: 2, facts, day, ownerSkin: MG })
    texts(b).forEach(t => got.add(t))
    assert.ok(b.lines.every(l => l.who === 'gemini' || l.who === 'claude'), JSON.stringify(b.lines))
  }
  const mine = all('claude', MG), toMe = all(MG, 'claude')
  assert.ok([...wrote].every(t => mine.has(t)), [...wrote].join())
  assert.ok([...got].some(t => toMe.has(t)), [...got].join())
  // 穿换衣服皮肤的：照旧用原版
  const day = '2026-11-03'
  assert.deepEqual(NF.block({ owner: 'claude', friend: 'deepseek', level: 3, facts, day, friendSkin: 'deepseek-knit' }),
    NF.block({ owner: 'claude', friend: 'deepseek', level: 3, facts, day }))
  // 魔术师写给每个别的角色、每个别的角色写给魔术师，好朋友和挚友都至少 2 条
  for (const o of NF.SEVEN.filter(c => c !== 'gemini')) for (const lv of [2, 3]) {
    assert.ok(NF.MSG[MG][o]?.[lv]?.length >= 2, `${MG}→${o} ${lv}`)
    assert.ok(NF.MSG[o][MG]?.[lv]?.length >= 2, `${o}→${MG} ${lv}`)
  }
  assert.ok(NF.GREET[MG] && NF.DATA_MSG[MG] && NF.STICKER[MG] && NF.CAMEO[MG])
})

test('互动：看数字、群聊、接话都按穿的挑，说话的人还是原角色', () => {
  const wear = ch => ch === 'gemini' ? MG : ''
  const facts = { today: { gemini: 9, claude: 3 }, pats: {}, togetherMin: 0, knownDays: 0 }
  const x = T.dataExchanges('claude', 'gemini', facts, wear)[0]
  assert.equal(x.lines[0][0], 'gemini'); assert.ok(T.DATA.rounds[MG].some(t => x.lines[0][1] === t.replace('{n}', 9).replace('{m}', 3)), x.lines[0][1])
  const plain = T.dataExchanges('claude', 'gemini', facts)[0].lines[0][1]
  assert.ok(T.DATA.rounds.gemini.some(t => plain === t.replace('{n}', 9).replace('{m}', 3)), plain)
  for (const t of T.TOPICS) for (const pos of ['open', 'follow', 'close']) assert.ok(t[pos][MG] && [...t[pos][MG]].length <= 14, `${t.id}/${pos}`)
  const g = T.groupPick({ present: ['gemini', 'claude', 'gpt'], levelOf: () => 1, nowMs: 1e9, rnd: () => 0, wear })
  const line = g.lines.find(l => l[0] === 'gemini')[1]
  assert.ok(T.TOPICS.some(t => ['open', 'follow', 'close'].some(p => t[p][MG] === line)), line)
  const r = T.react({ kind: 'done', actor: 'claude', present: ['claude', 'gemini'], levelOf: () => 2, nowMs: 1e9, rnd: () => 0, wear })
  assert.equal(r.speaker, 'gemini'); assert.ok(T.REACT.done[MG][2].includes(r.lines[0][1]), r.lines[0][1])
  const back = T.react({ kind: 'poke', actor: 'gemini', present: ['claude', 'gemini'], levelOf: () => 2, nowMs: 1e9, rnd: () => 0, wear })
  assert.ok(T.REACT_BACK.poke[MG].includes(back.lines[1][1]), back.lines[1][1])
  for (const kind of Object.keys(T.REACT)) assert.ok(T.REACT[kind][MG], kind)
})
