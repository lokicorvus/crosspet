// 反馈规则（网页层 app/web/feedback-plan.js）：每类附哪些段、日志怎么筛、记录怎么排、超长怎么缩。
// 设计见 docs/superpowers/specs/2026-10-21-feedback-redesign-design.md：node --test tests/feedback_plan.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const P = require('../app/web/feedback-plan.js')

// 接入诊断的真实格式（取自用户反馈，路径已改成示例）
const DIAG = [
  '接入工具：Python 3.9.6（/usr/bin/python3），数据目录 ~/Library/Application Support/CrossPet，状态目录 /tmp/crosspet',
  '已接入：codex；想一直接着：无',
  '[Claude] 配置目录 ~/.claude（不在），环境变量 无',
  '  settings.json：~/.claude/settings.json（不存在）；标准钩子 无',
  '[Codex] hooks.json：~/.codex/hooks.json（2618 字节，有 CrossPet 条目）',
  '  codex 程序：/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex（codex-cli 0.163.0）',
  '  最近消息：24 分钟前',
  '[DeepSeek Harness] profile ~/.dsh/profiles/desktop（在）',
  '[Antigravity] ~/.gemini/config/hooks.json（不存在）；最近消息 没有记录',
  '  WorkBuddy 最近消息 没有记录；环境变量 无',
  '[ZCode] ~/.zcode/cli/config.json（不存在）',
  '[状态] gpt=happy/Stop（10 小时前）',
].join('\n')

const facts = (sections = {}) => ({
  header: { version: '1.3.8-beta.2', platform: 'mac', os: 'macOS 26.7 arm64', install: 'abcdef1234567890', character: 'gpt', skin: '', uptimeMin: 104 },
  integrations: ['codex', 'deepseek'], characters: [{ id: 'gpt', name: 'GPT' }, { id: 'deepseek', name: 'DeepSeek' }], quotas: ['gpt'],
  sections,
})

test('九个类型，文案和顺序照设计', () => {
  assert.deepEqual(P.KINDS.map(k => k.id), ['gone', 'action', 'character', 'quota', 'display', 'update', 'perf', 'idea', 'other'])
  assert.equal(P.KINDS.find(k => k.id === 'action').label, 'AI 干活时她没反应')
  assert.equal(P.KINDS.find(k => k.id === 'idea').askStill, false)
  assert.equal(P.KINDS.find(k => k.id === 'gone').askStill, true)
})

test('每类附的段：AI 没反应附这一家的记录，不附更新日志和角色表；更新失败才附更新日志；建议什么都不附', () => {
  const a = P.sectionsFor('action', 'codex')
  for (const id of ['events:codex', 'petEvents', 'state:gpt|gpt', 'diag', 'seen', 'page']) assert.ok(a.includes(id), id)
  for (const id of ['updateLog', 'characters']) assert.ok(!a.includes(id), id)
  assert.ok(P.sectionsFor('update').includes('updateLog'))
  assert.ok(!P.sectionsFor('gone').includes('updateLog'))
  assert.deepEqual(P.sectionsFor('idea'), [])
  assert.ok(P.sectionsFor('action', 'codex-desktop').includes('events:codex'))
  assert.ok(P.sectionsFor('character', 'missing').includes('characters'))
  assert.ok(P.sectionsFor('quota', 'gemini').includes('quota:gemini'))
})

test('「不确定」附所有已接入的事件记录', () => {
  const s = P.sectionsFor('action', 'unsure', facts())
  assert.ok(s.includes('events:codex') && s.includes('events:deepseek'))
})

test('第二步的选项：ChatGPT 桌面版紧跟 Codex，最后是不确定', () => {
  assert.deepEqual(P.followOptions('action', facts()).map(o => o.id), ['codex', 'codex-desktop', 'deepseek', 'unsure'])
  assert.equal(P.followOptions('action', facts())[1].label, 'ChatGPT 桌面版')
  assert.deepEqual(P.followOptions('character', facts()).map(o => o.id), ['gpt', 'deepseek', 'missing'])
  assert.deepEqual(P.followOptions('quota', facts()).map(o => o.id), ['gpt'])
  assert.deepEqual(P.followOptions('gone', facts()), [])
})

