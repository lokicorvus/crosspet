const test = require('node:test')
const assert = require('node:assert/strict')
const N = require('../app/web/notebook.js')
const B = require('../app/web/notebook-backfill.js')

const at = (m, d, h, min = 0, sec = 0) => new Date(2026, m - 1, d, h, min, sec).getTime()
const S = 1000

test('characterForModel：和钩子的对照表一样', () => {
  const cases = { 'claude-opus-5-5': 'claude', 'deepseek-chat': 'deepseek', 'glm-4.6': 'glm', 'coder-model': 'qwen',
    'x-ai/grok-4.7': 'grok', 'gemini-3-pro': 'gemini', 'gpt-6.1-sol': 'gpt', 'kimi-k2': 'kimi', 'o3-mini': 'gpt',
    'Qwen3-Coder': 'qwen', '<synthetic>': null, '': null }
  for (const [m, ch] of Object.entries(cases)) assert.equal(B.characterForModel(m), ch, m)
  assert.equal(B.characterForModel(undefined), null)
})

const T0 = at(11, 1, 10)
const claude = events => [{ source: 'claude-code', events }]

test('Claude：一轮从你发的那句到她最后一句回复', () => {
  const r = B.roundsOf(claude([
    { t: T0, k: 'p' }, { t: T0 + 10 * S, k: 'a', m: 'claude-x' }, { t: T0 + 40 * S, k: 'a', m: 'claude-x' },
    { t: T0 + 100 * S, k: 'p' }, { t: T0 + 130 * S, k: 'a', m: 'claude-x' },
  ]))
  assert.deepEqual(r, [{ ch: 'claude', start: T0, end: T0 + 40 * S }, { ch: 'claude', start: T0 + 100 * S, end: T0 + 130 * S }])
})

test('Claude：事件顺序乱也按时间排', () => {
  const r = B.roundsOf(claude([{ t: T0 + 10 * S, k: 'a', m: 'claude-x' }, { t: T0, k: 'p' }]))
  assert.deepEqual(r, [{ ch: 'claude', start: T0, end: T0 + 10 * S }])
})

test('Claude：发了没回的不算一轮；开头没有提问的回复也不算', () => {
  const r = B.roundsOf(claude([{ t: T0 - 5 * S, k: 'a', m: 'claude-x' }, { t: T0, k: 'p' }, { t: T0 + 5 * S, k: 'p' }, { t: T0 + 9 * S, k: 'a', m: 'claude-x' }, { t: T0 + 20 * S, k: 'p' }]))
  assert.deepEqual(r, [{ ch: 'claude', start: T0 + 5 * S, end: T0 + 9 * S }])
})

test('Claude：一轮的角色按最后一句回复的模型算（中途换成 DeepSeek）', () => {
  const r = B.roundsOf(claude([{ t: T0, k: 'p' }, { t: T0 + S, k: 'a', m: 'claude-x' }, { t: T0 + 2 * S, k: 'a', m: 'deepseek-chat' }]))
  assert.equal(r[0].ch, 'deepseek')
})

test('Codex：一整轮直接给；没有模型名、认不出的模型都算 GPT（同钩子）', () => {
  const r = B.roundsOf([{ source: 'codex', events: [
    { t: T0, k: 'r', m: '', end: T0 + 60 * S }, { t: T0 + 100 * S, k: 'r', m: 'my-local', end: T0 + 120 * S },
    { t: T0 + 200 * S, k: 'r', m: 'deepseek-v4', end: T0 + 210 * S },
  ] }])
  assert.deepEqual(r.map(x => x.ch), ['gpt', 'gpt', 'deepseek'])
  assert.equal(r[0].end, T0 + 60 * S)
})

test('Claude Code 里认不出的模型算 Claude（同钩子）', () => {
  const r = B.roundsOf(claude([{ t: T0, k: 'p' }, { t: T0 + S, k: 'a', m: 'local-llama' }]))
  assert.equal(r[0].ch, 'claude')
})

test('对应的角色没装：算给那个程序默认的角色（同钩子）', () => {
  const r = B.roundsOf(claude([{ t: T0, k: 'p' }, { t: T0 + S, k: 'a', m: 'kimi-k2' }]), ['claude', 'gpt'])
  assert.equal(r[0].ch, 'claude')
})

test('不认识的来源跳过', () => {
  assert.deepEqual(B.roundsOf([{ source: 'other', events: [{ t: T0, k: 'r', m: 'gpt-5', end: T0 + S }] }]), [])
})

const payload = files => ({ installedAt: at(10, 5, 0), files })

test('补算：装 CrossPet 之前的轮单独记 before', () => {
  const s = B.apply(N.empty(at(11, 2, 0)), payload(claude([
    { t: at(10, 1, 10), k: 'p' }, { t: at(10, 1, 10, 5), k: 'a', m: 'claude-x' },
    { t: at(10, 6, 10), k: 'p' }, { t: at(10, 6, 10, 5), k: 'a', m: 'claude-x' },
  ])))
  assert.equal(s.chars.claude.before, 1)
  assert.equal(s.chars.claude.rounds, 1)
})

test('补算：新版开始记之后（liveSince 起）的轮不算，免得和实时记的重复', () => {
  const s = B.apply(N.empty(at(10, 6, 12)), payload(claude([
    { t: at(10, 6, 10), k: 'p' }, { t: at(10, 6, 10, 5), k: 'a', m: 'claude-x' },
    { t: at(10, 6, 12, 1), k: 'p' }, { t: at(10, 6, 12, 5), k: 'a', m: 'claude-x' },
  ])))
  assert.equal(s.chars.claude.rounds, 1)
})

test('补算：记下安装日、标上已补算；再补一次原样返回', () => {
  const s = B.apply(N.empty(at(11, 2, 0)), payload([]))
  assert.equal(s.installedAt, at(10, 5, 0))
  assert.equal(s.backfilled, true)
  assert.equal(B.apply(s, payload(claude([{ t: at(10, 6, 10), k: 'p' }, { t: at(10, 6, 11), k: 'a', m: 'claude-x' }]))), s)
})

test('补算：小成就用当时的日期', () => {
  const s = B.apply(N.empty(at(11, 2, 0)), payload(claude([{ t: at(10, 6, 10), k: 'p' }, { t: at(10, 6, 11), k: 'a', m: 'claude-x' }])))
  assert.equal(s.chars.claude.milestones.round1, '2026-10-06')
})

test('补算：坏的输入不崩（files 不是数组、事件缺字段）', () => {
  const s0 = N.empty(at(11, 2, 0))
  assert.equal(B.apply(s0, { installedAt: at(10, 5, 0), files: null }).backfilled, true)
  const s = B.apply(s0, payload([{ source: 'claude-code', events: [null, { k: 'p' }, { t: 'x', k: 'a' }, { t: at(10, 6, 10), k: 'p' }, { t: at(10, 6, 11), k: 'a', m: 'claude-x' }] }]))
  assert.equal(s.chars.claude.rounds, 1)
})
