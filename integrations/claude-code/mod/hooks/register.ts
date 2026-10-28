import type { EngineInterface, Register } from 'claude-code'

// CrossPet × Claude Code（增强版 mod）
// 和标准钩子输出同一种状态（<状态目录>/claude-state.json），另外多两样：
// - 额度：session.measure 推来的 5 小时 / 每周窗口 → claude-quota.json
// - 被打断 / 出错：turn.complete 的 reason
// - 压缩上下文：session.compact
// - 等你回答：AskUserQuestion 提问、弹出授权框（Notification）
// 状态目录和桌宠、其他接入一致：CROSSPET_STATE_DIR > Windows 的 %LOCALAPPDATA%\CrossPet\state > macOS 的 /tmp/crosspet。

let dir: string | undefined
async function stateDir($: EngineInterface): Promise<string> {
  if (dir) return dir
  const custom = await $.env.get('CROSSPET_STATE_DIR')
  const local = await $.env.get('LOCALAPPDATA')  // 只有 Windows 有这个变量
  dir = custom || (local ? `${local}\\CrossPet\\state` : '/tmp/crosspet')
  return dir
}
async function write($: EngineInterface, file: string, data: unknown): Promise<void> {
  await $.fs.write(`${await stateDir($)}/${file}`, JSON.stringify(data))
}
const ID = 'claude'

// 走别家的兼容接口（DeepSeek / 智谱……）时换成对应的角色演，认不出的还是 Claude。
// 看的是模型名：每次请求前（turn.step）看这次要用的模型，回复回来再用 API 报的「实际作答的模型」校正，中途 /model 换了也跟得上。
// 不看环境变量：CC Switch 之类会把 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 写进 settings.json，
// 但 Claude 桌面 App 登录的账号照样走 Anthropic，只看环境变量会把它误认成 DeepSeek。
// 接口地址只在模型名完全认不出时参考
function characterForUrl(url: string): string | undefined {
  const u = url.toLowerCase()
  if (u.includes('deepseek.com')) return 'deepseek'
  if (u.includes('bigmodel.cn') || u.includes('z.ai') || u.includes('zhipu')) return 'glm'
  return undefined
}
function characterForModel(model: string): string | undefined {
  const m = model.toLowerCase()
  if (/glm|zhipu|chatglm|z\.ai|zai-/.test(m)) return 'glm'
  if (m.includes('deepseek')) return 'deepseek'
  if (/claude|anthropic|opus|sonnet|haiku/.test(m)) return 'claude'
  if (m.includes('gemini')) return 'gemini'
  if (/^(gpt|o[1-9]|codex|chatgpt)/.test(m) || m.includes('openai')) return 'gpt'
  return undefined
}
// 会话 id → 正在演的角色（还没看到模型时是 Claude）
const actors = new Map<string, string>()
async function charactersDir($: EngineInterface): Promise<string> {
  const local = await $.env.get('LOCALAPPDATA')
  return local ? `${local}\\CrossPet\\characters` : `${await $.env.get('HOME')}/Library/Application Support/CrossPet/characters`
}
async function noteModel($: EngineInterface, model: string): Promise<void> {
  if (!model) return
  const sid = await $.session.id()
  let who = characterForModel(model) ?? characterForUrl((await $.env.get('ANTHROPIC_BASE_URL')) ?? '') ?? ID
  if (who !== ID && !(await $.fs.exists(`${await charactersDir($)}/${who}/character.json`))) who = ID   // 这个角色没装
  const old = actors.get(sid)
  if (old === who) return
  actors.set(sid, who)
  // 换了角色：这个会话从原来那个角色的多会话记录里拿掉，免得那边留着一张「还在忙」的卡片
  if (old) await dropSession($, old, sid)
  // 桌宠切到 Claude 的 App 时按它换角色（和 DeepSeek Harness、WorkBuddy 的 <宿主>-host.json 一样）
  await write($, `${ID}-host.json`, { character: who, model, ts: Date.now() / 1000 })
}
async function dropSession($: EngineInterface, who: string, sid: string): Promise<void> {
  try {
    const file = `${await stateDir($)}/${who}-sessions.json`
    const known = JSON.parse(await $.fs.read(file))
    if (!(sid in known)) return
    delete known[sid]
    await $.fs.write(file, JSON.stringify(known))
  } catch {}
}

