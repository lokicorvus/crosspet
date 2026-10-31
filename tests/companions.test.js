const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../app/web/companions.js')

const NOW = 1_800_000_000_000
const ago = sec => NOW / 1000 - sec   // 会话里的 ts 是秒

function byKey(list) { return Object.fromEntries(list.map(c => [c.key, c])) }

// ---- clientsOf ----

test('没有 client 的旧条目：客户端就用角色名，key 是 claude@claude', () => {
  const list = C.clientsOf({ claude: { s1: { pose: 'running', event: 'PreToolUse', ts: ago(5) } } }, NOW)
  assert.equal(list.length, 1)
  assert.deepEqual(list[0], { key: 'claude@claude', character: 'claude', client: 'claude', working: true, lastTs: ago(5) })
})

test('claude-desktop 和 claude-cli 各一条：两个 key', () => {
  const list = C.clientsOf({ claude: {
    a: { pose: 'thinking', ts: ago(5), client: 'claude-desktop' },
    b: { pose: 'running', ts: ago(8), client: 'claude-cli' },
  } }, NOW)
  assert.deepEqual(list.map(c => c.key).sort(), ['claude@claude-cli', 'claude@claude-desktop'])
})

test('同一个 key 的多个会话合并：任一干活就算干活，lastTs 取最大', () => {
  const list = C.clientsOf({ claude: {
    a: { pose: 'idle', ts: ago(2), client: 'claude-cli' },
    b: { pose: 'running', ts: ago(30), client: 'claude-cli' },
  } }, NOW)
  assert.equal(list.length, 1)
  assert.equal(list[0].working, true)
  assert.equal(list[0].lastTs, ago(2))
})

test('proud 和其他待机类姿态不算干活', () => {
  for (const pose of ['idle', 'sleeping', 'happy', 'proud', 'tired']) {
    const [c] = C.clientsOf({ gpt: { s: { pose, ts: ago(1), client: 'codex' } } }, NOW)
    assert.equal(c.working, false, pose)
  }
})

test('asking 算干活', () => {
  const [c] = C.clientsOf({ gpt: { s: { pose: 'asking', ts: ago(1), client: 'codex' } } }, NOW)
  assert.equal(c.working, true)
})

test('asking 不受 3 分钟兜底，但最多算 10 分钟：9 分钟前算干活，11 分钟前不算', () => {
  const at = sec => C.clientsOf({ gpt: { s: { pose: 'asking', ts: ago(sec), client: 'codex' } } }, NOW)[0].working
  assert.equal(at(9 * 60), true)
  assert.equal(at(11 * 60), false)
})

test('一轮结束（Stop / SessionEnd）不管什么姿态都不算干活；中途出错的 oops 还算', () => {
  const w = s => C.clientsOf({ claude: { s: { ts: ago(5), client: 'claude-cli', ...s } } }, NOW)[0].working
  assert.equal(w({ pose: 'surprised', event: 'Stop' }), false)
  assert.equal(w({ pose: 'oops', event: 'Stop' }), false)
  assert.equal(w({ pose: 'running', event: 'SessionEnd' }), false)
  assert.equal(w({ pose: 'oops', event: 'PostToolUseFailure' }), true)
})

test('4 分钟前的 running 不算干活（3 分钟卡住兜底）', () => {
  const [c] = C.clientsOf({ gpt: { s: { pose: 'running', ts: ago(240), client: 'codex' } } }, NOW)
  assert.equal(c.working, false)
  const [d] = C.clientsOf({ gpt: { s: { pose: 'running', ts: ago(170), client: 'codex' } } }, NOW)
  assert.equal(d.working, true)
})

test('导出时间常数', () => {
  assert.equal(C.STUCK_AFTER, 180_000)
  assert.equal(C.LEAVE_AFTER, 60_000)
  assert.equal(C.CLI_RECENT, 600_000)
  assert.equal(C.CLAIM_STICK, 60_000)
})

// ---- mainClaim ----

const desktopCli = (desktop, cli) => C.clientsOf({ claude: {
  a: { ts: ago(10), pose: 'running', client: 'claude-desktop', ...desktop },
  b: { ts: ago(20), pose: 'running', client: 'claude-cli', ...cli },
} }, NOW)

