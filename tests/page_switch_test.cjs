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
  for (const id of ['wrap', 'bubble', 'stage', 'aura', 'shadow', 'body', 'a', 'b', 'blink', 'fx', 'cards', 'more', 'newsCard', 'newsText', 'poof', 'foot', 'caption', 'quota'])
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
  ctx.window = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext('Math.random = () => 0.99', ctx)   // 不随机出闲时小动作、彩蛋
  for (const f of ['effects.js', 'text-size.js', 'codex-quota.js', 'quota-aggregate.js', 'plugin-update.js', 'stand-in.js', 'follow-policy.js', 'codex-resets.js', 'peak-hours.js', 'whats-new.js'])
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
    function sess(...entries) { const o = {}; entries.forEach(([sid, p, ev]) => o[sid] = { pose: p, event: ev || 'PreToolUse', ts: (Date.now() - 150) / 1000 }); return o }
  `)
  run('setPageHidden(true)')   // 特效的逐帧刷新不在这里测
  return { run, clk, advance: ms => clk.advance(ms), state: () => run('__state()'), says: () => run('__says'), errors: clk.errors }
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

;(async () => {
  const failures = []
  for (const [name, fn] of cases) {
    const e = await fresh()
    try { await fn(e) } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ file: path.join(WEB, 'index.html'), passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
