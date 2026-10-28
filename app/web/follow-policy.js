// 自动换角色的优先级由两端共用；外壳只提供当前前台程序对应的角色。
;(function (root) {
  function eventTarget({ eventId, foregroundId, followApps, followEvents, characters }) {
    if (!followEvents || !characters.includes(eventId)) return null
    // 同时开启时让前台 AI 优先，避免后台每条事件把前台刚选好的角色抢走。
    // 没有对应角色的宿主、终端和普通程序仍由工作事件选择角色。
    if (followApps && characters.includes(foregroundId)) return null
    return eventId
  }
  root.FollowPolicy = { eventTarget }
  if (typeof module !== 'undefined') module.exports = { eventTarget }
})(typeof window !== 'undefined' ? window : globalThis)
