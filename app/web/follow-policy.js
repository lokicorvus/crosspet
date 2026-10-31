// 自动换角色的优先级由两端共用；外壳只提供当前前台程序对应的角色。
;(function (root) {
  function eventTarget({ eventId, foregroundId, followApps, followEvents, characters, multiPets }) {
    // 多桌宠打开时，「跟随事件」不再给主桌宠换角色：别的客户端干活就冒出它自己那只（多桌宠的本意，不然又变回「谁动就换成谁」）
    if (multiPets) return null
    if (!followEvents || !characters.includes(eventId)) return null
    // 同时开启时让前台 AI 优先，避免后台每条事件把前台刚选好的角色抢走。
    // 没有对应角色的宿主、终端和普通程序仍由工作事件选择角色。
    if (followApps && characters.includes(foregroundId)) return null
    return eventId
  }
  // 「跟随前台」要换成哪个角色（多桌宠打开时外壳换角色前先问这里）；null = 不换。
  // - mainPet：设置里固定了主桌宠，跟随前台也不换
  // - standing：桌面上额外那几只的角色。要换成的角色已经有一只站着：不换（10-19 的规则，不然两只对调、各「噗」一下）
  function foregroundTarget({ foregroundId, current, mainPet, standing }) {
    if (mainPet) return null
    if (!foregroundId || foregroundId === current) return null
    if ((standing || []).includes(foregroundId)) return null
    return foregroundId
  }
  root.FollowPolicy = { eventTarget, foregroundTarget }
  if (typeof module !== 'undefined') module.exports = { eventTarget, foregroundTarget }
})(typeof window !== 'undefined' ? window : globalThis)
