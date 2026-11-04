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
  // 外壳认得 Claude 桌面：开始时 running 里有她（之后没了才算程序关掉）
  const a = run({ ...base, running: new Set(['claude@claude-desktop']), clients: cl(0, desktopBusy(0), sess('gemini', 'gemini', 'running', 1)) })
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
  const c = run({ t: 5000, clients: cl(5000, codexDone(5000)), prev: b.state })   // 这一轮做完
  assert.deepEqual(keys(c), [])
  const d = run({ t: 9000, clients: cl(9000, codexBusy(9000)), prev: c.state })   // 新一轮
  assert.deepEqual(keys(d), ['gpt@codex'])
  assert.deepEqual(d.state.sentHome, {})
})

test('干活中途送回去：这一轮后面的事件不放她回来；Stop 后还不回来；新一轮开始才出现', () => {
  let r = run({ clients: cl(0, codexBusy(0)) })
  r = run({ t: 1000, clients: cl(1000, codexBusy(1000)), prev: C.sendHome(r.state, 'gpt@codex', NOW + 1000) })
  assert.deepEqual(r.leaving, ['gpt@codex'])
  for (const t of [3000, 6000, 9000, 12_000]) {   // 同一轮里接着来的 PreToolUse / PostToolUse
    r = run({ t, clients: cl(t, codexBusy(t)), prev: r.state })
    assert.deepEqual(keys(r), [], String(t))
  }
  r = run({ t: 15_000, clients: cl(15_000, codexDone(15_000)), prev: r.state })
  assert.deepEqual(keys(r), [])
  r = run({ t: 20_000, clients: cl(20_000, codexBusy(20_000)), prev: r.state })
  assert.deepEqual(keys(r), ['gpt@codex'])
  assert.deepEqual(r.state.sentHome, {})
})

test('集合来的收编了 gpt@codex，codex 会话全部结束 → 退回 gpt@gather；gpt 别的客户端干活由她再收编，不多冒一只', () => {
  let r = run({ gathered: ['gpt'], clients: cl(0, codexBusy(0)) })
  assert.deepEqual(keys(r), ['gpt@codex'])
  r = run({ t: 1000, gathered: ['gpt'], clients: cl(1000, desktopBusy(1000)), prev: r.state })
  assert.deepEqual(r.pets.map(p => [p.key, p.client, p.via]), [['gpt@gather', null, 'gather']])
  assert.deepEqual(r.leaving, [])
  r = run({ t: 2000, gathered: ['gpt'], clients: cl(2000, sess('gpt', 'chatgpt', 'running', 1, 2000)), prev: r.state })
  assert.deepEqual(r.pets.map(p => [p.key, p.client, p.via]), [['gpt@chatgpt', 'chatgpt', 'gather']])
})

test('gathered 里有主桌宠正演着的角色：不叫她', () => {
  const r = run({ gathered: ['claude', 'gpt'], clients: cl(0, desktopBusy(0), sess('claude', 'claude-cli', 'running', 1)) })
  assert.deepEqual(r.pets.map(p => [p.key, p.via]), [['gpt@gather', 'gather'], ['claude@claude-cli', 'work']])
})

