// 额度条样式（设置「额度显示样式：额度条」）：单家显示时每个额度一行——名字、条、剩余百分比、短重置时间；条按剩余分三档变色。
// 只做排版判断；画进小窗的 render 在浏览器里用。设计见 docs/superpowers/specs/2026-10-21-quota-bars-design.md，测试 tests/quota_bars.test.js
// 数据：额度对象 q = { text, low, bars?, note? }。bars = [{ label, left（剩余 0–1）, reset?（Unix 秒）, group? }]；
// 没有 bars（旧版 Claude mod、余额）就按 text 的固定格式拆，拆不动的那段照旧显示文字
;(function (root) {
  const QA = root.QuotaAggregate || (typeof require !== 'undefined' ? require('./quota-aggregate.js') : null)

  // 颜色三档（多于 30% 蓝、10%–30% 橙、10% 及以下红）：和合并显示共用 quota-aggregate.js 的那一份
  const level = QA.level

  // 重置时间短写：24 小时内「3:40」（小时不补零），7 天内「周一」，再远「10/26」，按本机时区
  const WEEK = '日一二三四五六'
  function shortWhen(sec, nowSec) {
    const d = new Date(sec * 1000), ahead = sec - nowSec
    if (ahead < 86400) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    if (ahead < 7 * 86400) return `周${WEEK[d.getDay()]}`
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const pctOf = left => Math.max(0, Math.min(100, Math.round((+left || 0) * 100)))
  function barRow(b, label, nowSec) {
    if (b.reset && b.reset <= nowSec) return { kind: 'bar', label, pct: 100, level: 'ok', when: null }   // 过了重置时间、还没新数据：算满
    const pct = pctOf(b.left)
    return { kind: 'bar', label, pct, level: level(pct), when: b.reset ? shortWhen(b.reset, nowSec) : null }
  }

  // 有几个池（Antigravity：Gemini / Argon / Claude/GPT）时每个池只画一条，和文字样式一样按 pickBar 挑；只有一个池时每个窗口一条
  function fromBars(bars, nowSec) {
    const groups = []
    for (const b of bars) {
      const g = b.group || ''
      let e = groups.find(x => x.g === g)
      if (!e) groups.push(e = { g, list: [] })
      e.list.push(b)
    }
    if (groups.length < 2) return bars.map(b => barRow(b, b.label, nowSec))
    return groups.map(e => { const b = QA.pickBar(e.list, e.g); return barRow(b, b.label, nowSec) })
  }

  const SEG = /^(.+?) 剩余 (\d+)%(?: · (\S+) 重置)?(.*)$/
  function fromText(q) {
    let note = null
    const rows = String(q.text).split(/\s*｜\s*/).filter(Boolean).map(seg => {
      const m = SEG.exec(seg)
      if (!m) return { kind: 'text', text: seg, low: !!q.low }
      const [, label, p, when, tail] = m
      const t = tail.trim().replace(/^·\s*/, '')
      if (t) note = t   // GPT 问不到时的「· 15:20 的数据」
      const pct = Math.min(100, +p)
      return { kind: 'bar', label, pct, level: level(pct), when: when || null }
    })
    return { rows, note }
  }

  function of(q, nowSec) {
    if (!q || !q.text) return null
    const r = Array.isArray(q.bars) && q.bars.length ? { rows: fromBars(q.bars, nowSec), note: null } : fromText(q)
    if (!r.rows.some(x => x.kind === 'bar')) return null   // 一根条都没有（只有余额）：整块照旧按文字样式画
    if (q.note) r.note = q.note
    return r
  }

  // 画进名牌下面的小窗（只在浏览器里用）
  function render(el, result) {
    const div = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; if (text != null) d.textContent = text; return d }
    const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; if (text != null) s.textContent = text; return s }
    const timed = result.rows.some(r => r.when)   // 有一行带重置时间就每行都留出那一格，几根条才对得齐
    el.replaceChildren(...result.rows.map(r => {
      if (r.kind === 'text') return div(r.low ? 'low' : '', r.text)
      const row = div('qbar ' + r.level)
      const track = span('qtrack'), fill = document.createElement('i')
      fill.style.width = r.pct + '%'
      track.append(fill)
      row.append(span('ql', r.label), track, span('qp', r.pct + '%'))
      if (timed) row.append(span('qt', r.when || ''))
      return row
    }))
    if (result.note) el.append(div('qnote', result.note))
  }

  const api = { level, shortWhen, of, render }
  root.QuotaBars = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
