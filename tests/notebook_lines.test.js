// 小本子第一页的批注（按数字分档随机挑）和落款（按深夜 / 忙 / 好久不见 / 纪念日换）：notebook-lines.js
const test = require('node:test')
const assert = require('node:assert/strict')
const L = require('../app/web/notebook-lines.js')
const T = require('../app/web/notebook-themes.js')

const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen', 'kimi', 'doubao']
const H = 3_600_000, DAY = 86_400_000
const at = (h, d = 15) => new Date(2026, 10, d, h, 0, 0).getTime()   // 本地时间 2026-11-d h 点

test('band_edges：轮数 9 → 1、10 → 2、1000 → 4；干活 59 分钟 → 0；摸头 0 → 0、20 → 2', () => {
  assert.equal(L.bandOf('rounds', 0), 0)
  assert.equal(L.bandOf('rounds', 9), 1)
  assert.equal(L.bandOf('rounds', 10), 2)
  assert.equal(L.bandOf('rounds', 999), 3)
  assert.equal(L.bandOf('rounds', 1000), 4)
  assert.equal(L.bandOf('work', 59 / 60), 0)
  assert.equal(L.bandOf('work', 1), 1)
  assert.equal(L.bandOf('work', 100), 3)
  assert.equal(L.bandOf('pats', 0), 0)
  assert.equal(L.bandOf('pats', 20), 2)
})

test('seven_plus_generic_have_three_per_band：0 档以外每档至少 3 句、每句不超过 10 字', () => {
  for (const id of [...SEVEN, '*']) for (const [stat, edges] of Object.entries(L.BANDS)) for (let b = 1; b < edges.length; b++) {
    const list = L.NOTES[id]?.[stat]?.[b]
    assert.ok(list && list.length >= 3, `${id}/${stat}/${b}`)
    for (const s of list) assert.ok(s.length > 0 && [...s].length <= 10, `${id}/${stat}/${b}: ${s}`)
  }
})

test('notesFor：按三个数字各挑一句；0 档没写的是 null；别的角色用通用的', () => {
  const v = { rounds: 12, workMs: 0, pats: 150 }
  const got = L.notesFor('claude', v, () => 0)
  assert.equal(got.length, 3)
  assert.equal(got[0], L.NOTES.claude.rounds[2][0])
  assert.equal(got[1], null)
  assert.equal(got[2], L.NOTES.claude.pats[3][0])
  assert.equal(L.notesFor('alice', v, () => 0)[0], L.NOTES['*'].rounds[2][0])
})

test('sign_priority：纪念日 > 深夜 > 忙 > 好久不见 > 平常；每种至少 2 句、不超过 16 字', () => {
  for (const id of [...SEVEN, '*']) for (const kind of ['night', 'busy', 'miss', 'anniv', 'normal']) {
    const list = L.SIGNS[id]?.[kind]
    assert.ok(list && list.length >= 2, `${id}/${kind}`)
    for (const s of list) assert.ok([...s].length <= 16, `${id}/${kind}: ${s}`)
  }
  const S = L.SIGNS.gpt
  const noon = at(12), base = { daysKnown: 5, todayRounds: 0, lastEnd: noon - H }
  const sign = (v, now) => L.signFor('gpt', { ...base, ...v }, now, () => 0)
  assert.equal(sign({}, noon), S.normal[0])
  assert.equal(sign({ lastEnd: noon - 3 * DAY }, noon), S.miss[0])
  assert.equal(sign({ lastEnd: 0 }, noon), S.normal[0], '从没干过活不算好久不见')
  assert.equal(sign({ todayRounds: 30, lastEnd: noon - 3 * DAY }, noon), S.busy[0])
  assert.equal(sign({ todayRounds: 30 }, at(2)), S.night[0])
  assert.equal(sign({}, at(6)), S.normal[0])
  // 认识第 8 天（认识整 7 天当天）、整 30、100、365 天，之后每 100 天
  for (const d of [8, 31, 101, 366, 201, 501]) assert.equal(sign({ daysKnown: d }, at(2)), S.anniv[0], `第 ${d} 天`)
  for (const d of [7, 9, 150, 365]) assert.notEqual(sign({ daysKnown: d }, noon), S.anniv[0], `第 ${d} 天`)
})

test('old_override_wins：character.json 写了 notes / sign 就用她的；没写用挑好的；都没有用主题的', () => {
  const t = T.themeFor('claude')
  const picked = { notesPicked: ['挑的一', '挑的二', null], signPicked: '挑的落款' }
  assert.equal(T.noteFor(t, { notes: [null, '自己写的', null], ...picked }, 1), '自己写的')
  assert.equal(T.noteFor(t, { notes: null, ...picked }, 1), '挑的二')
  assert.equal(T.noteFor(t, { notes: null, ...picked }, 2), null)
  assert.equal(T.noteFor(t, { notes: null }, 1), t.notes[1])
  // 0 档挑出来是 null：不写批注，不能退回主题里的示例（Grok 0 次摸头写「摸够没」）
  const g = T.themeFor('grok'), zero = { notes: null, notesPicked: [null, null, null] }
  assert.deepEqual([0, 1, 2].map(i => T.noteFor(g, zero, i)), [null, null, null])
  const page = v => T.panel({ name: 'Grok', rounds: 0, workMs: 0, pats: v, milestones: [], ...zero, notesPicked: [null, null, v ? '摸够没' : null] }, g).split('pg pg2')[0]
  assert.ok(!page(0).includes('class="ring"'), '0 次不画红圈')
  assert.ok(page(5).includes('class="ring"'), '有批注才圈')
  assert.equal(T.signFor(t, { sign: '落款', ...picked }), '落款')
  assert.equal(T.signFor(t, { sign: null, ...picked }), '挑的落款')
  assert.equal(T.signFor(t, { sign: null }), t.sign)
})
