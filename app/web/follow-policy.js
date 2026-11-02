// 自动换角色的优先级由两端共用；外壳只提供当前前台程序对应的角色和当前角色最近的姿态。
;(function (root) {
  // 当前角色最近这么多秒内还在干活，别的 AI 的事件就不抢她：两个 AI 同时干活时不再来回切
  const BUSY_HOLD = 20
  // 这些姿态说明她这轮没在干活（空闲、睡着、做完了、道别），别人可以接手
  const RESTING = ['idle', 'sleeping', 'happy', 'proud', 'bye']

  function currentBusy({ currentPose, currentAge }) {
    return !!currentPose && !RESTING.includes(currentPose) && typeof currentAge === 'number' && currentAge < BUSY_HOLD
  }

  // 不换的原因（日志用），可以换就返回 null
  function eventSkip(input) {
    const { eventId, foregroundId, followApps, followEvents, characters } = input
    if (!followEvents || !characters.includes(eventId)) return 'off'
    // 同时开启时让前台 AI 优先，避免后台每条事件把前台刚选好的角色抢走。
    // 没有对应角色的宿主、终端和普通程序仍由工作事件选择角色。
    if (followApps && characters.includes(foregroundId)) return 'front-ai'
    if (currentBusy(input)) return 'current-busy'
    return null
  }

  function eventTarget(input) {
    return eventSkip(input) ? null : input.eventId
  }

  root.FollowPolicy = { eventTarget, eventSkip, currentBusy, BUSY_HOLD }
  if (typeof module !== 'undefined') module.exports = { eventTarget, eventSkip, currentBusy, BUSY_HOLD }
})(typeof window !== 'undefined' ? window : globalThis)