test('sendHome 没有 state 时给的初始 state 和 decide 的同一个形状', () => {
  const s = C.sendHome(null, 'gpt@codex', NOW)
  assert.deepEqual(Object.keys(s).sort(), ['awaySince', 'gatherKeys', 'idleSince', 'pets', 'sentHome'])
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

test('解散时收编的客户端还在干活 → 不走，转成 via:work 留着（不 bye、不重新冒）；没在干活的照常走', () => {
  const a = run({ gathered: ['gpt', 'deepseek'], clients: cl(0, desktopBusy(0), codexBusy(0)) })
  assert.equal(a.pets[0].key, 'gpt@codex')
  const b = run({ t: 1000, gathered: [], clients: cl(1000, desktopBusy(1000), codexBusy(1000)), prev: a.state })
  assert.deepEqual(b.pets.map(p => [p.key, p.client, p.via]), [['gpt@codex', 'codex', 'work']])
  assert.deepEqual(b.leaving, [a.pets[1].key])
  assert.deepEqual(b.state.gatherKeys, {})
})

test('解散时收编的客户端已经停了 → 照常走', () => {
  const a = run({ gathered: ['gpt'], clients: cl(0, desktopBusy(0), codexBusy(0)) })
  const b = run({ t: 1000, gathered: [], clients: cl(1000, desktopBusy(1000), codexDone(1000)), prev: a.state })
  assert.deepEqual(b.pets, [])
  assert.deepEqual(b.leaving, ['gpt@codex'])
})

test('workPets:false（开关关着只集合）→ 干活的客户端不冒；集合来的照样收编；已站着的 work 那只走；解散后收编的也走', () => {
  const r = run({ workPets: false, clients: cl(0, desktopBusy(0), codexBusy(0)) })
  assert.deepEqual(r.pets, [])
  const g = run({ workPets: false, gathered: ['gpt'], clients: cl(0, desktopBusy(0), codexBusy(0)) })
  assert.deepEqual(g.pets.map(p => [p.key, p.via]), [['gpt@codex', 'gather']])
  const w = run({ clients: cl(0, desktopBusy(0), codexBusy(0)) })
  const off = run({ t: 1000, workPets: false, clients: cl(1000, desktopBusy(1000), codexBusy(1000)), prev: w.state })
  assert.deepEqual(off.pets, [])
  assert.deepEqual(off.leaving, ['gpt@codex'])
  const d = run({ t: 1000, workPets: false, gathered: [], clients: cl(1000, desktopBusy(1000), codexBusy(1000)), prev: g.state })
  assert.deepEqual(d.pets, [])
  assert.deepEqual(d.leaving, ['gpt@codex'])
})

test("rest:'stay'、running 不含她但还在干活：只走一次，之后不再冒出来（不会 bye / 再冒循环）", () => {
  const base = { rest: 'stay', mainCharacter: 'gpt', claimKey: 'gpt@codex' }
  const a = run({ ...base, running: new Set(['gpt@codex', 'claude@claude-desktop']), clients: cl(0, desktopBusy(0)) })
  assert.deepEqual(keys(a), ['claude@claude-desktop'])
  const running = new Set(['gpt@codex'])   // Claude 桌面关掉了
  const b = run({ ...base, t: 1000, running, clients: cl(1000, desktopBusy(1000)), prev: a.state })
  assert.deepEqual(keys(b), [])
  assert.deepEqual(b.leaving, ['claude@claude-desktop'])
  const c = run({ ...base, t: 2000, running, clients: cl(2000, desktopBusy(2000)), prev: b.state })
  assert.deepEqual(keys(c), [])
  assert.deepEqual(c.leaving, [])
  const d = run({ ...base, t: 7000, running, clients: cl(7000, desktopBusy(7000)), prev: c.state })
  assert.deepEqual(keys(d), [])
  assert.deepEqual(d.leaving, [])
})

test("rest:'stay'：外壳认不出的有窗口的程序（从没在 running 里出现过）干活 → 出现，之后一直留着（只看 SessionEnd）", () => {
  const base = { rest: 'stay', mainCharacter: 'gpt', claimKey: 'gpt@codex' }
  const running = new Set(['gpt@codex'])
  const a = run({ ...base, running, clients: cl(0, desktopBusy(0)) })
  assert.deepEqual(keys(a), ['claude@claude-desktop'])
  const idle = t => cl(t, sess('claude', 'claude-desktop', 'proud', 1, 0, 'Stop'))
  const b = run({ ...base, t: 1000, running, inAI: false, clients: idle(1000), prev: a.state })
  const c = run({ ...base, t: 601_000, running, inAI: false, clients: idle(601_000), prev: b.state })
  assert.deepEqual(keys(c), ['claude@claude-desktop'])
  assert.deepEqual(c.leaving, [])
  // 会话全部结束（SessionEnd 删掉）才走
  const d = run({ ...base, t: 602_000, running, clients: cl(602_000), prev: c.state })
  assert.deepEqual(keys(d), [])
  assert.deepEqual(d.leaving, ['claude@claude-desktop'])
})

test("rest:'stay'：程序关掉走了之后再打开、又干活 → 再出现", () => {
  const base = { rest: 'stay', mainCharacter: 'gpt', claimKey: 'gpt@codex' }
  const open = new Set(['gpt@codex', 'claude@claude-desktop']), closed = new Set(['gpt@codex'])
  const a = run({ ...base, running: open, clients: cl(0, desktopBusy(0)) })
  const b = run({ ...base, t: 1000, running: closed, clients: cl(1000, desktopBusy(1000)), prev: a.state })
  assert.deepEqual(b.leaving, ['claude@claude-desktop'])
  const c = run({ ...base, t: 6000, running: closed, clients: cl(6000, desktopBusy(6000)), prev: b.state })
  assert.deepEqual(keys(c), [])
  assert.deepEqual(c.leaving, [])
  const d = run({ ...base, t: 9000, running: open, clients: cl(9000, desktopBusy(9000)), prev: c.state })
  assert.deepEqual(keys(d), ['claude@claude-desktop'])
  assert.deepEqual(d.leaving, [])
})

test("rest:'stay'：没有 client 的旧 gpt@gpt 算命令行，不看 running", () => {
  const base = { rest: 'stay', mainCharacter: 'claude', claimKey: 'claude@claude-desktop' }
  const old = t => ({ gpt: { s: { pose: 'running', ts: (NOW + t) / 1000 - 1 } } })
  const a = run({ ...base, running: new Set(), clients: cl(0, old(0)) })
  assert.deepEqual(keys(a), ['gpt@gpt'])
  const b = run({ ...base, t: 1000, running: new Set(), clients: cl(1000, old(1000)), prev: a.state })
  assert.deepEqual(keys(b), ['gpt@gpt'])
  assert.deepEqual(b.leaving, [])
})

test('isCli：hermes 和各角色没有 client 的旧条目按默认接入算；claude-desktop / cursor 不算', () => {
  assert.equal(C.CLI_CLIENTS.has('hermes'), true)
  for (const ch of ['claude', 'gpt', 'deepseek', 'gemini', 'qwen', 'grok']) assert.equal(C.isCli({ character: ch, client: ch }), true, ch)
  assert.equal(C.isCli({ character: 'claude', client: 'claude-desktop' }), false)
  assert.equal(C.isCli({ character: 'claude', client: 'cursor' }), false)
  assert.equal(C.isCli({ character: 'glm', client: 'glm' }), false)
})

// ---- rest:'open'：AI 程序开着就在 ----
// characterOf：在跑的程序（running 里的客户端）还没有会话时出哪个角色（页面按 clientCharacter 算好交进来）

const openBase = { rest: 'open', mainCharacter: 'gpt', claimKey: 'gpt@codex', characterOf: { 'claude-desktop': 'claude' } }

test("rest:'open'：Claude 桌面开着、还没会话 → 出一只 claude@claude-desktop；程序关掉 → 走", () => {
  const a = run({ ...openBase, running: new Set(['claude@claude-desktop', 'gpt@claude-desktop']), clients: [] })
  assert.deepEqual(keys(a), ['claude@claude-desktop'])
  const b = run({ ...openBase, t: 1000, running: new Set(), clients: [], prev: a.state })
  assert.deepEqual(keys(b), [])
  assert.deepEqual(b.leaving, ['claude@claude-desktop'])
})

test("rest:'open'：程序开着、会话闲着、你也离开 AI 软件很久 → 一直在", () => {
  const running = new Set(['claude@claude-desktop'])
  const idle = t => cl(t, sess('claude', 'claude-desktop', 'proud', 1, 0, 'Stop'))
  const a = run({ ...openBase, running, clients: idle(0) })
  const b = run({ ...openBase, t: 1000, running, inAI: false, clients: idle(1000), prev: a.state })
  const c = run({ ...openBase, t: 3_600_000, running, inAI: false, clients: idle(3_600_000), prev: b.state })
  assert.deepEqual(keys(c), ['claude@claude-desktop'])
  assert.deepEqual(c.leaving, [])
})

test("rest:'open'：命令行 AI 有会话就在（10 分钟内有动静），10 分钟没动静先走，又干活再来", () => {
  const base = { ...openBase, mainCharacter: 'gpt', claimKey: 'gpt@codex', running: new Set() }
  const a = run({ ...base, clients: cl(0, sess('gemini', 'gemini', 'idle', 1, 0, 'SessionStart')) })
  assert.deepEqual(keys(a), ['gemini@gemini'])
  // 之后一直没新事件：会话停在时刻 0 前 1 秒那次
  const b = run({ ...base, t: 590_000, inAI: false, clients: cl(590_000, sess('gemini', 'gemini', 'idle', 1)), prev: a.state })
  assert.deepEqual(keys(b), ['gemini@gemini'])
  const c = run({ ...base, t: 601_000, inAI: false, clients: cl(601_000, sess('gemini', 'gemini', 'idle', 1)), prev: b.state })
  assert.deepEqual(keys(c), [])
  assert.deepEqual(c.leaving, ['gemini@gemini'])
  const d = run({ ...base, t: 700_000, clients: cl(700_000, sess('gemini', 'gemini', 'running', 1, 700_000)), prev: c.state })
  assert.deepEqual(keys(d), ['gemini@gemini'])
})

test("rest:'open'：codex 是命令行客户端，但程序（Codex 桌面 / codex 进程）在跑就算开着", () => {
  const base = { ...openBase, mainCharacter: 'claude', claimKey: 'claude@claude-desktop', characterOf: { codex: 'gpt' } }
  const a = run({ ...base, running: new Set(['gpt@codex', 'claude@codex']), clients: cl(0, desktopBusy(0)) })
  assert.deepEqual(keys(a), ['gpt@codex'])
  const old = t => cl(t, desktopBusy(t), sess('gpt', 'codex', 'proud', 1200, 0, 'Stop'))   // 会话 20 分钟没动静了
  const b = run({ ...base, t: 1000, running: new Set(['gpt@codex']), clients: old(1000), prev: a.state })
  assert.deepEqual(keys(b), ['gpt@codex'])
})

test("rest:'open'：Cursor 开着，上次在里面的是 Claude → 先出 claude@cursor；开始用 GPT → 换成 gpt@cursor", () => {
  const base = { ...openBase, characterOf: { cursor: 'claude' } }
  const running = new Set(['claude@cursor', 'gpt@cursor'])
  const a = run({ ...base, running, clients: [] })
  assert.deepEqual(keys(a), ['claude@cursor'])
  const b = run({ ...base, t: 1000, running, clients: cl(1000, sess('gpt', 'cursor', 'thinking', 1)), prev: a.state })
  assert.deepEqual(keys(b), ['gpt@cursor'])
  assert.deepEqual(b.leaving, ['claude@cursor'])
})

test("rest:'open'：程序开着但不知道是谁（characterOf 里没有）→ 不出", () => {
  const a = run({ ...openBase, characterOf: {}, running: new Set(['claude@cursor', 'gpt@cursor']), clients: [] })
  assert.deepEqual(keys(a), [])
})

test("rest:'open'：主桌宠还没占着客户端、程序是她自己的角色 → 不另出一只（她就是那只）", () => {
  const a = run({ ...openBase, mainCharacter: 'claude', claimKey: null, running: new Set(['claude@claude-desktop']), clients: [] })
  assert.deepEqual(keys(a), [])
})

test("rest:'open'：workPets:false（开关关着）→ 程序开着也不出", () => {
  const a = run({ ...openBase, workPets: false, running: new Set(['claude@claude-desktop']), clients: [] })
  assert.deepEqual(keys(a), [])
})

test("rest:'open'：让她先回去 → 程序还开着也不回来；干活了再来", () => {
  const running = new Set(['claude@claude-desktop'])
  const a = run({ ...openBase, running, clients: [] })
  const sent = C.sendHome(a.state, 'claude@claude-desktop', NOW + 1000)
  const b = run({ ...openBase, t: 2000, running, clients: [], prev: sent })
  assert.deepEqual(keys(b), [])
  const c = run({ ...openBase, t: 60_000, running, clients: [], prev: b.state })
  assert.deepEqual(keys(c), [])
  const d = run({ ...openBase, t: 70_000, running, clients: cl(70_000, desktopBusy(70_000)), prev: c.state })
  assert.deepEqual(keys(d), ['claude@claude-desktop'])
})

test('clientCharacter：上次在里面的角色 > 程序默认的角色 > 客户端名就是角色；没装的角色不算', () => {
  const valid = new Set(['claude', 'gpt', 'gemini', 'deepseek'])
  assert.equal(C.clientCharacter('cursor', { cursor: 'gpt' }, valid), 'gpt')
  assert.equal(C.clientCharacter('cursor', {}, valid), null)
  assert.equal(C.clientCharacter('codex', {}, valid), 'gpt')
  assert.equal(C.clientCharacter('codex', { codex: 'deepseek' }, valid), 'deepseek')
  assert.equal(C.clientCharacter('claude-desktop', {}, valid), 'claude')
  assert.equal(C.clientCharacter('antigravity', {}, valid), 'gemini')
  assert.equal(C.clientCharacter('deepseek', {}, valid), 'deepseek')
  assert.equal(C.clientCharacter('cursor', { cursor: 'grok' }, valid), null)   // 记着的角色没装
})

test('rememberClients：每个客户端记最近有动静的那个角色；没变就返回原来那份', () => {
  const was = { cursor: 'claude' }
  const clients = C.clientsOf(merge(sess('gpt', 'cursor', 'idle', 5), sess('claude', 'cursor', 'idle', 50), sess('gemini', 'gemini', 'idle', 1)), NOW)
  assert.deepEqual(C.rememberClients(was, clients), { cursor: 'gpt', gemini: 'gemini' })
  const same = { cursor: 'gpt', gemini: 'gemini' }
  assert.equal(C.rememberClients(same, clients), same)
})