test('前台是 Claude 桌面：占着 claude@claude-desktop', () => {
  const clients = desktopCli({ ts: ago(30) }, { ts: ago(1) })   // 终端那个事件更新，但前台对得上桌面
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'ai', character: 'claude', client: 'claude-desktop' }, clients, last: null, nowMs: NOW })
  assert.equal(r.key, 'claude@claude-desktop')
  assert.equal(r.since, NOW)
})

test('前台是普通程序：占着最近有事件的那个', () => {
  const clients = desktopCli({ ts: ago(30) }, { ts: ago(1) })
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients, last: null, nowMs: NOW })
  assert.equal(r.key, 'claude@claude-cli')
})

test('前台是终端：取这个角色最近干过活的命令行客户端', () => {
  const clients = desktopCli({ ts: ago(1) }, { ts: ago(30) })
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'terminal' }, clients, last: null, nowMs: NOW })
  assert.equal(r.key, 'claude@claude-cli')
})

test('前台是 AI 但没给 client：取最近有事件的那个', () => {
  const clients = desktopCli({ ts: ago(30) }, { ts: ago(1) })
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'ai' }, clients, last: null, nowMs: NOW })
  assert.equal(r.key, 'claude@claude-cli')
})

test('只看主桌宠当前角色的客户端；没有就是 null', () => {
  const clients = C.clientsOf({ gpt: { s: { pose: 'running', ts: ago(1), client: 'codex' } } }, NOW)
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients, last: null, nowMs: NOW })
  assert.equal(r.key, null)
})

test('已经占着桌面、桌面还在干活，终端有更新的事件：不换', () => {
  const last = { key: 'claude@claude-desktop', since: NOW - 300_000 }
  const clients = desktopCli({ ts: ago(60) }, { ts: ago(1) })
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'terminal' }, clients, last, nowMs: NOW })
  assert.deepEqual(r, last)
})

test('桌面停了 59 秒不换，61 秒换', () => {
  const last = { key: 'claude@claude-desktop', since: NOW - 300_000 }
  const at59 = desktopCli({ pose: 'proud', ts: ago(59) }, { ts: ago(1) })
  assert.deepEqual(C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients: at59, last, nowMs: NOW }), last)
  const at61 = desktopCli({ pose: 'proud', ts: ago(61) }, { ts: ago(1) })
  const r = C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients: at61, last, nowMs: NOW })
  assert.equal(r.key, 'claude@claude-cli')
  assert.equal(r.since, NOW)
})

test('粘住期过了、重新选还是同一个：since 不变', () => {
  const last = { key: 'claude@claude-desktop', since: NOW - 300_000 }
  const clients = desktopCli({ pose: 'proud', ts: ago(120) }, { pose: 'proud', ts: ago(200) })
  assert.deepEqual(C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients, last, nowMs: NOW }), last)
})

test('占着的客户端已经没有会话了：重新选', () => {
  const last = { key: 'claude@claude-desktop', since: NOW - 300_000 }
  const clients = C.clientsOf({ claude: { b: { pose: 'running', ts: ago(1), client: 'claude-cli' } } }, NOW)
  assert.equal(C.mainClaim({ mainCharacter: 'claude', foreground: { kind: 'other' }, clients, last, nowMs: NOW }).key, 'claude@claude-cli')
})

test('换了 mainCharacter：粘住失效，立刻重新选', () => {
  const last = { key: 'claude@claude-desktop', since: NOW - 300_000 }
  const clients = C.clientsOf({
    claude: { a: { pose: 'running', ts: ago(1), client: 'claude-desktop' } },
    gpt: { c: { pose: 'running', ts: ago(5), client: 'codex' } },
  }, NOW)
  const r = C.mainClaim({ mainCharacter: 'gpt', foreground: { kind: 'other' }, clients, last, nowMs: NOW })
  assert.deepEqual(r, { key: 'gpt@codex', since: NOW })
})

// ---- inAISoftware ----

const codexAt = sec => C.clientsOf({ gpt: { s: { pose: 'proud', ts: ago(sec), client: 'codex' } } }, NOW)