// 事件记录（反馈「AI 干活时她没反应」用）：<数据目录>/events/claude-mod.jsonl，格式和 crosspet-hook.py 一样（见 docs/架构.md「记录」）。
// 只记事件名、工具名、会话 id 的哈希、结果，不记内容；只留最近 200 行。events 文件夹由桌宠启动时建好
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0').slice(0, 6)
}
// 同一个进程里的写入排队（并行的工具调用会同时触发），免得两次整读整写互相覆盖、丢行。
// 两个 Claude Code 进程同时写还可能丢一两行：引擎没有文件锁，这里接受（只是少几行记录，不会写坏格式以外的东西）
let ledgerChain: Promise<void> = Promise.resolve()
function ledger($: EngineInterface, ev: string, tool: string, sid: string, result: string, detail: string): void {
  ledgerChain = ledgerChain.then(() => writeLedger($, ev, tool, sid, result, detail))
}
async function writeLedger($: EngineInterface, ev: string, tool: string, sid: string, result: string, detail: string): Promise<void> {
  try {
    const file = `${(await charactersDir($)).replace(/[\\/]characters$/, '')}/events/claude-mod.jsonl`
    let rows: string[] = []
    try { rows = (await $.fs.read(file)).split('\n').filter(Boolean) } catch {}
    rows.push(JSON.stringify({ t: Math.round(Date.now() / 10) / 100, ev, tool: tool.toLowerCase().slice(0, 60), sid: sid ? shortHash(sid) : '', turn: false, result, detail }))
    if (rows.length > 240) rows = rows.slice(-200)
    await $.fs.write(file, rows.join('\n') + '\n')
  } catch {}   // 记录写不了不能影响 Claude
}

// 写状态；同时按会话另外记一份 <角色>-sessions.json（{会话id: {pose, event, ts}}），
// 同时开着好几个会话在干活时，桌宠演「手忙脚乱」，每个会话一张小卡片
type State = { pose: string; event: string; tool: string; ts: number }
async function setState($: EngineInterface, state: State): Promise<void> {
  await write($, 'seen-claude-mod', String(Math.floor(Date.now() / 1000))).catch(() => {})   // 心跳：最近一次收到消息
  let sid = ''
  try { sid = await $.session.id() } catch {}
  const who = actors.get(sid) ?? ID
  await write($, `${who}-state.json`, state)
  ledger($, state.event, state.tool, sid, 'shown', `${who} ${state.pose}`)   // 不等它写完：记录不该拖慢状态更新
  try {
    const file = `${await stateDir($)}/${who}-sessions.json`
    let known: Record<string, { pose: string; event: string; ts: number }> = {}
    try { known = JSON.parse(await $.fs.read(file)) } catch {}
    known[sid] = { pose: state.pose, event: state.event, ts: state.ts }
    const now = Date.now() / 1000
    for (const k of Object.keys(known)) if (now - known[k].ts > 600) delete known[k]
    await $.fs.write(file, JSON.stringify(known))
  } catch {}
}
const BIG_JOB_TOOLS = 8

