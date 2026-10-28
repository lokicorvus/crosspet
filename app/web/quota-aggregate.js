// 额度聚合：设置里「合并显示各家额度」打开后，小窗不只显示当前角色的额度，而是每家一行排成表：
//   Claude   5h 98% · 07:50 │ 周 99%
//   GPT      5h 12% · 04:31 │ 周 78%
// 只做排版，不碰姿态：「累了」「额度紧张」仍然只看她自己的额度（见 index.html 的 setQuota / restPose）。
// 纯函数 rows() 和测试（tests/quota_aggregate.test.js）共用；render() 把结果画进小窗，index.html 和图例脚本共用。
;(function (root) {
  const SHORT = { '5小时': '5h', '本周': '周' }   // 窗口名缩写；别的（花费、Gemini 的模型池）照原样
  const LOW_LEFT = 10                             // 剩余 ≤ 10% 算紧张，和各家接入的 low 判断（用了 90%）一致

  // 一段额度原文（「5小时 剩余 98% · 07:50 重置」）拆成几块，只有百分比可以单独标红。
  // 认不出句式（余额、以后新增的写法）就整段原样显示，来源标了 low 才整段变红
  function compact(seg, sourceLow) {
    const m = /^(.+?) 剩余 (\d+)%(?: · (\S+) 重置)?(.*)$/.exec(seg)
    if (!m) return [{ text: seg, low: sourceLow }]
    const [, label, pct, time, tail] = m
    const short = SHORT[label] || label
    // label、pct 给额度条样式用（barCell）：文字样式照旧只看 text、low
    const parts = [{ text: short + ' ', label: short }, { text: pct + '%', low: +pct <= LOW_LEFT, pct: +pct }]
    if (time) parts.push({ text: ' · ' + time })
    if (tail.trim()) parts.push({ text: ' ' + tail.trim() })   // GPT 问不到时的「· 11:30 的数据」
    return parts
  }

  // ---- 额度条样式（设置「额度显示样式：额度条」）：每格换成短条 ----
  // 颜色三档：多于 30% 蓝（ok）、10%–30% 橙（mid）、10% 及以下红（low，和文字样式变红的门槛一致）。单家显示（quota-bars.js）也用这一份
  const level = pct => (pct > 30 ? 'ok' : pct > LOW_LEFT ? 'mid' : 'low')
  const WINDOWS = new Set(['5h', '周', '今日', '5小时', '本周'])
  // 一格（compact 拆好的几块）→ { label, pct, level }：窗口名不写（同一列都是同一种窗口），池名（Arg、C/G）留着；认不出的（余额）返回 null，照旧显示文字
  function barCell(parts) {
    const p = parts.find(x => x.pct != null)
    if (!p) return null
    const words = (parts.find(x => x.label != null)?.label || '').split(' ').filter(w => !WINDOWS.has(w))
    return { label: words.join(' ') || null, pct: p.pct, level: level(p.pct) }
  }

  // ---- 额度条 bars → 格子 ----
  // 一项 { label, left（剩余比例 0–1）, reset?（Unix 秒）, group? }。同一个池的窗口挨着排；group 是池名（没有就当成同一个池）
  const pctOf = left => Math.round(Math.max(0, Math.min(1, +left || 0)) * 100)
  function resetText(sec) {
    const d = new Date(sec * 1000), p2 = n => String(n).padStart(2, '0')
    return d - Date.now() < 86400e3 ? p2(d.getHours()) + ':' + p2(d.getMinutes()) : (d.getMonth() + 1) + '/' + d.getDate()
  }
  // 拼成和 text 一样的一段原文，交给 compact 去缩写、标红
  const seg = (label, b) => (label ? label + ' ' : '') + '剩余 ' + pctOf(b.left) + '%' + (b.reset ? ' · ' + resetText(b.reset) + ' 重置' : '')
  const windowOf = (b, group) => (group && b.label.startsWith(group) ? b.label.slice(group.length) : b.label).trim()
  const POOL_SHORT = { Argon: 'Arg' }   // 池名放进格子里太长的缩短
  const CG = /claude|gpt/i, CG_ROW = 'Agy C/G'

  // 一个池只挑一个窗口放进格子（和解析端 text 的挑法一致）：5小时没满就用 5小时；否则用最紧的；
  // 例外：最紧的 ≤10% 时不管 5小时怎样都用它；一样紧的取重置更晚的
  function pickBar(list, group) {
    let tight = null
    for (const b of list) if (!tight || b.left < tight.left || (b.left === tight.left && (b.reset || 0) > (tight.reset || 0))) tight = b
    const five = list.find(b => windowOf(b, group) === '5小时')
    return tight.left > 0.1 && five && five.left < 1 ? five : tight
  }

  // 只有一个池（Claude / GPT 这类）：每个窗口一格，一家一行，和拆 text 的结果一样。
  // 有几个池（Antigravity）：第一个池（角色自己的）+ 独立池（Argon 等）各一格放一行，Claude/GPT 池的各个窗口另起一行「Agy C/G」，
  // 和 Claude / GPT 自己的「5h | 周」两格对齐
  // fold：底栏放不下时（见 rows），Claude/GPT 池不另起一行，和独立池一样挑一格并回第一行（「C/G 周 70%」）
  function barRows(bars, ownName, fold) {
    const cell = (label, b) => seg(label, fold ? { left: b.left } : b)   // 并成一行时不写重置时间，不然三格太宽
    const groups = []
    for (const b of bars) {
      const g = b.group || ''
      let e = groups.find(x => x.g === g)
      if (!e) groups.push(e = { g, list: [] })
      e.list.push(b)
    }
    if (groups.length < 2) return [{ name: ownName, cells: bars.map(b => seg(b.label, b)) }]
    const main = [], cg = []
    groups.forEach((e, i) => {
      if (i > 0 && CG.test(e.g) && !fold) { e.list.forEach(b => cg.push(seg(windowOf(b, e.g), b))); return }
      if (i > 0 && CG.test(e.g)) { const b = pickBar(e.list, e.g); const win = windowOf(b, e.g); main.push(cell('C/G ' + (SHORT[win] || win), b)); return }
      const b = pickBar(e.list, e.g), win = windowOf(b, e.g)
      main.push(cell(i === 0 ? win : [POOL_SHORT[e.g] || e.g, e.list.length > 1 ? win : ''].filter(Boolean).join(' '), b))
    })
    return [main.length && { name: ownName, cells: main }, cg.length && { name: CG_ROW, cells: cg }].filter(Boolean)
  }

  // quota：{ <角色 id>: { text, low } | null }；own：当前角色 id，排在最前；all：角色 id 的顺序；
  // nameOf：id → 名字。返回 [{ id, name, cells: [parts] }]，一家 AI 一行（来源给了 bars 且有几个池的可以有几行），每个额度窗口一格（原文用「｜」隔开）。
  // 没有额度（没接入、没打开开关、读不到）的 AI 直接跳过，不占行
  function rows(quota, own, all, nameOf, fold = false) {
    const out = []
    // 其余按 id 字母序：不能指望 all 自带顺序——macOS 上角色清单是 Swift 字典序列化出来的，每次启动的顺序都不一样
    for (const id of [own, ...all.filter(i => i !== own).sort()]) {
      const q = quota[id]
      if (!q || !q.text) continue
      // 来源给了分池的结构化额度 bars（[{ label, left, reset?, group }]，目前是 Antigravity）：不拆 text，从 bars 排版。
      // 不分池的 bars（GPT、Claude）只给额度条样式的单家显示用；合并显示照旧拆 text，过期算满、「几点的数据」、只给最紧的那格写时间都在 text 里排好了
      if (Array.isArray(q.bars) && q.bars.some(b => b.group)) {
        for (const r of barRows(q.bars, nameOf(id), fold)) out.push({ id, name: r.name, cells: r.cells.map(seg => compact(seg, !!q.low)) })
        continue
      }
      const cells = String(q.text).split(/\s*｜\s*/).filter(Boolean).map(seg => compact(seg, !!q.low))
      if (cells.length) out.push({ id, name: nameOf(id), cells })
    }
    // Antigravity 拆成两行后总共超过收紧字号也放不下的行数（底栏高度预算，见 render）：把它的两行并回一行再排一次
    if (!fold && out.length > LOOSE_ROWS + 1 && out.length > new Set(out.map(r => r.id)).size) return rows(quota, own, all, nameOf, true)
    return out
  }

  // 名字太长就截断：按显示宽度算（中日韩字符算 2，其余算 1），不靠 CSS 的省略号——表格里列宽会被挤到比名字还窄
  const NAME_WIDTH = 12, NAME_WIDTH_TIGHT = 9   // 表放不下、收紧了字号还不够时，名字再短一点
  const widthOf = ch => (ch.codePointAt(0) >= 0x2e80 ? 2 : 1)
  function shortName(name, max = NAME_WIDTH) {
    const chars = [...name]
    if (chars.reduce((w, c) => w + widthOf(c), 0) <= max) return name
    let w = 0, out = ''
    for (const c of chars) {
      if (w + widthOf(c) > max - 1) break   // 留一格给「…」
      w += widthOf(c); out += c
    }
    return out + '…'
  }

  const LOOSE_ROWS = 3   // 正常字号放得下的行数（见 render 里的说明）
  const isCrowded = rowCount => rowCount > LOOSE_ROWS

  // 画成对齐的表：名字一列、每个窗口一列，列宽自动撑开，不要求等宽字体。
  // 格子比别的行少的行，最后一格占满剩下的列（余额、Gemini 的长文本不撑歪别的行）
  // style：'bars' 时认得出百分比的格子画成「池名（有才画）+ 短条 + 百分比」，其余照旧（见 barCell）
  function render(el, list, nameWidth = NAME_WIDTH, style = 'text') {
    el.replaceChildren()
    const n = Math.max(0, ...list.map(r => r.cells.length))
    el.className = 'agg'
    el.style.gridTemplateColumns = n ? `auto repeat(${n}, auto)` : ''
    const div = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d }
    for (const r of list) {
      const name = div('qn', shortName(r.name, nameWidth))
      name.title = r.name   // 名字被截断时，鼠标停上去能看全
      el.append(name)
      r.cells.forEach((parts, i) => {
        const cell = div('qc')
        if (i === r.cells.length - 1 && r.cells.length < n) cell.style.gridColumn = `span ${n - r.cells.length + 1}`
        const bar = style === 'bars' && barCell(parts)
        if (bar) {
          cell.classList.add('qbarcell', bar.level)
          const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; if (text != null) s.textContent = text; return s }
          const track = span('qtrack'), fill = document.createElement('i')
          fill.style.width = bar.pct + '%'
          track.append(fill)
          if (bar.label) cell.append(span('ql', bar.label))
          cell.append(track, span('qp', bar.pct + '%'))
        } else for (const p of parts) {
          const s = document.createElement('span'); s.textContent = p.text
          if (p.low) s.className = 'low'
          cell.append(s)
        }
        el.append(cell)
      })
    }
    // 收紧（字号 9px、行高 1.1）的两个条件：
    // 1. 行太多：底栏（#foot）留给额度小窗的高度预算只够 3 行正常字号，或 4 行收紧后的字号；
    //    4 家都有时不管宽不宽都要收紧，不然人物会被顶上去
    // 2. 窗口放不下（Gemini 的模型池名字长）：字和间距收紧一点，别把名字列挤没
    if (isCrowded(list.length) || el.scrollWidth > el.clientWidth + 1) el.classList.add('tight')
    // 收紧了还放不下（名字长 + 四家都有 + 微软雅黑比苹方宽）：名字再截短一点，重画一次
    if (el.scrollWidth > el.clientWidth + 1 && nameWidth > NAME_WIDTH_TIGHT) render(el, list, NAME_WIDTH_TIGHT, style)
  }

  root.QuotaAggregate = { rows, render, compact, shortName, isCrowded, pickBar, windowOf, barCell, level }
  if (typeof module !== 'undefined') module.exports = { rows, compact, shortName, isCrowded, pickBar, windowOf, barCell, level }   // pickBar、windowOf 额度条样式（quota-bars.js）也用
})(typeof window !== 'undefined' ? window : globalThis)
