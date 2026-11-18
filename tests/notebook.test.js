const test = require('node:test')
const assert = require('node:assert/strict')
const N = require('../app/web/notebook.js')
const F = require('../app/web/friendship.js')

// 本地时间（「最忙的一天」「凌晨」都按本机时间算）
const at = (m, d, h, min = 0) => new Date(2026, m - 1, d, h, min).getTime()
const HOUR = 3_600_000

test('recordRound：数轮数、累计时长、记最长的一次', () => {
  let s = N.empty(at(11, 1, 0))
  s = N.recordRound(s, 'claude', at(11, 3, 10), at(11, 3, 10, 30))
  s = N.recordRound(s, 'claude', at(11, 3, 12), at(11, 3, 14))
  const r = s.chars.claude
  assert.equal(r.rounds, 2)
  assert.equal(r.workMs, 9_000_000)
  assert.equal(r.longestMs, 7_200_000)
})

test('recordRound：第一次记录定下 firstMet，之后不变', () => {
  let s = N.empty(at(11, 1, 0))
  s = N.recordRound(s, 'gpt', at(11, 3, 10), at(11, 3, 11))
  assert.equal(s.chars.gpt.firstMet, at(11, 3, 10))
  s = N.recordRound(s, 'gpt', at(11, 4, 10), at(11, 4, 11))
  assert.equal(s.chars.gpt.firstMet, at(11, 3, 10))
})

test('最忙的一天：取轮数最多的那天', () => {
  let s = N.empty(at(11, 1, 0))
  for (let i = 0; i < 3; i++) s = N.recordRound(s, 'claude', at(11, 3, 9 + i), at(11, 3, 9 + i, 10))
  for (let i = 0; i < 2; i++) s = N.recordRound(s, 'claude', at(11, 4, 9 + i), at(11, 4, 9 + i, 10))
  assert.deepEqual(s.chars.claude.busiest, { date: '2026-11-03', rounds: 3 })
})

test('按天的轮数只留最近 60 天', () => {
  let s = N.empty(at(1, 1, 0))
  for (let i = 0; i < 70; i++) {
    const t = new Date(2026, 0, 1 + i, 10).getTime()
    s = N.recordRound(s, 'claude', t, t + 60_000)
  }
  const days = Object.keys(s.chars.claude.days).sort()
  assert.equal(days.length, 60)
  assert.equal(days[0], N.localDay(new Date(2026, 0, 11, 10).getTime()))
  assert.equal(s.chars.claude.rounds, 70)
})

test('装 CrossPet 之前的轮：只进 before，不算轮数、不定 firstMet', () => {
  let s = { ...N.empty(at(11, 1, 0)), installedAt: at(10, 5, 0) }
  s = N.recordRound(s, 'claude', at(10, 1, 10), at(10, 1, 11))
  assert.equal(s.chars.claude.before, 1)
  assert.equal(s.chars.claude.rounds, 0)
  assert.equal(s.chars.claude.firstMet, 0)
})

test('addMinute：每个角色加一分钟；没见过的角色 firstMet 从这时算', () => {
  let s = N.empty(at(11, 1, 0))
  s = N.addMinute(s, ['claude', 'gpt'], at(11, 2, 9))
  s = N.addMinute(s, ['claude'], at(11, 2, 9, 1))
  assert.equal(s.chars.claude.minutes, 2)
  assert.equal(s.chars.gpt.minutes, 1)
  assert.equal(s.chars.gpt.firstMet, at(11, 2, 9))
})

test('bump：摸头 / 戳 / 生气各自计数', () => {
  let s = N.empty(at(11, 1, 0))
  s = N.bump(s, 'claude', 'pats', at(11, 2, 9))
  s = N.bump(s, 'claude', 'pokes', at(11, 2, 9))
  s = N.bump(s, 'claude', 'pokes', at(11, 2, 9))
  s = N.bump(s, 'claude', 'angry', at(11, 2, 9))
  const r = s.chars.claude
  assert.deepEqual([r.pats, r.pokes, r.angry], [1, 2, 1])
})

