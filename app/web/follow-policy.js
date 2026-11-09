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
    const { eventId, foregroundId, followApps, followEvents, characters, multiPets } = input
    // 多桌宠打开时，「跟随事件」不再给主桌宠换角色：别的客户端干活就冒出它自己那只（多桌宠的本意，不然又变回「谁动就换成谁」）
    if (multiPets) return 'multi-pets'
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

  // 「跟随前台」要换成哪个角色（多桌宠打开时外壳换角色前先问这里）；null = 不换。
  // - mainPet：设置里固定了主桌宠，跟随前台也不换
  // - mainClaimed：主桌宠的角色已经有会话（占着一个客户端）：谁先来谁当主桌宠，切到别的 AI 不换，
  //   那个 AI 干活时冒它自己那只（11-03 loki 定：以前开着 Claude 再切到 Codex，主桌宠变成 GPT、Claude 反倒成了额外那只）。
  //   主桌宠的角色最近没有会话（比如昨天留下的角色，今天还没用过；见 Companions.CLAIM_FRESH）才跟着前台换
  // - 要换成的角色已经有一只额外的站着：也换（11-09 改；10-19 起是不换）。主桌宠没占着客户端时不换的话，
  //   你一直用的那个 AI 只能当额外那只，主桌宠一直是不用的旧角色。换了之后页面让主桌宠占走那个客户端，那只说 bye 走
  //   （集合来的那只就地对调，见 Companions.swapMain）。外壳还传着 standing，这里不再用
  function foregroundTarget({ foregroundId, current, mainPet, mainClaimed }) {
    if (mainPet || mainClaimed) return null
    if (!foregroundId || foregroundId === current) return null
    return foregroundId
  }
  root.FollowPolicy = { eventTarget, eventSkip, currentBusy, BUSY_HOLD, foregroundTarget }
  if (typeof module !== 'undefined') module.exports = { eventTarget, eventSkip, currentBusy, BUSY_HOLD, foregroundTarget }
})(typeof window !== 'undefined' ? window : globalThis)
