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

test('ai / ours → 算；other → 不算', () => {
  assert.equal(C.inAISoftware({ foreground: { kind: 'ours' }, clients: [], nowMs: NOW }), true)
  assert.equal(C.inAISoftware({ foreground: { kind: 'ai', character: 'claude' }, clients: [], nowMs: NOW }), true)
  assert.equal(C.inAISoftware({ foreground: { kind: 'other' }, clients: codexAt(5), nowMs: NOW }), false)
})
