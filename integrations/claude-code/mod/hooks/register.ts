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
const BIG_JOB_TOOLS = 8

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
    await write($, `${ID}-state.json`, { pose: 'idle', event: 'SessionStart', tool: '', ts: Date.now() / 1000 })
    const usage = await $.session.usage()
    const q = quotaOf(usage.rateLimits)
    if (q) await write($, `${ID}-quota.json`, q)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    tools = 0
    await write($, `${ID}-state.json`, { pose: 'listening', event: 'UserPromptSubmit', tool: '', ts: Date.now() / 1000 })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    tools += 1
    await write($, `${ID}-state.json`, { pose: poseForTool(e.tool), event: 'PreToolUse', tool: e.tool, ts: Date.now() / 1000 })
    const r = await next(e)
    const failed = 'deny' in r && r.deny !== undefined ? true : r.isError === true
    await write($, `${ID}-state.json`, { pose: failed ? 'oops' : 'thinking', event: 'PostToolUse', tool: e.tool, ts: Date.now() / 1000 })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const pose =
      e.reason === 'answer' ? (tools >= BIG_JOB_TOOLS ? 'proud' : 'happy') : e.reason === 'aborted' ? 'surprised' : 'oops'
    tools = 0
    await write($, `${ID}-state.json`, { pose, event: 'Stop', tool: '', ts: Date.now() / 1000 })
    return r
  })

  // 要你授权 / MCP 要你填表：只认真的弹到你面前的那一刻（和标准钩子一样用 Notification）。
  // 不用 tool.check 的「ask」判定：auto 模式、PreToolUse 钩子会在弹框前自动放行，那样她干活时会一直举着选项卡
  on('classic.Notification', async ($, e, next) => {
    const kind = String(e.notification_type ?? '').toLowerCase()
    if (kind === 'permission_prompt' || kind === 'elicitation_dialog')
      await write($, `${ID}-state.json`, { pose: 'asking', event: 'Notification', tool: '', ts: Date.now() / 1000 })
    return next(e)
  })

  // 压缩上下文（/compact 或自动）：只管主对话，后台预先压缩（precompute）和子任务的不算
  on('session.compact', async ($, e, next) => {
    const shown = (e.trigger === 'manual' || e.trigger === 'auto') && !e.agentId
    if (shown) await write($, `${ID}-state.json`, { pose: 'compact', event: 'PreCompact', tool: '', ts: Date.now() / 1000 })
    const r = await next(e)
    if (shown) await write($, `${ID}-state.json`, { pose: 'thinking', event: 'PostCompact', tool: '', ts: Date.now() / 1000 })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const q = quotaOf(e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
    if (q) await write($, `${ID}-quota.json`, q)
    return next(e)
  })
}