test('bump：不认识的种类原样返回', () => {
  const s = N.empty(at(11, 1, 0))
  assert.equal(N.bump(s, 'claude', 'hugs', at(11, 2, 9)), s)
})

test('小成就：第 1 轮记在那一轮结束的日期', () => {
  let s = N.empty(at(10, 1, 0))
  s = N.recordRound(s, 'claude', at(10, 6, 10), at(10, 6, 11))
  const r = N.checkMilestones(s, 'claude', at(10, 6, 11), { friendLevel: 0 })
  assert.equal(r.store.chars.claude.milestones.round1, '2026-10-06')
  assert.deepEqual(r.reached, ['round1'])
  assert.equal(r.store.chars.claude.milestones.round100, undefined)
})

test('小成就：第 100 轮', () => {
  let s = N.empty(at(10, 1, 0))
  for (let i = 0; i < 100; i++) s = N.recordRound(s, 'claude', at(10, 6, 10) + i * 60_000, at(10, 6, 10) + i * 60_000 + 30_000)
  const r = N.checkMilestones(s, 'claude', at(10, 6, 12), { friendLevel: 0 })
  assert.ok(r.reached.includes('round100'))
  assert.ok(r.reached.includes('busy50'))
})

test('小成就：认识 7 天，日期按 firstMet 往后数', () => {
  let s = N.empty(at(10, 1, 0))
  s = N.addMinute(s, ['claude'], at(10, 6, 10))
  const r = N.checkMilestones(s, 'claude', at(10, 20, 10), { friendLevel: 0 })
  assert.equal(r.store.chars.claude.milestones.days7, '2026-10-13')
  assert.equal(r.store.chars.claude.milestones.days30, undefined)
})

test('小成就：凌晨 0–5 点结束的一轮算通宵，记下几点；5 点整不算', () => {
  let s = N.empty(at(10, 1, 0))
  s = N.recordRound(s, 'claude', at(10, 6, 2), at(10, 6, 3, 10))
  const r = N.checkMilestones(s, 'claude', at(10, 6, 3, 10), { friendLevel: 0 })
  assert.ok(r.reached.includes('night'))
  assert.equal(r.store.chars.claude.nightHour, 3)
  let t = N.empty(at(10, 1, 0))
  t = N.recordRound(t, 'claude', at(10, 6, 4), at(10, 6, 5))
  assert.ok(!N.checkMilestones(t, 'claude', at(10, 6, 5), { friendLevel: 0 }).reached.includes('night'))
})

test('小成就：摸头 100 次', () => {
  let s = N.empty(at(10, 1, 0))
  for (let i = 0; i < 100; i++) s = N.bump(s, 'claude', 'pats', at(10, 6, 10))
  assert.ok(N.checkMilestones(s, 'claude', at(10, 6, 10), { friendLevel: 0 }).reached.includes('pats100'))
})

test('小成就：第一次有了好朋友（关系升到 1 档以上）', () => {
  let s = N.addMinute(N.empty(at(10, 1, 0)), ['claude'], at(10, 6, 10))
  assert.ok(!N.checkMilestones(s, 'claude', at(10, 6, 10), { friendLevel: 0 }).reached.includes('friend'))
  assert.ok(N.checkMilestones(s, 'claude', at(10, 6, 10), { friendLevel: 1 }).reached.includes('friend'))
})

test('reached 只列这次新达成的', () => {
  let s = N.recordRound(N.empty(at(10, 1, 0)), 'claude', at(10, 6, 10), at(10, 6, 11))
  const a = N.checkMilestones(s, 'claude', at(10, 6, 11), { friendLevel: 0 })
  const b = N.checkMilestones(a.store, 'claude', at(10, 6, 12), { friendLevel: 0 })
  assert.deepEqual(b.reached, [])
  assert.equal(b.store, a.store)
})

