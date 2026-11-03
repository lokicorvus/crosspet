// 换角色的那 330 毫秒里别的事件 / 计时器不能串到别的角色上。
// 跑的是 app/web/index.html 里整段真实脚本（加上几个辅助脚本），DOM 和时钟是假的；不开窗口、不联网。
//   node tests/page_switch_test.cjs
'use strict'
process.env.TZ = 'UTC'
const fs = require('fs'), path = require('path'), vm = require('vm')
const WEB = path.join(__dirname, '..', 'app', 'web')
const START = Date.UTC(2026, 9, 19, 9, 0, 0)   // 平常的上午，不是节日

function makeClock(start) {
  let now = start, next = 1
  const timers = new Map(), errors = []
  return {
    now: () => now,
    setTimeout: (cb, delay, ...args) => { const id = next++; timers.set(id, { at: now + Math.max(0, Number(delay) || 0), cb, args, interval: 0 }); return id },
    setInterval: (cb, delay, ...args) => { const id = next++; const d = Math.max(1, Number(delay) || 0); timers.set(id, { at: now + d, cb, args, interval: d }); return id },
    clear: id => { timers.delete(id) },
    // 按时间顺序一个一个跑；每跑一个让 Promise 也走一步
    async advance(ms) {
      const target = now + ms
      for (let count = 0; count < 500000; count++) {
        let due = null
        for (const e of timers) if (e[1].at <= target && (!due || e[1].at < due[1].at || (e[1].at === due[1].at && e[0] < due[0]))) due = e
        if (!due) { now = target; await flush(); return }
        const [id, t] = due
        now = t.at
        if (t.interval) t.at = now + t.interval; else timers.delete(id)
        try { t.cb(...t.args) } catch (e) { errors.push({ at: now, error: String(e && e.message || e) }) }
        await flush()
      }
      throw Error('Timer loop')
    },
    errors,
  }
}
const flush = () => new Promise(r => setImmediate(r))

function makePage() {
  const clk = makeClock(START)
  class ClassList {
    constructor() { this.set = new Set() }
    add(...a) { a.forEach(x => this.set.add(x)) }
    remove(...a) { a.forEach(x => this.set.delete(x)) }
    contains(x) { return this.set.has(x) }
    toggle(x, force) { const on = force === undefined ? !this.set.has(x) : !!force; if (on) this.set.add(x); else this.set.delete(x); return on }
    toString() { return [...this.set].join(' ') }
  }
  class El {
    constructor(tag, id) {
      this.tagName = String(tag).toUpperCase(); this.id = id || ''; this.classList = new ClassList()
      this.style = { setProperty() {}, getPropertyValue() { return '' } }
      this.children = []; this.parentNode = null; this._text = ''; this._html = ''; this._src = ''; this.attrs = {}
      this.complete = true; this.onload = null; this.dataset = {}
    }
    get className() { return this.classList.toString() }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)) }
    get textContent() { return this._text }
    set textContent(v) { this._text = String(v ?? '') }
    get innerHTML() { return this._html }
    set innerHTML(v) { this._html = String(v) }
    get src() { return this._src }
    set src(v) {
      this._src = String(v); this.attrs.src = this._src
      if (this.tagName === 'IMG') { const el = this; clk.setTimeout(() => { if (el.onload) el.onload() }, 5) }
    }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
    setAttribute(n, v) { this.attrs[n] = String(v) }
    removeAttribute(n) { delete this.attrs[n]; if (n === 'src') this._src = '' }
    appendChild(c) { if (c.parentNode) c.remove(); this.children.push(c); c.parentNode = this; return c }
    replaceChildren(...c) { this.children = []; c.forEach(x => this.appendChild(x)) }
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter(x => x !== this); this.parentNode = null } }
    querySelector(sel) {
      if (sel !== 'svg') return null
      if (!this._svg) { const s = new El('svg'); s.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 }); s.querySelectorAll = () => []; this._svg = s }
      return this._svg
    }
    querySelectorAll() { return [] }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } }
    addEventListener() {}
    get offsetWidth() { return 0 }
    closest() { return null }
  }
  const els = {}
  for (const id of ['fit', 'wrap', 'bubble', 'stage', 'aura', 'shadow', 'body', 'a', 'b', 'blink', 'fx', 'cards', 'more', 'newsCard', 'newsText', 'poof', 'foot', 'caption', 'quota'])
    els[id] = new El(['a', 'b', 'blink'].includes(id) ? 'img' : 'div', id)
  els.a.classList.add('on'); els.bubble.classList.add('hide'); els.newsCard.classList.add('hidden')
  els.cards.appendChild(els.more)
  const store = new Map()
  const document = {
    getElementById: id => els[id] || null, documentElement: new El('html'), body: new El('body'),
    createElement: tag => new El(tag), querySelectorAll: () => [], elementFromPoint: () => null,
  }
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [clk.now()])) }
    static now() { return clk.now() }
  }
  const ctx = {
    Date: FakeDate, console,
    setTimeout: clk.setTimeout, clearTimeout: clk.clear, setInterval: clk.setInterval, clearInterval: clk.clear,
    requestAnimationFrame: cb => clk.setTimeout(() => cb(clk.now()), 16), performance: { now: () => clk.now() },
    document, Image: class { set src(v) {} }, MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ objectPosition: '50% 100%', display: 'block', visibility: 'visible' }),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    fetch: () => new Promise(() => {}), AbortController: class { constructor() { this.signal = {} } abort() {} },
    addEventListener() {},
  }
  // 页面发给外壳的消息（toShell 走 macOS 的 pet 通道）都记下来
  const shellMsgs = []
  ctx.webkit = { messageHandlers: { pet: { postMessage: m => shellMsgs.push({ at: clk.now(), msg: JSON.parse(JSON.stringify(m)) }) } } }
  ctx.window = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext('Math.random = () => 0.99', ctx)   // 不随机出闲时小动作、彩蛋
  for (const f of ['effects.js', 'text-size.js', 'codex-quota.js', 'quota-aggregate.js', 'plugin-update.js', 'stand-in.js', 'follow-policy.js', 'codex-resets.js', 'peak-hours.js', 'whats-new.js', 'companions.js', 'friendship.js', 'pair-chat.js'])
    vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f })
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').replace(/\r\n/g, '\n')
  const start = html.lastIndexOf('<script>\n'), end = html.lastIndexOf('</script>')
  if (start < 0 || end < start) throw Error('cannot find the inline script of index.html')
  vm.runInContext(html.slice(start + '<script>'.length, end), ctx, { filename: 'index.html' })
  const run = code => vm.runInContext(code, ctx)
  run(`
    var __says = []
    const __say = say; say = function (l) { const r = __say(l); __says.push({ at: Date.now(), charId, line: l }); return r }
    function __state() {
      const cards = $('cards').children.filter(c => c !== $('more'))
      return { charId, pose, characterTarget, egg: egg && { host: egg.host }, multi: multi && { busy: multi.busy, asking: multi.asking },
        cards: cards.length, bubble: $('bubble').classList.contains('hide') ? '' : $('bubble').textContent, caption: $('caption').textContent,
        stageHidden: $('stage').classList.contains('swap'), fxHidden: $('fx').classList.contains('hide') }
    }
    // 钩子写的时间：外壳下一次 0.3 秒轮询才交过来，比现在略早一点
    function hook(id, p, event, extra = {}) { applyCharState(id, { pose: p, event, ts: (Date.now() - 150) / 1000, ...extra }) }
    // 带客户端的会话：[会话id, 姿态, 客户端, 事件]
    function csess(...entries) { const o = {}; entries.forEach(([sid, p, client, ev]) => o[sid] = { pose: p, event: ev || 'PreToolUse', ts: (Date.now() - 150) / 1000, ...(client ? { client } : {}) }); return o }
    function sess(...entries) { const o = {}; entries.forEach(([sid, p, ev]) => o[sid] = { pose: p, event: ev || 'PreToolUse', ts: (Date.now() - 150) / 1000 }); return o }
  `)
  run('setPageHidden(true)')   // 特效的逐帧刷新不在这里测
  return { run, clk, advance: ms => clk.advance(ms), state: () => run('__state()'), says: () => run('__says'), errors: clk.errors,
    msgs: () => shellMsgs.map(x => x.msg), shellMsgs }
}

const POSES = ['idle', 'thinking', 'listening', 'reading', 'writing', 'running', 'happy', 'oops', 'asking', 'busy_left', 'busy_right',
  'edge_left', 'edge_right', 'edge_left_peek', 'edge_right_peek', 'sleeping', 'tired', 'surprised', 'pat']
