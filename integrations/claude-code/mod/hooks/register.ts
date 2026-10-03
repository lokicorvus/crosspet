import type { Register } from 'claude-code'

// CrossPet × Claude Code（增强版 mod）
// 和标准钩子输出同一种状态（<状态目录>/claude-state.json），另外多两样：
// - 额度：session.measure 推来的 5 小时 / 每周窗口 → claude-quota.json
// - 被打断 / 出错：turn.complete 的 reason
// 状态目录固定 /tmp/crosspet（和桌宠、其他接入一致）。

const DIR = '/tmp/crosspet'
const ID = 'claude'
const BIG_JOB_TOOLS = 8

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

function poseForTool(tool: string): string {
  const t = tool.toLowerCase()
  if (/image_gen|imagegen|generate_image|draw|paint/.test(t)) return 'drawing'
  if (/read|grep|glob|list|view|cat/.test(t)) return 'reading'
  if (/write|edit|patch|replace|create/.test(t)) return 'writing'
  if (/web|fetch|browse|search|http/.test(t)) return 'searching'
  if (/agent|task|subagent|delegate/.test(t)) return 'delegating'
  return 'running'
}

// 各窗口百分比，只给用得最多的那个标重置时间
function quotaOf(limits: Limit[]) {
  const shown = limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day' || l.kind === 'spend_limit')
  if (shown.length === 0) return null
  const top = shown.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
  const pad = (n: number) => String(n).padStart(2, '0')
  const parts = shown.map(l => {
    const label = l.kind === 'five_hour' ? '5小时' : l.kind === 'seven_day' ? '本周' : '花费'
    let piece = `${label} ${Math.round(l.percentUsed)}%`
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
    await $.fs.write(`${DIR}/${ID}-state.json`, JSON.stringify({ pose: 'idle', event: 'SessionStart', tool: '', ts: Date.now() / 1000 }))
    const usage = await $.session.usage()
    const q = quotaOf(usage.rateLimits)
    if (q) await $.fs.write(`${DIR}/${ID}-quota.json`, JSON.stringify(q))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    tools = 0
    await $.fs.write(`${DIR}/${ID}-state.json`, JSON.stringify({ pose: 'listening', event: 'UserPromptSubmit', tool: '', ts: Date.now() / 1000 }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    tools += 1
    await $.fs.write(`${DIR}/${ID}-state.json`, JSON.stringify({ pose: poseForTool(e.tool), event: 'PreToolUse', tool: e.tool, ts: Date.now() / 1000 }))
    const r = await next(e)
    const failed = 'deny' in r && r.deny !== undefined ? true : r.isError === true
    await $.fs.write(`${DIR}/${ID}-state.json`, JSON.stringify({ pose: failed ? 'oops' : 'thinking', event: 'PostToolUse', tool: e.tool, ts: Date.now() / 1000 }))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const pose =
      e.reason === 'answer' ? (tools >= BIG_JOB_TOOLS ? 'proud' : 'happy') : e.reason === 'aborted' ? 'surprised' : 'oops'
    tools = 0
    await $.fs.write(`${DIR}/${ID}-state.json`, JSON.stringify({ pose, event: 'Stop', tool: '', ts: Date.now() / 1000 }))
    return r
  })

  on('session.measure', async ($, e, next) => {
    const q = quotaOf(e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
    if (q) await $.fs.write(`${DIR}/${ID}-quota.json`, JSON.stringify(q))
    return next(e)
  })
}
