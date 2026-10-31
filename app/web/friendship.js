// 多桌宠的友谊记账：每对角色攒好感点，换算成 0–5 颗心。
// 纯函数；只由主桌宠页面调用 award 并存进 localStorage（crosspet-friendship），设置页只读 rows。
;(function (root) {
  // 一起在场每 10 分钟记一次 together
  const TOGETHER_MS = 600_000
  // 前后脚干完、分别摸头都按 5 分钟内算
  const COFINISH_MS = 300_000
  const PATS_MS = 300_000
  // 同时干活：同一对 10 分钟内只算一次
  const COWORK_GAP = 600_000
  // 每对每天（本地日期）最多加这么多，别涨太快
  const DAILY_CAP = 25
  const POINTS = { together: 1, cowork: 3, cofinish: 2, pats: 2 }
  const THRESHOLDS = [10, 40, 90, 160, 250]

  function pairKey(a, b) {
    if (a === b) return null
    return a < b ? `${a}+${b}` : `${b}+${a}`
  }

  function localDay(ms) {
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  function award(store, a, b, kind, nowMs) {
    const key = pairKey(a, b)
    if (!key || !Object.prototype.hasOwnProperty.call(POINTS, kind)) return store
    const prev = store[key] || { points: 0, day: '', today: 0, lastCowork: 0 }
    const day = localDay(nowMs)
    const rec = { ...prev, day, today: prev.day === day ? prev.today : 0 }
    if (kind === 'cowork') {
      if (prev.lastCowork && nowMs - prev.lastCowork < COWORK_GAP) return store
      rec.lastCowork = nowMs
    }
    // 只加不减；到上限的部分截掉
    const gain = Math.max(0, Math.min(POINTS[kind], DAILY_CAP - rec.today))
    rec.points += gain
    rec.today += gain
    return { ...store, [key]: rec }
  }

  function hearts(points) {
    let lo = 0
    for (let i = 0; i < THRESHOLDS.length; i++) {
      const hi = THRESHOLDS[i]
      if (points < hi) {
        // 第一档之前没有半颗心
        return i > 0 && points >= (lo + hi) / 2 ? i + 0.5 : i
      }
      lo = hi
    }
    return THRESHOLDS.length
  }

  function rows(store, names) {
    return Object.keys(store)
      .filter(key => store[key] && store[key].points > 0)
      .sort((x, y) => store[y].points - store[x].points)
      .map(key => {
        const [a, b] = key.split('+')
        const name = id => (names && names[id]) || id
        return { a, b, label: `${name(a)} ♥ ${name(b)}`, hearts: hearts(store[key].points) }
      })
  }

  const api = { pairKey, award, hearts, rows, TOGETHER_MS, COFINISH_MS, PATS_MS }
  root.Friendship = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
