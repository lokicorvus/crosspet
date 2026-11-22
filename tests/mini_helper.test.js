// 迷你小帮手：主桌宠的姿态 → 小帮手在干嘛（app/web/mini-helper.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../app/web/mini-helper.js')

test('mood_of：思考、干活、等你、睡觉、出错各有各的；贴边藏起来；没列出的是待机', () => {
  assert.equal(M.moodOf('thinking'), 'think')
  assert.equal(M.moodOf('deepthink'), 'think')
  for (const p of ['writing', 'searching', 'busy_left', 'busy_right', 'swamped_left', 'compact', 'delegating']) assert.equal(M.moodOf(p), 'busy', p)
  assert.equal(M.moodOf('asking'), 'asking')
  assert.equal(M.moodOf('reading'), 'read')
  assert.equal(M.moodOf('sleeping'), 'sleep')
  assert.equal(M.moodOf('oops'), 'worried')
  assert.equal(M.moodOf('greet_morning'), 'wave')
  assert.equal(M.moodOf('fest_spring'), 'happy')
  for (const p of ['edge_left', 'edge_right_peek']) assert.equal(M.moodOf(p), 'hidden', p)
  for (const p of ['idle', 'tired', 'listening', 'pat', 'pop', undefined, null]) assert.equal(M.moodOf(p), 'idle', String(p))
})

