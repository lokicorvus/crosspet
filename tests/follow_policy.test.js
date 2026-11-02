const test = require('node:test')
const assert = require('node:assert/strict')
const { eventTarget, eventSkip } = require('../app/web/follow-policy.js')
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

test('浏览器在前台、Claude 和 GPT 同时干活：当前角色还在忙就不来回切', () => {
  let current = 'claude'
  const last = { claude: { pose: 'running', t: 0 }, gpt: { pose: 'running', t: 0 } }
  const switches = []
  // 两边交替来事件，每 0.3～6 秒一条（loki 11-02 日志里的节奏）
  for (const [t, id, pose] of [[0.3, 'gpt', 'drawing'], [0.6, 'claude', 'running'], [6, 'gpt', 'running'], [6.5, 'claude', 'thinking'], [12, 'gpt', 'thinking']]) {
    last[id] = { pose, t }
    const target = eventTarget({ eventId: id, foregroundId: null, followApps: true, followEvents: true, characters,
      currentPose: last[current].pose, currentAge: t - last[current].t })
    if (target && target !== current) { current = target; switches.push(target) }
  }
  assert.deepEqual(switches, [])
})

test('当前角色做完了（happy）或 20 秒没动静，别的 AI 的事件可以接手', () => {
  const base = { eventId: 'gpt', foregroundId: null, followApps: true, followEvents: true, characters }
  for (const pose of ['idle', 'sleeping', 'happy', 'proud', 'bye']) {
    assert.equal(eventTarget({ ...base, currentPose: pose, currentAge: 1 }), 'gpt', pose)
  }
  assert.equal(eventTarget({ ...base, currentPose: 'running', currentAge: 20 }), 'gpt')
  assert.equal(eventTarget({ ...base, currentPose: 'running', currentAge: 19.9 }), null)
  assert.equal(eventTarget({ ...base, currentPose: null, currentAge: null }), 'gpt')   // 还没收到过她的状态
})

test('跳过原因分得清：前台 AI 优先 / 当前角色在忙 / 关了跟随', () => {
  const base = { eventId: 'gpt', followApps: true, followEvents: true, characters }
  assert.equal(eventSkip({ ...base, foregroundId: 'claude' }), 'front-ai')
  assert.equal(eventSkip({ ...base, foregroundId: null, currentPose: 'running', currentAge: 3 }), 'current-busy')
  assert.equal(eventSkip({ ...base, followEvents: false }), 'off')
  assert.equal(eventSkip({ ...base, foregroundId: null }), null)
})
