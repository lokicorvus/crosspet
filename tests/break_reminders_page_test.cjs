// 久坐、喝水提醒在主桌宠页面里：到点演什么、演多久、睡着 / 干活 / 藏起来 / 额外那只时怎么办。
// 跑 app/web/index.html 里整段真实脚本（tests/page_harness.cjs），假时钟从 2026-10-19 09:00（UTC）开始。
//   node tests/break_reminders_page_test.cjs
'use strict'
const { makePage, WEB } = require('./page_harness.cjs')
const path = require('path')

const MIN = 60000
const POSES = ['idle', 'stretch', 'happy', 'pat', 'thinking', 'listening', 'sleeping', 'tired']
const frames = list => Object.fromEntries(list.map(p => [p, [`gpt/${p}.webp`]]))
const manifest = { characters: { gpt: { name: 'GPT', greeting: 'hi', lines: {}, poses: frames(POSES) } } }

async function fresh(role = 'main') {
  const e = makePage()
  if (role === 'companion') e.run(`setRole('companion', { id: 'gpt@codex', key: 'gpt@codex', character: 'gpt', client: 'codex', label: '终端' })`)
  e.run(`init(${JSON.stringify(manifest)})`)
  await e.advance(1000)
  e.run(`setCharacter('gpt', true)`)
  await e.advance(1000)
  e.run(`setPageHidden(false)`)
  e.run(`var __poses = []; const __sp = setPose; setPose = function (p, i) { __poses.push(p); return __sp(p, i) }`)
  return e
}
const on = (sit, water) => `setBreakReminders({ sit: ${!!sit}, sitEvery: ${sit || 45}, water: ${!!water}, waterEvery: ${water || 60} })`
const posesSeen = e => e.run('__poses')
// 一次走太久假时钟会报 Timer loop：分成 5 分钟一段
async function walk(e, ms) { for (; ms > 0; ms -= 5 * MIN) await e.advance(Math.min(ms, 5 * MIN)) }
function assert(c, msg) { if (!c) throw Error(msg) }
// 往前走到她换成 p 为止（最多 ms），返回用了多久
async function until(e, p, ms) {
  for (let t = 0; t <= ms; t += 1000) { if (e.state().pose === p) return t; await e.advance(1000) }
  throw Error(`never became ${p} within ${ms}ms; poses: ${posesSeen(e).join(',')}`)
}

const cases = [
  ['off_by_default', async e => {
    await walk(e, 3 * 60 * MIN)
    assert(!posesSeen(e).includes('stretch') && !posesSeen(e).includes('drink'), 'reminded while off: ' + posesSeen(e).join(','))
  }],
  ['sit_reminder_shows_30s', async e => {
    e.run(on(30, 0))
    await walk(e, 29 * MIN)
    assert(!posesSeen(e).includes('stretch'), 'reminded too early')
    await until(e, 'stretch', 2 * MIN)
    const line = e.state().bubble
    assert(e.run('LOCAL_LINES.remindSit').includes(line), 'unexpected line: ' + line)
    await e.advance(28000)
    assert(e.state().pose === 'stretch', 'stopped before 30s: ' + e.state().pose)
    await e.advance(3000)
    assert(e.state().pose !== 'stretch' && e.state().bubble === '', 'still showing after 30s: ' + e.state().pose + ' ' + e.state().bubble)
  }],
  ['water_uses_happy_fallback', async e => {
    e.run(on(0, 30))
    await until(e, 'drink', 32 * MIN)
    assert(e.run('currentUrl').includes('happy'), 'drink did not fall back to happy: ' + e.run('currentUrl'))
    assert(e.run('LOCAL_LINES.remindWater').includes(e.state().bubble), 'unexpected line: ' + e.state().bubble)
  }],
  ['sleeping_still_reminded', async e => {
    e.run(on(30, 0))
    await walk(e, 20 * MIN)
    assert(e.state().pose === 'sleeping', 'precondition: asleep after 10 idle minutes, got ' + e.state().pose)
    await until(e, 'stretch', 12 * MIN)
  }],
  ['ai_work_overrides_reminder', async e => {
    e.run(on(30, 0))
    await until(e, 'stretch', 32 * MIN)
    await e.advance(5000)
    e.run(`hook('gpt', 'thinking', 'PreToolUse')`)
    await e.advance(3000)
    e.run(`hook('gpt', 'thinking', 'PreToolUse')`)
    await e.advance(30000)
    assert(e.state().pose === 'thinking', 'reminder pulled her out of work: ' + e.state().pose)
  }],
  ['hidden_long_resets_sit', async e => {
    e.run(on(30, 0))
    await walk(e, 20 * MIN)
    e.run('setPageHidden(true)')
    await walk(e, 6 * MIN)
    e.run('setPageHidden(false)')
    await walk(e, 29 * MIN)
    assert(!posesSeen(e).includes('stretch'), 'sit timer not reset by a long hide')
    await until(e, 'stretch', 2 * MIN)
  }],
  ['companion_never_reminds', async e => {
    e.run(on(30, 30))
    await walk(e, 2 * 60 * MIN)
    assert(!posesSeen(e).includes('stretch') && !posesSeen(e).includes('drink'), 'companion reminded: ' + posesSeen(e).join(','))
  }, 'companion'],
]

;(async () => {
  const failures = []
  for (const [name, fn, role] of cases) {
    try {
      const e = await fresh(role)
      await fn(e)
      if (e.errors.length) throw Error(`page errors: ${JSON.stringify(e.errors)}`)
    } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ file: path.join(WEB, 'index.html'), passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
