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

test('标题：用户起的名字 + 的 + 本子名；英文名后空一格', () => {
  assert.equal(T.bookTitle('白龙', '冰晶匣'), '白龙的冰晶匣')
  assert.equal(T.bookTitle('GPT', '冰晶匣'), 'GPT 的冰晶匣')
  assert.equal(T.bookTitle('  ', '冰晶匣'), '冰晶匣')
  assert.ok(T.panel(view({ id: 'gpt', name: '小冰' }), T.themeFor('gpt')).includes('>小冰的冰晶匣<'))
  assert.ok(T.panel(view({ id: 'deepseek', name: '大肥鱼' }), T.themeFor('deepseek')).includes('>大肥鱼的潮汐日志<'))
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

test('panel：还没见过面；补算过、认识之前有轮数也不显示那两行', () => {
  const html = T.panel(view({ firstMet: 0, daysKnown: 0, rounds: 0, workMs: 0, minutes: 0, busiest: null, longestMs: 0, before: 12, backfilled: true }), T.themeFor('qwen'))
  assert.ok(html.includes('还没一起干过活呢'))
  assert.ok(!html.includes('认识你之前'))
  assert.ok(!html.includes('补算'))
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

// ---- 第二页 ----
const NOW = new Date(2026, 10, 9, 16, 0).getTime()
const blk = (who, owner, extra = {}) => ({ lines: [{ who, text: '你好呀' }, { who: owner, text: '你好' }], sticker: '🍚', photo: null, hint: '再好一点', ...extra })
const page2 = (o = {}) => ({ now: NOW, ownerImage: '../characters/claude/idle.webp', cameo: null, chats: [],
  friends: [{ id: 'deepseek', name: 'DeepSeek', image: '../characters/deepseek/idle.webp', levelName: '好朋友', hearts: 5, block: blk('deepseek', 'claude') }], ...o })
const count = (html, s) => html.split(s).length - 1

test('panel_has_two_pages_and_tabs：两页叠在一起，右边两个书签、每页一个翻页角', () => {
  const html = T.panel(view({ page2: page2() }), T.themeFor('claude'))
  assert.equal(count(html, 'class="sheet pg pg1'), 1)
  assert.equal(count(html, 'class="sheet pg pg2'), 1)
  assert.ok(html.includes('data-page="1"') && html.includes('data-page="2"'))
  assert.ok(html.includes('class="tabs"'))
  assert.equal(count(html, 'class="corner"'), 2)
  // 没给 page2（旧外壳 / 旧数据）也有第二页，写着还没有朋友
  assert.ok(T.panel(view(), T.themeFor('claude')).includes('还没有一起站过的朋友'))
})

test('friends_page_writer_fonts：留言用写的人的字，回复用本子主人的字', () => {
  for (const id of IDS) {
    const fr = id === 'deepseek' ? 'claude' : 'deepseek'
    const html = T.panel(view({ id, page2: page2({ friends: [{ id: fr, name: fr, image: 'x.webp', levelName: '好朋友', hearts: 5, block: blk(fr, id) }] }) }), T.themeFor(id))
    assert.ok(html.includes(`class="ln w-${fr}"`), id)
    assert.ok(html.includes(`class="ln w-${id} reply"`), id)
  }
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'web', 'notebook-themes.css'), 'utf8')
  for (const id of IDS) assert.ok(css.includes(`.w-${id} {`), `css .w-${id}`)
  assert.ok(css.includes('.w-other {'))
})

test('custom_writer_font：写的人是自定义角色（kimi）→ w-other', () => {
  const html = T.panel(view({ page2: page2({ friends: [{ id: 'kimi', name: 'Kimi', image: null, levelName: '认识了', hearts: 1, block: { lines: [{ who: 'kimi', text: '嗨' }], sticker: null, photo: null, hint: 'x' } }] }) }), T.themeFor('claude'))
  assert.ok(html.includes('class="ln w-other"'))
})

test('empty_friends_message：一个朋友都没有', () => {
  const html = T.panel(view({ page2: page2({ friends: [] }) }), T.themeFor('grok'))
  assert.ok(html.includes('还没有一起站过的朋友，多叫她们出来玩吧'))
})

test('贴纸、合照、提示、插嘴、留言里的字都转义', () => {
  const b = blk('deepseek', 'claude', { photo: { date: new Date(2026, 9, 28).getTime() }, hint: null, lines: [{ who: 'deepseek', text: '<b>x</b>' }] })
  const html = T.panel(view({ page2: page2({ friends: [{ id: 'deepseek', name: 'DeepSeek', image: 'd.webp', levelName: '挚友', hearts: 9, block: b }], cameo: { who: 'grok', name: 'Grok', stamp: '已阅·还行' } }) }), T.themeFor('claude'))
  assert.ok(html.includes('🍚'))
  assert.ok(html.includes('10 月 28 日') && html.includes('class="photo'))
  assert.ok(html.includes('class="stamp w-grok"') && html.includes('已阅·还行'))
  assert.ok(!html.includes('<b>x</b>') && html.includes('&lt;b&gt;x&lt;/b&gt;'))
  const hint = T.panel(view({ page2: page2() }), T.themeFor('claude'))
  assert.ok(hint.includes('class="locked"') && hint.includes('再好一点'))
})

test('chats_section_five_max：最近聊了什么最多 5 段，今天的写时间、别的天写日子', () => {
  const chat = (t, i) => ({ t, lines: [{ who: 'claude', name: 'Claude', text: `第${i}句` }, { who: 'gpt', name: 'GPT', text: '嗯。' }] })
  const chats = [0, 1, 2, 3, 4, 5, 6].map(i => chat(NOW - i * 3_600_000 * 5, i))
  const html = T.panel(view({ page2: page2({ chats }) }), T.themeFor('claude'))
  assert.equal(count(html, '<li class="chat">'), 5)
  assert.ok(html.includes('今天 16:00'))
  assert.ok(html.includes('11 月 8 日'))
  assert.ok(html.includes('class="w-gpt"'))
})
