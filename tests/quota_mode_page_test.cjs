// 设置「显示哪些」接进桌宠页面：Gemini（Antigravity）额度按模式显示，换模式立刻重画。
// 跑 app/web/index.html 整段真实脚本，DOM 和时钟是假的；不开窗口、不联网。
//   node tests/quota_mode_page_test.cjs
'use strict'
const { makePage, WEB } = require('./page_harness.cjs')
const path = require('path')

const POSES = ['idle', 'thinking', 'listening', 'happy', 'tired']
const manifest = { characters: Object.fromEntries(['claude', 'gemini'].map(id =>
  [id, { name: id, greeting: id + ' hello', lines: {}, poses: Object.fromEntries(POSES.map(p => [p, [`/characters/${id}/${p}.webp`]])) }])) }
const SHELL_TEXT = 'Gemini 5小时 剩余 89% · 15:35 重置 ｜ Claude/GPT 5小时 剩余 100%'
const sample = now => ({ text: SHELL_TEXT, low: false, bars: [
  { label: 'Gemini 5小时', left: 0.89, reset: now + 3600, group: 'Gemini' },
  { label: 'Gemini 本周', left: 0.95, reset: now + 3 * 86400, group: 'Gemini' },
  { label: 'Claude/GPT 5小时', left: 1, group: 'Claude/GPT' },
  { label: 'Claude/GPT 本周', left: 1, group: 'Claude/GPT' },
] })
async function fresh() {
  const e = makePage()
  e.run(`init(${JSON.stringify(manifest)})`)
  await e.advance(1000)
  e.run(`setCharacter('gemini'); setQuotaStyle('text')`)
  await e.advance(1000)
  return e
}
const feed = e => e.run(`setQuota('gemini', ${JSON.stringify(sample(0))}.bars ? (q => (q.bars.forEach(b => b.reset && (b.reset += Date.now() / 1000)), q))(${JSON.stringify(sample(0))}) : null)`)
const lines = e => e.run(`$('quota').children.map(c => c.textContent)`)
function assert(c, msg) { if (!c) throw Error(msg) }

const cases = [
  ['agy_mode_default_week', async () => {
    const e = await fresh(); feed(e)
    const l = lines(e)
    assert(l.length === 2 && l[0].startsWith('5小时 剩余 89%') && l[1].startsWith('本周 剩余 95%'), `week: ${JSON.stringify(l)}`)
  }],
  ['agy_mode_cg_switches_back', async () => {
    const e = await fresh(); feed(e)
    e.run(`setAgyQuotaMode('cg')`)
    const l = lines(e)
    assert(l.length === 2 && l[0].startsWith('Gemini 5小时') && l[1].startsWith('Claude/GPT'), `cg: ${JSON.stringify(l)}`)
    e.run(`setAgyQuotaMode('week')`)
    assert(lines(e)[0].startsWith('5小时 剩余'), `back to week: ${JSON.stringify(lines(e))}`)
  }],
  ['agy_mode_before_quota', async () => {
    const e = await fresh()
    e.run(`setAgyQuotaMode('cg')`); feed(e)
    assert(lines(e)[1]?.startsWith('Claude/GPT'), `cg first: ${JSON.stringify(lines(e))}`)
  }],
  ['agy_mode_null_quota', async () => {
    const e = await fresh()
    e.run(`setQuota('gemini', null)`)
    e.run(`setAgyQuotaMode('cg'); setAgyQuotaMode('week')`)
    assert(lines(e).length === 0, `null: ${JSON.stringify(lines(e))}`)
  }],
  ['agy_mode_bars_style', async () => {
    const e = await fresh(); e.run(`$('foot').offsetHeight = 40; setQuotaStyle('bars')`); feed(e)   // 假 DOM 没有排版：告诉它底栏放得下，不然退回文字
    const labels = e.run(`$('quota').children.map(r => r.children[0]?.textContent)`)
    assert(JSON.stringify(labels) === JSON.stringify(['5小时', '本周']), `bars: ${JSON.stringify(labels)}`)
  }],
]

;(async () => {
  const failures = []
  for (const [name, fn] of cases) {
    try { await fn() } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ file: path.join(WEB, 'index.html'), passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
