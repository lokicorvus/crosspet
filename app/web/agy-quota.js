// Antigravity 的 Gemini 额度按设置「显示哪些」挑（设计见 docs/superpowers/specs/2026-11-24-gemini-额度显示模式-design.md，测试 tests/agy_quota.test.js）。
// 外壳交来 { text, low, bars }：text 每组挑一行（Gemini、Claude/GPT），bars 是每组每个窗口一项、带 group。
// - week（默认）：只看 Gemini 组的各个窗口，排得和 GPT / Claude 的额度一样：「5小时 剩余 89% · 15:35 重置 ｜ 本周 剩余 95%」
//   （文字格式同 codex-quota.js：只在剩得最少的那个后面标重置时间；过了重置时间的算满）
// - cg：原样，就是外壳挑的两组各一行
;(function (root) {
  const pad = n => String(n).padStart(2, '0')
  function when(sec, nowSec) {
    const d = new Date(sec * 1000)
    return sec - nowSec < 86400 ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`
  }

  function view(q, mode, nowSec) {
    if (mode === 'cg' || !q || !Array.isArray(q.bars)) return q
    const own = q.bars.filter(b => b.group === 'Gemini')
    if (!own.length) return q
    const bars = own.map(b => ({ label: String(b.label).replace(/^Gemini\s+/, ''), left: b.left, ...(b.reset ? { reset: b.reset } : {}) }))
    const past = b => b.reset > 0 && b.reset <= nowSec
    const pct = b => Math.max(0, Math.min(100, Math.round((+b.left || 0) * 100)))
    const live = bars.filter(b => !past(b))
    const least = live.length ? Math.min(...live.map(pct)) : 100
    let marked = false
    const text = bars.map(b => {
      if (past(b)) return `${b.label} 剩余 100%`
      let s = `${b.label} 剩余 ${pct(b)}%`
      if (!marked && pct(b) === least && b.reset > 0) { marked = true; s += ` · ${when(b.reset, nowSec)} 重置` }
      return s
    }).join(' ｜ ')
    return { text, low: least <= 10, bars }
  }

  root.AgyQuota = { view }
  if (typeof module !== 'undefined') module.exports = { view }
})(typeof window !== 'undefined' ? window : globalThis)
