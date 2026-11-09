// 她的小本子：你和她的相处记录（轮数、时长、摸头、小成就……只记数字和日期，不记对话内容）。
// 纯函数；只由主桌宠页面调用并存进 localStorage（crosspet-notebook），外壳另存一份 notebook.json。
// 设计：docs/superpowers/specs/2026-11-08-notebook-design.md
;(function (root) {
  const Friendship = root.Friendship || (typeof require === 'function' ? require('./friendship.js') : null)
  const DAY = 86_400_000
  // 按天的轮数只留最近这么多天（算「最忙的一天」用；最忙那天另外记着，删了也不丢）
  const KEEP_DAYS = 60
  const KINDS = ['pats', 'pokes', 'angry']
  const LEVEL_NAMES = ['刚见面', '认识了', '好朋友', '挚友']

  // 小成就：顺序就是检查顺序。label 是面板上的一行，line 是达成时她说的通用台词（character.json 的 milestones 可以覆盖）
  const MILESTONES = {
    days7: { label: '认识 7 天', line: '认识一个星期啦，以后也请多关照～' },
    days30: { label: '认识 30 天', line: '认识一个月了呢！' },
    days100: { label: '认识 100 天', line: '一百天了！谢谢你一直在。' },
    days365: { label: '认识一周年', line: '一周年快乐！明年也一起吧。' },
    round1: { label: '第 1 轮活', line: '第一轮活干完啦！' },
    round100: { label: '第 100 轮活', line: '一起干了 100 轮啦！' },
    round1000: { label: '第 1000 轮活', line: '1000 轮了……我们真能干。' },
    busy50: { label: '一天干了 50 轮', line: '今天干了 50 轮，歇会儿吧？' },
    night: { label: '凌晨 {h} 点还在陪你', line: '都凌晨 {h} 点了，早点睡呀。' },
    pats100: { label: '摸头 100 次', line: '已经被摸了 100 次头了……' },
    friend: { label: '第一次有了好朋友', line: '我有好朋友啦！' },
  }
  const DAYS_AT = { days7: 7, days30: 30, days100: 100, days365: 365 }
  const ROUNDS_AT = { round1: 1, round100: 100, round1000: 1000 }

  function localDay(ms) {
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  // 本地日期那天的 0 点（跨夏令时也按日历日算）
  const dayStart = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const daysBetween = (fromMs, toMs) => Math.round((dayStart(toMs) - dayStart(fromMs)) / DAY)
  const addDays = (ms, n) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime() }

  function empty(nowMs) {
    return { v: 1, installedAt: 0, liveSince: nowMs, backfilled: false, chars: {} }
  }
  function blank() {
    return { firstMet: 0, minutes: 0, rounds: 0, workMs: 0, longestMs: 0, busiest: null, days: {},
      pats: 0, pokes: 0, angry: 0, before: 0, lastTs: 0, lastEnd: 0, nightHour: null, milestones: {} }
  }
  const recOf = (store, ch) => ({ ...blank(), ...((store.chars || {})[ch] || {}) })
  const put = (store, ch, rec) => ({ ...store, chars: { ...(store.chars || {}), [ch]: rec } })
  const meet = (rec, ms) => (rec.firstMet && rec.firstMet <= ms ? rec.firstMet : ms)

  function recordRound(store, ch, startMs, endMs) {
    const rec = recOf(store, ch)
    if (store.installedAt && startMs < store.installedAt) return put(store, ch, { ...rec, before: rec.before + 1 })
    const ms = Math.max(0, endMs - startMs)
    const day = localDay(endMs)
    let days = { ...rec.days, [day]: (rec.days[day] || 0) + 1 }
    const keys = Object.keys(days).sort()
    if (keys.length > KEEP_DAYS) for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete days[k]
    const busiest = !rec.busiest || days[day] > rec.busiest.rounds ? { date: day, rounds: days[day] } : rec.busiest
    return put(store, ch, {
      ...rec, firstMet: meet(rec, startMs), rounds: rec.rounds + 1, workMs: rec.workMs + ms,
      longestMs: Math.max(rec.longestMs, ms), days, busiest, lastEnd: Math.max(rec.lastEnd, endMs),
    })
  }

  function addMinute(store, chars, nowMs) {
    let out = store
    for (const ch of chars || []) {
      const rec = recOf(out, ch)
      out = put(out, ch, { ...rec, firstMet: meet(rec, nowMs), minutes: rec.minutes + 1 })
    }
    return out
  }

  function bump(store, ch, kind, nowMs) {
    if (!KINDS.includes(kind)) return store
    const rec = recOf(store, ch)
    return put(store, ch, { ...rec, firstMet: meet(rec, nowMs), [kind]: rec[kind] + 1 })
  }

  // 看有没有新达成的小成就；日期：认识 N 天按 firstMet 往后数，其余按 nowMs（这一轮结束 / 这次摸头的时刻）
  function checkMilestones(store, ch, nowMs, opts) {
    const rec = recOf(store, ch)
    const got = { ...rec.milestones }
    const reached = []
    let nightHour = rec.nightHour
    const hit = (id, date) => { if (!got[id]) { got[id] = date; reached.push(id) } }
    if (rec.firstMet) for (const [id, n] of Object.entries(DAYS_AT)) if (daysBetween(rec.firstMet, nowMs) >= n) hit(id, localDay(addDays(rec.firstMet, n)))
    for (const [id, n] of Object.entries(ROUNDS_AT)) if (rec.rounds >= n) hit(id, localDay(nowMs))
    if ((rec.days[localDay(nowMs)] || 0) >= 50) hit('busy50', localDay(nowMs))
    if (rec.lastEnd && !got.night) {
      const h = new Date(rec.lastEnd).getHours()
      if (h < 5) { nightHour = h; hit('night', localDay(rec.lastEnd)) }
    }
    if (rec.pats >= 100) hit('pats100', localDay(nowMs))
    if (opts && opts.friendLevel >= 1) hit('friend', localDay(nowMs))
    if (!reached.length) return { store, reached }
    return { store: put(store, ch, { ...rec, milestones: got, nightHour }), reached }
  }

  const milestoneLabel = (id, rec) => MILESTONES[id].label.replace('{h}', rec.nightHour == null ? '' : rec.nightHour)

  // 和她分最高的那一对（还没有一对有分：null）
  function bestFriend(friendship, ch, names) {
    if (!Friendship) return null
    let best = null
    for (const [key, r] of Object.entries(friendship || {})) {
      if (!r || !Number.isFinite(r.points) || r.points <= 0) continue
      const [a, b] = key.split('+')
      const other = a === ch ? b : b === ch ? a : null
      if (!other || (best && best.points >= r.points)) continue
      best = { other, points: r.points }
    }
    if (!best) return null
    return { id: best.other, name: (names && names[best.other]) || best.other, level: LEVEL_NAMES[Friendship.level(best.points)],
      hearts: Friendship.hearts(best.points) + Friendship.partial(best.points) }
  }

  function view(store, ch, { names, friendship, nowMs }) {
    const rec = recOf(store, ch)
    const all = Object.values(store.chars || {})
    const firstAll = all.map(r => r.firstMet).filter(Boolean)
    const since = store.installedAt || (firstAll.length ? Math.min(...firstAll) : 0)
    const milestones = Object.entries(rec.milestones)
      .filter(([id]) => MILESTONES[id])
      .map(([id, date]) => ({ id, label: milestoneLabel(id, rec), date }))
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    return {
      id: ch, name: (names && names[ch]) || ch, firstMet: rec.firstMet,
      daysKnown: rec.firstMet ? daysBetween(rec.firstMet, nowMs) + 1 : 0,
      rounds: rec.rounds, workMs: rec.workMs, minutes: rec.minutes, pats: rec.pats, pokes: rec.pokes, angry: rec.angry,
      busiest: rec.busiest, longestMs: rec.longestMs, friend: bestFriend(friendship, ch, names), milestones,
      before: rec.before, backfilled: !!store.backfilled,
      total: { days: since ? daysBetween(since, nowMs) + 1 : 0, rounds: all.reduce((n, r) => n + (r.rounds || 0), 0) },
    }
  }

  // 外壳存的备份（notebook.json）并回网页的存储：每个角色留「多的那份」，绝不把数往回拉；坏记录丢掉
  const NUMS = ['firstMet', 'minutes', 'rounds', 'workMs', 'longestMs', 'pats', 'pokes', 'angry', 'before', 'lastTs']
  const validRec = r => r && typeof r === 'object' && !Array.isArray(r) && NUMS.every(k => r[k] === undefined || Number.isFinite(r[k]))
  const size = r => (r.rounds || 0) + (r.minutes || 0) + (r.pats || 0) + (r.pokes || 0) + (r.angry || 0) + (r.before || 0)
  const isStore = s => s && typeof s === 'object' && !Array.isArray(s)
  function merge(local, saved) {
    if (!isStore(saved)) return local
    if (!isStore(local)) local = empty(Number.isFinite(saved.liveSince) ? saved.liveSince : Date.now())
    const chars = {}
    for (const [ch, r] of Object.entries(local.chars || {})) if (validRec(r)) chars[ch] = r
    for (const [ch, r] of Object.entries(saved.chars || {})) if (validRec(r) && (!chars[ch] || size(r) > size(chars[ch]))) chars[ch] = r
    const pos = [local.installedAt, saved.installedAt].filter(x => Number.isFinite(x) && x > 0)
    const live = [local.liveSince, saved.liveSince].filter(Number.isFinite)
    return { ...local, installedAt: pos.length ? Math.min(...pos) : 0, liveSince: live.length ? Math.min(...live) : local.liveSince,
      backfilled: !!(local.backfilled || saved.backfilled), chars }
  }

  // 最近她们聊了什么（第二页最下面）：新的在前，全局留 CHAT_KEEP 段，只存角色和台词
  const CHAT_KEEP = 30
  function logChat(store, lines, nowMs) {
    const entry = { t: nowMs, lines: lines.map(([who, text]) => [who, text]) }
    return { ...store, chats: [entry, ...(store.chats || [])].slice(0, CHAT_KEEP) }
  }

  const api = { logChat, CHAT_KEEP, empty, recordRound, addMinute, bump, checkMilestones, view, merge, MILESTONES, LEVEL_NAMES, localDay }
  root.Notebook = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
