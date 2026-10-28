// DeepSeek Harness 插件什么时候查余额：node --test tests/deepseek_plugin_poll.test.mjs
// 用假的 Harness（只记事件处理函数）和假的余额接口，数插件发了几次余额请求
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'

async function run(config) {
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] }) } }
  const handlers = {}, effects = []
  const ctx = { on(n, f) { (handlers[n] ||= []).push(f) }, inject() { throw new Error('none') }, effect(f) { effects.push(f) }, logger: { warn() {} },
    credentials: { resolve: async () => ({ value: 'sk-test' }) } }
  const tmp = mkdtempSync(join(tmpdir(), 'crosspet-dsh-'))
  apply(ctx, { stateDir: tmp, dataDir: tmp, autostart: false, ...config })   // dataDir：事件记录也写进临时目录，别写到真实的数据目录
  const stops = effects.map((f) => f())
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const fire = async (n, ...a) => { for (const h of handlers[n] || []) await h(...a, async () => {}); await wait(50) }
  await wait(50); const counts = [calls]
  await fire('agent/pre-step', { messages: [{ role: 'user', content: 'hi' }] }); counts.push(calls)
  await fire('agent/turn-stopping'); counts.push(calls)
  stops.forEach((s) => typeof s === 'function' && s())
  return counts
}

test('启动时查一次，发消息、一轮结束时各查一次（充值后一说话就更新）', async () => {
  assert.deepEqual(await run({ balanceGapMs: 0 }), [1, 2, 3])
})

test('30 秒内查过就不再查（连着对话时不会问得太勤）', async () => {
  assert.deepEqual(await run({}), [1, 1, 1])
})

// #29（@mkinnqijn）：定时查余额的间隔可配，0 = 不定时查（只在启动、发消息、一轮结束时查）
async function timed(config, ms) {
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] }) } }
  const effects = []
  const ctx = { on() {}, inject() { throw new Error('none') }, effect(f) { effects.push(f) }, logger: { warn() {} },
    credentials: { resolve: async () => ({ value: 'sk-test' }) } }
  const tmp = mkdtempSync(join(tmpdir(), 'crosspet-dsh-'))
  apply(ctx, { stateDir: tmp, dataDir: tmp, autostart: false, ...config })   // dataDir：事件记录也写进临时目录，别写到真实的数据目录
  const stops = effects.map((f) => f())
  await new Promise((r) => setTimeout(r, ms))
  stops.forEach((s) => typeof s === 'function' && s())
  return calls
}

test('balanceIntervalMs 可以调定时查余额的间隔', async () => {
  assert.ok(await timed({ balanceIntervalMs: 40 }, 150) >= 3)
})

// 记下插件设了哪些定时器（间隔），不真的等
async function intervals(config) {
  const real = globalThis.setInterval, seen = []
  globalThis.setInterval = (f, ms) => { seen.push(ms); return real(f, 1e9) }
  try { return { calls: await timed(config, 30), seen } } finally { globalThis.setInterval = real }
}

test('balanceIntervalMs 为 0 时不定时查，只在启动时查一次', async () => {
  assert.deepEqual(await intervals({ balanceIntervalMs: 0 }), { calls: 1, seen: [] })
})

test('不写 balanceIntervalMs（或写错）时还是每分钟查（老用户不变）', async () => {
  assert.deepEqual((await intervals({})).seen, [60000])
  assert.deepEqual((await intervals({ balanceIntervalMs: '5' })).seen, [60000])
  assert.deepEqual((await intervals({ balanceIntervalMs: -1 })).seen, [60000])
})