test('view：面板要的字段', () => {
  let s = { ...N.empty(at(10, 1, 0)), installedAt: at(10, 1, 9) }
  s = N.recordRound(s, 'claude', at(10, 6, 10), at(10, 6, 12))
  s = N.recordRound(s, 'gpt', at(10, 7, 10), at(10, 7, 11))
  s = N.bump(s, 'claude', 'pats', at(10, 6, 12))
  s = N.addMinute(s, ['claude'], at(10, 6, 12))
  s = N.checkMilestones(s, 'claude', at(10, 6, 12), { friendLevel: 0 }).store
  s = N.checkMilestones(s, 'claude', at(10, 20, 12), { friendLevel: 0 }).store
  const friendship = { 'claude+gpt': { points: 40 }, 'claude+gemini': { points: 10 }, 'gemini+gpt': { points: 400 } }
  const v = N.view(s, 'claude', { names: { claude: 'Claude', gpt: 'GPT' }, friendship, nowMs: at(10, 20, 12) })
  assert.equal(v.id, 'claude')
  assert.equal(v.name, 'Claude')
  assert.equal(v.firstMet, at(10, 6, 10))
  assert.equal(v.daysKnown, 15)
  assert.equal(v.rounds, 1)
  assert.equal(v.workMs, 2 * HOUR)
  assert.equal(v.minutes, 1)
  assert.deepEqual([v.pats, v.pokes, v.angry], [1, 0, 0])
  assert.deepEqual(v.busiest, { date: '2026-10-06', rounds: 1 })
  assert.equal(v.longestMs, 2 * HOUR)
  assert.deepEqual(v.friend, { id: 'gpt', name: 'GPT', level: '认识了', hearts: F.hearts(40) + F.partial(40) })
  assert.deepEqual(v.milestones.map(m => m.id), ['days7', 'round1'])
  assert.equal(v.milestones[0].date, '2026-10-13')
  assert.equal(typeof v.milestones[0].label, 'string')
  assert.equal(v.before, 0)
  assert.equal(v.backfilled, false)
  assert.deepEqual(v.total, { days: 20, rounds: 2 })
  // 落款要的：今天几轮（那天没干是 0）、最后一轮结束的时间
  assert.equal(v.todayRounds, 0)
  assert.equal(v.lastEnd, at(10, 6, 12))
  assert.equal(N.view(s, 'claude', { names: {}, friendship, nowMs: at(10, 6, 20) }).todayRounds, 1)
})

test('view：还没有一起站过的就没有最好的朋友；没见过的角色全是 0', () => {
  const s = N.empty(at(10, 1, 0))
  const v = N.view(s, 'grok', { names: {}, friendship: {}, nowMs: at(10, 2, 0) })
  assert.equal(v.friend, null)
  assert.equal(v.name, 'grok')
  assert.equal(v.rounds, 0)
  assert.equal(v.daysKnown, 0)
  assert.equal(v.busiest, null)
  assert.deepEqual(v.milestones, [])
})

test('merge：每个角色留多的那份，安装日取早的，坏记录丢掉', () => {
  let a = { ...N.empty(at(11, 2, 0)), installedAt: 0 }
  a = N.recordRound(a, 'claude', at(11, 2, 10), at(11, 2, 11))
  let b = { ...N.empty(at(11, 1, 0)), installedAt: at(10, 1, 0), backfilled: true }
  for (let i = 0; i < 3; i++) b = N.recordRound(b, 'claude', at(11, 1, 10 + i), at(11, 1, 10 + i, 5))
  b = N.recordRound(b, 'gpt', at(11, 1, 10), at(11, 1, 11))
  b.chars.bad = 'x'
  b.chars.nan = { ...b.chars.gpt, rounds: NaN }
  const m = N.merge(a, b)
  assert.equal(m.chars.claude.rounds, 3)
  assert.equal(m.chars.gpt.rounds, 1)
  assert.equal(m.chars.bad, undefined)
  assert.equal(m.chars.nan, undefined)
  assert.equal(m.installedAt, at(10, 1, 0))
  assert.equal(m.liveSince, at(11, 1, 0))
  assert.equal(m.backfilled, true)
  assert.equal(N.merge(a, null), a)
  assert.equal(N.merge(a, []), a)
  // 本地坏了（不是对象）：用备份
  assert.equal(N.merge(null, b).chars.claude.rounds, 3)
})