test('接入诊断只切出这一家', () => {
  const c = P.sliceDiag(DIAG, 'codex')
  assert.match(c, /\[Codex\]/)
  assert.match(c, /最近消息：24 分钟前/)
  assert.doesNotMatch(c, /\[Claude\]|\[DeepSeek Harness\]/)
  assert.match(P.sliceDiag(DIAG, 'claude-mod'), /\[Claude\]/)
  assert.match(P.sliceDiag(DIAG, 'workbuddy'), /^\s*WorkBuddy 最近消息/)
  assert.equal(P.sliceDiag(DIAG, 'hermes'), '')
})

test('日志按类型筛行，最多 60 行', () => {
  const log = ['10:00 全屏中，先藏起来', '10:01 GPT 额度：本周已用 3%', '10:02 换角色 gpt', ...Array.from({ length: 100 }, (_, i) => `10:03 置顶 ${i}`)].join('\n')
  const gone = P.filterLog(log, 'gone').split('\n')
  assert.ok(gone.length <= 60)
  assert.ok(!gone.some(l => l.includes('额度')))
  assert.match(P.filterLog(log, 'quota'), /额度/)
  assert.doesNotMatch(P.filterLog(log, 'quota'), /置顶/)
})

test('记录排成一行一条；没有记录时说明可能的原因', () => {
  const jsonl = JSON.stringify({ t: 1792571450.12, ev: 'PreToolUse', tool: 'bash', sid: 'a1b2c3', turn: true, result: 'dropped', detail: 'codex-suggestion' }) + '\n'
  const out = P.formatLedger(jsonl, 10)
  assert.match(out, /PreToolUse bash → dropped codex-suggestion/)
  assert.match(out, /a1b2c3/)
  assert.match(P.formatLedger('', 10), /插件版本早于 1\.3\.8，或从没收到消息/)
  const many = Array.from({ length: 50 }, (_, i) => JSON.stringify({ t: 1792571450 + i, ev: 'E' + i, tool: '', sid: '', turn: false, result: 'shown', detail: 'gpt idle' })).join('\n')
  const lines = P.formatLedger(many, 10).split('\n')
  assert.equal(lines.length, 10)
  assert.match(lines.at(-1), /E49/)
})

test('卡片不超过 19000 字节，开头和用户的话完整', () => {
  const big = Array.from({ length: 3000 }, (_, i) => `2026-10-21 10:00:00 全屏中，先藏起来 第 ${i} 行`).join('\n')
  const text = '她突然不见了，托盘还在'.repeat(5)
  const card = P.buildCard({ kind: 'gone', target: '', still: 'now', text, attach: true, facts: facts({ log: big, window: '窗口 1,2 260×362' }) })
  const body = JSON.stringify(card)
  assert.ok(Buffer.byteLength(body) <= 19000, String(Buffer.byteLength(body)))
  assert.ok(body.includes(text))
  assert.ok(body.includes('1.3.8-beta.2'))
  assert.ok(body.includes('窗口 1,2 260×362'))
})

test('不勾「附上排查信息」：只发版本、平台、三项选择和用户的话', () => {
  const card = P.buildCard({ kind: 'action', target: 'codex', still: 'now', text: '没反应', attach: false, facts: facts({ diag: DIAG }) })
  const body = JSON.stringify(card)
  assert.ok(body.includes('1.3.8-beta.2') && body.includes('没反应') && body.includes('还在'))
  for (const s of ['macOS 26.7', 'abcdef12', '104', 'Codex]']) assert.ok(!body.includes(s), s)
})

