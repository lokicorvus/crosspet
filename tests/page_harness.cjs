// 页面测试共用：假的 DOM、假的时钟，跑 app/web/index.html 里整段真实脚本（加上几个辅助脚本）；不开窗口、不联网。
// page_switch_test.cjs、notebook_page_test.cjs 用
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

function makePage(startMs = START) {
  const clk = makeClock(startMs)
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
  for (const f of ['effects.js', 'text-size.js', 'codex-quota.js', 'quota-aggregate.js', 'plugin-update.js', 'stand-in.js', 'follow-policy.js', 'codex-resets.js', 'peak-hours.js', 'whats-new.js', 'companions.js', 'friendship.js', 'pair-chat.js', 'notebook.js', 'notebook-backfill.js'])
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

module.exports = { makeClock, makePage, flush, START, WEB }