test('终端在前台、9 分钟前 codex 干过活 → 算；11 分钟 → 不算', () => {
  assert.equal(C.inAISoftware({ foreground: { kind: 'terminal' }, clients: codexAt(9 * 60), nowMs: NOW }), true)
  assert.equal(C.inAISoftware({ foreground: { kind: 'terminal' }, clients: codexAt(11 * 60), nowMs: NOW }), false)
})

test('终端在前台、只有 claude-desktop 干过活 → 不算', () => {
  const clients = C.clientsOf({ claude: { a: { pose: 'running', ts: ago(5), client: 'claude-desktop' } } }, NOW)
  assert.equal(C.inAISoftware({ foreground: { kind: 'terminal' }, clients, nowMs: NOW }), false)
})

test('终端在前台、没有 client 的旧 Claude 条目 5 分钟前有事件 → 算（按 claude-cli）', () => {
  const clients = C.clientsOf({ claude: { s: { pose: 'proud', event: 'Stop', ts: ago(300) } } }, NOW)
  assert.equal(clients[0].key, 'claude@claude')
  assert.equal(C.inAISoftware({ foreground: { kind: 'terminal' }, clients, nowMs: NOW }), true)
})

test('ai / ours → 算；other → 不算', () => {
  assert.equal(C.inAISoftware({ foreground: { kind: 'ours' }, clients: [], nowMs: NOW }), true)
  assert.equal(C.inAISoftware({ foreground: { kind: 'ai', character: 'claude' }, clients: [], nowMs: NOW }), true)
  assert.equal(C.inAISoftware({ foreground: { kind: 'other' }, clients: codexAt(5), nowMs: NOW }), false)
})

// ---- decide ----

// 一条会话 → clients；t 是相对 NOW 的毫秒（可正可负），sec 是会话距 t 的秒数
const sess = (character, client, pose, sec, t = 0, event) =>
  ({ [character]: { [character + client]: { pose, ts: (NOW + t) / 1000 - sec, client, ...(event ? { event } : {}) } } })
const merge = (...parts) => {
  const out = {}
  for (const p of parts) for (const [ch, ss] of Object.entries(p)) out[ch] = { ...(out[ch] || {}), ...ss }
  return out
}
const cl = (t, ...parts) => C.clientsOf(merge(...parts), NOW + t)

function run(input) {
  return C.decide({
    claimKey: 'claude@claude-desktop', mainCharacter: 'claude', inAI: true,
    rest: 'auto', gathered: [], running: null, coveredByStandIn: new Set(), prev: null,
    ...input,
    nowMs: NOW + (input.t || 0),
  })
}
const keys = r => r.pets.map(p => p.key)

const desktopBusy = t => sess('claude', 'claude-desktop', 'running', 2, t)
const codexBusy = t => sess('gpt', 'codex', 'running', 1, t)
const codexDone = (t, sec = 1) => sess('gpt', 'codex', 'proud', sec, t, 'Stop')

test('Claude 主桌宠占着 desktop，codex 干活 → pets 有 gpt@codex', () => {
  const r = run({ clients: cl(0, desktopBusy(0), codexBusy(0)) })
  assert.deepEqual(r.pets, [{ key: 'gpt@codex', character: 'gpt', client: 'codex', via: 'work', quota: true }])
  assert.deepEqual(r.leaving, [])
})

test('codex 干完、inAI 为 true 过了 5 分钟 → 还在', () => {
  const a = run({ clients: cl(0, codexBusy(0)) })
  const b = run({ t: 300_000, clients: cl(300_000, codexDone(0, 0)), prev: a.state })   // 刚干完
  const c = run({ t: 600_000, clients: cl(600_000, codexDone(300_000, 0)), prev: b.state })
  assert.deepEqual(keys(c), ['gpt@codex'])
  assert.deepEqual(c.leaving, [])
})

