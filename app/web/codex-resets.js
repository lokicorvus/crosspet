// Codex 重置提醒（设置里默认关）：数据来自第三方网站 codex-resets.com（根据 @thsottiaux 的推文整理，预测不是 OpenAI 的承诺）。
// 这里只做判断：接口的数据整理成三块（官方宣布 / 预测 / 统计）、额度下方显示什么、问她时回答哪一档、要不要主动说。
// 联网、显示、说话在 index.html；纯函数，网页和测试（tests/codex_resets.test.js）共用。设计见 docs/superpowers/specs/2026-10-14-codex-resets-design.md
;(function (root) {
  const sec = s => { const t = typeof s === 'string' ? Date.parse(s) : NaN; return isNaN(t) ? null : t / 1000 }

  function parse(j) {
    const d = j && typeof j === 'object' ? j.data : null
    if (!d || typeof d !== 'object') return null
    const s = d.scheduled_reset, w = d.active_watch, l = d.latest_reset, st = d.stats
    const announced = s && typeof s.id === 'string' && sec(s.announced_at) !== null
      ? { id: s.id, at: sec(s.announced_at), for: sec(s.scheduled_for), url: s.source?.url || '' } : null
    const watch = w && (w.level === 'elevated' || w.level === 'strong') && typeof w.observed_at === 'string'
      ? { id: w.observed_at, level: w.level, chance: Number.isInteger(w.reset_chance_percent) ? w.reset_chance_percent : null,
          window: typeof w.forecast_window === 'string' ? w.forecast_window : '', expires: sec(w.expires_at) || 0 } : null
    // reset_type：regular = 官方直接把大家的额度重置了；banked = 发重置卡（存进账户，自己想用时再用，额度不会自己满）。
    // 认不出的当 regular（以前没有这个字段时都是直接重置）
    const latest = l && typeof l.id === 'string' ? { id: l.id, at: sec(l.announced_at) || 0, card: l.reset_type === 'banked' } : null
    const stats = st && typeof st.days_since_last === 'number' && typeof st.avg_interval_days === 'number'
      ? { since: st.days_since_last, avg: st.avg_interval_days } : null
    return { announced, watch, latest, stats }
  }

  // 还有效的宣布：站点没记为已执行，我们也没在宣布之后看到 Codex 额度重置（resetSeenAt：index.html 的 quotaEvent 判出 reset 的时间，秒）
  function liveAnnounced(d, resetSeenAt) {
    const a = d?.announced
    if (!a || d.latest?.id === a.id || (resetSeenAt && resetSeenAt > a.at)) return null
    return a
  }
  // 宣布过、而且已经执行了（站点记为已执行，或我们在宣布之后看到了 Codex 额度重置）
  const doneAnnounced = (d, resetSeenAt) => !!(d?.announced && !liveAnnounced(d, resetSeenAt))
  const liveWatch = (d, now) => (d?.watch && (!d.watch.expires || d.watch.expires > now) ? d.watch : null)
  // 刚重置过：站点记的最近一次重置在 5 小时内（一个 5 小时额度窗口）。官方常常不提前宣布、直接发「已经重置」（10-20 那次），
  // 这段时间问她要说「刚重置过」，不能说「没风声」
  const RECENT_SEC = 5 * 3600
  const within = (d, now, span) => (now && d?.latest?.at && now - d.latest.at >= -60 && now - d.latest.at < span ? d.latest : null)
  const recentReset = (d, now) => { const l = within(d, now, RECENT_SEC); return l && !l.card ? l : null }
  // 刚发了重置卡：一天内问她要说「发的是卡、要自己去用」，不能说「刚重置过、额度满满」（11-01 两次都是卡）
  const CARD_SEC = 24 * 3600
  const recentCard = (d, now) => { const l = within(d, now, CARD_SEC); return l && l.card ? l : null }
  function agoText(sec) {
    const m = Math.max(1, Math.floor(sec / 60))
    return m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`
  }

  const pad = n => String(n).padStart(2, '0')
  function fmt(s) { const t = new Date(s * 1000); return `${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` }

  function notice(d, resetSeenAt, now) {
    const a = liveAnnounced(d, resetSeenAt)
    if (a) return a.for ? `🔔 官方已宣布重置 · 预计 ${fmt(a.for)}` : '🔔 官方已宣布重置，还没生效'
    const r = recentReset(d, now)
    if (r) return `✨ ${agoText(now - r.at)}刚重置过`
    const c = recentCard(d, now)
    return c ? `🎟️ ${agoText(now - c.at)}发了重置卡，要自己去用` : ''
  }

  // forecast_window 翻成中文：next 48h → 接下来 48 小时内；within / in 24h → 24 小时内（站点 10 月起用 within）。
  // 认不出返回 ''：带 {window} 的台词就不挑了，不把英文硬塞进句子
  function windowText(s) {
    const m = /^(next|within|in)\s+(\d+)\s*(h|hrs?|hours?|d|days?)$/i.exec(String(s || '').trim())
    if (!m) return ''
    const unit = /^h/i.test(m[3]) ? '小时' : '天'
    return /^next$/i.test(m[1]) ? `接下来 ${m[2]} ${unit}内` : `${m[2]} ${unit}内`
  }

  // 专属立绘（docs/prompts/重置提醒/）；没画的在 index.html 的 POSE_FALLBACK 里退回 reset / happy / hum / sulk
  const POSE = { recent: 'reset', card: 'reset_hope', announced: 'reset_bell', high: 'reset_hope', mid: 'reset_maybe', low: 'reset_nope', none: 'reset_nope', offline: 'reset_nope' }
  function tierOf(d, now, resetSeenAt) {
    if (liveAnnounced(d, resetSeenAt)) return 'announced'
    const w = liveWatch(d, now)
    if (!w) return 'none'
    if (w.chance === null) return w.level === 'strong' ? 'mid' : 'low'
    return w.chance >= 70 ? 'high' : w.chance >= 30 ? 'mid' : 'low'
  }

  function answer(d, now, resetSeenAt) {
    if (!d) return { tier: 'offline', pose: POSE.offline, key: 'resetOffline', vars: {} }
    if (doneAnnounced(d, resetSeenAt)) return { tier: 'done', pose: 'reset', key: 'resetDone', vars: {} }   // 不能说「没风声」
    const r = !liveAnnounced(d, resetSeenAt) && recentReset(d, now)
    if (r) return { tier: 'recent', pose: POSE.recent, key: 'resetRecent', vars: { ago: agoText(now - r.at) } }
    const c = !liveAnnounced(d, resetSeenAt) && recentCard(d, now)
    if (c) return { tier: 'card', pose: POSE.card, key: 'resetCard', vars: { ago: agoText(now - c.at) } }
    const tier = tierOf(d, now, resetSeenAt)
    if (tier === 'announced') { const a = liveAnnounced(d, resetSeenAt); return { tier, pose: POSE[tier], key: 'resetAnnounced', vars: { when: a.for ? fmt(a.for) : '很快' } } }
    // 站点的统计把发卡也算进「上次」：最近一次是卡就照实说是卡
    if (tier === 'none') return d.stats
      ? { tier, pose: POSE.none, key: d.latest?.card ? 'resetNoneCard' : 'resetNone', vars: { since: d.stats.since.toFixed(1), avg: d.stats.avg.toFixed(1) } }
      : { tier, pose: POSE.none, key: 'resetQuiet', vars: {} }
    const w = liveWatch(d, now)
    const key = { high: 'resetHigh', mid: 'resetMid', low: 'resetLow' }[tier]
    const vars = {}
    if (w.chance !== null) vars.chance = w.chance
    const window = windowText(w.window)
    if (window) vars.window = window
    return { tier, pose: POSE[tier], key, vars }
  }

  // 主动说：新宣布，或新的强预测（strong 或 ≥70%）；told 是已经说过的 id（宣布 'a:<id>'，预测 'w:<observed_at>'）
  function toAnnounce(d, now, resetSeenAt, told) {
    const a = liveAnnounced(d, resetSeenAt)
    if (a) return told.includes('a:' + a.id) ? null : { id: 'a:' + a.id }
    const r = recentReset(d, now)
    if (r && !(resetSeenAt && resetSeenAt >= r.at)) return told.includes('r:' + r.id) ? null : { id: 'r:' + r.id }   // 我们自己已经看到重置、庆祝过了就不说
    const c = recentCard(d, now)
    if (c) return told.includes('c:' + c.id) ? null : { id: 'c:' + c.id }
    const w = liveWatch(d, now)
    if (!w || !(w.level === 'strong' || (w.chance ?? 0) >= 70)) return null
    return told.includes('w:' + w.id) ? null : { id: 'w:' + w.id }
  }

  // 能用的台词：句子里的 {占位} 在 vars 里都有。角色自己的（own）一句都用不了就退回默认句，再不行就不说话
  function usableLines(own, key, vars) {
    const ok = list => (list || []).filter(l => [...String(l).matchAll(/\{(\w+)\}/g)].every(m => m[1] in vars))
    const mine = ok(own)
    if (mine.length) return mine
    const dflt = ok(LINES[key])
    return dflt.length ? dflt : ['']
  }

  const fill = (line, vars) => String(line).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

  // 默认台词（角色 character.json 的 lines 里写了同名键就用角色自己的）
  const LINES = {
    resetAnnounced: ['官方说了，要重置！预计 {when}。'],
    resetDone: ['官方说的重置已经到了，额度满啦！'],
    resetRecent: ['刚重置过啦！{ago}，额度满满～', '{ago}刚重置过，放心用！'],
    resetCard: ['{ago}发的是重置卡，额度不会自己满，想用时去 Codex 里用一张。', '这次是发重置卡，不是直接重置哦。'],
    resetHigh: ['这次很有戏：{chance}%，{window}。', '这次很有戏：{chance}%！'],
    resetMid: ['有点风声，{chance}% 吧，别太指望。', '有点风声……别太指望。'],
    resetLow: ['有动静，但不太像。'],
    resetNone: ['最近没风声。上次重置是 {since} 天前，平均 {avg} 天一次。'],
    resetNoneCard: ['最近没风声。上次是 {since} 天前发的重置卡，平均 {avg} 天有一次动静。'],
    resetQuiet: ['最近没风声。'],
    resetOffline: ['我这会儿连不上那个网站……'],
  }

  const api = { parse, notice, answer, toAnnounce, windowText, usableLines, fill, fmt, LINES }
  root.CodexResets = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
