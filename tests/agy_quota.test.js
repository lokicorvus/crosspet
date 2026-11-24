// Antigravity 的 Gemini 额度按设置「显示哪些」挑（app/web/agy-quota.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const { view } = require('../app/web/agy-quota.js')

const now = 1_800_000_000
const sample = (over = {}) => ({
  text: 'Gemini 5小时 剩余 89% · 15:35 重置 ｜ Claude/GPT 5小时 剩余 100%', low: false,
  bars: [
    { label: 'Gemini 5小时', left: 0.89, reset: now + 3600, group: 'Gemini', ...over.five },
    { label: 'Gemini 本周', left: 0.95, reset: now + 3 * 86400, group: 'Gemini', ...over.week },
    { label: 'Claude/GPT 5小时', left: 1, group: 'Claude/GPT' },
    { label: 'Claude/GPT 本周', left: 1, group: 'Claude/GPT' },
  ],
})
const pad = n => String(n).padStart(2, '0')
const hm = sec => { const d = new Date(sec * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const md = sec => { const d = new Date(sec * 1000); return `${d.getMonth() + 1}/${d.getDate()}` }

test('week_keeps_gemini_windows_like_gpt', () => {
  const v = view(sample(), 'week', now)
  assert.deepEqual(v.bars.map(b => b.label), ['5小时', '本周'])
  assert.deepEqual(v.bars.map(b => b.left), [0.89, 0.95])
  assert.equal(v.text, `5小时 剩余 89% · ${hm(now + 3600)} 重置 ｜ 本周 剩余 95%`)
  assert.equal(v.low, false)
})
test('cg_returns_original', () => { const q = sample(); assert.equal(view(q, 'cg', now), q) })
test('unknown_mode_is_week', () => assert.deepEqual(view(sample(), 'x', now), view(sample(), 'week', now)))
test('no_bars_or_no_gemini_group_unchanged', () => {
  const a = { text: 'Gemini 剩余 50%', low: false }
  assert.equal(view(a, 'week', now), a)
  const b = { text: 'Claude/GPT 本周 剩余 3%', low: true, bars: [{ label: 'Claude/GPT 本周', left: 0.03, group: 'Claude/GPT' }] }
  assert.equal(view(b, 'week', now), b)
})
test('null_passes_through', () => assert.equal(view(null, 'week', now), null))
test('weekly_tightest_gets_reset_mark_and_low', () => {
  const v = view(sample({ week: { left: 0.08 } }), 'week', now)
  assert.equal(v.text, `5小时 剩余 89% ｜ 本周 剩余 8% · ${md(now + 3 * 86400)} 重置`)
  assert.equal(v.low, true)
})
test('past_reset_window_counts_full', () => {
  const v = view(sample({ five: { left: 0.02, reset: now - 10 } }), 'week', now)
  assert.equal(v.text, `5小时 剩余 100% ｜ 本周 剩余 95% · ${md(now + 3 * 86400)} 重置`)
  assert.equal(v.low, false)
})
test('single_window', () => {
  const v = view({ text: 'Gemini 剩余 40%', low: false, bars: [{ label: 'Gemini 本周', left: 0.4, group: 'Gemini' }] }, 'week', now)
  assert.deepEqual(v.bars, [{ label: '本周', left: 0.4 }])
  assert.equal(v.text, '本周 剩余 40%')
})

// Antigravity 关了：外壳接着交最后一次问到的数，带 source: 'stale' 和 at（几点问到的），和 GPT 一样标「HH:mm 的数据」
test('stale_marks_time_like_gpt', () => {
  const at = now - 1800
  const q = { ...sample(), source: 'stale', at }
  const w = view(q, 'week', now)
  assert.equal(w.note, `${hm(at)} 的数据`)
  assert.ok(w.text.endsWith(` · ${hm(at)} 的数据`), w.text)
  const c = view(q, 'cg', now)
  assert.equal(c.note, `${hm(at)} 的数据`)
  assert.equal(c.text, `${q.text} · ${hm(at)} 的数据`)
  assert.equal(c.bars, q.bars)
})
test('stale_past_reset_counts_full', () => {
  const v = view({ ...sample({ five: { left: 0.05, reset: now - 60 } }), source: 'stale', at: now - 7200 }, 'week', now)
  assert.ok(v.text.startsWith('5小时 剩余 100%'), v.text)
  assert.equal(v.low, false)
})
test('live_has_no_note', () => assert.equal(view(sample(), 'week', now).note, undefined))
