const test = require('node:test')
const assert = require('node:assert/strict')
const { eventTarget } = require('../app/web/follow-policy.js')
const characters = ['gpt', 'deepseek', 'claude']
const decide = args => eventTarget({ eventId: 'deepseek', foregroundId: 'gpt', followApps: true, followEvents: true, characters, ...args })

test('Codex 在前台，WorkBuddy 连续事件和前台复查不应让角色来回切换', () => {
  let current = 'gpt'
  const switches = []
  for (let i = 0; i < 5; i++) {
    const target = decide({})
    if (target && target !== current) { current = target; switches.push(target) }
    // Windows 在宿主模型记录更新时重新检查仍在前台的 Codex。
    if (current !== 'gpt') { current = 'gpt'; switches.push(current) }
  }
  assert.deepEqual(switches, [])
})

test('反向也一样：WorkBuddy 的 DeepSeek 在前台时，后台 GPT 不抢角色', () => {
  assert.equal(decide({ foregroundId: 'deepseek', eventId: 'gpt' }), null)
})

test('终端或普通程序在前台，仍按事件换角色', () => {
  for (const foregroundId of [null, '', 'terminal', 'workbuddy']) {
    assert.equal(decide({ foregroundId }), 'deepseek')
  }
})

test('关闭跟随前台后，已识别的 AI 在前台也允许跟随事件', () => {
  assert.equal(decide({ followApps: false }), 'deepseek')
})

test('关闭跟随事件、current 通道及未知角色不会自动切换', () => {
  assert.equal(decide({ followEvents: false }), null)
  for (const eventId of [null, '', 'current', 'unknown']) assert.equal(decide({ eventId }), null)
})
