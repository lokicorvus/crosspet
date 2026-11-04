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
  const CLI_CLIENTS = new Set(['claude-cli', 'codex', 'deepseek', 'gemini', 'qwen', 'grok', 'hermes'])
  // 没有 client 的旧条目（key 是 角色@角色）：这些角色默认接入的是命令行客户端
  // （claude → Claude Code 命令行、gpt → codex，其余同名命令行）
  const LEGACY_CLI_CHARACTERS = new Set(['claude', 'gpt', 'deepseek', 'gemini', 'qwen', 'grok'])

  // 一轮结束（Stop / SessionEnd）不管什么姿态都不算干活：被打断、出错收尾时钩子会写 oops / surprised + Stop。
  // 一轮中途的 oops（比如 PostToolUseFailure）还算干活。
  // 「等你回答」不受 3 分钟卡住兜底（同 index.html），但最多算 CLI_RECENT：终端关掉不发 SessionEnd 时不至于一直站着。
  function isWorking(s, ageMs) {
    if (!s.pose || WORKING_EXCLUDED.has(s.pose)) return false
    if (s.event === 'Stop' || s.event === 'SessionEnd') return false
    return ageMs < (s.pose === 'asking' ? CLI_RECENT : STUCK_AFTER)
  }

  // 命令行客户端；没有 client 的旧条目（客户端就是角色名，比如 claude@claude、gpt@gpt）按角色默认接入的那个算
  function isCli(c) {
    return CLI_CLIENTS.has(c.client) || (c.client === c.character && LEGACY_CLI_CHARACTERS.has(c.character))
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

  // 「AI 程序开着就在」（rest:'open'）：程序开着、还没会话时出哪个角色。
  // 上次在这个程序里的角色（rememberClients 记的）优先，没记过用程序默认的角色，客户端名本身是角色名（deepseek、gemini……）也算；
  // Cursor、WorkBuddy、ZCode 这类多模型的程序没记过就不知道是谁，返回 null（开始对话后再出）。没装的角色不算
  const CLIENT_DEFAULT_CHARACTER = { 'claude-desktop': 'claude', 'claude-cli': 'claude', codex: 'gpt', antigravity: 'gemini' }
  function clientCharacter(client, remembered, validCharacters) {
    for (const ch of [(remembered || {})[client], CLIENT_DEFAULT_CHARACTER[client], client]) if (ch && validCharacters.has(ch)) return ch
    return null
  }
  // 每个客户端最近有动静的那个角色（clientCharacter 用）；没变就返回原来那份（调用方按 === 判断要不要存）
  function rememberClients(remembered, clients) {
    const out = { ...(remembered || {}) }
    const best = {}
    for (const c of clients || []) if (!best[c.client] || c.lastTs > best[c.client].lastTs) best[c.client] = c
    let changed = false
    for (const [client, c] of Object.entries(best)) if (out[client] !== c.character) { out[client] = c.character; changed = true }
    return changed ? out : remembered
  }

  // 集合来、还没收编客户端的那只用的 key
  const gatherKey = character => character + '@gather'

  // 「让她先回去」：记下送回去的时间，下一次 decide 让她走，直到这个 key 有新一轮的活。
  // sentHome[key] = { t: 送回去的时间, sawIdle: 之后看到过她不干活（这一轮做完了）}
  // 集合来的那只要送走，调用方同时把她的角色从 gathered 里去掉（decide 里集合来的不看 sentHome）。
  function sendHome(state, key, nowMs) {
    const s = state || { pets: [], awaySince: null, idleSince: {}, sentHome: {}, gatherKeys: {} }
    return { ...s, sentHome: { ...(s.sentHome || {}), [key]: { t: nowMs, sawIdle: false } } }
  }

  // 谁站着、谁走。每次状态变化调一次，返回该站着的 pets（按出现先后）和这次要说 bye 走的 leaving。
  // 「离开满 LEAVE_AFTER 才走」只在调用时判断：调用方除了状态变化时调，还要定时调（比如每几秒一次），
  // 不然没有新事件时她会一直不走。
  // 规则见设计第二节：
  // - 主桌宠占着的 claimKey、reactTo 代演的角色（coveredByStandIn）不出现
  // - 额外那只：没占着的客户端干活就出现；auto 下「不干活」和「不在 AI 软件里」同时成立满 LEAVE_AFTER 才走
  //   （从两者中较晚开始的那一刻起算；停下的时刻按 decide 第一次看到她不干活记，存在 state.idleSince）；
  //   stay 下只在会话全部消失、或有窗口的程序关掉（在 running 里见过、现在不含她；记在 state.runningSeen）时走
  // - open（AI 程序开着就在）：客户端「开着」就出现、不开着就走，不看干不干活、你在不在 AI 软件里。
  //   开着 = 程序在跑（running 里有她）；不然有窗口的程序在 running 里见过就算关了；其余（命令行、外壳认不出的程序）
  //   看会话：在干活或 CLI_RECENT 内有过动静（和钩子的 SESSION_KEEP 一样 10 分钟）。
  //   在跑、还没会话的客户端按 characterOf（客户端 → 角色，页面按 clientCharacter 算好）补一条；主桌宠还没占着客户端时，
  //   她自己角色的那条归她，不另出一只
  // - 会话全部消失（上次站着、这次 clients 里没有她的 key；SessionEnd 会从会话表里删掉会话）立刻走
  // - 集合来的每个角色一只，不按上面的规则走，解散（不在 gathered 里）才走；
  //   她的角色有客户端开始干活、而且那个客户端没有自己的那只时，收编它（key / client 换成那个客户端）。
  //   集合来的每个角色只有一只，外壳按角色认她的窗口（收编时 key 变了，窗口和位置不变）
  // - 解散时收编着的客户端还在干活：她不走，转成干活冒出来的那只（via 'work'）留着，不说 bye 再冒一次
  // - workPets 为 false（开关关着、只是集合）：不冒干活的那几只，已站着的干活那只走；集合来的照样收编、解散就走
  // - quota：同一角色只有一只为 true；主桌宠是这个角色时都为 false
  function decide({ nowMs, clients, claimKey, mainCharacter, inAI, rest, gathered, running, coveredByStandIn, prev, workPets = true, characterOf }) {
    const p = prev || {}
    const covered = coveredByStandIn || new Set()
    const open = rest === 'open'
    const list = [...(clients || [])]
    if (open && running != null) {
      const has = new Set(list.map(c => c.client))
      const runningClients = new Set([...running].map(k => k.slice(k.indexOf('@') + 1)))
      for (const client of runningClients) {
        const character = !has.has(client) && (characterOf || {})[client]
        if (character) list.push({ key: character + '@' + client, character, client, working: false, lastTs: 0 })
      }
    }
    const byKey = new Map(list.map(c => [c.key, c]))
    // 主桌宠正演着的角色不重复叫
    const gatherSet = new Set((gathered || []).filter(ch => ch !== mainCharacter))
    const awaySince = inAI ? null : (p.awaySince != null ? p.awaySince : nowMs)
    const leaving = []

    // 送回去的：会话都没了就不用再记（再出现必然是新一轮）。
    // 送回去时这一轮可能还没做完，后面的事件不算新一轮：要先看到她不干活（这一轮做完），再干活才放出来
    const sentHome = {}
    for (const [key, v] of Object.entries(p.sentHome || {})) {
      const h = typeof v === 'number' ? { t: v, sawIdle: false } : v
      const c = byKey.get(key)
      if (!c) continue
      if (!c.working) { sentHome[key] = { t: h.t, sawIdle: true }; continue }
      if (h.sawIdle && c.lastTs * 1000 > h.t) continue
      sentHome[key] = { t: h.t, sawIdle: h.sawIdle }
    }
    // 外壳只报它认得的程序：在 running 里见过的 key 才知道她的程序开没开着。见过一次就一直记着（走了也不删：
    // 删了下一轮就成了「没见过」，她还在干活又会冒出来）；程序再打开时 key 回到 running，自然不算关掉
    const runningSeen = new Set(p.runningSeen || [])
    if (running != null) for (const key of running) runningSeen.add(key)
    // stay 下有窗口的程序关掉了（见过、现在 running 里没有）：也算挡住，不然第 1 步刚让她走、第 4 步看她还在干活又冒出来。
    // 从没见过的（外壳认不出的程序）和命令行一样只看 SessionEnd
    const programClosed = c => rest === 'stay' && running != null && !isCli(c) && runningSeen.has(c.key) && !running.has(c.key)
    const isOpen = c => {
      if (running != null && running.has(c.key)) return true
      if (running != null && !isCli(c) && runningSeen.has(c.key)) return false
      return c.working || nowMs - c.lastTs * 1000 < CLI_RECENT
    }
    const blocked = c => c.key === claimKey || covered.has(c.character) || sentHome[c.key] != null || programClosed(c)
      || (open && (!isOpen(c) || (!claimKey && c.character === mainCharacter)))

    // 1. 上次站着的：先定谁留谁走
    // 额外那只停下的时刻：这一次调用才发现她不干活就记成 nowMs（3 分钟兜底判停也一样，不按旧的 lastTs 倒推）
    const idleSince = {}
    const kept = []
    for (const pet of p.pets || []) {
      if (pet.via === 'gather') {
        if (!gatherSet.has(pet.character) || covered.has(pet.character)) {
          const c = pet.client && byKey.get(pet.key)
          if (workPets && c && c.working && !blocked(c)) kept.push({ ...pet, via: 'work' })
          else leaving.push(pet.key)
          continue
        }
        // 收编的客户端被主桌宠占了、或会话全部结束：退回没收编的样子，她还留着，之后能再收编这个角色别的客户端
        if (pet.client && (pet.key === claimKey || !byKey.has(pet.key))) kept.push({ ...pet, key: gatherKey(pet.character), client: null })
        else kept.push({ ...pet })
        continue
      }
      const c = byKey.get(pet.key)
      let go = !workPets || !c || blocked(c)
      // stay、open 下不按「不干活、不在 AI 软件里」走（程序关掉、不开着已经算进 blocked）
      if (!go && rest !== 'stay' && !open && !c.working) {
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

    // 4. 新干活的客户端各冒一只（open 下开着的都冒，blocked 里已经去掉不开着的）
    for (const c of workPets ? list : []) {
      if ((!open && !c.working) || blocked(c) || taken.has(c.key)) continue
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

    return { pets: kept, leaving, state: { pets: kept.map(x => ({ ...x })), awaySince, idleSince, sentHome, gatherKeys, runningSeen: [...runningSeen] } }
  }

  const api = {
    STUCK_AFTER, LEAVE_AFTER, CLI_RECENT, CLAIM_STICK,
    WORKING_EXCLUDED, CLI_CLIENTS,
    isCli, clientsOf, mainClaim, inAISoftware, decide, sendHome, clientCharacter, rememberClients,
  }
  root.Companions = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