test('写函数都不改入参', () => {
  const s = N.empty(at(11, 1, 0))
  const snap = JSON.stringify(s)
  N.recordRound(s, 'claude', at(11, 2, 10), at(11, 2, 11))
  N.addMinute(s, ['claude'], at(11, 2, 10))
  N.bump(s, 'claude', 'pats', at(11, 2, 10))
  const r = N.recordRound(s, 'claude', at(11, 2, 10), at(11, 2, 11))
  const snap2 = JSON.stringify(r)
  N.checkMilestones(r, 'claude', at(11, 2, 11), { friendLevel: 1 })
  assert.equal(JSON.stringify(s), snap)
  assert.equal(JSON.stringify(r), snap2)
})

test('logChat：新的在前，最多留 30 段，只存角色和台词', () => {
  let s = N.empty(0)
  for (let i = 0; i < 35; i++) s = N.logChat(s, [['claude', `第${i}句`, 'happy'], ['gpt', '嗯', null]], 1000 + i)
  assert.equal(s.chats.length, 30)
  assert.equal(s.chats[0].t, 1034)
  assert.deepEqual(s.chats[0].lines, [['claude', '第34句'], ['gpt', '嗯']])
})

test('addMinute 顺带记每一对一起在桌面上的分钟和第一次', () => {
  let s = N.addMinute(N.empty(0), ['claude', 'gpt', 'grok'], 5000)
  s = N.addMinute(s, ['claude', 'gpt'], 65000)
  assert.deepEqual(s.pairs['claude+gpt'], { first: 5000, minutes: 2, last: 65000 })
  assert.deepEqual(s.pairs['gpt+grok'], { first: 5000, minutes: 1, last: 5000 })
  assert.deepEqual(s.pairs['claude+grok'], { first: 5000, minutes: 1, last: 5000 })
  assert.equal(N.addMinute(N.empty(0), ['claude'], 1).pairs, undefined)
})

