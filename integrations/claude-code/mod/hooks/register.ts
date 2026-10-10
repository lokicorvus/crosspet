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

// 走别家的兼容接口（ANTHROPIC_BASE_URL 指向 DeepSeek / 智谱……，或者用别家的模型名）时换成对应的角色演，
// 认不出的还是 Claude。每次向模型发请求前（turn.step）看一眼这次用的模型，中途 /model 换了也跟得上。
// 接口地址比模型名可信：DeepSeek、智谱的 Anthropic 兼容接口也收 Claude 的模型名
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
  const sid = await $.session.id()
  let who = characterForUrl((await $.env.get('ANTHROPIC_BASE_URL')) ?? '') ?? characterForModel(model) ?? ID
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

// 写状态；同时按会话另外记一份 <角色>-sessions.json（{会话id: {pose, event, ts}}），
// 同时开着好几个会话在干活时，桌宠演「手忙脚乱」，每个会话一张小卡片
type State = { pose: string; event: string; tool: string; ts: number }
async function setState($: EngineInterface, state: State): Promise<void> {
  let sid = ''
  try { sid = await $.session.id() } catch {}
  const who = actors.get(sid) ?? ID
  await write($, `${who}-state.json`, state)
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
function quotaOf(limits: Limit[]) {
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
  return { text: parts.join(' ｜ '), low: top.percentUsed >= 90 }
}

export const register: Register = on => {
  let tools = 0

  on('session.start', async ($, e, next) => {
    void ensurePet($).catch(() => {})
    // 还没发请求时先按环境变量猜（只配了 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 的情况）
    await noteModel($, (await $.env.get('ANTHROPIC_MODEL')) ?? '').catch(() => {})
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
    return yield* next(e)
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
