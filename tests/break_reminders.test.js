// 久坐、喝水提醒的计时规则（app/web/break-reminders.js）。本机时间按 UTC 算，夜里 = 23:00–7:00
process.env.TZ = 'UTC'
const test = require('node:test')
const assert = require('node:assert')
const B = require('../app/web/break-reminders.js')

const MIN = 60000
const T = (s, day = '2026-11-17') => Date.parse(`${day}T${s}:00Z`)
// 从 from 到 to（含）每分钟 tick 一次；busyAt(ms) 决定那一分钟忙不忙。返回最后的 state 和每次说了什么
function run(state, cfg, from, to, busyAt = () => false) {
  const said = []
  for (let t = from; t <= to; t += MIN) {
    const r = B.tick(state, cfg, t, busyAt(t))
    state = r.state
    if (r.say) said.push([new Date(t).toISOString().slice(11, 16), r.say])
  }
  return { state, said }
}

test('off_never_says', () => {
  const { said } = run(B.fresh(T('09:00')), { sit: 0, water: 0 }, T('09:00'), T('12:00'))
  assert.deepStrictEqual(said, [])
})

test('sit_due_after_interval', () => {
  const { said, state } = run(B.fresh(T('09:00')), { sit: 45, water: 0 }, T('09:01'), T('10:30'))
  assert.deepStrictEqual(said, [['09:45', 'sit'], ['10:30', 'sit']])
  assert.strictEqual(state.sit.from, T('10:30'))
})

test('restart_resets', () => {
  let s = B.fresh(T('09:00'))
  s = run(s, { sit: 45, water: 0 }, T('09:01'), T('09:39')).state
  s = B.restart(s, 'sit', T('09:40'))
  const { said } = run(s, { sit: 45, water: 0 }, T('09:40'), T('10:25'))
  assert.deepStrictEqual(said, [['10:25', 'sit']])
})

test('busy_waits_then_says', () => {
  let s = B.fresh(T('09:00'))
  let r = B.tick(s, { sit: 45, water: 0 }, T('09:45'), true)
  assert.strictEqual(r.say, null)
  assert.strictEqual(r.state.sit.waitFrom, T('09:45'))
  const { said } = run(r.state, { sit: 45, water: 0 }, T('09:46'), T('09:50'), t => t < T('09:50'))
  assert.deepStrictEqual(said, [['09:50', 'sit']])
})

test('busy_too_long_skips', () => {
  const cfg = { sit: 45, water: 0 }
  let { said, state } = run(B.fresh(T('09:00')), cfg, T('09:45'), T('09:55'), () => true)
  assert.deepStrictEqual(said, [])
  assert.strictEqual(state.sit.from, T('09:55'))
  assert.strictEqual(state.sit.waitFrom, null)
  ;({ said } = run(state, cfg, T('09:56'), T('10:40')))
  assert.deepStrictEqual(said, [['10:40', 'sit']])
})

test('both_due_sit_first_water_5min_later', () => {
  const { said } = run(B.fresh(T('09:00')), { sit: 60, water: 60 }, T('09:01'), T('10:06'))
  assert.deepStrictEqual(said, [['10:00', 'sit'], ['10:05', 'water']])
})

test('night_skips_and_restarts', () => {
  const end = T('07:00', '2026-11-18')
  let { said, state } = run(B.fresh(T('22:50')), { sit: 30, water: 0 }, T('22:51'), end)
  assert.deepStrictEqual(said, [])
  assert.strictEqual(state.sit.from, T('06:59', '2026-11-18'), 'night keeps restarting the timer, so nothing piles up for 7:00')
  ;({ said } = run(state, { sit: 30, water: 0 }, end + MIN, T('07:30', '2026-11-18')))
  assert.deepStrictEqual(said, [['07:29', 'sit']])
})

test('isNight_bounds', () => {
  assert.strictEqual(B.isNight(T('22:59')), false)
  assert.strictEqual(B.isNight(T('23:00')), true)
  assert.strictEqual(B.isNight(T('06:59')), true)
  assert.strictEqual(B.isNight(T('07:00')), false)
})

test('back_short_hide_keeps_sit', () => {
  const s = B.fresh(T('09:00')), now = T('09:30')
  const a = B.back(s, 4 * MIN, now)
  assert.strictEqual(a.sit.from, T('09:00'))
  const b = B.back(s, 5 * MIN, now)
  assert.strictEqual(b.sit.from, now)
  assert.strictEqual(a.water.from, T('09:00'))
  assert.strictEqual(b.water.from, T('09:00'))
})

test('pure', () => {
  const s = B.fresh(T('09:00')), before = JSON.stringify(s)
  B.tick(s, { sit: 30, water: 30 }, T('10:00'), false)
  B.tick(s, { sit: 30, water: 30 }, T('10:00'), true)
  B.back(s, 10 * MIN, T('10:00'))
  B.restart(s, 'sit', T('10:00'))
  assert.strictEqual(JSON.stringify(s), before)
})

test('choices_and_defaults', () => {
  assert.deepStrictEqual(B.CHOICES, [30, 45, 60, 90, 120])
  assert.deepStrictEqual(B.DEFAULTS, { sit: 45, water: 60 })
})
