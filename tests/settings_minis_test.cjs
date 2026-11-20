// 设置页「角色」页的「显示小帮手」开关（showMinis，默认开，外壳推 state、点一下发 set）。
// 跑的是 app/web/settings.html 里整段真实脚本（加上它引的几个辅助脚本），DOM 是这里手写的小假页面；不开窗口、不联网。
//   node tests/settings_minis_test.cjs
'use strict'
const fs = require('fs'), path = require('path'), vm = require('vm')
const WEB = path.join(__dirname, '..', 'app', 'web')
const HTML = fs.readFileSync(path.join(WEB, 'settings.html'), 'utf8')

// ---- 小假 DOM：够这一页用就行 ----
const VOID = new Set(['input', 'br', 'meta', 'img', 'link', 'hr'])
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
class ClassList {
  constructor() { this.set = new Set() }
  add(...a) { a.forEach(x => this.set.add(x)) }
  remove(...a) { a.forEach(x => this.set.delete(x)) }
  contains(x) { return this.set.has(x) }
  toggle(x, force) { const on = force === undefined ? !this.set.has(x) : !!force; if (on) this.set.add(x); else this.set.delete(x); return on }
  toString() { return [...this.set].join(' ') }
}
class Text { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null } get textContent() { return this.data } }
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.dataset = {}
    this.classList = new ClassList(); this.children = []; this.childNodes = []; this.parentNode = null
    this.style = { setProperty() {} }; this.checked = false; this.disabled = false; this._value = ''
  }
  get id() { return this.attrs.id || '' } set id(v) { this.attrs.id = String(v) }
  get className() { return this.classList.toString() } set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)) }
  get type() { return (this.attrs.type || '').toLowerCase() } set type(v) { this.attrs.type = v }
  get name() { return this.attrs.name || '' }
  setAttribute(k, v) {
    v = String(v); this.attrs[k] = v
    if (k === 'class') this.className = v
    if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = v
    if (k === 'checked') this.checked = true
    if (k === 'disabled') this.disabled = true
    if (k === 'value') this._value = v
  }
  getAttribute(k) { return k === 'class' ? this.className : k in this.attrs ? this.attrs[k] : null }
  hasAttribute(k) { return k === 'class' ? this.classList.set.size > 0 : k in this.attrs }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options.find(o => o.selected) || this.options[0]; return o ? o.value : '' }
    if (this.tagName === 'OPTION') return 'value' in this.attrs ? this.attrs.value : this.textContent
    return this._value
  }
  set value(v) {
    v = String(v)
    if (this.tagName === 'SELECT') { for (const o of this.options) o.selected = o.value === v; return }
    if (this.tagName === 'OPTION') { this.attrs.value = v; return }
    this._value = v
  }
  get options() { return this.querySelectorAll('option') }
  _add(n) {
    if (typeof n === 'string') n = new Text(n)
    if (n.parentNode) n.parentNode._remove(n)
    n.parentNode = this; this.childNodes.push(n); if (n.nodeType === 1) this.children.push(n)
    return n
  }
  _remove(n) { this.childNodes = this.childNodes.filter(x => x !== n); this.children = this.children.filter(x => x !== n); n.parentNode = null }
  append(...ns) { ns.forEach(n => this._add(n)) }
  appendChild(n) { return this._add(n) }
  remove() { if (this.parentNode) this.parentNode._remove(this) }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) this._remove(n); this.append(...ns) }
  get textContent() { return this.childNodes.map(n => n.textContent).join('') }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this._add(String(v)) }
  get innerHTML() { return this._html || '' }
  set innerHTML(v) { this._html = String(v); this.replaceChildren(); parseInto(this, String(v)) }
  get offsetWidth() { return 0 }
  scrollIntoView() {} focus() {} select() {}
  descendants() { const out = []; const walk = e => { for (const c of e.children) { out.push(c); walk(c) } }; walk(this); return out }
  matches(sel) { return sel.split(',').some(s => matchChain(this, s.trim())) }
  querySelectorAll(sel) { return this.descendants().filter(e => e.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  closest(sel) { for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(sel)) return e; return null }
}
// 一节简单选择器：tag#id.cls[attr][attr=val]
function matchSimple(el, s) {
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g
  let m, used = 0
  while ((m = re.exec(s)) && m[0]) {
    used += m[0].length
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false
    if (m[2] && el.id !== m[2]) return false
    if (m[3] && !el.classList.contains(m[3])) return false
    if (m[4]) { const v = el.getAttribute(m[4]); if (v === null) return false; if (m[5] !== undefined && v !== m[5]) return false }
  }
  if (used !== s.length) throw Error('假 DOM 不认识这个选择器：' + s)
  return true
}
function matchChain(el, sel) {
  const parts = sel.split(/\s+/)
  if (!matchSimple(el, parts.pop())) return false
  let e = el.parentNode
  while (parts.length) {
    const p = parts[parts.length - 1]
    while (e && e.nodeType === 1 && !matchSimple(e, p)) e = e.parentNode
    if (!e || e.nodeType !== 1) return false
    parts.pop(); e = e.parentNode
  }
  return true
}
function parseInto(root, html) {
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g
  let m, cur = root
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { const t = m[4].replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); cur._add(t); continue }
    if (!m[2]) continue
    const tag = m[2].toLowerCase()
    if (m[1]) { for (let e = cur; e && e !== root; e = e.parentNode) if (e.tagName === tag.toUpperCase()) { cur = e.parentNode; break } continue }
    const el = new El(tag)
    const ar = /([\w-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
    let a
    while ((a = ar.exec(m[3]))) if (a[1] !== '/') el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '')
    if (tag === 'option' && el.hasAttribute('selected')) el.selected = true
    cur._add(el)
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = el
  }
}