test('frames：和 tools/mini_sheet.py 的格子顺序一样', () => {
  const py = require('fs').readFileSync(require('path').join(__dirname, '../tools/mini_sheet.py'), 'utf8')
  const list = JSON.parse(py.match(/FRAMES = (\[[\s\S]*?\])/)[1].replace(/'/g, '"'))
  assert.deepEqual(list, M.FRAMES)
})

// ---- crew：该显示哪几个 ----
const manifest = { characters: {
  claude: { poses: { idle: ['file:///x/characters/claude/idle.webp'], mini: ['file:///x/characters/claude/mini.webp'] } },
  deepseek: { poses: { idle: ['file:///x/characters/deepseek-pajamas/idle.webp'], mini: ['file:///x/characters/deepseek-pajamas/mini.webp'] }, skin: 'deepseek-pajamas' },
  gpt: { skin: 'gpt-onesie', poses: { idle: ['https://crosspet.data/characters/gpt-onesie/idle.webp'] } },
  gemini: { poses: { idle: ['…/gemini/idle.webp'], mini: ['…/gemini/mini.webp'] } },
  'egg-claude': { egg: true, poses: { mini: ['…'] } },
} }
const lv = p => (p >= 150 ? 2 : p >= 15 ? 1 : 0)
const S = (pts) => ({ points: pts, shown: 2 })   // 升到好朋友那段对话已经演过（老的一对都是这样）

test('crew_self_first_then_good_friends_by_points', () => {
  const store = { 'claude+deepseek': S(200), 'claude+gemini': S(400), 'claude+gpt': S(20) }
  const c = M.crew('claude', { store, manifest, today: '2026-11-20', levelOf: lv })
  assert.deepEqual(c.map(x => x.id), ['claude', 'gemini', 'deepseek'])   // gpt 只「认识了」不算
  assert.equal(c[2].sheet, 'file:///x/characters/deepseek-pajamas/mini.webp')   // 穿着睡衣就是睡衣那套
  assert.deepEqual(c.map(x => x.move), ['run', 'pounce', 'run'])   // deepseek 跑步（游泳试过不用了）
})
test('crew_falls_back_to_base_sheet_when_skin_has_none', () => {
  const c = M.crew('claude', { store: { 'claude+gpt': S(200) }, manifest, today: '2026-11-20', levelOf: lv })
  assert.equal(c[1].sheet, 'https://crosspet.data/characters/gpt/mini.webp')
  assert.equal(c[1].move, 'fly')
})
test('crew_skips_unknown_and_egg_characters', () => {
  const store = { 'claude+my-own': S(500), 'claude+egg-claude': S(500) }
  assert.deepEqual(M.crew('claude', { store, manifest, today: '2026-11-20', levelOf: lv }).map(x => x.id), ['claude'])
})
test('crew_without_own_sheet_still_shows_friends', () => {
  const m = { characters: { ...manifest.characters, kimi: { poses: { idle: ['…/kimi/idle.webp'] } } } }
  // kimi 没有 mini 也没有皮肤：自己那格没有，好友照常
  assert.deepEqual(M.crew('kimi', { store: { 'gemini+kimi': S(200) }, manifest: m, today: '2026-11-20', levelOf: lv }).map(x => x.id), ['gemini'])
})
test('crew_caps_at_six_and_rotates_daily', () => {
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']
  const m = { characters: { claude: manifest.characters.claude } }
  for (const id of ids) m.characters[id] = { poses: { mini: [`…/${id}/mini.webp`] } }
  const store = Object.fromEntries(ids.map((id, i) => [`${id}+claude`, S(200 + i)]))   // pairKey 按字母序
  const day1 = M.crew('claude', { store, manifest: m, today: '2026-11-20', levelOf: lv })
  assert.equal(day1.length, 6); assert.equal(day1[0].id, 'claude')
  assert.deepEqual(M.crew('claude', { store, manifest: m, today: '2026-11-20', levelOf: lv }), day1)   // 同一天不变
  const week = new Set(['21', '22', '23', '24', '25', '26', '27', '28', '29', '30'].flatMap(d => M.crew('claude', { store, manifest: m, today: `2026-11-${d}`, levelOf: lv }).map(x => x.id)))
  assert.equal(week.size, 8)   // 十天下来 7 个好友都轮到过（种子固定，结果是确定的）
})
// 刚升到好朋友、升级那段对话还没演（shown < 2、没 giftShown）：小帮手先不出来，等送礼那一幕
test('crew_waits_for_level_up_chat_before_showing_friend', () => {
  const at = rec => M.crew('claude', { store: { 'claude+gemini': rec }, manifest, today: '2026-11-20', levelOf: lv }).map(x => x.id)
  assert.deepEqual(at({ points: 200, shown: 1 }), ['claude'])
  assert.deepEqual(at({ points: 200 }), ['claude'])
  assert.deepEqual(at({ points: 200, shown: 2 }), ['claude', 'gemini'])   // 升级那句演过了（看不见时压着的送礼也是 shown = 2）
  assert.deepEqual(at({ points: 200, shown: 1, giftShown: true }), ['claude', 'gemini'])
})
test('move_of', () => {
  assert.equal(M.moveOf('gpt'), 'fly'); assert.equal(M.moveOf('deepseek'), 'run')
  assert.equal(M.moveOf('gemini'), 'pounce'); assert.equal(M.moveOf('glm'), 'pounce'); assert.equal(M.moveOf('kimi'), 'run')
})
// 连体衣的翅膀只是衣服上的装饰（loki 定的）：穿着它、用它自己那套图时跑着走，不飞
test('onesie_runs_instead_of_flying', () => {
  const onesie = { skin: 'gpt-onesie', poses: { idle: ['…/gpt-onesie/idle.webp'], mini: ['…/gpt-onesie/mini.webp'] } }
  assert.equal(M.moveOf('gpt', onesie), 'run')
  const m = { characters: { ...manifest.characters, gpt: onesie } }
  assert.equal(M.crew('claude', { store: { 'claude+gpt': S(200) }, manifest: m, today: '2026-11-20', levelOf: lv })[1].move, 'run')
  assert.equal(M.moveOf('gpt', { skin: 'gpt-other', poses: { mini: ['…/gpt-other/mini.webp'] } }), 'fly')   // 别的皮肤照原版
})

// ---- 一组：站位、干活分工 ----
test('spots_stay_inside_canvas_and_apart', () => {
  for (let n = 1; n <= 6; n++) {
    const s = M.spotsFor(n)
    assert.equal(s.length, n)
    for (const p of s) assert.ok(Math.abs(p.x) <= 104, `n=${n} x=${p.x}`)
    assert.deepEqual(s[0], M.spotsFor(1)[0])   // 第一个（她自己）的位置不随人数变
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)   // 不叠成一团：左右至少差 16，或者前后至少差 10
      assert.ok(Math.abs(s[i].x - s[j].x) >= 16 || Math.abs(s[i].y - s[j].y) >= 10, `n=${n} ${i}/${j}`)
  }
})
test('busy_roles_at_most_three_laps_and_everyone_busy', () => {
  for (let n = 1; n <= 6; n++) for (let seed = 0; seed < 20; seed++) {
    const r = M.busyRoles(n, seed)
    assert.equal(r.length, n)
    assert.ok(r.filter(x => x === 'lap').length <= 3)
    assert.ok(r.filter(x => x === 'lap').length >= Math.min(n, 1))
    for (const x of r) assert.ok(['lap', 'read', 'notes', 'think'].includes(x))
  }
})
