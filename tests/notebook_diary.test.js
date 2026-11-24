// 小本子第二页的「事」：发生了才记，每本本子留最近 60 个有事的日子（notebook-diary.js）
// 设计：docs/superpowers/specs/2026-11-16-notebook-diary-design.md
const test = require('node:test')
const assert = require('node:assert/strict')
const D = require('../app/web/notebook-diary.js')

const DAY = 86_400_000
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime()
const NOW = at(11, 16)
const ymd = ms => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const TODAY = ymd(NOW), YESTERDAY = ymd(NOW - DAY)
const ALL = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen', 'kimi']
const P = { 0: 1, 1: 20, 2: 120, 3: 400 }   // 各关系够得上的分数（friendship.js：1 / 4 / 8 颗心）
const key = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`)
const ev = (s, kind) => (s.events || []).filter(e => e.kind === kind)
const base = more => ({ v: 1, installedAt: 0, liveSince: 0, chars: {}, ...more })
const tick = (s, ctx) => D.tick(s, { nowMs: NOW, present: [], friendship: {}, fest: null, installed: ALL, ...ctx })

test('chat_records_both_books_once_per_day', () => {
  const lines = [['claude', '你好呀'], ['gpt', '嗯。']]
  let s = D.recordChat(base(), lines, NOW, { levelOf: () => 0, installed: ALL })
  s = D.recordChat(s, lines, NOW + 60_000, { levelOf: () => 0, installed: ALL })
  const list = ev(s, 'chat')
  assert.equal(list.length, 2)
  const c = list.find(e => e.owner === 'claude'), g = list.find(e => e.owner === 'gpt')
  assert.deepEqual([c.friend, c.q, c.day], ['gpt', '嗯。', TODAY])
  assert.deepEqual([g.friend, g.q], ['claude', '你好呀'])
})

test('chat_ignores_unknown_speakers', () => {
  const opts = { levelOf: () => 0, installed: ALL }
  assert.equal(ev(D.recordChat(base(), [['claude', 'a'], ['egg-claude', 'b']], NOW, opts), 'chat').length, 0)
  assert.equal(ev(D.recordChat(base(), [['claude', 'a'], ['alice', 'b']], NOW, opts), 'chat').length, 0)
  assert.equal(ev(D.recordChat(base(), [['claude', 'a'], ['claude', 'b']], NOW, opts), 'chat').length, 0)
})

test('group_chat_records_each_pair', () => {
  const s = D.recordChat(base(), [['claude', 'a'], ['gpt', 'b'], ['qwen', 'c']], NOW, { levelOf: () => 0, installed: ALL })
  assert.equal(ev(s, 'chat').length, 6)
})

test('first_tick_seeds_levels_without_events', () => {
  const s = tick(base({ pairs: { [key('claude', 'gpt')]: { first: NOW - 3 * DAY, minutes: 50 } } }), { friendship: { [key('claude', 'gpt')]: { points: P[2] } } })
  assert.equal((s.events || []).length, 0)
  assert.equal(s.pairs[key('claude', 'gpt')].lv, 2)
})

test('levelup_records_both_sides', () => {
  const k = key('claude', 'gpt')
  let s = tick(base({ pairs: { [k]: { first: NOW - 3 * DAY, minutes: 50, lv: 1 } } }), { friendship: { [k]: { points: P[2] } } })
  assert.equal(ev(s, 'levelup').length, 2)
  assert.ok(ev(s, 'levelup').every(e => e.n === 2 && e.day === TODAY))
  s = tick(s, { friendship: { [k]: { points: P[2] } } })
  assert.equal(ev(s, 'levelup').length, 2)
})

test('reunion_after_seven_days', () => {
  const k = key('claude', 'gpt')
  const mk = days => tick(base({ pairs: { [k]: { first: NOW - 60 * DAY, minutes: 500, lv: 1, last: NOW - days * DAY } } }),
    { present: ['claude', 'gpt'], friendship: { [k]: { points: P[1] } } })
  const r = ev(mk(8), 'reunion')
  assert.equal(r.length, 2); assert.equal(r[0].n, 8)
  assert.equal(ev(mk(6), 'reunion').length, 0)
})

test('anniv_on_exact_days', () => {
  const k = key('claude', 'gpt')
  const mk = (days, lv = 1) => tick(base({ pairs: { [k]: { first: NOW - days * DAY, minutes: 500, lv } } }), { friendship: { [k]: { points: P[lv] } } })
  for (const n of [7, 30, 100, 200, 365, 400]) {
    const a = ev(mk(n), 'anniv')
    assert.equal(a.length, 2, `${n} 天该记`); assert.equal(a[0].n, n)
  }
  for (const n of [29, 366, 450]) assert.equal(ev(mk(n), 'anniv').length, 0, `${n} 天不该记`)
  assert.equal(ev(mk(30, 0), 'anniv').length, 0, '刚见面不记')
})

test('fest_multi_day_records_once', () => {
  const k = key('claude', 'gpt')
  let s = base({ pairs: { [k]: { first: NOW - 60 * DAY, minutes: 500, lv: 1 } } })
  for (let i = 0; i < 7; i++) s = tick(s, { nowMs: NOW + i * DAY, fest: 'spring', friendship: { [k]: { points: P[1] } } })
  assert.equal(new Set(ev(s, 'fest').filter(e => e.owner === 'claude').map(e => e.day)).size, 1)
})

test('fest_top_three_friends', () => {
  const friends = ['deepseek', 'gemini', 'glm', 'gpt', 'qwen']
  const friendship = Object.fromEntries(friends.map((f, i) => [key('claude', f), { points: 20 + i * 10 }]))
  const pairs = Object.fromEntries(friends.map(f => [key('claude', f), { first: NOW - 60 * DAY, minutes: 500, lv: 1 }]))
  const s = tick(base({ pairs }), { fest: 'midautumn', friendship })
  const mine = ev(s, 'fest').filter(e => e.owner === 'claude')
  assert.deepEqual(mine.map(e => e.friend).sort(), ['glm', 'gpt', 'qwen'])
  assert.ok(mine.every(e => e.n === 'midautumn'))
})

test('busy_reads_yesterday', () => {
  const friendship = { [key('claude', 'gpt')]: { points: P[2] }, [key('claude', 'qwen')]: { points: P[1] } }
  const pairs = { [key('claude', 'gpt')]: { first: 1, minutes: 9, lv: 2 }, [key('claude', 'qwen')]: { first: 1, minutes: 9, lv: 1 } }
  const mk = n => tick(base({ pairs, chars: { claude: { days: { [YESTERDAY]: n } } } }), { friendship })
  const b = ev(mk(30), 'busy')
  assert.equal(b.length, 1); assert.deepEqual([b[0].owner, b[0].friend, b[0].n], ['claude', 'gpt', 30])
  assert.equal(ev(mk(29), 'busy').length, 0)
})

test('pats_today_resets_after_midnight', () => {
  const friendship = { [key('claude', 'gpt')]: { points: P[1] } }
  const pairs = { [key('claude', 'gpt')]: { first: 1, minutes: 9, lv: 1 } }
  const old = tick(base({ pairs, chars: { claude: { today: { day: YESTERDAY, pats: 25, pokes: 0 } } } }), { friendship })
  assert.equal(ev(old, 'pats').length, 0)
  const now = tick(base({ pairs, chars: { claude: { today: { day: TODAY, pats: 3, pokes: 21 } } } }), { friendship })
  const p = ev(now, 'pats')
  assert.equal(p.length, 1); assert.deepEqual([p[0].m, p[0].n, p[0].friend], ['pokes', 21, 'gpt'])
})

test('keeps_sixty_days_per_owner', () => {
  const events = []
  for (let i = 0; i < 61; i++) events.push({ day: ymd(NOW - (i + 1) * DAY), kind: 'chat', owner: 'claude', friend: 'gpt', q: 'x' })
  events.push({ day: ymd(NOW - 100 * DAY), kind: 'chat', owner: 'gpt', friend: 'claude', q: 'y' })
  const s = tick(base({ events }), {})
  assert.equal(D.daysOf(s, 'claude').length, 60)
  assert.equal(D.daysOf(s, 'gpt').length, 1)
  assert.equal(D.daysOf(s, 'claude')[0], ymd(NOW - DAY))
})

test('merge_events_dedupes', () => {
  const same = { day: TODAY, kind: 'chat', owner: 'claude', friend: 'gpt', q: 'x' }
  const a = [same, { day: YESTERDAY, kind: 'levelup', owner: 'claude', friend: 'gpt', n: 2 }]
  const b = [{ ...same }, { day: ymd(NOW - 2 * DAY), kind: 'anniv', owner: 'claude', friend: 'gpt', n: 30 }]
  const m = D.mergeEvents(a, b)
  assert.equal(m.length, 3)
  assert.deepEqual(m.map(e => e.day), [TODAY, YESTERDAY, ymd(NOW - 2 * DAY)])
  assert.deepEqual(D.eventsOn({ events: m }, 'claude', TODAY).map(e => e.kind), ['chat'])
})

test('levelup_gift_flag：越级升到 2 以上记 gift，2 升 3 不记', () => {
  const k = key('claude', 'gpt')
  const jump = tick(base({ pairs: { [k]: { first: NOW - 3 * DAY, minutes: 50, lv: 1 } } }), { friendship: { [k]: { points: P[3] } } })
  assert.ok(ev(jump, 'levelup').length === 2 && ev(jump, 'levelup').every(e => e.n === 3 && e.gift === true))
  const normal = tick(base({ pairs: { [k]: { first: NOW - 3 * DAY, minutes: 50, lv: 1 } } }), { friendship: { [k]: { points: P[2] } } })
  assert.ok(ev(normal, 'levelup').every(e => e.n === 2 && e.gift === true))
  const later = tick(base({ pairs: { [k]: { first: NOW - 3 * DAY, minutes: 50, lv: 2 } } }), { friendship: { [k]: { points: P[3] } } })
  assert.ok(ev(later, 'levelup').length === 2 && ev(later, 'levelup').every(e => e.n === 3 && e.gift === false))
})