function makePage() {
  const posted = [], store = new Map()
  const bodyHtml = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script'))
  const body = new El('body'); parseInto(body, bodyHtml)
  const document = {
    body, activeElement: null,
    documentElement: { style: { setProperty() {} } },
    getElementById: id => body.querySelector('#' + id),
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    createElement: t => new El(t), execCommand: () => false,
  }
  function Option(text, value, defSel, sel) { const o = new El('option'); o.textContent = text; o.value = value; o.selected = !!sel; return o }
  const ctx = vm.createContext({
    document, Option, console, navigator: {},
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    chrome: { webview: { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))) } },
  })
  ctx.window = ctx
  for (const [, src] of HTML.matchAll(/<script src="([^"]+)"><\/script>/g))
    vm.runInContext(fs.readFileSync(path.join(WEB, src), 'utf8'), ctx, { filename: src })
  const inline = HTML.match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInContext(inline, ctx, { filename: 'settings.html' })
  return {
    posted, store, document,
    $: id => document.getElementById(id),
    q: s => document.querySelector(s), qa: s => document.querySelectorAll(s),
    push(extra) { ctx.__s = { ...BASE, ...extra }; vm.runInContext('setState(__s)', ctx) },
    sets: key => posted.filter(m => m.cmd === 'set' && m.key === key).map(m => m.value),
  }
}
const BASE = {
  version: '1.4.0', size: 1, textSize: 1, textLinked: true, aura: 'auto', peakStyle: 'bar', quotaStyle: 'text',
  followApps: true, followEvents: true, eggs: true,
  character: 'claude',
  characters: [{ id: 'claude', name: 'Claude' }, { id: 'gpt', name: 'GPT' }, { id: 'deepseek', name: '小鲸' }],
}
const ROWS = [{ a: 'claude', b: 'gpt', label: 'Claude ♥ GPT', hearts: 5 }, { a: 'deepseek', b: 'gpt', label: '小鲸 ♥ GPT', hearts: 2 }]

function assert(cond, detail) { if (!cond) throw Error(detail) }
const hidden = el => { for (let e = el; e && e.nodeType === 1; e = e.parentNode) if (e.classList.contains('hidden')) return true; return false }
const click = el => { if (el.type === 'radio' || el.type === 'checkbox') el.checked = el.type === 'radio' ? true : !el.checked; (el.onchange || el.onclick)?.() }

const sw = p => p.q('input[data-key=showMinis]')
const cases = [
  ['开关在「角色」页、在多桌宠那张卡里，文案照设计稿', p => {
    const s = sw(p); assert(s, '没有 data-key=showMinis 的开关')
    const card = s.closest('.card'); assert(card && card.dataset.tab === 'character', '开关不在「角色」页')
    assert(card.querySelector('input[data-key=multiPets]'), '该和 multiPets 开关在同一张卡')
    const label = s.closest('.item').querySelector('.label').textContent
    assert(label.includes('显示小帮手'), '标题不对：' + label)
    assert(label.includes('她脚边陪着自己的小帮手；和别的 AI 成为好朋友后会互送，收到的也一起陪着（最多 6 个）'), '说明不对：' + label)
  }],
  ['收到 true 是开的，收到 false 是关的', p => {
    p.push({ showMinis: true }); assert(sw(p).checked, '该是开的')
    p.push({ showMinis: false }); assert(!sw(p).checked, '该是关的')
  }],
  ['点一下发 set showMinis（同现有开关的消息）', p => {
    p.push({ showMinis: true })
    click(sw(p))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'showMinis', value: false }), '消息不对：' + JSON.stringify(p.posted.at(-1)))
    click(sw(p))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'showMinis', value: true }), '再点该发 true')
  }],
]

let failed = 0
for (const [name, run] of cases) {
  try { run(makePage()); console.log('ok  ', name) }
  catch (e) { failed++; console.log('FAIL', name, '—', e.message) }
}
console.log(`${cases.length - failed}/${cases.length} 通过`)
process.exit(failed ? 1 : 0)