test('inAI 为 false 持续 59 秒 → 还在；61 秒 → 在 leaving 里', () => {
  const a = run({ clients: cl(0, codexBusy(0)) })
  const b = run({ t: 1000, inAI: false, clients: cl(1000, codexDone(1000)), prev: a.state })
  assert.deepEqual(keys(b), ['gpt@codex'])
  const c59 = run({ t: 60_000, inAI: false, clients: cl(60_000, codexDone(1000)), prev: b.state })
  assert.deepEqual(keys(c59), ['gpt@codex'])
  assert.deepEqual(c59.leaving, [])
  const c61 = run({ t: 62_000, inAI: false, clients: cl(62_000, codexDone(1000)), prev: c59.state })
  assert.deepEqual(keys(c61), [])
  assert.deepEqual(c61.leaving, ['gpt@codex'])
})

test('走开 50 秒、回到 AI 软件 1 秒、再走开 50 秒 → 还在', () => {
  const done = cl(0, codexDone(0))
  let r = run({ clients: cl(0, codexBusy(0)) })
  r = run({ t: 1000, inAI: false, clients: done, prev: r.state })
  r = run({ t: 51_000, inAI: false, clients: done, prev: r.state })
  r = run({ t: 51_000, inAI: true, clients: done, prev: r.state })
  r = run({ t: 52_000, inAI: false, clients: done, prev: r.state })
  r = run({ t: 102_000, inAI: false, clients: done, prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  assert.deepEqual(r.leaving, [])
})

test('走开 5 分钟时她一直在干活、这才停下 → 停下后 59 秒还在，61 秒在 leaving 里', () => {
  let r = run({ clients: cl(0, codexBusy(0)) })
  for (let t = 1000; t <= 301_000; t += 60_000) r = run({ t, inAI: false, clients: cl(t, codexBusy(t)), prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  const stopped = cl(301_000, codexDone(301_000))
  r = run({ t: 301_000, inAI: false, clients: stopped, prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  const at59 = run({ t: 360_000, inAI: false, clients: stopped, prev: r.state })
  assert.deepEqual(keys(at59), ['gpt@codex'])
  assert.deepEqual(at59.leaving, [])
  const at61 = run({ t: 362_000, inAI: false, clients: stopped, prev: at59.state })
  assert.deepEqual(at61.leaving, ['gpt@codex'])
})

test('3 分钟卡住兜底让她变成不干活：从发现的那一刻起算 1 分钟，不按旧的 lastTs 立刻走', () => {
  // 最后一条 running 在 t=0；走开很久；t=181 秒时兜底判成不干活
  let r = run({ clients: cl(0, codexBusy(0)) })
  r = run({ t: 1000, inAI: false, clients: cl(1000, codexBusy(0)), prev: r.state })
  r = run({ t: 120_000, inAI: false, clients: cl(120_000, codexBusy(0)), prev: r.state })
  r = run({ t: 181_000, inAI: false, clients: cl(181_000, codexBusy(0)), prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  r = run({ t: 240_000, inAI: false, clients: cl(240_000, codexBusy(0)), prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  r = run({ t: 242_000, inAI: false, clients: cl(242_000, codexBusy(0)), prev: r.state })
  assert.deepEqual(r.leaving, ['gpt@codex'])
})

test('codex 会话全部消失 → 立刻在 leaving 里', () => {
  const a = run({ clients: cl(0, codexBusy(0)) })
  const b = run({ t: 1000, clients: cl(1000, desktopBusy(1000)), prev: a.state })
  assert.deepEqual(keys(b), [])
  assert.deepEqual(b.leaving, ['gpt@codex'])
})

test("rest:'stay' 时走开 10 分钟 → 还在；running 不含它 → 走", () => {
  // 主桌宠是 GPT、占着 codex；Claude 桌面（有窗口的程序）冒一只，codex（命令行）不看 running
  const base = { rest: 'stay', mainCharacter: 'gpt', claimKey: 'gpt@codex' }
  const a = run({ ...base, clients: cl(0, desktopBusy(0), sess('gemini', 'gemini', 'running', 1)) })
  assert.deepEqual(keys(a), ['claude@claude-desktop', 'gemini@gemini'])
  const idle = t => cl(t, sess('claude', 'claude-desktop', 'proud', 1, 0, 'Stop'), sess('gemini', 'gemini', 'proud', 1, 0, 'Stop'))
  const b = run({ ...base, t: 1000, inAI: false, clients: idle(1000), prev: a.state })
  const c = run({ ...base, t: 601_000, inAI: false, clients: idle(601_000), prev: b.state })
  assert.deepEqual(keys(c), ['claude@claude-desktop', 'gemini@gemini'])
  assert.deepEqual(c.leaving, [])
  const d = run({ ...base, t: 602_000, inAI: false, running: new Set(), clients: idle(602_000), prev: c.state })
  assert.deepEqual(keys(d), ['gemini@gemini'])
  assert.deepEqual(d.leaving, ['claude@claude-desktop'])
})

test('sentHome 后同一 key 旧会话还在 → 不出现；新一轮 working → 出现', () => {
  const a = run({ clients: cl(0, codexBusy(0)) })
  const sent = C.sendHome(a.state, 'gpt@codex', NOW + 1000)
  const b = run({ t: 1000, clients: cl(1000, codexBusy(0)), prev: sent })   // 还是 1 秒前那条
  assert.deepEqual(keys(b), [])
  assert.deepEqual(b.leaving, ['gpt@codex'])
  const c = run({ t: 5000, clients: cl(5000, codexBusy(0)), prev: b.state })
  assert.deepEqual(keys(c), [])
  const d = run({ t: 9000, clients: cl(9000, codexBusy(9000)), prev: c.state })   // 新事件
  assert.deepEqual(keys(d), ['gpt@codex'])
  assert.deepEqual(d.state.sentHome, {})
})

test("集合 ['gpt','deepseek'] → 两只 via:'gather'、client:null；codex 开始干活 → gpt 那只收编为 gpt@codex，只有一只 gpt", () => {
  const a = run({ gathered: ['gpt', 'deepseek'], clients: cl(0, desktopBusy(0)) })
  assert.deepEqual(a.pets.map(p => [p.character, p.client, p.via]), [['gpt', null, 'gather'], ['deepseek', null, 'gather']])
  const b = run({ t: 1000, gathered: ['gpt', 'deepseek'], clients: cl(1000, desktopBusy(1000), codexBusy(1000)), prev: a.state })
  assert.deepEqual(b.pets.map(p => [p.key, p.client, p.via]), [['gpt@codex', 'codex', 'gather'], [a.pets[1].key, null, 'gather']])
  assert.equal(b.pets.filter(p => p.character === 'gpt').length, 1)
  assert.deepEqual(b.leaving, [])
  assert.equal(b.state.gatherKeys.gpt, 'gpt@codex')
})

test("解散（gathered:[]）→ 两只都在 leaving", () => {
  const a = run({ gathered: ['gpt', 'deepseek'], clients: cl(0, desktopBusy(0)) })
  const b = run({ t: 1000, gathered: [], clients: cl(1000, desktopBusy(1000)), prev: a.state })
  assert.deepEqual(b.pets, [])
  assert.deepEqual(b.leaving, a.pets.map(p => p.key))
  assert.deepEqual(b.state.gatherKeys, {})
})

test('主桌宠 Claude 占着 desktop、cli 也在干活 → 冒一只 claude@claude-cli，quota:false', () => {
  const r = run({ clients: cl(0, desktopBusy(0), sess('claude', 'claude-cli', 'running', 1)) })
  assert.deepEqual(r.pets, [{ key: 'claude@claude-cli', character: 'claude', client: 'claude-cli', via: 'work', quota: false }])
})

test('主桌宠是 GPT，两只 Claude → 先出现的那只 quota:true', () => {
  const base = { mainCharacter: 'gpt', claimKey: 'gpt@codex' }
  const a = run({ ...base, clients: cl(0, desktopBusy(0)) })
  const b = run({ ...base, t: 1000, clients: cl(1000, sess('claude', 'claude-cli', 'running', 1, 1000), desktopBusy(1000)), prev: a.state })
  assert.deepEqual(b.pets.map(p => [p.key, p.quota]), [['claude@claude-desktop', true], ['claude@claude-cli', false]])
})

test('coveredByStandIn 含 gpt → codex 干活不冒', () => {
  const r = run({ coveredByStandIn: new Set(['gpt']), gathered: ['gpt'], clients: cl(0, desktopBusy(0), codexBusy(0)) })
  assert.deepEqual(r.pets, [])
})
