// 额度条样式（app/web/quota-bars.js）：node --test tests/quota_bars.test.js
process.env.TZ = 'Asia/Shanghai'
const test = require('node:test')
const assert = require('node:assert')
const B = require('../app/web/quota-bars.js')

const bj = s => Date.parse(s + ':00+08:00') / 1000
const now = bj('2026-10-21T10:00')   // 周三

test('颜色三档：多于 30% 蓝、10%–30% 橙、10% 及以下红', () => {
  assert.deepStrictEqual([100, 31, 30, 11, 10, 0].map(B.level), ['ok', 'ok', 'mid', 'mid', 'low', 'low'])
})

test('重置时间短写：24 小时内、7 天内、更远', () => {
  assert.equal(B.shortWhen(now + 5.6 * 3600, now), '15:36')
  assert.equal(B.shortWhen(bj('2026-10-22T03:40'), now), '3:40')   // 不补零
  assert.equal(B.shortWhen(bj('2026-10-26T08:00'), now), '周一')
  assert.equal(B.shortWhen(bj('2026-11-02T08:00'), now), '11/2')
})

test('有 bars、只有一个池：每个窗口一行', () => {
  const r = B.of({ text: 'x', bars: [{ label: '5小时', left: 0.91, reset: now + 3600 }, { label: '本周', left: 0.25 }] }, now)
  assert.deepStrictEqual(r.rows, [
    { kind: 'bar', label: '5小时', pct: 91, level: 'ok', when: '11:00' },
    { kind: 'bar', label: '本周', pct: 25, level: 'mid', when: null }])
  assert.equal(r.note, null)
})

test('Gemini 有几个池：每个池只画一条（和文字样式一样按 pickBar 挑），不是每个窗口一条', () => {
  const H = 3600, D = 86400
  const bars = [
    { label: 'Gemini 5小时', left: 1, reset: now + 5 * H, group: 'Gemini' }, { label: 'Gemini 本周', left: 0.99, reset: now + 3 * D, group: 'Gemini' },
    { label: 'Argon 本周', left: 0.46, reset: now + 4 * D, group: 'Argon' },
    { label: 'Claude/GPT 5小时', left: 1, reset: now + 5 * H, group: 'Claude/GPT' }, { label: 'Claude/GPT 本周', left: 1, reset: now + 6 * D, group: 'Claude/GPT' }]
  const r = B.of({ text: 'x', bars }, now)
  assert.deepStrictEqual(r.rows.map(x => [x.label, x.pct]), [['Gemini 本周', 99], ['Argon 本周', 46], ['Claude/GPT 本周', 100]])
})

test('剩余 10% 算快用完（红），过了重置时间算满、不写时间', () => {
  assert.equal(B.of({ text: 'x', bars: [{ label: '5小时', left: 0.1, reset: now + 60 }] }, now).rows[0].level, 'low')
  assert.deepStrictEqual(B.of({ text: 'x', bars: [{ label: '5小时', left: 0.05, reset: now - 60 }] }, now).rows[0],
    { kind: 'bar', label: '5小时', pct: 100, level: 'ok', when: null })
})

test('没有 bars 时从文字拆（旧版 Claude mod）：时间用文字里原样的', () => {
  const r = B.of({ text: '5小时 剩余 91% ｜ 本周 剩余 8% · 10/26 重置', low: true }, now)
  assert.deepStrictEqual(r.rows.map(x => [x.label, x.pct, x.level, x.when]), [['5小时', 91, 'ok', null], ['本周', 8, 'low', '10/26']])
})

test('拆字：「· 15:20 的数据」进 note；q.note 优先', () => {
  assert.equal(B.of({ text: '5小时 剩余 40% · 15:20 的数据' }, now).note, '15:20 的数据')
  assert.equal(B.of({ text: 'x', bars: [{ label: '本周', left: 0.4 }], note: '15:20 的数据' }, now).note, '15:20 的数据')
})

test('拆不动的段落保留成文字行；一根条都没有（只有余额）时返回 null，整块照旧按文字样式画', () => {
  assert.deepStrictEqual(B.of({ text: '5小时 剩余 50% ｜ 余额 ¥4.96', low: true }, now).rows[1], { kind: 'text', text: '余额 ¥4.96', low: true })
  assert.equal(B.of({ text: '余额 ¥4.96', low: true }, now), null)
})

test('没有额度 → null', () => {
  assert.equal(B.of(null, now), null)
  assert.equal(B.of({ text: '' }, now), null)
})
