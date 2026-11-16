// 小本子第二页的「事」：这一对升级了、今天聊过、过节、认识整 N 天、她昨天很忙、今天被摸 / 戳得多、隔了好久又碰面。
// 发生的时候记（升级的日期、哪天聊过，事后都算不出来），只记 id、日期、种类和数字（chat 另记当时对方说的那一句，是写好的台词）。
// 纯函数；主桌宠页面调用，存进小本子的存储（crosspet-notebook / notebook.json）的 events。
// 设计：docs/superpowers/specs/2026-11-16-notebook-diary-design.md
;(function (root) {
  const Friendship = root.Friendship || (typeof require === 'function' ? require('./friendship.js') : null)
  const KINDS = ['levelup', 'chat', 'fest', 'anniv', 'busy', 'pats', 'reunion']
  const KEEP = 60                 // 每本本子留最近这么多个有事的日子
  const BUSY_ROUNDS = 30, PATS_TODAY = 20, REUNION_DAYS = 7, FEST_WRITERS = 3
  const ANNIV = new Set([7, 30, 100, 365])   // 和第一页落款一样：这几天，加上 100 以后每个 100 的倍数
  const isAnniv = n => n > 0 && (ANNIV.has(n) || (n > 100 && n % 100 === 0))

  // 和 notebook.js 的一样（这里不 require 它，免得两个文件互相引用）
  const pairKey = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`)
  const pad = n => String(n).padStart(2, '0')
  const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
  const dayStart = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86_400_000)
  const prevDay = ms => { const d = new Date(ms); return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()) }

  const idOf = e => `${e.day}|${e.kind}|${e.owner}|${e.friend}`
  const levelOfPoints = p => (Friendship ? Friendship.level(p || 0) : 0)

  // 按日子新的在前；每本本子只留最近 KEEP 个有事的日子
  function tidy(events) {
    const seen = new Set(), out = []
    for (const e of events) if (e && typeof e.day === 'string' && KINDS.includes(e.kind) && e.owner && e.friend && !seen.has(idOf(e))) { seen.add(idOf(e)); out.push(e) }
    out.sort((x, y) => (x.day < y.day ? 1 : x.day > y.day ? -1 : 0))
    const days = {}
    return out.filter(e => { const d = (days[e.owner] = days[e.owner] || new Set()); if (!d.has(e.day)) { if (d.size >= KEEP) return false; d.add(e.day) } return true })
  }
  const withEvents = (store, add) => (add.length ? { ...store, events: tidy([...add, ...(store.events || [])]) } : store)

  // 说完的一段对话：说话的人里每两只，各给对方的本子记一条（同一天同一对只记第一次）
  function recordChat(store, lines, nowMs, { installed = [] } = {}) {
    const ok = new Set(installed), day = localDay(nowMs)
    const who = [...new Set((lines || []).map(([w]) => w).filter(w => ok.has(w)))]
    const add = []
    for (const owner of who) for (const friend of who) {
      if (owner === friend) continue
      const q = lines.find(([w]) => w === friend)?.[1] || ''
      add.push({ day, kind: 'chat', owner, friend, q })
    }
    if (!add.length) return store
    const have = new Set((store.events || []).map(idOf))
    return withEvents(store, add.filter(e => !have.has(idOf(e))))
  }

  // 每分钟一次（在 Notebook.addMinute 之前：要用到上一次的 pairs[key].last）。按日期、按数字的事在这里补记
  function tick(store, { nowMs, present = [], friendship = {}, fest = null, installed = [] }) {
    const ok = new Set(installed), day = localDay(nowMs)
    const pairs = { ...(store.pairs || {}) }
    const add = []
    const both = (kind, a, b, more) => { add.push({ day, kind, owner: a, friend: b, ...more }, { day, kind, owner: b, friend: a, ...more }) }
    const points = k => friendship[k]?.points || 0

    for (const k of new Set([...Object.keys(friendship), ...Object.keys(pairs)])) {
      const [a, b] = k.split('+')
      if (!ok.has(a) || !ok.has(b)) continue
      const lv = levelOfPoints(points(k)), p = pairs[k]
      // 升级：没记过关系的只记下现在的（刚装新版时不把已有的关系都算成刚升级）
      if (!p || !Number.isFinite(p.lv)) { if (points(k) > 0) pairs[k] = { first: 0, minutes: 0, ...(p || {}), lv } }
      else if (lv > p.lv) { both('levelup', a, b, { n: lv }); pairs[k] = { ...p, lv } }
      if (!p) continue
      if (lv >= 1 && p.first && isAnniv(daysBetween(p.first, nowMs))) both('anniv', a, b, { n: daysBetween(p.first, nowMs) })
      if (p.last && present.includes(a) && present.includes(b)) {
        const gap = daysBetween(p.last, nowMs)
        if (gap >= REUNION_DAYS) both('reunion', a, b, { n: gap })
      }
    }

    // 本子主人的朋友：认识了以上，心多的在前
    const friendsOf = owner => Object.keys(friendship)
      .map(k => { const [a, b] = k.split('+'); return { k, other: a === owner ? b : b === owner ? a : null } })
      .filter(x => x.other && ok.has(x.other) && levelOfPoints(points(x.k)) >= 1)
      .sort((x, y) => points(y.k) - points(x.k) || (pairs[y.k]?.minutes || 0) - (pairs[x.k]?.minutes || 0))
      .map(x => x.other)

    const owners = [...ok]
    if (fest) {
      const since = localDay(nowMs - 7 * 86_400_000)
      for (const owner of owners) {
        const done = (store.events || []).some(e => e.kind === 'fest' && e.owner === owner && e.n === fest && e.day > since && e.day !== day)
        if (!done) for (const friend of friendsOf(owner).slice(0, FEST_WRITERS)) add.push({ day, kind: 'fest', owner, friend, n: fest })
      }
    }
    const yesterday = prevDay(nowMs)
    for (const owner of owners) {
      const rec = store.chars?.[owner]
      if (!rec) continue
      const best = friendsOf(owner)[0]
      if (!best) continue
      const rounds = rec.days?.[yesterday] || 0
      if (rounds >= BUSY_ROUNDS) add.push({ day, kind: 'busy', owner, friend: best, n: rounds })
      const t = rec.today
      if (t && t.day === day) {
        const pats = t.pats || 0, pokes = t.pokes || 0
        if (Math.max(pats, pokes) >= PATS_TODAY) add.push({ day, kind: 'pats', owner, friend: best, n: Math.max(pats, pokes), m: pokes > pats ? 'pokes' : 'pats' })
      }
    }

    const have = new Set((store.events || []).map(idOf))
    const out = { ...store, pairs }
    if (!Object.keys(pairs).length) delete out.pairs
    const fresh = add.filter(e => !have.has(idOf(e)))
    return fresh.length || store.events ? { ...out, events: tidy([...fresh, ...(store.events || [])]) } : out
  }

  const eventsOn = (store, owner, day) => (store.events || []).filter(e => e.owner === owner && e.day === day)
  const daysOf = (store, owner) => [...new Set((store.events || []).filter(e => e.owner === owner).map(e => e.day))]
  const mergeEvents = (a, b) => tidy([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])

  const api = { KINDS, KEEP, recordChat, tick, eventsOn, daysOf, mergeEvents }
  root.NotebookDiary = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
