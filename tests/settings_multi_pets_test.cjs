// 设置页「角色」页的多桌宠设置：开关、主桌宠、什么时候去休息、她们的友谊。
// 跑的是 app/web/settings.html 里整段真实脚本（加上它引的几个辅助脚本），DOM 是这里手写的小假页面；不开窗口、不联网。
//   node tests/settings_multi_pets_test.cjs
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
const ROWS = [{ a: 'claude', b: 'gpt', label: 'Claude ♥ GPT', hearts: 2.5 }, { a: 'deepseek', b: 'gpt', label: '小鲸 ♥ GPT', hearts: 1 }]

function assert(cond, detail) { if (!cond) throw Error(detail) }
const hidden = el => { for (let e = el; e && e.nodeType === 1; e = e.parentNode) if (e.classList.contains('hidden')) return true; return false }
const sw = p => p.q('input[data-key=multiPets]')
const click = el => { if (el.type === 'radio' || el.type === 'checkbox') el.checked = el.type === 'radio' ? true : !el.checked; (el.onchange || el.onclick)?.() }

const cases = [
  ['开关在「角色」页，文案照设计稿', p => {
    const s = sw(p); assert(s, '没有 data-key=multiPets 的开关')
    const card = s.closest('.card'); assert(card && card.dataset.tab === 'character', '开关不在「角色」页')
    const label = s.closest('.item').querySelector('.label').textContent
    assert(label.includes('在干活的 AI 各显示一只'), '开关标题不对：' + label)
    assert(label.includes('同时开着几个 AI（比如 Claude 和 Codex）时，干活的那几个各出来一只；你离开 AI 软件一会儿，干完活的就先去休息'), '开关说明不对：' + label)
    const main = p.$('mainPetRow').textContent, rest = p.$('petsRestRow').textContent
    for (const t of ['主桌宠', '跟着规则换', '固定为']) assert(main.includes(t), '主桌宠一行缺：' + t)
    for (const t of ['她们什么时候去休息', '干完活、你离开 AI 软件一会儿后', '一直留着，直到我让她回去或 AI 程序关掉']) assert(rest.includes(t), '休息一行缺：' + t)
    assert(p.$('friendship').closest('.card').dataset.tab === 'character' && p.$('friendship').textContent.includes('她们的友谊'), '友谊区不在「角色」页')
  }],
  ['开关关着：两个选项收起，友谊区不显示', p => {
    p.push({ multiPets: false, friendship: ROWS })
    assert(!sw(p).checked, '开关该是关的')
    assert(hidden(p.$('mainPetRow')) && hidden(p.$('petsRestRow')), '关着时两个选项该收起')
    assert(hidden(p.$('friendship')), '从没打开过开关，友谊区不该显示')
  }],
  ['没推 multiPets（老外壳）：按默认关', p => {
    p.push({})
    assert(!sw(p).checked && hidden(p.$('mainPetRow')) && hidden(p.$('petsRestRow')) && hidden(p.$('friendship')), '默认该是关的、选项收起')
  }],
  ['点开关发 set multiPets true（和现有开关同一种消息）', p => {
    p.push({ multiPets: false })
    click(sw(p))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'multiPets', value: true }), '发的消息不对：' + JSON.stringify(p.posted.at(-1)))
    click(sw(p))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'multiPets', value: false }), '再点该发 false')
  }],
  ['开关开着：两个选项出来', p => {
    p.push({ multiPets: true })
    assert(sw(p).checked, '开关该是开的')
    assert(!hidden(p.$('mainPetRow')) && !hidden(p.$('petsRestRow')), '开着时两个选项该显示')
  }],
  ['友谊两行：每行名字 + 五颗心，x.5 才有半颗心', p => {
    p.push({ multiPets: true, friendship: ROWS })
    assert(!hidden(p.$('friendship')), '开着、有记录时友谊区该显示')
    const rows = p.$('friendRows').querySelectorAll('.friend')
    assert(rows.length === 2, '该有两行，实际 ' + rows.length)
    const VS15 = '\ufe0e'
    assert(rows[0].querySelector('.friend-name').textContent === 'Claude ♥' + VS15 + ' GPT' && rows[1].querySelector('.friend-name').textContent === '小鲸 ♥' + VS15 + ' GPT', '名字不对（♥ 后该带 U+FE0E 按文字画）：' + JSON.stringify(rows[0].querySelector('.friend-name').textContent))
    const count = (r, cls) => r.querySelectorAll('.heart' + cls).length
    assert(r0ok(), '第一行心不对')
    function r0ok() { const r = rows[0]; return r.querySelectorAll('.heart').length === 5 && count(r, '.full') === 2 && count(r, '.half') === 1 }
    assert(rows[1].querySelectorAll('.heart').length === 5 && count(rows[1], '.full') === 1 && count(rows[1], '.half') === 0, '第二行心不对')
    assert(rows[0].querySelectorAll('.heart.full')[0].textContent === '♥\ufe0e', '整颗心用 ♥（按文字画）')
    assert(!/\d/.test(p.$('friendRows').textContent), '不显示数字')
  }],
  ['满心 5 颗、0 颗都画五个位置', p => {
    p.push({ multiPets: true, friendship: [{ a: 'claude', b: 'gpt', label: 'Claude ♥ GPT', hearts: 5 }, { a: 'claude', b: 'deepseek', label: 'Claude ♥ 小鲸', hearts: 0.5 }] })
    const rows = p.$('friendRows').querySelectorAll('.friend')
    assert(rows[0].querySelectorAll('.heart.full').length === 5 && rows[0].querySelectorAll('.heart.half').length === 0, '5 颗心该全满')
    assert(rows[1].querySelectorAll('.heart.full').length === 0 && rows[1].querySelectorAll('.heart.half').length === 1 && rows[1].querySelectorAll('.heart').length === 5, '0.5 该是一颗半心')
  }],
  ['没有记录：整块不显示', p => {
    p.push({ multiPets: true, friendship: [] })
    assert(hidden(p.$('friendship')), '空数组时友谊区该藏起来')
    p.push({ multiPets: true })
    assert(hidden(p.$('friendship')), '没推 friendship 时友谊区该藏起来')
  }],
  ['打开过再关上：友谊区还在但灰掉，选项收起', p => {
    p.push({ multiPets: true, friendship: ROWS })
    p.push({ multiPets: false, friendship: ROWS })
    assert(!hidden(p.$('friendship')), '打开过开关，关上后友谊区还该显示')
    assert(p.$('friendship').classList.contains('dim'), '关着时友谊区该灰掉')
    assert(hidden(p.$('mainPetRow')) && hidden(p.$('petsRestRow')), '关着时选项该收起')
    p.push({ multiPets: true, friendship: ROWS })
    assert(!p.$('friendship').classList.contains('dim'), '开着时不灰')
  }],
  ['「打开过」记得住：重开设置窗口，开关关着也显示友谊', p => {
    p.push({ multiPets: true, friendship: ROWS })
    const again = makePage()
    for (const [k, v] of p.store) again.store.set(k, v)
    again.push({ multiPets: false, friendship: ROWS })
    assert(!hidden(again.$('friendship')) && again.$('friendship').classList.contains('dim'), '重开后该记得打开过')
  }],
  ['主桌宠：下拉列出外壳给的角色；"" = 跟着规则换', p => {
    p.push({ multiPets: true, mainPet: '' })
    const sel = p.$('mainPetSelect')
    assert(sel.options.map(o => o.value).join() === 'claude,gpt,deepseek', '下拉角色不对：' + sel.options.map(o => o.value).join())
    assert(sel.options.map(o => o.textContent).join() === 'Claude,GPT,小鲸', '下拉名字不对')
    assert(p.q('input[name=mainPet][value=rule]').checked && !p.q('input[name=mainPet][value=fixed]').checked, '"" 该选中跟着规则换')
    p.push({ multiPets: true })
    assert(p.q('input[name=mainPet][value=rule]').checked, '没推 mainPet 时按跟着规则换')
  }],
  ['两个选项行不带 .sub（页头版本号那一行的灰色小字样式）', p => {
    p.push({ multiPets: true })
    for (const id of ['mainPetRow', 'petsRestRow']) assert(!p.$(id).classList.contains('sub') && !p.$(id).closest('.sub'), id + ' 撞上了 .sub 样式')
  }],
  ['没有角色可选：「固定为」灰掉', p => {
    p.push({ multiPets: true, characters: [] })
    assert(p.q('input[name=mainPet][value=fixed]').disabled && p.$('mainPetSelect').disabled, '下拉是空的，「固定为」该灰掉')
    p.push({ multiPets: true })
    assert(!p.q('input[name=mainPet][value=fixed]').disabled && !p.$('mainPetSelect').disabled, '有角色时不灰')
  }],
  ['心的颜色用页面的配色变量，深浅色各一份', () => {
    assert(!/\.heart[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(HTML), '.heart 里不该写死颜色')
    assert((HTML.match(/--heart:\s*#[0-9a-f]{6}/gi) || []).length === 2, '浅色、深色各该定义一份 --heart')
  }],
  ['主桌宠：固定为某个角色', p => {
    p.push({ multiPets: true, mainPet: 'gpt' })
    assert(p.q('input[name=mainPet][value=fixed]').checked && p.$('mainPetSelect').value === 'gpt', '该选中固定为 GPT')
  }],
  ['主桌宠：点选项、换下拉发 set mainPet', p => {
    p.push({ multiPets: true, mainPet: '' })
    p.$('mainPetSelect').value = 'deepseek'
    click(p.q('input[name=mainPet][value=fixed]'))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'mainPet', value: 'deepseek' }), '点「固定为」该发下拉里的角色：' + JSON.stringify(p.posted.at(-1)))
    p.push({ multiPets: true, mainPet: 'deepseek' })
    click(p.q('input[name=mainPet][value=rule]'))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'mainPet', value: '' }), '点「跟着规则换」该发 ""')
    p.push({ multiPets: true, mainPet: '' })
    p.$('mainPetSelect').value = 'gpt'; p.$('mainPetSelect').onchange()
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'mainPet', value: 'gpt' }), '换下拉该直接固定为那个角色')
  }],
  ['主桌宠：固定的角色不在了（删掉了）还列着，免得悄悄换掉', p => {
    p.push({ multiPets: true, mainPet: 'grok' })
    assert(p.$('mainPetSelect').value === 'grok', '下拉该显示 grok')
  }],
  ['休息：默认 auto；点「一直留着」发 stay', p => {
    p.push({ multiPets: true })
    assert(p.q('input[name=petsRest][value=auto]').checked && !p.q('input[name=petsRest][value=stay]').checked, '默认该选干完活就休息')
    click(p.q('input[name=petsRest][value=stay]'))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'petsRest', value: 'stay' }), '该发 stay')
    p.push({ multiPets: true, petsRest: 'stay' })
    assert(p.q('input[name=petsRest][value=stay]').checked, '推回 stay 该选中')
    click(p.q('input[name=petsRest][value=auto]'))
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'petsRest', value: 'auto' }), '该发 auto')
  }],
  ['现有开关照旧', p => {
    p.push({ followApps: true })
    const f = p.q('input[data-key=followApps]')
    assert(f.checked, 'followApps 该是开的')
    click(f)
    assert(JSON.stringify(p.posted.at(-1)) === JSON.stringify({ cmd: 'set', key: 'followApps', value: false }), 'followApps 消息变了')
  }],
]

let failed = 0
for (const [name, run] of cases) {
  try { run(makePage()); console.log('ok  ', name) }
  catch (e) { failed++; console.log('FAIL', name, '—', e.message) }
}
console.log(`${cases.length - failed}/${cases.length} 通过`)
process.exit(failed ? 1 : 0)
