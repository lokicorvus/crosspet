// 久坐提醒、喝水提醒（设置里默认关）：只按时间算，不看键鼠、不看 AI 会话。
// 这里只算「这一分钟说不说、说哪个」，演什么、说什么在 index.html；纯函数，网页和测试（tests/break_reminders.test.js）共用。
// 设计见 docs/superpowers/specs/2026-11-17-break-reminders-design.md
;(function (root) {
  const MIN = 60000
  const CHOICES = [30, 45, 60, 90, 120]          // 设置里能选的间隔（分钟）
  const DEFAULTS = { sit: 45, water: 60 }
  const KINDS = ['sit', 'water']                 // 同时到点时排前面的先说
  const WAIT_MAX = 10 * MIN                      // 她忙着就等，最多等这么久，还不空就跳过这一次
  const HIDE_RESET = 5 * MIN                     // 藏起来 / 屏幕睡着这么久，算起来过了：久坐重新计时
  const WATER_DELAY = 5 * MIN                    // 和久坐同时到点时，喝水往后推这么久

  const fresh = nowMs => ({ sit: { from: nowMs, waitFrom: null }, water: { from: nowMs, waitFrom: null } })
  const restart = (state, kind, nowMs) => ({ ...state, [kind]: { from: nowMs, waitFrom: null } })
  const back = (state, hiddenMs, nowMs) => (hiddenMs >= HIDE_RESET ? restart(state, 'sit', nowMs) : state)
  // 夜里 23:00–7:00（本机时间）不提醒
  const isNight = nowMs => { const h = new Date(nowMs).getHours(); return h >= 23 || h < 7 }

  // cfg：{ sit: 分钟, water: 分钟 }，0 = 关。busy：她这会儿在忙（干活、彩蛋、更新……），由页面判断
  function tick(state, cfg, nowMs, busy) {
    const next = { ...state }, due = []
    for (const k of KINDS) {
      const every = cfg[k] * MIN
      if (!every) continue
      // 夜里一直重新计时：不攒到早上一起说
      if (isNight(nowMs)) { next[k] = { from: nowMs, waitFrom: null }; continue }
      if (nowMs - state[k].from < every) continue
      if (busy) {
        const waitFrom = state[k].waitFrom ?? nowMs
        next[k] = nowMs - waitFrom >= WAIT_MAX ? { from: nowMs, waitFrom: null } : { ...state[k], waitFrom }
        continue
      }
      due.push(k)
    }
    if (!due.length) return { state: next, say: null }
    const say = due[0]
    next[say] = { from: nowMs, waitFrom: null }
    // 剩下的（喝水）往后推几分钟再说，不连着两句
    for (const k of due.slice(1)) next[k] = { from: nowMs - cfg[k] * MIN + WATER_DELAY, waitFrom: null }
    return { state: next, say }
  }

  const api = { CHOICES, DEFAULTS, fresh, restart, back, isNight, tick }
  root.BreakReminders = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