test('卡片标题写类型和补选；「AI 没反应」带上那一家的事件记录', () => {
  const ev = JSON.stringify({ t: 1792571450, ev: 'Stop', tool: '', sid: '', turn: true, result: 'shown', detail: 'gpt happy' })
  const card = P.buildCard({ kind: 'action', target: 'codex-desktop', still: 'earlier', text: 'Work 模式不动', attach: true,
    facts: facts({ 'events:codex': ev, diag: DIAG }) })
  assert.match(card.card.header.title.content, /AI 干活时她没反应 · ChatGPT 桌面版/)
  const body = JSON.stringify(card)
  assert.ok(body.includes('Stop  → shown gpt happy') || body.includes('Stop → shown gpt happy'), body.slice(0, 2000))
  assert.ok(body.includes('更早'))
})

// ---- 审查修复 ----
test('诊断特别长也不超过 19000 字节（飞书会拒收，用户发不出去）', () => {
  const diag = '[Codex] ' + '很长的诊断内容'.repeat(3000)
  const card = P.buildCard({ kind: 'action', target: 'codex', still: 'now', text: '没反应', attach: true, facts: facts({ diag, page: 'x'.repeat(30000) }) })
  assert.ok(Buffer.byteLength(JSON.stringify(card)) <= 19000)
  assert.ok(JSON.stringify(card).includes('没反应'))
})

test('WorkBuddy 的诊断：带方括号的那几行也切出来', () => {
  const d = DIAG + '\n[WorkBuddy] 钩子 已装\n  最近消息 3 分钟前\n[ZCode] x'
  const w = P.sliceDiag(d, 'workbuddy')
  assert.match(w, /\[WorkBuddy\] 钩子 已装/)
  assert.match(w, /最近消息 3 分钟前/)
  assert.doesNotMatch(w, /\[ZCode\]/)
})

test('多模型宿主的状态段：状态按角色、轮次和换模型记录按宿主名', () => {
  assert.ok(P.sectionsFor('action', 'workbuddy').includes('state:current|workbuddy'))
  assert.ok(P.sectionsFor('action', 'codex').includes('state:gpt|gpt'))
  assert.ok(P.sectionsFor('action', 'zcode').includes('state:glm|zcode'))
  assert.ok(P.sectionsFor('action', 'claude-hooks').includes('state:claude|claude'))
})

test('没有记录时分清：收到过消息却没记录 / 从没收到 / 桌宠自己没记录', () => {
  const card = s => JSON.stringify(P.buildCard({ kind: 'action', target: 'codex', still: 'now', text: 'x', attach: true, facts: facts(s) }))
  assert.match(card({ 'events:codex': '', seen: JSON.stringify({ codex: Date.now() / 1000 - 60 }) }), /收到过消息却没有记录/)
  assert.match(card({ 'events:codex': '', seen: JSON.stringify({ codex: 0 }) }), /从没收到/)
  assert.doesNotMatch(card({ petEvents: '' }), /插件版本/)
})

test('排查信息没收齐就发了：卡片里写明，不是静默发空卡', () => {
  const body = JSON.stringify(P.buildCard({ kind: 'action', target: 'codex', still: 'now', text: 'x', attach: true, partial: true, facts: facts({}) }))
  assert.match(body, /排查信息没来得及收齐/)
  assert.doesNotMatch(JSON.stringify(P.buildCard({ kind: 'action', target: 'codex', still: 'now', text: 'x', attach: true, facts: facts({}) })), /没来得及收齐/)
})

test('「其他」是说不清哪类时用的：每类都带一点，已接入的 AI 各附 10 条事件记录', () => {
  const s = P.sectionsFor('other', '', facts())
  for (const id of ['window', 'displays', 'front', 'hidden', 'page', 'settings', 'seen', 'events:codex', 'events:deepseek', 'petEvents', 'switches', 'install', 'log'])
    assert.ok(s.includes(id), id)
  const many = Array.from({ length: 50 }, (_, i) => JSON.stringify({ t: 1792571450 + i, ev: 'E' + i, tool: '', sid: '', turn: false, result: 'shown', detail: 'gpt idle' })).join('\n')
  const body = JSON.stringify(P.buildCard({ kind: 'other', target: '', still: 'now', text: 'x', attach: true, facts: facts({ 'events:codex': many, seen: '{}' }) }))
  assert.ok(body.includes('E49') && !body.includes('E39 '), '每家只附最近 10 条')
})
