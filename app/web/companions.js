// 多桌宠：按客户端分桌宠、主桌宠占着哪个客户端、你是不是还在 AI 软件里。
// 纯函数，外壳和页面都不在这里读文件；「谁站着、谁离开」（decide）也在这里。
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

  // 集合来、还没收编客户端的那只用的 key
  const gatherKey = character => character + '@gather'

  // 「让她先回去」：记下送回去的时间，下一次 decide 让她走，直到这个 key 有新一轮的活。
  // 集合来的那只要送走，调用方同时把她的角色从 gathered 里去掉（decide 里集合来的不看 sentHome）。
  function sendHome(state, key, nowMs) {
    const s = state || { pets: [], awaySince: null, sentHome: {}, gatherKeys: {} }
    return { ...s, sentHome: { ...(s.sentHome || {}), [key]: nowMs } }
  }

  // 谁站着、谁走。每次状态变化调一次，返回该站着的 pets（按出现先后）和这次要说 bye 走的 leaving。
  // 规则见设计第二节：
  // - 主桌宠占着的 claimKey、reactTo 代演的角色（coveredByStandIn）不出现
  // - 额外那只：没占着的客户端干活就出现；auto 下「不干活」和「不在 AI 软件里」同时成立满 LEAVE_AFTER 才走
  //   （从两者中较晚开始的那一刻起算；停下的时刻按 decide 第一次看到她不干活记，存在 state.idleSince）；
  //   stay 下只在会话全部消失、或有窗口的程序关掉（running 非 null 且不含她）时走
  // - 会话全部消失（上次站着、这次 clients 里没有她的 key；SessionEnd 会从会话表里删掉会话）立刻走
  // - 集合来的每个角色一只，不按上面的规则走，解散（不在 gathered 里）才走；
  //   她的角色有客户端开始干活、而且那个客户端没有自己的那只时，收编它（key / client 换成那个客户端）。
  //   集合来的每个角色只有一只，外壳按角色认她的窗口（收编时 key 变了，窗口和位置不变）
  // - quota：同一角色只有一只为 true；主桌宠是这个角色时都为 false
  function decide({ nowMs, clients, claimKey, mainCharacter, inAI, rest, gathered, running, coveredByStandIn, prev }) {
    const p = prev || {}
    const covered = coveredByStandIn || new Set()
    const list = clients || []
    const byKey = new Map(list.map(c => [c.key, c]))
    const gatherSet = new Set(gathered || [])
    const awaySince = inAI ? null : (p.awaySince != null ? p.awaySince : nowMs)
    const leaving = []

    // 送回去的：会话都没了就不用再记（再出现必然是新一轮）；有新一轮的活就放出来
    const sentHome = {}
    for (const [key, t] of Object.entries(p.sentHome || {})) {
      const c = byKey.get(key)
      if (!c || (c.working && c.lastTs * 1000 > t)) continue
      sentHome[key] = t
    }
    const blocked = c => c.key === claimKey || covered.has(c.character) || sentHome[c.key] != null

    // 1. 上次站着的：先定谁留谁走
    // 额外那只停下的时刻：这一次调用才发现她不干活就记成 nowMs（3 分钟兜底判停也一样，不按旧的 lastTs 倒推）
    const idleSince = {}
    const kept = []
    for (const pet of p.pets || []) {
      if (pet.via === 'gather') {
        if (!gatherSet.has(pet.character) || covered.has(pet.character)) { leaving.push(pet.key); continue }
        // 收编的客户端被主桌宠占了：退回没收编的样子，她还留着
        if (pet.key === claimKey) kept.push({ ...pet, key: gatherKey(pet.character), client: null })
        else kept.push({ ...pet })
        continue
      }
      const c = byKey.get(pet.key)
      let go = !c || blocked(c)
      if (!go && rest === 'stay') go = running != null && !isCli(c) && !running.has(pet.key)
      else if (!go && !c.working) {
        const prevIdle = p.idleSince && p.idleSince[pet.key]
        idleSince[pet.key] = prevIdle != null ? prevIdle : nowMs
        // 两条都不满足（不干活、不在 AI 软件里）持续 LEAVE_AFTER：从较晚的那个时刻起算
        go = awaySince != null && nowMs - Math.max(awaySince, idleSince[pet.key]) >= LEAVE_AFTER
      }
      if (go) delete idleSince[pet.key]
      if (go) leaving.push(pet.key)
      else kept.push({ ...pet })
    }

    const taken = new Set(kept.filter(x => x.client).map(x => x.key))
    const adoptable = character => latest(list.filter(c =>
      c.character === character && c.working && !blocked(c) && !taken.has(c.key)))

    // 2. 集合来、还没收编的：她的角色有客户端开始干活就收编
    for (const pet of kept) {
      if (pet.via !== 'gather' || pet.client) continue
      const c = adoptable(pet.character)
      if (c) { pet.key = c.key; pet.client = c.client; taken.add(c.key) }
    }

    // 3. 新集合来的：这个角色已经有一只额外的站着就直接归她（不重复叫），不然收编在干活的客户端，都没有就空着来
    for (const character of gatherSet) {
      if (covered.has(character) || kept.some(x => x.via === 'gather' && x.character === character)) continue
      const own = kept.find(x => x.via === 'work' && x.character === character)
      if (own) { own.via = 'gather'; continue }
      const c = adoptable(character)
      if (c) taken.add(c.key)
      kept.push({ key: c ? c.key : gatherKey(character), character, client: c ? c.client : null, via: 'gather', quota: false })
    }

    // 4. 新干活的客户端各冒一只
    for (const c of list) {
      if (!c.working || blocked(c) || taken.has(c.key)) continue
      taken.add(c.key)
      kept.push({ key: c.key, character: c.character, client: c.client, via: 'work', quota: false })
    }

    // 额度：同一角色只有先出现的那只显示；主桌宠是这个角色时都不显示
    const quotaShown = new Set()
    for (const pet of kept) {
      pet.quota = pet.character !== mainCharacter && !quotaShown.has(pet.character)
      quotaShown.add(pet.character)
    }

    const gatherKeys = {}
    for (const pet of kept) if (pet.via === 'gather') gatherKeys[pet.character] = pet.client ? pet.key : null

    return { pets: kept, leaving, state: { pets: kept.map(x => ({ ...x })), awaySince, idleSince, sentHome, gatherKeys } }
  }

  const api = {
    STUCK_AFTER, LEAVE_AFTER, CLI_RECENT, CLAIM_STICK,
    WORKING_EXCLUDED, CLI_CLIENTS,
    clientsOf, mainClaim, inAISoftware, decide, sendHome,
  }
  root.Companions = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