// 跟着 AI 出现：会话开始 / 发消息时看一眼，桌宠没开着就打开。用户从菜单手动退出过（user-quit）就先不管，
// 直到 Claude 关掉重开或重启电脑（Claude 是在退出之后才打开的，记号就作废）；在设置里关了（ai-autostart-off）就不管。
// 不等它跑完，失败也不影响 Claude；一分钟内最多看一次
let lastEnsure = 0
// Claude 程序是什么时候打开的（毫秒）：顺着父进程往上找到 launchd 下面那一层。sh 的 $PPID 就是这个引擎进程
async function appStartedAt($: EngineInterface): Promise<number> {
  const { stdout } = await $.process.run(['/bin/sh', '-c', 'echo $PPID; /bin/ps -A -o pid=,ppid=,etime='])
  const [first, ...lines] = stdout.trim().split('\n')
  const procs = new Map<number, [number, number]>()
  for (const line of lines) {
    const [pid, ppid, etime] = line.trim().split(/\s+/)
    if (!etime) continue
    const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime]
    const secs = clock.split(':').reduce((a, b) => a * 60 + Number(b), 0) + Number(days) * 86400
    procs.set(Number(pid), [Number(ppid), secs])
  }
  let pid = Number(first)
  while (procs.has(pid) && procs.get(pid)![0] > 1 && procs.has(procs.get(pid)![0])) pid = procs.get(pid)![0]
  return procs.has(pid) ? Date.now() - procs.get(pid)![1] * 1000 : 0
}
async function ensurePet($: EngineInterface): Promise<void> {
  if (Date.now() - lastEnsure < 60_000) return
  lastEnsure = Date.now()
  const local = await $.env.get('LOCALAPPDATA')
  if (local) {  // Windows：交给随包 Python 跑钩子脚本的 --ensure（查单实例互斥量、用独立进程打开）
    await $.process.run([`${local}\\Programs\\CrossPet\\python\\python.exe`, `${local}\\CrossPet\\crosspet-hook.py`, '--ensure'], { timeoutMs: 10_000 })
    return
  }
  // macOS：不用 Python（没装开发者工具的 Mac 上调 python3 会弹安装框）
  const data = `${await $.env.get('HOME')}/Library/Application Support/CrossPet`
  if (await $.fs.exists(`${data}/ai-autostart-off`)) return
  if (await $.fs.exists(`${data}/user-quit`) && await appStartedAt($) <= (await $.fs.stat(`${data}/user-quit`)).mtimeMs) return
  try {
    const pid = (await $.fs.read(`${await stateDir($)}/pet.pid`)).trim()
    if (/^\d+$/.test(pid) && (await $.process.run(['/bin/kill', '-0', pid])).exitCode === 0) return  // 在跑
  } catch {}
  await $.process.run(['/usr/bin/open', '-g', '-b', 'io.github.crosspet'], { timeoutMs: 10_000 })  // -g：后台打开，不抢焦点
}

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

function poseForTool(tool: string): string {
  const t = tool.toLowerCase()
  if (t === 'askuserquestion') return 'asking'  // 停下来问你问题、让你选选项
  if (/image_gen|imagegen|generate_image|draw|paint/.test(t)) return 'drawing'
  if (/read|grep|glob|list|view|cat/.test(t)) return 'reading'
  if (/write|edit|patch|replace|create/.test(t)) return 'writing'
  if (/web|fetch|browse|search|http/.test(t)) return 'searching'
  if (/agent|task|subagent|delegate/.test(t)) return 'delegating'
  return 'running'
}

