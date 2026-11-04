// DeepSeek Harness 插件的事件记录（数据目录 events/deepseek.jsonl，格式同 crosspet-hook.py）：node --test tests/deepseek_plugin_ledger.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'

function harness() {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ is_available: false, balance_infos: [] }) })
  const dataDir = mkdtempSync(join(tmpdir(), 'crosspet-dsh-ledger-'))
  const handlers = {}
  const ctx = { on(n, f) { (handlers[n] ||= []).push(f) }, inject() { throw new Error('none') }, effect() {}, logger: { warn() {} },
    credentials: { resolve: async () => ({ value: 'sk-test' }) } }
  apply(ctx, { stateDir: join(dataDir, 'state'), dataDir, autostart: false, balanceGapMs: 1e9 })
  const fire = async (n, ...a) => { for (const h of handlers[n] || []) await h(...a, async () => {}) }
  // 记录是排队异步写的：等到 ok(行) 成立再返回（最多 5 秒），不靠固定等多少毫秒（多写了 @ 状态文件后 80ms 不够）
  const rows = async (ok = () => true) => {
    const p = join(dataDir, 'events', 'deepseek.jsonl')
    const read = () => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    await new Promise((r) => setTimeout(r, 80))
    for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
      const v = read()
      if (ok(v)) return v
    }
    return read()
  }
  return { fire, rows, dataDir }
}

test('收到消息记一行 shown，字段和钩子的一样', async () => {
  const h = harness()
  await h.fire('agent/pre-step', { messages: [{ role: 'user', content: 'hi' }] })
  const last = (await h.rows()).at(-1)
  assert.equal(last.result, 'shown')
  assert.equal(last.ev, 'UserPromptSubmit')
  assert.match(last.detail, /^deepseek listening$/)
  for (const k of ['t', 'ev', 'tool', 'sid', 'turn', 'result', 'detail']) assert.ok(k in last, k)
})

test('不记内容：消息、工具参数都不进记录', async () => {
  const h = harness()
  await h.fire('agent/pre-step', { messages: [{ role: 'user', content: 'SECRET-DS-1' }] })
  await h.fire('tools/pre-execute', { name: 'Bash', arguments: { command: 'cat SECRET-DS-2' } })
  await h.rows()
  const text = readFileSync(join(h.dataDir, 'events', 'deepseek.jsonl'), 'utf8')
  assert.ok(!text.includes('SECRET'), text)
  assert.ok(text.includes('"tool":"bash"'))
})

test('超过 240 行截回 200 行，最后一行是最新的', async () => {
  const h = harness()
  for (let i = 0; i < 245; i++) await h.fire('tools/pre-execute', { name: `t${i}`, arguments: {} })
  const rows = await h.rows((v) => v.at(-1)?.tool === 't244')
  assert.ok(rows.length >= 200 && rows.length <= 240, String(rows.length))
  assert.equal(rows.at(-1).tool, 't244')
})
