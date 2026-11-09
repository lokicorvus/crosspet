const test = require('node:test')
const assert = require('node:assert/strict')
const T = require('../app/web/notebook-themes.js')

const IDS = ['claude', 'deepseek', 'gpt', 'gemini', 'glm', 'grok', 'qwen']
const view = (o = {}) => ({
  id: 'claude', name: 'Claude', firstMet: new Date(2026, 9, 2, 10).getTime(), daysKnown: 37, rounds: 312, workMs: 41.4 * 3_600_000,
  minutes: 96 * 60, pats: 128, pokes: 23, angry: 4, busiest: { date: '2026-11-03', rounds: 46 }, longestMs: (2 * 60 + 13) * 60_000,
  friend: { id: 'deepseek', name: 'DeepSeek', level: '挚友', hearts: 8.5, image: '../characters/deepseek/idle.webp' },
  milestones: [{ id: 'round100', label: '第 100 轮活', date: '2026-11-07' }, { id: 'night', label: '凌晨 3 点还在陪你', date: '2026-10-28' }],
  before: 0, backfilled: false, total: { days: 37, rounds: 1284 }, notes: null, sign: null, ...o,
})

test('themeFor：七个角色各有主题；不认识的用 Claude 的手册', () => {
  for (const id of IDS) {
    const t = T.themeFor(id)
    assert.equal(t.id, id)
    assert.equal(typeof t.book, 'string')
    assert.equal(t.notes.length, 3)
    assert.ok('sign' in t)
    assert.equal(typeof t.cover, 'string')
  }
  assert.equal(T.themeFor('kimi').id, 'claude')
  assert.equal(T.themeFor(undefined).id, 'claude')
})

test('noteFor：character.json 里写了就用她的，没写用主题的', () => {
  const t = T.themeFor('claude')
  assert.equal(T.noteFor(t, view({ notes: [null, '自己写的', null] }), 1), '自己写的')
  assert.equal(T.noteFor(t, view(), 1), t.notes[1])
  assert.equal(T.signFor(t, view({ sign: '落款' })), '落款')
  assert.equal(T.signFor(t, view()), t.sign)
})

test('panel：数字、细节、朋友、小成就、合计', () => {
  const html = T.panel(view(), T.themeFor('claude'))
  for (const s of ['Claude 的随身手册', '认识第 <b>37</b> 天', '10 月 2 日初见', '>312<', '>41<', '>128<', '11 月 3 日', '46 轮', '2 小时 13 分', '96 小时',
    '23 <span class="dim">/</span> 4 次', 'DeepSeek', '挚友 · 8.5', '第 100 轮活', '11 月 7 日', '凌晨 3 点还在陪你', '<b>1,284</b>'])
    assert.ok(html.includes(s), s)
  assert.ok(!html.includes('认识你之前'))
  assert.ok(!html.includes('补算'))
})

test('panel：最新的小成就标成 new，最多 4 个', () => {
  const ms = [1, 2, 3, 4, 5].map(i => ({ id: 'round1', label: 'm' + i, date: '2026-11-0' + (6 - i) }))
  const html = T.panel(view({ milestones: ms }), T.themeFor('gpt'))
  assert.equal((html.match(/<li/g) || []).length, 4)
  assert.ok(html.includes('<li class="new">'))
  assert.ok(!html.includes('m5'))
})

test('panel：没有朋友整栏不显示；没有小成就显示一句鼓励', () => {
  const html = T.panel(view({ friend: null, milestones: [] }), T.themeFor('glm'))
  assert.ok(!html.includes('最好的朋友'))
  assert.ok(html.includes('还没有小成就'))
})

test('panel：还没见过面、补算过、认识之前有轮数', () => {
  const html = T.panel(view({ firstMet: 0, daysKnown: 0, rounds: 0, workMs: 0, minutes: 0, busiest: null, longestMs: 0, before: 12, backfilled: true }), T.themeFor('qwen'))
  assert.ok(html.includes('还没一起干过活呢'))
  assert.ok(html.includes('认识你之前，你已经和她干了 <b>12</b> 轮'))
  assert.ok(html.includes('补算'))
  assert.ok(html.includes('>0<'))
})

test('panel：时长的写法', () => {
  assert.equal(T.hoursOrMinutes(0), '0 分钟')
  assert.equal(T.hoursOrMinutes(45 * 60_000), '45 分钟')
  assert.equal(T.hoursOrMinutes(96 * 3_600_000), '96 小时')
  assert.equal(T.duration(30_000), '不到 1 分')
  assert.equal(T.duration(13 * 60_000), '13 分')
  assert.equal(T.duration(2 * 3_600_000), '2 小时')
  assert.equal(T.duration(2 * 3_600_000 + 13 * 60_000), '2 小时 13 分')
})

test('panel：名字里的尖括号不当成标签', () => {
  const html = T.panel(view({ friend: { id: 'x', name: '<b>坏</b>', level: '认识了', hearts: 1 } }), T.themeFor('grok'))
  assert.ok(html.includes('&lt;b&gt;坏'))
})

test('panel：带封面（翻书动画用）', () => {
  for (const id of IDS) assert.ok(T.panel(view({ id }), T.themeFor(id)).includes('class="cover'), id)
})
