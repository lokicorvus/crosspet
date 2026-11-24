// 迷你小帮手接进桌宠页面：谁出来（好感度到好朋友的）、开关、每分钟重算、贴边 / 彩蛋收起、送礼那一幕。
// 跑的是 app/web/index.html 里整段真实脚本（加上 mini-helper.js 等辅助脚本），DOM 和时钟是假的；不开窗口、不联网。
//   node tests/mini_page_test.cjs
'use strict'
const { makePage, START, WEB } = require('./page_harness.cjs')
const path = require('path')

const POSES = ['idle', 'thinking', 'listening', 'reading', 'writing', 'happy', 'oops', 'surprised', 'pat', 'sleeping',
  'edge_left', 'edge_right', 'friend_up', 'mini']
const frames = id => Object.fromEntries(POSES.map(p => [p, [p === 'mini' ? `/characters/${id}/mini.webp` : `/characters/${id}/${p}.webp`]]))
const EXTRA = ['ava', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus']   // 跨午夜轮换用：好友超过 5 个
function manifest() {
  const ids = ['claude', 'gemini', ...EXTRA]
  return { characters: Object.fromEntries(ids.map(id => [id, { name: id, greeting: id + ' hello', lines: {}, poses: frames(id) }])) }
}
const FRIEND_KEY = 'crosspet-friendship'
async function fresh(store, startMs = START) {
  const e = makePage(startMs)
  e.run(`
    // 页面里的小帮手：#figure（只装她身子和小帮手的那层）下的 .mini，带上她用的图和 class
    function __minis() {
      const spr = el => el.classList.contains('spr') ? el : el.children.map(spr).find(Boolean)
      return $('figure').children.filter(c => c.classList.contains('mini')).map(c => {
        const s = spr(c), img = (s && s.style.backgroundImage) || ''
        return { id: (img.match(/characters\\/([^/]+)\\/mini/) || [])[1] || '', cls: c.className, spr: s ? s.className : '' }
      })
    }`)
  if (store) e.run(`localStorage.setItem('${FRIEND_KEY}', ${JSON.stringify(JSON.stringify(store))})`)
  e.run(`init(${JSON.stringify(manifest())})`)
  await e.advance(1000)
  e.run(`setCharacter('claude')`)
  await e.advance(1000)
  return e
}
const minis = e => e.run('__minis()')
const ids = e => minis(e).map(m => m.id).sort().join(',')
const store = e => JSON.parse(e.run(`localStorage.getItem('${FRIEND_KEY}')`) || '{}')
function assert(c, msg) { if (!c) throw Error(msg) }
// 主桌宠 claude + 额外那只 gemini 都在：手搭 companionsState（companionsReadyAt 推到无穷远，updateCompanions 不再重算，免得没有会话把她算走）
function withGemini(e) {
  e.run(`setMultiPets({ on: true, rest: 'auto', mainPet: '' }); companionsReadyAt = Infinity
    companionsState = { pets: [{ id: 'gemini@gather', key: 'gemini@gather', character: 'gemini' }] }; pageHidden = false`)
}
const giftCalls = e => e.msgs().filter(m => m.companionCall && m.companionCall.fn === 'miniGift').map(m => m.companionCall)
// 一边推进一边看：期间谁演过 f-gift
async function watchGift(e, ms) {
  const seen = new Set()
  for (let t = 0; t < ms; t += 100) { await e.advance(100); for (const m of minis(e)) if (m.cls.split(' ').includes('f-gift')) seen.add(m.id) }
  return seen
}

const cases = [
  ['crew_shows_self_and_good_friend', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    assert(minis(e).length === 2 && ids(e) === 'claude,gemini', `crew: ${JSON.stringify(minis(e))}`)
  }],
  // 后半圈 z-index: -1 只沉到她身后：隔开的是只装她身子和小帮手的 #figure，不是整个 #stage
  // （#stage 隔开的话，里面的「新功能」卡片 z-index 4 只在 #stage 里算，前面的气泡 z-index 3 会盖住它、还挡住卡片上的按钮）
  ['minis_isolated_in_figure_not_stage', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    assert(minis(e).length === 2, `minis not in #figure: ${JSON.stringify(minis(e))}`)
    assert(!e.run(`$('stage').style.isolation`), `#stage isolated: ${e.run(`$('stage').style.isolation`)}`)
    const html = require('fs').readFileSync(path.join(WEB, 'index.html'), 'utf8')
    assert(/<div id="figure"><div id="body">(?:<img[^>]*>)+<\/div><\/div>/.test(html), '#figure should hold only #body')
    assert(/#figure \{[^}]*position: absolute; inset: 0;[^}]*isolation: isolate;[^}]*pointer-events: none;/.test(html), '#figure css')
    assert(!/#stage \{[^}]*isolation/.test(html), '#stage css isolated')
  }],
  ['show_minis_off_hides_all', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    assert(minis(e).every(m => !m.cls.includes('off')), `on: ${JSON.stringify(minis(e))}`)
    e.run(`setShowMinis(false)`)
    assert(minis(e).length === 2 && minis(e).every(m => m.cls.split(' ').includes('off')), `off: ${JSON.stringify(minis(e))}`)
    e.run(`setShowMinis(true)`)
    assert(minis(e).length === 2 && minis(e).every(m => !m.cls.split(' ').includes('off')), `back: ${JSON.stringify(minis(e))}`)
  }],
  // 设置「只显示她自己的」：朋友送的收起来；切回来又出来
  ['minis_from_own_hides_friends', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    e.run(`setMinisFrom('own')`)
    assert(ids(e) === 'claude', `own: ${ids(e)}`)
    e.run(`setMinisFrom('all')`)
    assert(ids(e) === 'claude,gemini', `all: ${ids(e)}`)
  }],
  ['crew_recomputed_every_minute', async () => {
    const e = await fresh({})
    assert(ids(e) === 'claude', `start: ${ids(e)}`)
    e.run(`localStorage.setItem('${FRIEND_KEY}', JSON.stringify({ 'claude+gemini': { points: 200, shown: 2 } }))`)
    await e.advance(61000)
    assert(ids(e) === 'claude,gemini', `after a minute: ${ids(e)}`)
  }],
  ['crew_rotates_across_midnight', async () => {
    const all = Object.fromEntries(['gemini', ...EXTRA].map((id, i) => [id < 'claude' ? `${id}+claude` : `claude+${id}`, { points: 200 + i, shown: 2 }]))
    const e = await fresh(all, Date.UTC(2026, 9, 19, 23, 58, 0))
    const before = ids(e)
    assert(minis(e).length === 6, `6 at most: ${before}`)
    await e.advance(3 * 60000)   // 23:58 → 00:01（中间过午夜）
    const after = ids(e)
    assert(minis(e).length === 6 && after !== before, `same crew after midnight: ${before} / ${after}`)
  }],
  ['crew_hidden_during_egg_and_tuck', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    e.run(`setPose('edge_left')`)
    assert(minis(e).every(m => m.cls.split(' ').includes('off')), `edge: ${JSON.stringify(minis(e))}`)
    e.run(`setPose('idle')`)
    assert(minis(e).every(m => !m.cls.split(' ').includes('off')), `back: ${JSON.stringify(minis(e))}`)
    // 真的贴边：tucked 时 syncMini 收起
    e.run(`tucked = 'left'; syncMini()`)
    assert(minis(e).every(m => m.cls.split(' ').includes('off')), `tucked: ${JSON.stringify(minis(e))}`)
    e.run(`tucked = null; syncMini()`)
    // 演彩蛋：egg 在时收起
    e.run(`egg = { host: 'claude', timers: [] }; syncMini()`)
    assert(minis(e).every(m => m.cls.split(' ').includes('off')), `egg: ${JSON.stringify(minis(e))}`)
    e.run(`egg = null; syncMini()`)
    assert(minis(e).every(m => !m.cls.split(' ').includes('off')), `after egg: ${JSON.stringify(minis(e))}`)
  }],
  ['gift_cancelled_when_turned_off', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    e.run(`miniGift('gemini')`)
    assert(minis(e).some(m => m.id === 'gemini' && m.cls.split(' ').includes('f-gift')), `gift not played: ${JSON.stringify(minis(e))}`)
    e.run(`setShowMinis(false)`)
    for (let i = 0; i < 40; i++) {
      await e.advance(100)
      assert(minis(e).every(m => !m.cls.split(' ').includes('f-gift')), `f-gift while off: ${JSON.stringify(minis(e))}`)
    }
  }],
  // Task 4 的两条：关了以后没有在演送礼的、没有在绕圈的
  ['off_stops_gift_and_laps', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    e.run(`setPose('writing')`)   // 干活：有人绕圈
    await e.advance(500)
    e.run(`miniGift('gemini')`)
    assert(minis(e).some(m => m.cls.split(' ').includes('lap')), `nobody laps while busy: ${JSON.stringify(minis(e))}`)
    e.run(`setShowMinis(false)`)
    assert(minis(e).every(m => !m.cls.split(' ').includes('f-gift') && !m.cls.split(' ').includes('lap')), `off: ${JSON.stringify(minis(e))}`)
    await e.advance(5000)
    assert(minis(e).every(m => !m.cls.split(' ').includes('f-gift') && !m.cls.split(' ').includes('lap')), `off later: ${JSON.stringify(minis(e))}`)
  }],
  // 两只的站位正好在跑道两端（x = ±88 = 绕圈半宽）：只让一只跑，另一只站着看书，跑的那只每圈都要穿过她。
  // 干活时大家一起跑，在圈上均匀错开（两只就差半圈），谁也不站在跑道上挡路
  ['busy_everyone_laps_evenly', async () => {
    for (const friends of [['gemini'], ['gemini', 'ava', 'bob']]) {
      const e = await fresh(Object.fromEntries(friends.map(f => [`claude+${f}`, { points: 200, shown: 2 }])))
      e.run(`setPose('writing')`)
      await e.advance(500)
      const ms = minis(e)
      assert(ms.length === friends.length + 1, `count: ${JSON.stringify(ms)}`)
      assert(ms.every(m => m.cls.split(' ').includes('lap')), `not everyone laps: ${JSON.stringify(ms)}`)
      const lap = 5.2
      const phase = e.run(`$('figure').children.filter(c => c.classList.contains('mini')).map(c => parseFloat(c.style.animationDelay))`)
        .map(d => ((-d % lap) + lap) % lap).sort((a, b) => a - b)
      for (let i = 0; i < phase.length; i++) {
        const gap = ((i + 1 < phase.length ? phase[i + 1] : phase[0] + lap) - phase[i])
        assert(Math.abs(gap - lap / phase.length) < .05, `uneven: ${phase.map(p => p.toFixed(2))}`)
      }
    }
  }],
  // 待机时有人想跑一圈，站在跑道上的（前四个站位，|x| ≤ 绕圈半宽）一起从各自的位置跑一圈、跑回原位，
  // 不会一只跑、另一只站在跑道上挡路；身后两侧那两个（|x| = 104，在跑道外）不跑：从她们的位置起跑会和最前面那只叠在一起
  ['idle_laps_together', async () => {
    for (const friends of [['gemini'], ['gemini', ...EXTRA.slice(0, 4)]]) {
      const e = await fresh(Object.fromEntries(friends.map(id => [id < 'claude' ? `${id}+claude` : `claude+${id}`, { points: 200, shown: 2 }])))
      // 小人自己找事时总挑「跑一圈」（随机数取 0）；页面别的随机事（彩蛋、闲时小动作）不看这里，结尾查一下没演彩蛋
      e.run(`Math.random = () => 0`)
      e.run(`setPose('idle')`)
      const n = friends.length + 1, track = Math.min(n, 4)
      let ever = 0
      for (let t = 0; t < 60000; t += 250) {
        await e.advance(250)
        const laps = minis(e).map((m, i) => m.cls.split(' ').includes('lap') ? i : -1).filter(i => i >= 0)
        if (!laps.length) continue
        ever++
        assert(laps.length === track && laps.every(i => i < 4), `n=${n} lapping: ${laps}`)
      }
      assert(minis(e).length === n, `crew: ${ids(e)}`)
      assert(!e.state().egg, 'an egg played; the sample is meaningless')
      assert(ever > 0, `n=${n} nobody lapped in 60 s`)
    }
  }],
  ['level_up_to_two_plays_gift_and_marks', async () => {
    const e = await fresh({ 'claude+gemini': { points: 100, shown: 1 } })
    withGemini(e)
    assert(ids(e) === 'claude', `start: ${ids(e)}`)
    e.run(`localStorage.setItem('${FRIEND_KEY}', JSON.stringify({ 'claude+gemini': { points: 200, shown: 1 } }))`)
    e.run(`syncMini()`)   // 分数过线了、升级那段对话还没演：送的小帮手先不出来
    assert(ids(e) === 'claude', `before the talk: ${ids(e)}`)
    e.run(`pairChatAt = 0; tryPairChat()`)
    const until = e.run('speakingUntil') - e.clk.now()
    assert(until > 0, 'no level-up talk')
    assert(store(e)['claude+gemini'].giftShown === true && store(e)['claude+gemini'].shown === 2, `store: ${JSON.stringify(store(e))}`)
    assert(giftCalls(e).length === 0, 'gift before the talk ended')
    const seen = await watchGift(e, until + 2000)
    const calls = giftCalls(e)
    assert(calls.length === 1 && calls[0].id === 'gemini@gather' && JSON.stringify(calls[0].args) === '["claude"]', `companionCall: ${JSON.stringify(calls)}`)
    assert(seen.has('gemini') && !seen.has('claude'), `main's own gift: ${[...seen]}`)
  }],
  ['old_pair_gets_gift_once', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    withGemini(e)
    e.run(`pairChatAt = 0; tryPairChat()`)
    const seen = await watchGift(e, 1500)
    assert(seen.has('gemini'), `retro gift not played: ${[...seen]}`)
    assert(giftCalls(e).length === 1 && store(e)['claude+gemini'].giftShown === true, `retro: ${JSON.stringify(giftCalls(e))} ${JSON.stringify(store(e))}`)
    await e.advance(40000)
    e.run(`pairChatAt = 0; tryPairChat()`)
    await e.advance(5000)
    assert(giftCalls(e).length === 1, `played twice: ${JSON.stringify(giftCalls(e))}`)
  }],
  ['gift_waits_until_minis_visible', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    withGemini(e)
    e.run(`setShowMinis(false); pairChatAt = 0; tryPairChat()`)
    const hidden = await watchGift(e, 2000)
    assert(hidden.size === 0 && giftCalls(e).length === 0 && !store(e)['claude+gemini'].giftShown, `gift while off: ${[...hidden]} ${JSON.stringify(store(e))}`)
    // 升级那条路也一样：shown 照写，giftShown 不写
    e.run(`localStorage.setItem('${FRIEND_KEY}', JSON.stringify({ 'claude+gemini': { points: 200, shown: 1 } }))`)
    e.run(`pairChatAt = 0; tryPairChat()`)
    const talk = e.run('speakingUntil') - e.clk.now()
    assert(store(e)['claude+gemini'].shown === 2 && !store(e)['claude+gemini'].giftShown, `level-up while off: ${JSON.stringify(store(e))}`)
    await e.advance(talk + 2000)
    assert(giftCalls(e).length === 0, `gift scheduled while off: ${JSON.stringify(giftCalls(e))}`)
    e.run(`setShowMinis(true); pairChatAt = 0; tryPairChat()`)
    const seen = await watchGift(e, 1500)
    assert(seen.has('gemini') && giftCalls(e).length === 1 && store(e)['claude+gemini'].giftShown === true, `retro after on: ${[...seen]} ${JSON.stringify(giftCalls(e))}`)
    await e.advance(40000)
    e.run(`pairChatAt = 0; tryPairChat()`)
    await e.advance(5000)
    assert(giftCalls(e).length === 1, `played twice: ${JSON.stringify(giftCalls(e))}`)
  }],
  ['old_pair_waits_while_busy', async () => {
    const e = await fresh({ 'claude+gemini': { points: 200, shown: 2 } })
    withGemini(e)
    e.run(`friendWorking.gemini = true; pairChatAt = 0; tryPairChat()`)
    await e.advance(1000)
    assert(giftCalls(e).length === 0 && !store(e)['claude+gemini'].giftShown, 'retro gift while gemini is busy')
    e.run(`friendWorking.gemini = false; pairChatAt = Date.now(); tryPairChat()`)   // 刚说过：隔 30 秒
    await e.advance(1000)
    assert(giftCalls(e).length === 0, 'retro gift ignored LEVEL_UP_GAP')
  }],
  ['companion_window_recomputes_too', async () => {
    const e = makePage()
    e.run(`setRole('companion', { id: 'gemini@gather', key: 'gemini@gather', character: 'gemini', client: 'gather', label: '' })`)
    e.run(`init(${JSON.stringify(manifest())})`)
    await e.advance(1000)
    e.run(`function __n() { return $('figure').children.filter(c => c.classList.contains('mini')).length }`)
    assert(e.run('__n()') === 1, `companion start: ${e.run('__n()')}`)
    e.run(`localStorage.setItem('${FRIEND_KEY}', JSON.stringify({ 'claude+gemini': { points: 200, shown: 2 } }))`)
    await e.advance(61000)
    assert(e.run('__n()') === 2, `companion after a minute: ${e.run('__n()')}`)
  }],
]

;(async () => {
  const failures = []
  for (const [name, fn] of cases) {
    try { await fn() } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ file: path.join(WEB, 'index.html'), passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
