// DeepSeek Harness 插件按模型选角色：node --test tests/deepseek_character_for.test.mjs
// 每条会话事件看一眼请求路由，把对应角色写进 <状态目录>/deepseek-host.json；桌宠切到 Harness 窗口时按它换角色
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'

async function hostCharacterFor(provider, model, config = {}) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ is_available: false, balance_infos: [] }) })
  const stateDir = mkdtempSync(join(tmpdir(), 'crosspet-dsh-char-'))
  const handlers = {}, effects = []
  const ctx = { on(n, f) { (handlers[n] ||= []).push(f) }, inject() { throw new Error('none') }, effect(f) { effects.push(f) },
    logger: { warn() {} }, credentials: { resolve: async () => ({ value: 'sk-test' }) } }
  apply(ctx, { stateDir, dataDir: stateDir, autostart: false, ...config })   // dataDir：事件记录也写进临时目录，别写到真实的数据目录
  for (const h of handlers['session/event'] || []) h({ requestContext: () => ({ provider, model }) }, {})
  await new Promise((r) => setTimeout(r, 50))
  effects.map((f) => f()).forEach((s) => typeof s === 'function' && s())
  return JSON.parse(readFileSync(join(stateDir, 'deepseek-host.json'), 'utf8')).character
}

test('千问：模型名或服务商名认出来都换成 qwen', async () => {
  for (const [provider, model] of [['', 'qwen3.8-max'], ['', 'Qwen3-Coder'], ['dashscope', 'qwen-plus'], ['bailian', 'qwen-max'], ['tongyi', 'qwen-turbo']]) {
    assert.equal(await hostCharacterFor(provider, model), 'qwen', `${provider}/${model}`)
  }
})
test('别家的模型照旧映射，不受千问那条影响', async () => {
  assert.equal(await hostCharacterFor('deepseek', 'deepseek-chat'), 'deepseek')
  assert.equal(await hostCharacterFor('zhipu', 'glm-4.6'), 'glm')
  assert.equal(await hostCharacterFor('anthropic', 'claude-sonnet-4'), 'claude')
  assert.equal(await hostCharacterFor('', 'gpt-5'), 'gpt')
})
test('Grok：模型名或服务商名（xai / x-ai）认出来换成 grok', async () => {
  for (const [provider, model] of [['', 'grok-4.7'], ['openrouter', 'x-ai/grok-code-fast-2'], ['xai', 'grok-4-fast']]) {
    assert.equal(await hostCharacterFor(provider, model), 'grok', `${provider}/${model}`)
  }
})
test('认不出的还是由 DeepSeek 自己来演', async () => {
  assert.equal(await hostCharacterFor('some-gateway', 'mystery-model-1'), 'deepseek')
})
test('配置里的 characters 覆盖优先于内置判断', async () => {
  assert.equal(await hostCharacterFor('dashscope', 'qwen3.8-max', { characters: { dashscope: 'gpt' } }), 'gpt')
})