const fr = (o) => Object.fromEntries(Object.entries(o).map(([k, points]) => [k, { points }]))
test('friendsOf：按心数排、同心按一起的分钟，最多 4 个', () => {
  let s = N.empty(0)
  s = { ...s, pairs: { 'claude+gpt': { first: 1, minutes: 50 }, 'claude+grok': { first: 2, minutes: 90 } } }
  const friendship = fr({ 'claude+gpt': 40, 'claude+grok': 40, 'claude+deepseek': 400, 'claude+glm': 10, 'claude+qwen': 5, 'gemini+gpt': 99 })
  const list = N.friendsOf(s, 'claude', { friendship, installed: ['claude', 'gpt', 'grok', 'deepseek', 'glm', 'qwen', 'gemini'] })
  assert.deepEqual(list.map(f => f.id), ['deepseek', 'grok', 'gpt', 'glm'])
  assert.equal(list[0].level, F.level(400))
  assert.equal(list[1].minutes, 90); assert.equal(list[1].first, 2)
  assert.equal(list[0].minutes, 0); assert.equal(list[0].first, 0)
})
test('friendsOf：没装的角色、0 分的对跳过', () => {
  const friendship = fr({ 'claude+kimi': 300, 'claude+gpt': 0, 'claude+grok': 20 })
  assert.deepEqual(N.friendsOf(N.empty(0), 'claude', { friendship, installed: ['claude', 'gpt', 'grok'] }).map(f => f.id), ['grok'])
})
test('merge：旧的备份没有 pairs / chats 也能合，各取多的', () => {
  const local = { ...N.empty(0), pairs: { 'claude+gpt': { first: 50, minutes: 3 } }, chats: [{ t: 2, lines: [['claude', 'a']] }] }
  const saved = { ...N.empty(0), chars: {} }
  const m = N.merge(local, saved)
  assert.deepEqual(m.pairs, local.pairs); assert.deepEqual(m.chats, local.chats)
  const m2 = N.merge(saved, { ...saved, pairs: { 'claude+gpt': { first: 10, minutes: 1 } } })
  assert.deepEqual(m2.pairs['claude+gpt'], { first: 10, minutes: 1 })
  const m3 = N.merge(local, { ...saved, pairs: { 'claude+gpt': { first: 10, minutes: 1 } } })
  assert.deepEqual(m3.pairs['claude+gpt'], { first: 10, minutes: 3 })
})
test('merge：chats 按时间去重、新的在前、留 30 段', () => {
  const a = Array.from({ length: 20 }, (_, i) => ({ t: i * 2, lines: [['claude', 'x']] }))
  const b = Array.from({ length: 20 }, (_, i) => ({ t: i * 3, lines: [['claude', 'y']] }))
  const m = N.merge({ ...N.empty(0), chats: a }, { ...N.empty(0), chats: b })
  assert.equal(m.chats.length, 30)
  assert.ok(m.chats.every((c, i) => i === 0 || m.chats[i - 1].t > c.t))
})
test('chatsOf：只要她参与的，最近 5 段', () => {
  let s = N.empty(0)
  for (let i = 0; i < 8; i++) s = N.logChat(s, [['claude', 'a'], ['gpt', 'b']], i)
  s = N.logChat(s, [['gpt', 'a'], ['grok', 'b']], 100)
  const got = N.chatsOf(s, 'claude')
  assert.equal(got.length, 5); assert.equal(got[0].t, 7)
  assert.equal(N.chatsOf(s, 'grok').length, 1)
})

test('addminute_sets_pair_last：记下这一对上次一起站着的时间', () => {
  const t = new Date(2026, 10, 16, 12).getTime()
  const s = N.addMinute(N.empty(t), ['claude', 'gpt'], t)
  assert.equal(s.pairs['claude+gpt'].last, t)
})

test('bump_today_counter_rolls_over：今天的摸戳次数，过了零点重新数', () => {
  const y = new Date(2026, 10, 15, 22).getTime(), t = new Date(2026, 10, 16, 9).getTime()
  let s = N.empty(y)
  for (let i = 0; i < 3; i++) s = N.bump(s, 'claude', 'pats', y)
  s = N.bump(s, 'claude', 'pats', t)
  s = N.bump(s, 'claude', 'angry', t)
  assert.deepEqual(s.chars.claude.today, { day: '2026-11-16', pats: 1, pokes: 0 })
})

test('merge_keeps_pair_last_and_lv：合并时上次同框取晚的、关系取大的', () => {
  const local = { ...N.empty(0), pairs: { 'claude+gpt': { first: 1, minutes: 5, last: 100, lv: 1 } } }
  const saved = { ...N.empty(0), pairs: { 'claude+gpt': { first: 2, minutes: 9, last: 50, lv: 2 } } }
  assert.deepEqual(N.merge(local, saved).pairs['claude+gpt'], { first: 1, minutes: 9, last: 100, lv: 2 })
})

test('merge_combines_events：两边的事合并去重', () => {
  const e = { day: '2026-11-16', kind: 'chat', owner: 'claude', friend: 'gpt', q: 'x' }
  const local = { ...N.empty(0), events: [e] }
  const saved = { ...N.empty(0), events: [{ ...e }, { day: '2026-11-15', kind: 'anniv', owner: 'claude', friend: 'gpt', n: 30 }] }
  assert.equal(N.merge(local, saved).events.length, 2)
})
