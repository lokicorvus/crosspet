// 多桌宠：按客户端分桌宠、主桌宠占着哪个客户端、你是不是还在 AI 软件里。
// 纯函数，外壳和页面都不在这里读文件；之后「谁站着、谁离开」（decide）也加在这个文件里。
;(function (root) {
  // 干活判定沿用主页面的 3 分钟卡住兜底（index.html 的 STUCK_AFTER）
  const STUCK_AFTER = 180_000
  // 额外那只：不干活、也不在 AI 软件里，持续这么久才离开（防闪）
  const LEAVE_AFTER = 60_000
  // 终端在前台时，命令行客户端这么久内有过事件才算「在 AI 软件里」
  const CLI_RECENT = 600_000
  // 主桌宠占着的客户端停下后，还粘住这么久不换
  const CLAIM_STICK = 60_000

  // 这些姿态不算干活；「等你回答」（asking）算
  const WORKING_EXCLUDED = new Set(['idle', 'sleeping', 'happy', 'proud', 'tired'])
  // 跑在终端里的客户端
  const CLI_CLIENTS = new Set(['claude-cli', 'codex', 'deepseek', 'gemini', 'qwen', 'grok'])

  // 一轮结束（Stop / SessionEnd）不管什么姿态都不算干活：被打断、出错收尾时钩子会写 oops / surprised + Stop。
  // 一轮中途的 oops（比如 PostToolUseFailure）还算干活。
  // 「等你回答」不受 3 分钟卡住兜底（同 index.html），但最多算 CLI_RECENT：终端关掉不发 SessionEnd 时不至于一直站着。
  function isWorking(s, ageMs) {
    if (!s.pose || WORKING_EXCLUDED.has(s.pose)) return false
    if (s.event === 'Stop' || s.event === 'SessionEnd') return false
    return ageMs < (s.pose === 'asking' ? CLI_RECENT : STUCK_AFTER)
  }

  // 命令行客户端；没有 client 的旧 Claude 条目（claude@claude）按设计算 claude-cli
  function isCli(c) {
    return CLI_CLIENTS.has(c.client) || (c.character === 'claude' && c.client === 'claude')
  }

  // sessionsByChar: { 角色: { 会话 id: { pose, event, ts(秒), client? } } }
  // 同一个「角色@客户端」的会话并成一只：任一会话在干活就算干活，lastTs 取最新。
  // 旧条目没有 client 时客户端就用角色名（claude@claude）。
  function clientsOf(sessionsByChar, nowMs) {
    const byKey = new Map()
    for (const [character, sessions] of Object.entries(sessionsByChar || {})) {
      for (const s of Object.values(sessions || {})) {
        if (!s || typeof s !== 'object') continue
        const client = s.client || character
        const key = character + '@' + client
        const ts = Number(s.ts) || 0
        const working = isWorking(s, nowMs - ts * 1000)
        const c = byKey.get(key)
        if (!c) byKey.set(key, { key, character, client, working, lastTs: ts })
        else {
          c.working = c.working || working
          if (ts > c.lastTs) c.lastTs = ts
        }
      }
    }
    return [...byKey.values()]
  }

  function latest(list) {
    let best = null
    for (const c of list) if (!best || c.lastTs > best.lastTs) best = c
    return best
  }

  // 主桌宠占着她当前角色的哪个客户端。
  // 占着的客户端还在干活、或停下不到 CLAIM_STICK，就粘住不换（免得同一角色两个客户端都在干活时来回对调）；
  // 换了角色、或占着的客户端已经没有会话了，立刻重新选。
  // 重新选：前台对得上的客户端（Claude 桌面 → claude-desktop；终端 → 最近有事件的命令行客户端），
  // 对不上就取最近有事件的那个。
  // last / 返回值：{ key, since }，since 是开始占着这个客户端的时间（毫秒）
  function mainClaim({ mainCharacter, foreground, clients, last, nowMs }) {
    const mine = (clients || []).filter(c => c.character === mainCharacter)
    const held = last && last.key && mine.find(c => c.key === last.key)
    if (held && (held.working || nowMs - held.lastTs * 1000 < CLAIM_STICK)) return last

    const fg = foreground || {}
    let pick = null
    if (fg.kind === 'ai' && fg.client) pick = mine.find(c => c.client === fg.client) || null
    else if (fg.kind === 'terminal') pick = latest(mine.filter(isCli))
    if (!pick) pick = latest(mine)

    const key = pick ? pick.key : null
    if (last && last.key === key) return last
    return { key, since: nowMs }
  }

  // 你是不是还在 AI 软件里：AI 程序或我们自己的窗口在前台；
  // 终端在前台时，只有命令行客户端最近 CLI_RECENT 内有过事件才算。
  function inAISoftware({ foreground, clients, nowMs }) {
    const kind = foreground && foreground.kind
    if (kind === 'ai' || kind === 'ours') return true
    if (kind !== 'terminal') return false
    return (clients || []).some(c => isCli(c) && nowMs - c.lastTs * 1000 < CLI_RECENT)
  }

  const api = {
    STUCK_AFTER, LEAVE_AFTER, CLI_RECENT, CLAIM_STICK,
    WORKING_EXCLUDED, CLI_CLIENTS,
    clientsOf, mainClaim, inAISoftware,
  }
  root.Companions = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