// 各窗口显示「剩余」百分比，只给剩得最少的那个标重置时间
export function quotaOf(limits: Limit[]) {
  const shown = limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day' || l.kind === 'spend_limit')
  if (shown.length === 0) return null
  const top = shown.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
  const pad = (n: number) => String(n).padStart(2, '0')
  const parts = shown.map(l => {
    const label = l.kind === 'five_hour' ? '5小时' : l.kind === 'seven_day' ? '本周' : '花费'
    let piece = `${label} 剩余 ${Math.max(0, 100 - Math.round(l.percentUsed))}%`
    if (l === top && l.resetsAt) {
      const d = new Date(l.resetsAt)
      const soon = d.getTime() - Date.now() < 86_400_000
      piece += ` · ${soon ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`} 重置`
    }
    return piece
  })
  // 额度条样式（CrossPet 设置里「额度显示样式：额度条」）用的结构化数据：剩余比例 0–1、重置时刻 Unix 秒
  const bars = shown.map(l => ({
    label: l.kind === 'five_hour' ? '5小时' : l.kind === 'seven_day' ? '本周' : '花费',
    left: Math.max(0, 100 - Math.round(l.percentUsed)) / 100,
    ...(l.resetsAt ? { reset: Math.round(new Date(l.resetsAt).getTime() / 1000) } : {}),
  }))
  return { text: parts.join(' ｜ '), low: top.percentUsed >= 90, bars }
}

export const register: Register = on => {
  let tools = 0

  on('session.start', async ($, e, next) => {
    void ensurePet($).catch(() => {})
    await setState($, { pose: 'idle', event: 'SessionStart', tool: '', ts: Date.now() / 1000 })
    const usage = await $.session.usage()
    const q = quotaOf(usage.rateLimits)
    if (q) await write($, `${ID}-quota.json`, q)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    void ensurePet($).catch(() => {})
    tools = 0
    await setState($, { pose: 'listening', event: 'UserPromptSubmit', tool: '', ts: Date.now() / 1000 })
    return next(e)
  })

  // 每次向模型发请求前：这次用的是哪个模型（只看主对话，子任务的不算）
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await noteModel($, e.model).catch(() => {})
    const r = yield* next(e)
    if (!e.agentId && r?.usage?.model) await noteModel($, r.usage.model).catch(() => {})   // API 报的实际作答模型
    return r
  })

  on('tool.call', async ($, e, next) => {
    tools += 1
    await setState($, { pose: poseForTool(e.tool), event: 'PreToolUse', tool: e.tool, ts: Date.now() / 1000 })
    const r = await next(e)
    const failed = 'deny' in r && r.deny !== undefined ? true : r.isError === true
    await setState($, { pose: failed ? 'oops' : 'thinking', event: 'PostToolUse', tool: e.tool, ts: Date.now() / 1000 })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const pose =
      e.reason === 'answer' ? (tools >= BIG_JOB_TOOLS ? 'proud' : 'happy') : e.reason === 'aborted' ? 'surprised' : 'oops'
    tools = 0
    await setState($, { pose, event: 'Stop', tool: '', ts: Date.now() / 1000 })
    return r
  })

  // 要你授权 / MCP 要你填表：只认真的弹到你面前的那一刻（和标准钩子一样用 Notification）。
  // 不用 tool.check 的「ask」判定：auto 模式、PreToolUse 钩子会在弹框前自动放行，那样她干活时会一直举着选项卡
  on('classic.Notification', async ($, e, next) => {
    const kind = String(e.notification_type ?? '').toLowerCase()
    if (kind === 'permission_prompt' || kind === 'elicitation_dialog')
      await setState($, { pose: 'asking', event: 'Notification', tool: '', ts: Date.now() / 1000 })
    return next(e)
  })

  // 压缩上下文（/compact 或自动）：只管主对话，后台预先压缩（precompute）和子任务的不算
  on('session.compact', async ($, e, next) => {
    const shown = (e.trigger === 'manual' || e.trigger === 'auto') && !e.agentId
    if (shown) await setState($, { pose: 'compact', event: 'PreCompact', tool: '', ts: Date.now() / 1000 })
    const r = await next(e)
    // 自动压缩发生在一轮中途，压完接着干活；手动 /compact 压完这一轮就结束了，后面不会再有 Stop，得自己收尾
    if (shown) await setState($, e.trigger === 'manual'
      ? { pose: 'happy', event: 'Stop', tool: '', ts: Date.now() / 1000 }
      : { pose: 'thinking', event: 'PostCompact', tool: '', ts: Date.now() / 1000 })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const q = quotaOf(e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
    if (q) await write($, `${ID}-quota.json`, q)
    return next(e)
  })
}