const frames = (id, list) => Object.fromEntries(list.map(p => [p, [`${id}/${p}.webp`]]))
function manifest() {
  return { characters: {
    gpt: { name: 'GPT', greeting: 'GPT hello', lines: { busy: ['GPT busy!'], asking: ['GPT asks'] }, poses: frames('gpt', POSES) },
    grok: { name: 'Grok', greeting: 'Grok hello', lines: { busy: ['Grok busy!'] }, poses: frames('grok', POSES) },
    claude: { name: 'Claude', greeting: 'Claude hello', lines: { busy: ['Claude busy!'] }, poses: frames('claude', POSES) },
    'egg-gpt': { name: 'EggGPT', egg: true, host: 'gpt', lines: { pop: ['egg pop'], pretend: ['egg pretend'], caught: ['egg caught'], bye: ['egg bye'] },
      poses: frames('egg-gpt', ['pop', 'pretend', 'caught', 'bye']) },
  } }
}
// 和外壳一样启动：init（先换上排第一的），再安静地换回上次的 GPT
async function fresh() {
  const e = makePage()
  e.run(`init(${JSON.stringify(manifest())})`)
  await e.advance(1000)
  e.run(`setCharacter('gpt', true)`)
  await e.advance(1000)
  e.run(`hook('grok','idle','SessionStart');hook('claude','idle','SessionStart')`)
  return e
}
function assert(c, msg) { if (!c) throw Error(msg) }

const cases = [
  ['render_recovery_says_why_she_vanished', async e => {
    e.run(`justRecovered()`)
    await e.advance(3000)
    assert(e.state().bubble.includes('重启'), 'no recovery line: ' + e.state().bubble)
    await e.advance(9000)
    assert(e.state().bubble === '', 'recovery line stuck: ' + e.state().bubble)
  }],
  ['async_reset_answer_is_cancelled_after_switching_away_and_back', async e => {
    e.run(`resetsOn=true; devResetsSaved={}; var __resetAnswers=0; tellReset=()=>{__resetAnswers++}; void askReset()`)
    await e.advance(100)
    e.run(`setCharacter('claude',true)`)
    await e.advance(100)
    e.run(`setCharacter('gpt',true)`)
    await e.advance(1500)
    assert(e.run('__resetAnswers')===0, 'obsolete asynchronous reset response changed a new GPT display')
  }],
  ['peak_outfit_change_treats_pending_character_switch_as_busy', async e => {
    assert(!e.run('peakBusy()'), 'precondition: idle page is not busy')
    e.run(`setCharacter('claude',true)`)
    assert(e.run('peakBusy()'), 'peak outfit migration could run during character swap')
    await e.advance(1000)
    assert(!e.run('peakBusy()'), 'completed quiet switch left peak outfit migration busy')
  }],
  ['old_outfit_speech_does_not_survive_new_display_generation', async e => {
    e.run(`manifest.characters.gpt.skin='sleep'; manifest.characters.gpt.lines.peakStart=['old outfit']; outfitLine={id:'gpt',skin:'sleep',key:'peakStart',at:Date.now()}; refreshLook('gpt')`)
    await e.advance(400)
    e.run(`setCharacter('claude',true)`)
    await e.advance(100)
    e.run(`setCharacter('gpt',true)`)
    await e.advance(1000)
    assert(e.state().charId==='gpt' && e.state().bubble!=='old outfit', `old peak outfit speech crossed display generation: ${JSON.stringify(e.state())}`)
  }],
  ['cancel_pending_switch_back_keeps_stage_visible', async e => {
    e.run(`setCharacter('claude')`)
    await e.advance(100)
    e.run(`setCharacter('gpt',true)`)
    await e.advance(2000)
    assert(e.state().charId==='gpt' && !e.state().stageHidden, `return switch hid current character: ${JSON.stringify(e.state())}`)
  }],
  ['repeated_foreground_poll_does_not_postpone_switch_forever', async e => {
    for (let i=0;i<10;i++) {
      e.run(`setCharacter('claude',true)`)
      await e.advance(300)
    }
    assert(e.state().charId==='claude' && !e.state().stageHidden, `repeated polling starves switch: ${JSON.stringify(e.state())}`)
  }],
  ['sessions_during_switch_do_not_juggle_the_new_character', async e => {
    e.run(`setSessions('gpt', sess(['s1','writing'],['s2','reading']))`)
    await e.advance(2000)
    assert(e.state().multi, 'precondition: GPT juggles two sessions')
    e.run(`setCharacter('claude')`)
    await e.advance(150)
    e.run(`setSessions('gpt', sess(['s1','running'],['s2','reading']))`)   // 下一次轮询：GPT 那边还在忙
    await e.advance(250)
    let s = e.state()
    assert(s.charId === 'claude' && !s.multi && s.cards === 0, `Claude shows GPT's cards: ${JSON.stringify(s)}`)
    await e.advance(1000)
    s = e.state()
    assert(s.bubble === 'Claude hello' && !/^busy_/.test(s.pose), `Claude's greeting was cut by GPT's cards: ${JSON.stringify(s)}`)
  }],
  ['current_sessions_join_own_sessions', async e => {
    // Cursor 这类多模型宿主的 current 会话：和她自己的会话一起演，谁也不盖掉谁（先到后到都一样）
    e.run(`setSessions('gpt', sess(['s1','writing'])); setSessions('current', sess(['x1','reading']))`)
    await e.advance(2000)
    let s = e.state()
    assert(s.multi && s.cards === 2, `current overwrote GPT's own sessions: ${JSON.stringify(s)}`)
    e.run(`setSessions('gpt', sess(['s1','running']))`)   // 下一次轮询她自己的会话：current 那张还在
    await e.advance(500)
    s = e.state()
    assert(s.multi && s.cards === 2, `own sessions overwrote current: ${JSON.stringify(s)}`)
  }],
  ['restored_listening_moves_on_to_thinking', async e => {
    e.run(`hook('claude','listening','UserPromptSubmit'); setCharacter('claude')`)   // Windows 跟着最新的事件换角色
    await e.advance(5000)
    assert(e.state().pose === 'thinking', `stuck in '${e.state().pose}'`)
  }],
  ['no_egg_while_switching', async e => {
    e.run(`setCharacter('grok')`)
    await e.advance(100)
    assert(e.run(`playEgg(true)`) === false, 'an egg started during the switch')
    await e.advance(50000)
    assert(e.state().charId === 'grok', `ended on ${e.state().charId}`)
  }],
  ['switch_during_egg_poof_cancels_the_egg', async e => {
    e.run(`playEgg(true)`)
    await e.advance(100)
    e.run(`setCharacter('grok'); setCharacter('grok')`)
    await e.advance(2000)
    const s = e.state()
    assert(s.charId === 'grok' && !s.egg && !s.stageHidden, `after the switch: ${JSON.stringify(s)}`)
    assert(!e.errors.length, `page errors: ${JSON.stringify(e.errors)}`)
    e.run(`hook('grok','writing','PreToolUse')`)
    await e.advance(500)
    assert(e.state().pose === 'writing', 'Grok ignores her own work')
  }],
  ['celebration_during_switch_waits_for_her', async e => {
    const now = e.clk.now() / 1000
    e.run(`setQuota('gpt', {text:'5h 20%', windows:[{label:'5h', used:80, reset:${now + 3600}}]})`)
    e.run(`setCharacter('grok')`)
    await e.advance(150)
    e.run(`setQuota('gpt', {text:'5h 95%', windows:[{label:'5h', used:5, reset:${now + 3600 + 18000}}]})`)   // 提前重置了
    await e.advance(1000)
    e.run(`setCharacter('gpt')`)
    await e.advance(2000)
    assert(['reset', 'happy'].includes(e.state().pose), `GPT never celebrated: ${e.state().pose}`)
  }],
  ['asking_cards_keep_effects_hidden', async e => {
    e.run(`setSessions('gpt', sess(['s1','asking','Notification'],['s2','writing']))`)
    await e.advance(300)
    const s = e.state()
    assert(s.multi && s.pose === 'asking' && s.fxHidden, `effects shown next to the cards: ${JSON.stringify(s)}`)
  }],
  ['switched_in_character_stays_awake', async e => {
    await e.advance(11 * 60 * 1000)   // 十来分钟没动静
    e.run(`setCharacter('grok')`)     // 你切到了 Cursor
    await e.advance(21000)
    assert(e.state().pose !== 'sleeping', 'Grok fell asleep right after showing up')
  }],
  ['never_sleep_setting', async e => {
    // 设置里打开「不睡觉」：正睡着就醒；闲多久、AI 会话结束都不睡；关掉后照旧会睡
    await e.advance(12 * 60 * 1000)
    assert(e.state().pose === 'sleeping', `did not fall asleep normally: ${e.state().pose}`)
    e.run('setNeverSleep(true)')
    assert(e.state().pose === 'idle', `did not wake up: ${e.state().pose}`)
    await e.advance(30 * 60 * 1000)
    assert(e.state().pose !== 'sleeping', 'fell asleep with the setting on')
    e.run(`hook('gpt','sleeping','SessionEnd')`)
    await e.advance(2000)
    assert(e.state().pose !== 'sleeping', 'slept on SessionEnd with the setting on')
    e.run('setNeverSleep(false)')
    await e.advance(12 * 60 * 1000)
    assert(e.state().pose === 'sleeping', `did not sleep after turning it off: ${e.state().pose}`)
  }],
  ['reset_notice_is_not_used_up_on_the_fading_stage', async e => {
    e.run(`resetsOn = true; resetsData = CodexResets.parse({data:{scheduled_reset:{id:'r1', announced_at:new Date(Date.now()-60000).toISOString(), scheduled_for:new Date(Date.now()+3600000).toISOString()}}}); announceReset()`)
    await e.advance(2800)
    e.run(`setCharacter('grok')`)    // 3 秒那次刚好落在换角色的时候
    await e.advance(1000)
    assert(e.run(`resetsTold().length`) === 0, 'the notice was marked as told while GPT was being switched away')
    e.run(`setCharacter('gpt')`)
    await e.advance(1000)
    e.run(`say('')`)                 // 招呼说完，闲下来了
    await e.advance(10000)
    assert(e.says().some(x => x.charId === 'gpt' && /重置/.test(x.line || '')), 'GPT never told the notice')
  }],
  ['new_manifest_keeps_a_pending_switch', async e => {
    e.run(`setCharacter('grok')`)
    await e.advance(100)
    e.run(`init(${JSON.stringify(manifest())})`)   // 换衣服时外壳重新 init
    await e.advance(1000)
    const s = e.state()
    assert(s.charId === 'grok' && !s.stageHidden, `after init: ${JSON.stringify(s)}`)
  }],
  ['switch_to_a_removed_character_is_dropped', async e => {
    const m = manifest(); delete m.characters.grok
    e.run(`setCharacter('grok')`)
    await e.advance(100)
    e.run(`init(${JSON.stringify(m)})`)
    await e.advance(1000)
    const s = e.state()
    assert(s.charId === 'gpt' && !s.stageHidden && s.caption === 'GPT', `after init: ${JSON.stringify(s)}`)
    assert(!e.errors.length, `page errors: ${JSON.stringify(e.errors)}`)
  }],
  ['redress_does_not_take_over_a_pending_switch', async e => {
    e.run(`setCharacter('grok')`)
    await e.advance(400)
    e.run(`setCharacter('claude')`)
    e.run(`refreshLook('grok')`)     // 还显示着 Grok 时给她换了衣服
    await e.advance(1000)
    assert(e.state().charId === 'claude', `ended on ${e.state().charId}`)
  }],
]

