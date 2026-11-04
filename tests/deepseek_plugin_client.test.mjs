// DeepSeek Harness 插件写客户端（多桌宠按「角色 + 客户端」各站一只）：node --test tests/deepseek_plugin_client.test.mjs
// 假的 Harness 只记事件处理函数；状态目录、数据目录都指到临时目录。等预期的最后一条写出来再断言，不用固定的毫秒数
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'

delete process.env.CLAUDE_CODE_ENTRYPOINT   // 测试本身跑在 Claude Code 里

function harness() {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ is_available: false, balance_infos: [] }) })
  const dataDir = mkdtempSync(join(tmpdir(), 'crosspet-dsh-client-'))
  const stateDir = join(dataDir, 'state')
  const handlers = {}
  const ctx = { on(n, f) { (handlers[n] ||= []).push(f) }, inject() { throw new Error('none') }, effect() {}, logger: { warn() {} },
    credentials: { resolve: async () => ({ value: 'sk-test' }) } }
  apply(ctx, { stateDir, dataDir, autostart: false, balanceGapMs: 1e9 })
  const fire = async (n, ...a) => { for (const h of handlers[n] || []) await h(...a, async () => {}) }
  const read = (f) => { try { return JSON.parse(readFileSync(join(stateDir, f), 'utf8')) } catch { return undefined } }
  // 一直读到 ok(值) 为真；5 秒还没等到就失败，报最后读到的内容
  const until = async (f, ok) => {
    const deadline = Date.now() + 5000
    for (;;) {
      const v = read(f)
      if (ok(v)) return v
      if (Date.now() > deadline) assert.fail(`等不到 ${f}：${JSON.stringify(v)}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  return { fire, until, read }
}

test('一轮事件后：会话条目带 client: deepseek，另写 deepseek@deepseek-state.json，主文件不带 client', async () => {
  const h = harness()
  const session = { id: 'ds-1', header: {}, requestContext: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) }
  await h.fire('agent/pre-step', { messages: [{ role: 'user', content: 'hi' }] })
  await h.fire('session/event', session, { type: 'turn/start', data: {} })
  await h.fire('tools/pre-execute', { name: 'Bash', arguments: {} })
  await h.fire('session/event', session, { type: 'tool/call', data: { name: 'Bash', arguments: {} } })
  await h.fire('tools/post-execute', { name: 'Bash' }, { isError: false })
  await h.fire('session/event', session, { type: 'tool/result', data: {} })
  await h.fire('agent/turn-stopping')
  await h.fire('session/event', session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })

  const sessions = await h.until('deepseek-sessions.json', (v) => v?.['ds-1']?.event === 'Stop')
  assert.equal(sessions['ds-1'].client, 'deepseek')
  const extra = await h.until('deepseek@deepseek-state.json', (v) => v?.event === 'Stop')
  assert.equal(extra.client, 'deepseek')
  assert.equal(extra.pose, 'happy')
  // 主文件只看不带 client：连续几次主文件写入本来就不排队（插件原有行为，这里不改），最后落盘的不一定是 Stop
  const main = await h.until('deepseek-state.json', (v) => v !== undefined)
  assert.ok(!('client' in main), JSON.stringify(main))
})

test('按模型换了角色：写 <角色>@deepseek-state.json', async () => {
  const h = harness()
  const session = { id: 'ds-2', header: {}, requestContext: () => ({ provider: 'openrouter', model: 'openai/gpt-5' }) }
  await h.fire('session/event', session, { type: 'turn/start', data: {} })   // 先看到路由，角色换成 gpt
  await h.fire('agent/turn-stopping')
  const extra = await h.until('gpt@deepseek-state.json', (v) => v?.event === 'Stop')
  assert.equal(extra.client, 'deepseek')
  const sessions = await h.until('gpt-sessions.json', (v) => v?.['ds-2'])
  assert.equal(sessions['ds-2'].client, 'deepseek')
})