// ---- 多桌宠（主桌宠页面）----
const MULTI_KEYS = ['companions', 'companionLeave', 'companionCall', 'eggAllowed', 'friendship', 'patted', 'gone']
const multiMsgs = e => e.msgs().filter(m => MULTI_KEYS.some(k => k in m))
const companionLists = e => e.msgs().filter(m => 'companions' in m).map(m => m.companions)
const lastCompanions = e => companionLists(e).slice(-1)[0]
// companions 消息里带着 gathering（正集合着：外壳菜单显示「解散」）
const lastGathering = e => e.msgs().filter(m => 'companions' in m).slice(-1)[0]?.gathering
// 外壳打开开关后先交一轮状态；页面开头等一下再算（见 index.html 的 COMPANIONS_WARMUP）
async function multiOn(e, main, extra = '') {
  if (main && e.state().charId !== main) { e.run(`setCharacter('${main}', true)`); await e.advance(1000) }
  e.run(`setRole('main'); setMultiPets({ on: true, rest: 'auto', mainPet: '' }); ${extra}`)
  await e.advance(2000)
}
// 额外那只（或对照用的主桌宠）的页面：外壳先 setRole 再 init。localStorage 写入、联网都记下来
async function rolePage(role, m = manifest()) {
  const e = makePage()
  e.run(`var __writes = []; { const set = localStorage.setItem; localStorage.setItem = (k, v) => { __writes.push(k); return set(k, v) } }
         var __fetches = 0; fetch = () => { __fetches++; return new Promise(() => {}) }`)
  if (role === 'companion') e.run(`setRole('companion', { id: 'gpt@codex', key: 'gpt@codex', character: 'gpt', client: 'codex', label: '终端' })`)
  e.run(`init(${JSON.stringify(m)})`)
  await e.advance(1000)
  return e
}
// 第四节那些只该做一次的事挨个来一遍：登场招呼（时段）、换衣服、重置提醒、插件更新、新功能卡片、有新版本、事件、额度
async function onceOnlyRound(e) {
  e.run(`setCharacter('gpt')`)
  await e.advance(1000)
  e.run(`setPeakSkins({ deepseek: { peak: 'night', valley: '' } }); setCodexResets(true)`)
  e.run(`setPluginUpdates([{ bundled: '2.0.0', installed: '1.0.0', label: 'Codex' }]); justUpdated('1.3.8', '1.3.6')`)
  e.run(`hook('gpt','writing','PreToolUse')`)
  await e.advance(3000)
  e.run(`hook('gpt','happy','Stop')`)
  const now = e.clk.now() / 1000
  e.run(`setQuota('gpt', {text:'5h 20%', windows:[{label:'5h', used:80, reset:${now + 3600}}]})`)
  e.run(`setQuota('gpt', {text:'5h 95%', windows:[{label:'5h', used:5, reset:${now + 3600 + 18000}}]})`)
  await e.advance(10 * 60000)
  e.run(`notifyUpdate('v9.9.9')`)
  await e.advance(100)
  return {
    writes: e.run('__writes'), fetches: e.run('__fetches'), wear: e.msgs().filter(m => m.wear).length,
    news: e.run(`$('newsText').textContent`), says: e.says().map(x => x.line).join('|'), egg: e.run('playEgg(true)'),
  }
}
const friendStore = e => { const s = e.run(`localStorage.getItem('crosspet-friendship')`); return s ? JSON.parse(s) : {} }
const friendRows = e => e.msgs().filter(m => 'friendship' in m).map(m => m.friendship).slice(-1)[0]
const multiCases = [
  ['companion_does_no_once_only', async e => {
    const m = manifest()
    m.characters.gpt.lines.greet_morning = ['早上好']
    m.characters.deepseek = { name: 'DeepSeek', greeting: 'DS hello', poses: frames('deepseek', POSES) }
    // 对照：主桌宠页面同样一轮，这些事都会做（测试本身能看出来）
    const main = await onceOnlyRound(await rolePage('main', m))
    for (const k of ['crosspet-greeted', 'crosspet-peak-applied', 'crosspet-quota-memory'])
      assert(main.writes.includes(k), `control: main did not write ${k}: ${JSON.stringify(main.writes)}`)
    assert(main.fetches > 0 && main.wear > 0 && main.news && main.says.includes('有新版本') && main.says.includes('插件有新版本') && main.egg === true,
      `control: ${JSON.stringify(main)}`)
    // 额外那只：一样都不做，也不写 localStorage
    const c = await rolePage('companion', m)
    const r = await onceOnlyRound(c)
    assert(r.writes.length === 0, `companion wrote localStorage: ${JSON.stringify(r.writes)}`)
    assert(r.fetches === 0, 'companion fetched codex-resets')
    assert(r.wear === 0, 'companion changed outfits')
    assert(!r.news, `companion showed the news card: ${r.news}`)
    assert(!r.says.includes('有新版本') && !r.says.includes('插件有新版本') && !r.says.includes('早上好'), `companion said once-only lines: ${r.says}`)
    assert(r.egg === false && !c.state().egg, 'companion played an egg')
    // 事件、摸头、气泡照常
    c.run(`hook('gpt','writing','PreToolUse')`)
    await c.advance(3000)
    assert(c.state().pose === 'writing', `companion ignores her events: ${c.state().pose}`)
    c.run(`handleClick('pat')`)
    await c.advance(100)
    assert(c.state().pose === 'pat', `companion not patted: ${c.state().pose}`)
    assert(c.msgs().filter(m => m.patted === true).length === 1, `no patted message: ${JSON.stringify(c.msgs())}`)
    assert(!c.msgs().some(m => 'companions' in m || 'friendship' in m), `companion did main-page work: ${JSON.stringify(c.msgs())}`)
    assert(c.run(`$('caption').dataset.label`) === '终端', 'client label not shown under the name')
    assert(!c.errors.length, `page errors: ${JSON.stringify(c.errors)}`)
  }],
  ['main_claimed_keeps_first_comer', async e => {
    // 谁先来谁当主桌宠：主桌宠的角色有会话时，外壳问「跟随前台」换不换，答案是不换（11-03）
    await multiOn(e, 'claude')
    const ask = () => e.run(`FollowPolicy.foregroundTarget(Object.assign({ foregroundId: 'gpt', current: 'claude', mainPet: '', standing: [] }, { mainClaimed: mainClaimed() }))`)
    assert(ask() === 'gpt', `main with no sessions should follow the first comer: ${ask()}`)
    e.run(`setSessions('claude', csess(['s1','writing','claude-desktop'])); setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    await e.advance(3000)
    assert(e.run('mainClaimed()') === true, 'claude sessions did not claim the main pet')
    assert(ask() === null, `switched away from the first comer: ${ask()}`)
  }],
  ['companion_waves_on_quit', async e => {
    // 退出时外壳也让额外那只 farewell：她挥手（bye）、说一句道别，之后状态事件不再打断
    const c = await rolePage('companion')
    c.run('farewell(null, 2000)')
    await c.advance(300)
    const s = c.state()
    assert(s.pose === 'bye', `companion did not wave: ${JSON.stringify(s)}`)
    c.run(`hook('gpt','writing','PreToolUse')`)
    await c.advance(500)
    assert(c.state().pose === 'bye', `work event interrupted the farewell: ${c.state().pose}`)
  }],
  ['companion_leave_now', async e => {
    const c = await rolePage('companion')
    c.run(`setCharacter('gpt', true)`)
    await c.advance(1000)
    c.run(`leaveNow()`)
    await c.advance(100)
    const line = c.state().bubble
    assert(line, 'no bye line')
    assert(/m-bob|m-leave/.test(c.run(`$('body').className`)), `no bye motion: ${c.run(`$('body').className`)}`)
    await c.advance(500)
    assert(c.run(`$('body').className`) === 'm-leave', `no leave motion before the poof: ${c.run(`$('body').className`)}`)
    assert(!c.msgs().some(m => m.gone), 'gone before the bye line was shown')
    c.run(`say('别的话'); leaveNow()`)   // 道别时别的话盖不掉；再调一次也只走一次
    assert(c.state().bubble === line, `bye line replaced: ${c.state().bubble}`)
    await c.advance(3000)
    assert(c.msgs().filter(m => m.gone === true).length === 1, `gone: ${JSON.stringify(c.msgs())}`)
    assert(c.state().stageHidden, 'still visible after poof')
    assert(!c.errors.length, `page errors: ${JSON.stringify(c.errors)}`)
  }],
  ['friendship_together_ten_minutes', async e => {
    e.run(`pageHidden = false`)   // 测试页默认按「窗口看不见」跑（不画特效）；在场要看得见。直接改变量，不开逐帧刷新
    e.run(`gather()`)
    await e.advance(1500)
    await e.advance(8 * 60000)
    assert(!friendStore(e)['gpt+grok']?.points, `points before 10 minutes: ${JSON.stringify(friendStore(e))}`)
    await e.advance(2 * 60000)
    const s = friendStore(e)
    assert(s['gpt+grok']?.points === 1 && s['claude+gpt']?.points === 1 && s['claude+grok']?.points === 1, `after 10 minutes: ${JSON.stringify(s)}`)
    const rows = friendRows(e)
    assert(rows && rows.length === 3 && rows.some(r => r.label === 'GPT ♥ Grok'), `rows: ${JSON.stringify(rows)}`)
    // 只在变化时发
    const n = e.msgs().filter(m => 'friendship' in m).length
    await e.advance(60000)
    assert(e.msgs().filter(m => 'friendship' in m).length === n, 'unchanged rows were re-sent')
    // 窗口藏起来（锁屏 / 全屏隐藏）时不算在场
    e.run(`pageHidden = true`)
    await e.advance(10 * 60000)
    assert(friendStore(e)['gpt+grok'].points === 1, `counted while hidden: ${JSON.stringify(friendStore(e))}`)
    // 坏掉的存储：当成空的，照样记
    e.run(`localStorage.setItem('crosspet-friendship', '{oops')`)
    e.run(`pageHidden = false`)
    await e.advance(10 * 60000)
    assert(friendStore(e)['gpt+grok']?.points === 1, `corrupt store: ${JSON.stringify(friendStore(e))}`)
  }],
  ['pair_chat_gather', async e => {
    e.run(`pageHidden = false; Math.random = () => 0`)   // 掷骰子都取 0：第一对（claude+gpt）、第一档第一段
    e.run(`globalThis.__said = []; { const o = say; say = l => { if (l) __said.push(l); return o(l) } }`)
    e.run(`gather()`)
    await e.advance(1500)
    const calls = () => e.msgs().filter(m => m.companionCall?.fn === 'chat')
    await e.advance(65000)
    const [[w1, l1], [w2, l2]] = e.run(`PairChat.LINES['claude+gpt'][0][0]`)
    const main = e.run(`mainCharacter()`)
    // 一句由额外那只说（外壳转 companionCall），一句由主桌宠自己说，先后隔 REPLY_MS
    const [other, own, otherLine, ownLine] = w1 === main ? [w2, w1, l2, l1] : [w1, w2, l1, l2]
    assert(own === main, `precondition: main ${main} not in claude+gpt`)
    const otherId = e.run(`companionsState.pets.find(p => p.character === '${other}').id`)
    assert(calls().length === 1 && calls()[0].companionCall.id === otherId && calls()[0].companionCall.args[0] === otherLine, `companion line: ${JSON.stringify(calls())}`)
    assert(e.run(`__said`).includes(ownLine), `main line: ${JSON.stringify(e.run(`__said`))}`)
    await e.advance(7000)
    assert(e.state().bubble !== ownLine, 'own line not cleared')
    // 12 分钟内不再说；之后再说时换一段
    await e.advance(10 * 60000)
    assert(calls().length === 1, `chatted again too soon: ${calls().length}`)
    await e.advance(3 * 60000)
    const later = e.msgs().filter(m => m.companionCall?.fn === 'chat').length + (e.state().bubble ? 1 : 0)
    assert(later >= 1, 'no second chat')
    // 主桌宠在干活：她不说（也不挑她）
    e.run(`hook('${main}','writing','PreToolUse')`)
    await e.advance(100)
    e.run(`chat('不该说')`)
    assert(e.state().bubble !== '不该说', 'chatted while working')
    assert(!e.errors.length, `page errors: ${JSON.stringify(e.errors)}`)
  }],
  ['friend_level_up', async e => {
    // 已经攒到好朋友（4 颗心 = 105 分）、还没演过：集合后两只都闲着，下一分钟演升级，记下演过；不再重复演
    e.run(`localStorage.setItem('crosspet-friendship', JSON.stringify({ 'claude+gpt': { points: 105, day: '2026-01-01', today: 0, lastCowork: 0 } }))`)
    e.run(`pageHidden = false; Math.random = () => 0.9`)
    e.run(`globalThis.__said = []; { const o = say; say = l => { if (l) __said.push(l); return o(l) } }`)
    e.run(`gather()`)
    await e.advance(1500)
    await e.advance(65000)
    const ups = e.msgs().filter(m => m.companionCall?.fn === 'chat' && m.companionCall.args[1] === 'friend_up')
    const main = e.run(`mainCharacter()`), other = main === 'gpt' ? 'claude' : 'gpt'
    const lines = e.run(`PairChat.LEVEL_LINES`)
    assert(ups.length === 1 && ups[0].companionCall.args[0] === lines[other][1], `companion level line: ${JSON.stringify(ups)}`)
    assert(e.run(`__said`).includes(lines[main][1]), `main level line: ${JSON.stringify(e.run(`__said`))}`)
    assert(friendStore(e)['claude+gpt'].shown === 2, `shown not saved: ${JSON.stringify(friendStore(e))}`)
    await e.advance(30 * 60000)
    assert(e.msgs().filter(m => m.companionCall?.args?.[1] === 'friend_up').length === 1, 'level-up played twice')
    // 主桌宠说的那一刻换上升级的图（没画就是 happy），飘心
    e.run(`chat('测试', 'friend_up')`)
    assert(e.state().pose === 'friend_up' && e.run(`framesFor('friend_up')`).length > 0, `friend_up pose: ${e.state().pose}`)
    assert(!e.errors.length, `page errors: ${JSON.stringify(e.errors)}`)
  }],
  ['companion_chat_line', async e => {
    const c = await rolePage('companion')
    c.run(`setCharacter('gpt', true)`)
    await c.advance(1000)
    const before = c.state().pose
    c.run(`chat('一起喝茶？')`)
    assert(c.state().bubble === '一起喝茶？', `companion bubble: ${c.state().bubble}`)
    assert(c.state().pose === before, `no look given but pose changed: ${c.state().pose}`)
    await c.advance(6500)
    assert(c.state().bubble !== '一起喝茶？', 'companion chat not cleared')
    // 带立绘：说的时候换上，6 秒后回到常态
    c.run(`chat('好耶 :3', 'happy')`)
    assert(c.state().pose === 'happy', `chat look: ${c.state().pose}`)
    await c.advance(6500)
    assert(c.state().pose !== 'happy', `chat look not reverted: ${c.state().pose}`)
    c.run(`chat('乱写的', 'nope')`)
    assert(c.state().pose !== 'nope', 'unknown look applied')
    assert(!c.errors.length, `page errors: ${JSON.stringify(c.errors)}`)
  }],
  ['friendship_cowork_cofinish_pats', async e => {
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['d1','writing','claude-desktop'])); setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(100)
    assert(lastCompanions(e).length === 1, `precondition: ${JSON.stringify(lastCompanions(e))}`)
    assert(friendStore(e)['claude+gpt']?.points === 2, `cowork: ${JSON.stringify(friendStore(e))}`)
    await e.advance(30000)
    assert(friendStore(e)['claude+gpt'].points === 2, 'cowork counted twice within 10 minutes')
    // 前后脚干完（5 分钟内）
    e.run(`setSessions('gpt', csess(['s1','happy','codex','Stop']))`)
    await e.advance(60000)
    e.run(`setSessions('claude', csess(['d1','happy','claude-desktop','Stop']))`)
    await e.advance(100)
    assert(friendStore(e)['claude+gpt'].points === 4, `cofinish: ${JSON.stringify(friendStore(e))}`)
    // 5 分钟内分别摸了两只（额外那只由外壳转 notePat，主桌宠是自己被点）
    e.run(`notePat('gpt')`)
    await e.advance(1000)
    e.run(`handleClick('pat')`)
    await e.advance(100)
    assert(friendStore(e)['claude+gpt'].points === 6, `pats: ${JSON.stringify(friendStore(e))}`)
    // 同角色不算、只有一只时不记
    e.run(`notePat('claude')`)
    assert(Object.keys(friendStore(e)).length === 1, `extra pairs: ${JSON.stringify(friendStore(e))}`)
  }],
  ['cofinish_same_pair_not_repeated', async e => {
    // 前后脚干完记过一次后，这一对的「干完时间」清掉：同一对在 5 分钟内不能再靠一个人干完反复 +2
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['d1','writing','claude-desktop'])); setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(100)
    const base = friendStore(e)['claude+gpt'].points
    e.run(`setSessions('gpt', csess(['s1','happy','codex','Stop']))`)
    await e.advance(30000)
    e.run(`setSessions('claude', csess(['d1','happy','claude-desktop','Stop']))`)
    await e.advance(100)
    assert(friendStore(e)['claude+gpt'].points === base + 2, `cofinish: ${JSON.stringify(friendStore(e))}`)
    e.run(`setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(30000)
    e.run(`setSessions('gpt', csess(['s1','happy','codex','Stop']))`)
    await e.advance(100)
    assert(friendStore(e)['claude+gpt'].points === base + 2, `cofinish repeated: ${JSON.stringify(friendStore(e))}`)
  }],
  ['friendship_rows_sent_after_init', async e => {
    // 重启后开关关着：主桌宠页面 init 完把存着的友谊交一次给外壳（设置页显示灰的列表）；额外那只不发
    const seeded = page => page.run(`localStorage.setItem('crosspet-friendship', JSON.stringify(Friendship.award({}, 'claude', 'gpt', 'cofinish', Date.now())))`)
    const f = makePage()
    seeded(f)
    f.run(`init(${JSON.stringify(manifest())})`)
    await f.advance(1000)
    const sent = f.msgs().filter(m => 'friendship' in m)
    assert(sent.length === 1 && sent[0].friendship.length === 1 && sent[0].friendship[0].label.includes('Claude'), `main: ${JSON.stringify(sent)}`)
    f.run(`init(${JSON.stringify(manifest())})`)   // 换衣服时外壳会重新 init：不重复发
    await f.advance(1000)
    assert(f.msgs().filter(m => 'friendship' in m).length === 1, `re-sent on re-init: ${JSON.stringify(f.msgs())}`)
    const g = makePage()   // 存储是空的：不发
    g.run(`init(${JSON.stringify(manifest())})`)
    await g.advance(1000)
    assert(!g.msgs().some(m => 'friendship' in m), `empty store sent: ${JSON.stringify(g.msgs())}`)
    const c = makePage()
    seeded(c)
    c.run(`setRole('companion', { id: 'gpt@codex', key: 'gpt@codex', character: 'gpt', client: 'codex', label: '' })`)
    c.run(`init(${JSON.stringify(manifest())})`)
    await c.advance(1000)
    assert(!c.msgs().some(m => 'friendship' in m), `companion sent friendship: ${JSON.stringify(c.msgs())}`)
  }],
  ['friendship_backup_restore', async e => {
    // 外壳载入完先交回 friendship.json：网页的存储被清掉了也能找回；init 发的友谊行就是并好的；记账时每次都交一份给外壳存
    const rec = points => ({ points, day: '2026-01-01', today: 0, lastCowork: 0 })
    const f = makePage()
    f.run(`restoreFriendship(${JSON.stringify({ 'claude+gpt': rec(105) })})`)
    assert(friendStore(f)['claude+gpt'].points === 105, `not restored: ${JSON.stringify(friendStore(f))}`)
    assert(!f.msgs().some(m => 'friendshipStore' in m), `echoed an unchanged backup: ${JSON.stringify(f.msgs())}`)
    f.run(`init(${JSON.stringify(manifest())})`)
    await f.advance(1000)
    const rows = f.msgs().filter(m => 'friendship' in m)
    assert(rows.length === 1 && rows[0].friendship[0].hearts === 4, `rows: ${JSON.stringify(rows)}`)
    f.run(`friendAward([['claude', 'gpt']], 'pats')`)
    const backups = f.msgs().filter(m => 'friendshipStore' in m)
    assert(backups.length === 1 && backups[0].friendshipStore['claude+gpt'].points === 107, `backup: ${JSON.stringify(backups)}`)
    // 网页这边比备份新（或备份没有）：回写一次让备份跟上；没有备份、网页也是空的：不发
    const g = makePage()
    g.run(`localStorage.setItem('crosspet-friendship', ${JSON.stringify(JSON.stringify({ 'claude+gpt': rec(50) }))})`)
    g.run(`restoreFriendship(${JSON.stringify({ 'claude+gpt': rec(20) })})`)
    const up = g.msgs().filter(m => 'friendshipStore' in m)
    assert(up.length === 1 && up[0].friendshipStore['claude+gpt'].points === 50 && friendStore(g)['claude+gpt'].points === 50, `stale backup: ${JSON.stringify(up)}`)
    const h = makePage()
    h.run('restoreFriendship(null)')
    assert(!h.msgs().some(m => 'friendshipStore' in m) && !h.run(`localStorage.getItem('crosspet-friendship')`), 'empty restore wrote something')
  }],
  ['companion_first_character_gets_entrance', async e => {
    // 额外那只的角色正好是清单里排第一的（claude）：init 不能先悄悄换上她，让外壳的 setCharacter 成了空操作、没有噗和招呼
    const c = makePage()
    c.run(`setRole('companion', { id: 'claude@claude-cli', key: 'claude@claude-cli', character: 'claude', client: 'claude-cli', label: '' })`)
    c.run(`var __poofs = 0; { const p = $('poof'), add = p.classList.add.bind(p.classList); p.classList.add = (...a) => { if (a.includes('go')) __poofs++; return add(...a) } }`)
    c.run(`init(${JSON.stringify(manifest())}); setCharacter('claude')`)
    await c.advance(1000)
    assert(c.state().charId === 'claude', `charId: ${c.state().charId}`)
    assert(c.run('__poofs') >= 1, 'no poof for the first character')
    assert(c.says().some(x => x.line === 'Claude hello'), `no greeting: ${JSON.stringify(c.says())}`)
    assert(!c.errors.length, `page errors: ${JSON.stringify(c.errors)}`)
  }],
  ['gather_entrance_is_uniform', async e => {
    // 集合来的（id 是 <角色>@gather，重号的带 #n）：不管哪个角色、招呼冷却没冷却，都演同一个得意动作、说「（名字）到！」；
    // 干活来的照旧说自己的招呼
    for (const [id, ch, name] of [['claude@gather', 'claude', 'Claude'], ['gpt@gather#2', 'gpt', 'GPT']]) {
      const c = makePage()
      c.run(`setRole('companion', { id: '${id}', key: '${ch}@gather', character: '${ch}', client: null, label: '' })`)
      c.run(`init(${JSON.stringify(manifest())}); setCharacter('${ch}')`)
      await c.advance(1000)
      assert(c.says().some(x => x.line === `${name}到！`), `${id} says: ${JSON.stringify(c.says())}`)
      assert(c.state().pose === 'proud', `${id} pose: ${c.state().pose}`)
      await c.advance(7000)
      assert(c.state().pose === 'idle', `${id} did not settle: ${c.state().pose}`)
      assert(!c.errors.length, `page errors: ${JSON.stringify(c.errors)}`)
    }
    // 画了举手答到的专属图（roll_call）就用它
    const r = makePage(), m = manifest()
    m.characters.claude.poses.roll_call = m.characters.claude.poses.idle
    r.run(`setRole('companion', { id: 'claude@gather', key: 'claude@gather', character: 'claude', client: null, label: '' })`)
    r.run(`init(${JSON.stringify(m)}); setCharacter('claude')`)
    await r.advance(1000)
    assert(r.state().pose === 'roll_call', `roll_call pose: ${r.state().pose}`)
    await r.advance(7000)
    assert(r.state().pose === 'idle', `roll_call did not settle: ${r.state().pose}`)
    const w = makePage()
    w.run(`setRole('companion', { id: 'claude@claude-cli', key: 'claude@claude-cli', character: 'claude', client: 'claude-cli', label: '' })`)
    w.run(`init(${JSON.stringify(manifest())}); setCharacter('claude')`)
    await w.advance(1000)
    assert(!w.says().some(x => x.line.endsWith('到！')), `work pet says: ${JSON.stringify(w.says())}`)
  }],
  ['send_home_prefers_window_id', async e => {
    // 窗口 id 和别的那只的 key 撞了（集合接管后 id 留着旧 key）：先按 id 认
    await multiOn(e, 'gpt')
    e.run(`var __sent = []; { const sh = Companions.sendHome; Companions.sendHome = (s, k, t) => { __sent.push(k); return sh(s, k, t) } }`)
    e.run(`companionsState = { pets: [
      { id: 'claude@claude-cli#2', key: 'claude@claude-cli', character: 'claude', client: 'claude-cli', via: 'work', quota: false },
      { id: 'claude@claude-cli', key: 'claude@claude-desktop', character: 'claude', client: 'claude-desktop', via: 'gather', quota: true },
    ], awaySince: null, idleSince: {}, sentHome: {}, gatherKeys: {} }`)
    e.run(`sendHome('claude@claude-cli')`)
    assert(JSON.stringify(e.run('__sent')) === '["claude@claude-desktop"]', `sent home: ${JSON.stringify(e.run('__sent'))}`)
  }],
  ['multi_off_untouched', async e => {
    // 开关关着：会话、按客户端的状态、前台、集合都来了，也不发任何多桌宠消息，主桌宠照旧演
    e.run(`setSessions('gpt', csess(['s1','writing','codex'])); setSessions('claude', csess(['c1','reading','claude-cli']))`)
    e.run(`setForeground({ kind: 'terminal' }); setRunning(['claude@claude-desktop'])`)
    e.run(`applyClientState('gpt', 'codex', { pose: 'reading', event: 'PreToolUse', ts: Date.now() / 1000 })`)
    await e.advance(500)
    assert(e.state().pose !== 'reading', 'applyClientState played while the switch is off')
    e.run(`hook('gpt','writing','PreToolUse')`)
    await e.advance(3000)
    assert(e.state().pose === 'writing', `main pet ignores her own work: ${e.state().pose}`)
    assert(e.run(`playEgg(true)`) === true, 'egg blocked while the switch is off')
    e.run(`notePat('claude'); handleClick('pat')`)
    await e.advance(60000)
    assert(multiMsgs(e).length === 0, `multi-pet messages while off: ${JSON.stringify(multiMsgs(e))}`)
    assert(!e.run(`localStorage.getItem('crosspet-friendship')`), 'friendship recorded with a single pet')
  }],
  ['main_emits_companion_for_codex', async e => {
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['c1','idle','claude-desktop','SessionStart'])); setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(100)
    const list = lastCompanions(e)
    assert(list && list.length === 1, `companions: ${JSON.stringify(companionLists(e))}`)
    const p = list[0]
    assert(p.id === 'gpt@codex' && p.key === 'gpt@codex' && p.character === 'gpt' && p.client === 'codex' && p.quota === true && p.label === '',
      `entry: ${JSON.stringify(p)}`)
    assert(e.state().charId === 'claude', 'main pet switched to GPT')
    // Codex 干完了，你切到浏览器：1 分钟后她走（companionLeave），列表变空
    e.run(`setSessions('gpt', csess(['s1','happy','codex','Stop'])); setForeground({ kind: 'other' })`)
    await e.advance(70000)
    assert(e.msgs().some(m => m.companionLeave === 'gpt@codex'), `no companionLeave: ${JSON.stringify(multiMsgs(e))}`)
    assert(lastCompanions(e).length === 0, `still listed: ${JSON.stringify(lastCompanions(e))}`)
    // 列表没变时不重复发
    const n = companionLists(e).length
    await e.advance(30000)
    assert(companionLists(e).length === n, 'unchanged list was re-sent')
  }],
  ['main_plays_only_claimed_client', async e => {
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['d1','thinking','claude-desktop'],['c1','writing','claude-cli']))`)
    await e.advance(3000)
    let s = e.state()
    assert(!s.multi && s.cards === 0, `main juggles the other client's sessions: ${JSON.stringify(s)}`)
    const list = lastCompanions(e)
    assert(list.length === 1 && list[0].key === 'claude@claude-cli' && list[0].label === '终端' && list[0].quota === false,
      `companions: ${JSON.stringify(list)}`)
    e.run(`applyClientState('claude', 'claude-cli', { pose: 'running', event: 'PreToolUse', ts: Date.now() / 1000 })`)
    e.run(`applyCharState('claude', { pose: 'running', event: 'PreToolUse', ts: Date.now() / 1000 })`)   // 旧的按角色那份：被终端那只写过
    await e.advance(3000)
    assert(e.state().pose !== 'running', `main played the terminal client: ${e.state().pose}`)
    e.run(`applyClientState('claude', 'claude-desktop', { pose: 'reading', event: 'PreToolUse', ts: Date.now() / 1000 })`)
    await e.advance(3000)
    assert(e.state().pose === 'reading', `main ignores her claimed client: ${e.state().pose}`)
  }],
  ['unknown_model_current_played_by_main', async e => {
    // 多模型宿主里没有对应角色的模型（current-state.json）：开关开着、主桌宠的角色已有按客户端的状态时也由主桌宠演（设计第一节）
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['d1','idle','claude-desktop']))`)
    e.run(`applyClientState('claude', 'claude-desktop', { pose: 'idle', event: 'Stop', ts: Date.now() / 1000 })`)
    await e.advance(3000)
    e.run(`applyCharState('current', { pose: 'writing', event: 'PreToolUse', ts: Date.now() / 1000 })`)
    await e.advance(500)
    assert(e.state().pose === 'writing', `current swallowed with the switch on: ${e.state().pose}`)
  }],
  ['current_sessions_no_extra_pet', async e => {
    // 开关开着：current 会话（client 是 cursor）不算主桌宠角色的另一个客户端，不冒一只永远没状态的；由主桌宠演
    await multiOn(e, 'claude')
    e.run(`setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    e.run(`setSessions('claude', csess(['d1','writing','claude-desktop'])); setSessions('current', csess(['x1','reading','cursor']))`)
    await e.advance(3000)
    assert((lastCompanions(e) || []).length === 0, `extra pet for current: ${JSON.stringify(lastCompanions(e))}`)
    const s = e.state()
    assert(s.multi && s.cards === 2, `main does not show current sessions: ${JSON.stringify(s)}`)
  }],
  ['no_client_files_fallback', async e => {
    // 旧钩子：会话没有 client、没有 @ 状态文件 → 只有一只 Claude，主桌宠照旧按 <角色>-state.json 演（Review Focus 1）
    await multiOn(e, 'claude')
    e.run(`setSessions('claude', sess(['c1','writing'])); hook('claude','writing','PreToolUse')`)
    await e.advance(3000)
    assert(e.state().pose === 'writing', `main does not play the old state: ${e.state().pose}`)
    assert((lastCompanions(e) || []).length === 0, `extra Claude appeared: ${JSON.stringify(lastCompanions(e))}`)
  }],
  ['egg_blocked_with_companions', async e => {
    await multiOn(e, 'gpt')
    e.run(`setSessions('claude', csess(['c1','writing','claude-cli']))`)
    await e.advance(500)
    assert(lastCompanions(e).length === 1, `precondition: ${JSON.stringify(lastCompanions(e))}`)
    assert(e.msgs().some(m => m.eggAllowed === false), 'no eggAllowed:false')
    assert(e.run(`playEgg(true)`) === false, 'egg played next to a companion')
    // 只剩主桌宠：彩蛋照旧；正演着时冒出额外那只：彩蛋收掉、换回原来的角色
    const f = await fresh()
    await multiOn(f, 'gpt')
    assert(f.run(`playEgg(true)`) === true, 'egg blocked with nobody around')
    await f.advance(3000)
    assert(f.state().egg, 'egg not playing')
    f.run(`setSessions('claude', csess(['c1','writing','claude-cli']))`)
    await f.advance(1500)
    const s = f.state()
    assert(!s.egg && s.charId === 'gpt' && s.caption === 'GPT' && !s.stageHidden, `egg not ended: ${JSON.stringify(s)}`)
    assert(f.msgs().some(m => m.eggAllowed === false), 'no eggAllowed:false')
    assert(!f.errors.length, `page errors: ${JSON.stringify(f.errors)}`)
  }],
  ['reload_resends_full_list', async e => {
    await multiOn(e, 'claude', `setSessions('gpt', csess(['s1','writing','codex']))`)
    assert(lastCompanions(e).length === 1, `precondition: ${JSON.stringify(companionLists(e))}`)
    // 页面重载（Windows 渲染重启）：新页面，外壳重新交一遍；第一次 companions 就是完整列表，没有先发一个空的
    const f = await fresh()
    f.run(`setCharacter('claude', true)`)
    await f.advance(1000)
    f.run(`setRole('main'); setMultiPets({ on: true, rest: 'auto', mainPet: '' })`)
    await f.advance(300)
    f.run(`setSessions('gpt', csess(['s1','writing','codex'])); setForeground({ kind: 'ai', character: 'claude', client: 'claude-desktop' })`)
    await f.advance(3000)
    assert(f.msgs().some(m => m.eggAllowed === false), 'reloaded page did not re-send eggAllowed')
    const lists = companionLists(f)
    assert(lists.length >= 1 && lists[0].length === 1 && lists[0][0].id === 'gpt@codex', `first list after reload: ${JSON.stringify(lists)}`)
    // 列表没变也会定时算一次，但不重复发
    await f.advance(20000)
    assert(companionLists(f).length === 1, `re-sent: ${JSON.stringify(companionLists(f))}`)
  }],
  ['call_one_companion', async e => {
    // 「叫她出来」：多桌宠开关关着也能叫；只叫来这一个，算集合（菜单显示「解散」），一起在场攒好感
    e.run(`setRole('main'); pageHidden = false`)   // 在场要看得见（测试页默认按看不见跑，见 friendship_together_ten_minutes）
    assert(e.run(`callCompanion('claude')`) === true, 'call refused')
    await e.advance(2000)
    let list = lastCompanions(e)
    assert(list && list.length === 1 && list[0].character === 'claude' && list[0].id === 'claude@gather', `called: ${JSON.stringify(list)}`)
    assert(lastGathering(e) === true, 'not marked as gathering')
    assert(e.run(`callCompanion('claude')`) === false, 'called the same one twice')
    assert(e.run(`callCompanion('gpt')`) === false, 'called the main pet')
    assert(e.run(`callCompanion('egg-gpt')`) === false, 'called an egg')
    await e.advance(11 * 60 * 1000)
    const store = JSON.parse(e.run(`localStorage.getItem('crosspet-friendship')`) || '{}')
    assert(store['claude+gpt']?.points > 0, `no friendship while called out: ${JSON.stringify(store)}`)
    // 让她先回去：走掉、不再算集合
    e.run(`sendHome('claude@gather')`)
    await e.advance(2000)
    assert(lastCompanions(e).length === 0 && lastGathering(e) === false, `still here: ${JSON.stringify(multiMsgs(e).slice(-2))}`)
  }],
  ['called_companions_come_back_after_restart', async e => {
    // 叫出来 / 集合来的记在 crosspet-gathered：重启（新页面、同一份存储）后一只接一只再叫回来；送走的不回来
    e.run(`setRole('main')`)
    e.run(`callCompanion('claude'); callCompanion('grok')`)
    await e.advance(2000)
    e.run(`sendHome('grok@gather')`)
    await e.advance(2000)
    const saved = e.run(`localStorage.getItem('crosspet-gathered')`)
    assert(saved === '["claude"]', `saved: ${saved}`)
    const f = makePage()
    f.run(`localStorage.setItem('crosspet-gathered', ${JSON.stringify(saved)})`)
    f.run(`init(${JSON.stringify(manifest())}); setCharacter('gpt', true)`)
    await f.advance(4000)
    const list = lastCompanions(f)
    assert(list && list.length === 1 && list[0].character === 'claude', `after restart: ${JSON.stringify(list)}`)
    f.run(`init(${JSON.stringify(manifest())})`)   // 换衣服时外壳重新 init：不重复叫
    await f.advance(4000)
    assert(lastCompanions(f).length === 1, `re-init called again: ${JSON.stringify(lastCompanions(f))}`)
    f.run('dismiss()')
    await f.advance(3000)
    assert(f.run(`localStorage.getItem('crosspet-gathered')`) === '[]', 'dismiss did not clear the saved list')
  }],
  ['gather_prepares_before_arriving', async e => {
    // Windows 外壳说能预开（setShellPrepares）：集合先交要来的角色让外壳在屏幕外开好，备好了才一只只登场；
    // 外壳一直不回（崩了、老版本）就等 5 秒照常来。macOS 不说：照旧直接来（gather_staggered 测）
    await multiOn(e, 'gpt')
    e.run(`setShellPrepares(true); gather()`)
    const prep = e.msgs().filter(m => 'companionsPrepare' in m)
    assert(prep.length === 1 && prep[0].companionsPrepare.characters.includes('claude') && !prep[0].companionsPrepare.characters.includes('gpt'), `prepare: ${JSON.stringify(prep)}`)
    assert(e.state().bubble === 'GPT到！', `main did not answer first: ${e.state().bubble}`)
    assert(lastGathering(e) === true, 'menu would not show 解散 while preparing')
    await e.advance(3000)
    assert(!(lastCompanions(e) || []).length, `arrived before prepared: ${JSON.stringify(lastCompanions(e))}`)
    e.run(`companionsPrepared(${prep[0].companionsPrepare.batch})`)
    await e.advance(100)
    assert(lastCompanions(e).length === 1, `first did not arrive right after prepared: ${JSON.stringify(lastCompanions(e))}`)
    await e.advance(1000)
    assert(lastCompanions(e).length === 2, `not one per second: ${JSON.stringify(lastCompanions(e))}`)
    e.run(`companionsPrepared(${prep[0].companionsPrepare.batch})`)   // 重复回：不重新排一遍
    await e.advance(10000)
    const n = prep[0].companionsPrepare.characters.length
    assert(lastCompanions(e).length === n, `expected ${n}: ${JSON.stringify(lastCompanions(e))}`)
    // 叫一只：外壳不回也照样来（等满 5 秒）
    e.run(`dismiss()`)
    await e.advance(15000)
    assert(lastCompanions(e).length === 0, 'dismiss')
    e.run(`callCompanion('claude')`)
    await e.advance(4000)
    assert(!lastCompanions(e).length, 'called one arrived before the timeout')
    await e.advance(1500)
    assert(lastCompanions(e).length === 1 && lastCompanions(e)[0].character === 'claude', `timeout fallback: ${JSON.stringify(lastCompanions(e))}`)
    // 备着的时候解散：那批作废，备好了也不来
    e.run(`dismiss()`)
    await e.advance(3000)
    e.run(`gather()`)
    const b2 = e.msgs().filter(m => 'companionsPrepare' in m).slice(-1)[0].companionsPrepare.batch
    e.run(`dismiss()`)
    e.run(`companionsPrepared(${b2})`)
    await e.advance(8000)
    assert(!lastCompanions(e).length, `cancelled batch still arrived: ${JSON.stringify(lastCompanions(e))}`)
  }],
  ['parked_companion_waits_then_arrives', async e => {
    // 屏幕外备着的那只：悄悄换上、整页藏着、不说话；arriveNow 才噗一下出来答到
    const c = makePage()
    c.run(`setRole('companion', { id: 'claude@gather', key: 'claude@gather', character: 'claude', client: null, label: '', parked: true })`)
    c.run(`init(${JSON.stringify(manifest())})`)
    await c.advance(1000)
    assert(c.run(`document.body.classList.contains('parked')`) === true, 'parked page not hidden')
    assert(c.state().charId === 'claude' && c.state().bubble === '', `parked spoke: ${JSON.stringify(c.state())}`)
    c.run(`setRole('companion', { id: 'claude@gather', key: 'claude@gather', character: 'claude', client: null, label: '' }); arriveNow()`)
    assert(c.run(`document.body.classList.contains('parked')`) === false, 'still hidden after arriveNow')
    await c.advance(500)
    assert(c.state().bubble === 'Claude到！' && !c.state().stageHidden, `arrival: ${JSON.stringify(c.state())}`)
    c.run(`arriveNow()`)   // 已经出来了：不再噗一次
    await c.advance(500)
    assert(!c.state().stageHidden, 'second arriveNow hid her')
  }],
  ['gather_staggered', async e => {
    await multiOn(e, 'gpt')
    e.run(`gather()`)
    // 主桌宠自己也答到（举手的图没有就用 proud）
    assert(e.state().bubble === 'GPT到！' && ['roll_call', 'proud'].includes(e.state().pose), `main roll call: ${e.state().bubble} ${e.state().pose}`)
    await e.advance(10)
    let list = lastCompanions(e)
    assert(list.length === 1, `first one: ${JSON.stringify(list)}`)
    await e.advance(1000)
    list = lastCompanions(e)
    const chars = list.map(p => p.character)
    assert(list.length === 2 && chars.includes('claude') && chars.includes('grok'), `after 1s: ${JSON.stringify(list)}`)
    assert(!chars.includes('gpt') && !chars.includes('egg-gpt'), `main / egg summoned: ${JSON.stringify(list)}`)
    assert(list.every(p => p.id === p.character + '@gather'), `ids: ${JSON.stringify(list)}`)
    assert(lastGathering(e) === true, `gathering while gathered: ${JSON.stringify(multiMsgs(e).slice(-1))}`)
    assert(e.msgs().filter(m => 'companions' in m).every(m => typeof m.gathering === 'boolean'), `shape: ${JSON.stringify(multiMsgs(e))}`)
    // 集合来的 Claude 收编了干活的终端：key 换成那个客户端，id 不变（外壳按 id 认窗口）
    e.run(`setSessions('claude', csess(['c1','writing','claude-cli']))`)
    await e.advance(100)
    const c = lastCompanions(e).find(p => p.character === 'claude')
    assert(c && c.id === 'claude@gather' && c.key === 'claude@claude-cli', `adopted: ${JSON.stringify(lastCompanions(e))}`)
    // 解散：Grok 说 bye 走；Claude 收编的终端还在干活，她不走、不重新冒，窗口 id 不变
    e.run(`dismiss()`)
    await e.advance(3000)
    const leaves = e.shellMsgs.filter(x => 'companionLeave' in x.msg)
    assert(leaves.length === 1 && leaves[0].msg.companionLeave === 'grok@gather', `dismiss: ${JSON.stringify(leaves)}`)
    const after = lastCompanions(e)
    assert(after.length === 1 && after[0].id === 'claude@gather' && after[0].key === 'claude@claude-cli', `left over: ${JSON.stringify(after)}`)
    // 解散完：留下的是干活那只，不算集合了（列表没变也要告诉外壳 gathering 变 false）
    assert(lastGathering(e) === false, `gathering after dismiss: ${JSON.stringify(multiMsgs(e).slice(-3))}`)
  }],
  ['window_ids_stay_unique', async e => {
    // 干活冒出来的 Claude 终端那只被集合接管（id 还是 claude@claude-cli）→ 终端会话结束退回没收编 → 收编桌面 →
    // 终端又开新会话冒出新的一只：新那只的 id 不能和她撞
    await multiOn(e, 'gpt')
    e.run(`setSessions('claude', csess(['c1','writing','claude-cli']))`)
    await e.advance(100)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`setSessions('claude', {})`)
    await e.advance(100)
    e.run(`setSessions('claude', csess(['d1','writing','claude-desktop']))`)
    await e.advance(100)
    e.run(`setSessions('claude', csess(['d1','writing','claude-desktop'],['c2','writing','claude-cli']))`)
    await e.advance(100)
    const list = lastCompanions(e), ids = list.map(p => p.id)
    assert(list.filter(p => p.character === 'claude').length === 2, `claudes: ${JSON.stringify(list)}`)
    assert(new Set(ids).size === ids.length, `duplicate ids: ${JSON.stringify(list)}`)
  }],
  ['multi_on_while_gathered_and_quick_dismiss', async e => {
    // 关着时集合了，再打开开关：不等 1.5 秒热身，马上按开着算
    e.run(`gather()`)
    await e.advance(1500)
    const n = companionLists(e).length
    e.run(`setSessions('gpt', csess(['s1','writing','codex'])); setCharacter('claude', true)`)
    await e.advance(1000)
    e.run(`setMultiPets({ on: true, rest: 'auto', mainPet: '' })`)
    assert(companionLists(e).length > n && lastCompanions(e).some(p => p.key === 'gpt@codex'), `no immediate update: ${JSON.stringify(lastCompanions(e))}`)
    // 刚打开、还在热身时集合又马上解散：没有可错开的，直接收尾（关着时发空列表、eggAllowed 回 true）
    const f = await fresh()
    f.run(`gather(); dismiss()`)
    await f.advance(100)
    f.run(`setMultiPets({ on: true, rest: 'auto', mainPet: '' })`)
    f.run(`gather()`)
    await f.advance(10)
    f.run(`dismiss()`)
    f.run(`setMultiPets({ on: false, rest: 'auto', mainPet: '' })`)
    await f.advance(30000)
    assert(!f.errors.length, `page errors: ${JSON.stringify(f.errors)}`)
    const last = f.msgs().filter(m => 'companions' in m).slice(-1)[0]
    assert(!last || last.companions.length === 0, `left over: ${JSON.stringify(multiMsgs(f))}`)
  }],
  ['gather_while_off', async e => {
    // 集合不受开关限制：开关关着也能叫；只是不冒干活的那几只
    e.run(`setCharacter('gpt', true)`)
    await e.advance(1000)
    e.run(`setSessions('grok', csess(['g1','writing','grok'])); gather()`)
    await e.advance(1500)
    let list = lastCompanions(e)
    assert(list && list.length === 2 && list.every(p => p.id.endsWith('@gather')), `gathered: ${JSON.stringify(companionLists(e))}`)
    assert(lastGathering(e) === true, `gathering while off: ${JSON.stringify(multiMsgs(e).slice(-1))}`)
    assert(e.run(`playEgg(true)`) === false, 'egg next to gathered pets')
    // 集合来的 Claude 收编干活的终端；GPT 主桌宠没占着的 codex 不冒
    e.run(`setSessions('claude', csess(['c1','writing','claude-cli'])); setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(100)
    list = lastCompanions(e)
    assert(list.length === 2 && list.find(p => p.character === 'claude').key === 'claude@claude-cli' && !list.some(p => p.character === 'gpt'), `off + work: ${JSON.stringify(list)}`)
    // 解散：都走（开关关着不转成干活那只），列表空了发一次空列表，之后不再发
    e.run(`dismiss()`)
    await e.advance(3000)
    const leaves = e.msgs().filter(m => 'companionLeave' in m).map(m => m.companionLeave)
    assert(leaves.length === 2 && leaves.includes('claude@gather'), `leaves: ${JSON.stringify(leaves)}`)
    assert(lastCompanions(e).length === 0 && e.msgs().filter(m => 'eggAllowed' in m).slice(-1)[0].eggAllowed === true, `after dismiss: ${JSON.stringify(multiMsgs(e))}`)
    assert(lastGathering(e) === false, `gathering after dismiss while off: ${JSON.stringify(multiMsgs(e).slice(-3))}`)
    const n = multiMsgs(e).length
    await e.advance(30000)
    assert(multiMsgs(e).length === n, `messages after dismiss: ${JSON.stringify(multiMsgs(e).slice(n))}`)
    assert(e.run(`playEgg(true)`) === true, 'egg still blocked after dismiss')
  }],
  ['send_home_and_switch_off', async e => {
    await multiOn(e, 'claude', `setSessions('gpt', csess(['s1','writing','codex']))`)
    e.run(`sendHome('gpt@codex')`)
    await e.advance(100)
    assert(e.msgs().some(m => m.companionLeave === 'gpt@codex') && lastCompanions(e).length === 0, `sendHome: ${JSON.stringify(multiMsgs(e))}`)
    e.run(`setSessions('grok', csess(['g1','writing','grok']))`)
    await e.advance(100)
    assert(lastCompanions(e).length === 1, `grok: ${JSON.stringify(lastCompanions(e))}`)
    // 关掉开关：发一次空列表让外壳全关，之后不再发
    e.run(`setMultiPets({ on: false, rest: 'auto', mainPet: '' })`)
    await e.advance(100)
    assert(lastCompanions(e).length === 0, 'no empty list on switch off')
    const n = multiMsgs(e).length
    e.run(`setSessions('gpt', csess(['s1','writing','codex']))`)
    await e.advance(30000)
    assert(multiMsgs(e).length === n, `messages after switch off: ${JSON.stringify(multiMsgs(e).slice(n))}`)
  }],
  ['quota_celebration_goes_to_the_companion', async e => {
    await multiOn(e, 'claude', `setSessions('gpt', csess(['s1','writing','codex']))`)
    const now = e.clk.now() / 1000
    e.run(`setQuota('gpt', {text:'5h 20%', windows:[{label:'5h', used:80, reset:${now + 3600}}]})`)
    e.run(`setQuota('gpt', {text:'5h 95%', windows:[{label:'5h', used:5, reset:${now + 3600 + 18000}}]})`)
    await e.advance(100)
    const call = e.msgs().find(m => m.companionCall)
    assert(call && call.companionCall.id === 'gpt@codex' && call.companionCall.fn === 'celebrate' && call.companionCall.args[1] === 'reset',
      `companionCall: ${JSON.stringify(multiMsgs(e))}`)
  }],
]
const multiNames = new Set(multiCases.map(c => c[0]))
cases.push(...multiCases)

;(async () => {
  const failures = []
  for (const [name, fn] of cases) {
    const e = await fresh()
    try {
      await fn(e)
      // 开关默认关：没打开过的场景一条多桌宠消息都不能有
      if (!multiNames.has(name) && multiMsgs(e).length) throw Error(`multi-pet messages with the switch off: ${JSON.stringify(multiMsgs(e))}`)
      if (multiNames.has(name) && e.errors.length) throw Error(`page errors: ${JSON.stringify(e.errors)}`)
    } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ file: path.join(WEB, 'index.html'), passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
