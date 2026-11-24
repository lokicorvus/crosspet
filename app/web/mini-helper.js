// 迷你小帮手：陪在桌宠脚边的一组小人（她自己的 + 好朋友送的，最多 6 个，见 crew）。
// 素材是一张横条 characters/<角色>/mini.webp（tools/mini_sheet.py 拼的），FRAMES 是格子顺序；
// 外壳把它当「姿态 mini」扫进清单，网页从 char().poses.mini 拿地址。
// 动作全交给代码：主桌宠换姿态时 moodOf(姿态) 决定小帮手在干嘛；绕圈跑、换帧、上下浮动都是 CSS 动画，
// 她干活一干几个小时时也不用 JS 每帧算位置。
// moodOf、crew、spotsFor 是纯函数，网页和测试（tests/mini_helper.test.js）共用；attach 只在网页里用。
;(function (root) {
  const FRAMES = ['idle', 'happy', 'sleep', 'run-a', 'run-b', 'run-c', 'wave', 'read', 'worried',
    'think-a', 'think-b', 'notes', 'carry-a', 'carry-b', 'carry-c', 'point', 'gift',
    'move-a', 'move-b', 'move-c']
  const CELL_W = 136, CELL_H = 148          // 和 tools/mini_sheet.py 一样
  // 画布（#stage 250×241）里的尺寸：站着的小人 43 高（桌宠画布 580×560 里 100 高，人物 420 高）
  const K = 43 / 140
  const W = CELL_W * K, H = CELL_H * K
  const RX = 88, BASE = 13, RY = 6, LAP = 5.2   // 绕圈：半宽、离底、前后半高、一圈秒数

  // 主桌宠的姿态 → 小帮手在干嘛。没列出的都是 idle
  const MOOD = {}
  const put = (mood, poses) => poses.forEach(p => { MOOD[p] = mood })
  put('think', ['thinking', 'deepthink', 'reset_check'])
  put('busy', ['writing', 'running', 'searching', 'delegating', 'drawing', 'compact', 'update',
    'busy_left', 'busy_right', 'swamped_left', 'swamped_right'])
  put('read', ['reading'])
  put('asking', ['asking'])
  put('sleep', ['sleeping'])
  put('happy', ['happy', 'proud', 'reset', 'reset_bell', 'reset_hope', 'forgiven', 'friend_up', 'feast'])
  put('wave', ['greet_morning', 'greet_noon', 'greet_afternoon', 'greet_evening', 'greet_night', 'greet_dawn', 'bye', 'roll_call'])
  put('worried', ['oops', 'surprised', 'dizzy', 'annoyed', 'puffed', 'redhot', 'sulk', 'pout', 'sorry', 'reset_nope', 'caught'])
  function moodOf(pose) {
    if (typeof pose !== 'string') return 'idle'
    if (/^edge_/.test(pose)) return 'hidden'   // 缩在屏幕边上：小帮手先藏起来
    if (/^fest_/.test(pose)) return 'happy'
    return MOOD[pose] || 'idle'
  }

  // 待机站位（画布坐标：x 离中线、y 正 = 靠前），按顺序填：右、左、脚前偏右、偏左、身后两侧（往后、高一点，从前面那个头上探出来）。
  // 第一个是她自己的，位置不随人数变；|x| ≤ 104 才不出画布（画布半宽 125，小人半宽约 21）
  const SPOTS = [[88, 2], [-88, 2], [42, 11], [-42, 11], [104, -12], [-104, -12]]
  // 人少（3 个以内）挤在她右边站成一小堆：她自己的照旧在右边，第二个站到脚前偏右，第三个在右后方从头上探出来。
  // 待机一起跑一圈时第二个跟在第一个后面，像排队；干活时照旧在圈上均匀错开
  const FEW = [[88, 2], [48, 11], [104, -12]]
  const spotsFor = n => {
    const k = Math.max(0, Math.min(n, SPOTS.length))
    return (k <= FEW.length ? FEW : SPOTS).slice(0, k).map(([x, y]) => ({ x, y }))
  }

  // 帧序列 → background-position 的关键帧（配 steps(1) 用）
  const pos = name => `${(FRAMES.indexOf(name) / (FRAMES.length - 1) * 100).toFixed(4)}% 0`
  function cycle(id, names) {
    const step = 100 / names.length
    return `@keyframes ${id} {` + names.map((n, i) => `${(i * step).toFixed(2)}% { background-position: ${pos(n)} }`).join(' ') +
      ` 100% { background-position: ${pos(names[0])} } }`
  }
  const HOP = LAP / 6   // 扑跳：一圈 6 跳
  // 绕圈的前后起伏，lift = 离地多高（飞 25、游 10）
  const lapY = (id, lift) => `@keyframes ${id} { 0% { transform: translateY(${-lift}px); animation-timing-function: ease-out }
  25% { transform: translateY(${RY - lift}px) scale(1.05); animation-timing-function: ease-in }
  50% { transform: translateY(${-lift}px); animation-timing-function: ease-out }
  75% { transform: translateY(${-RY - lift}px) scale(.9); animation-timing-function: ease-in } 100% { transform: translateY(${-lift}px) } }`
  function css() {
    const f = n => `.mini .spr.f-${n} { background-position: ${pos(n)} }`
    return `
.mini { position: absolute; left: 50%; bottom: ${BASE}px; width: 0; height: 0; z-index: 1; pointer-events: none; transition: opacity .3s; }
.mini.off { opacity: 0; }
.mini .mx, .mini .my, .mini .mh, .mini .mf { position: absolute; left: 0; bottom: 0; }
.mini .spr { position: absolute; left: ${-W / 2}px; bottom: 0; width: ${W}px; height: ${H}px; background-repeat: no-repeat;
  background-size: ${FRAMES.length * 100}% 100%; transform-origin: 50% 100%; }
${FRAMES.map(f).join('\n')}
/* 绕圈：从她右边出发，前半圈从她前面往左跑（大一点、翻过来），后半圈绕到她身后往右跑（小一点、被她挡住）。
   错开、从自己的位置起跑都靠行内的 animation-delay / animation-iteration-count */
.mini.lap { animation: mini-z ${LAP}s infinite; }
.mini.lap .mx { animation: mini-x ${LAP}s infinite; }
.mini.lap .my { animation: mini-y ${LAP}s infinite; }
.mini.lap .mf { animation: mini-f ${LAP}s infinite; }
/* 飞：离地高一截、一路上下起伏；游：离地一点、起伏更大更慢；扑：一跳一跳，落地停一拍 */
.mini.lap.m-fly .my { animation-name: mini-y-fly; }
.mini.lap.m-swim .my { animation-name: mini-y-swim; }
.mini.lap.m-fly .mh { animation: mini-hover 1.3s ease-in-out infinite; }
.mini.lap.m-swim .mh { animation: mini-paddle 2.2s ease-in-out infinite; }
.mini.lap.m-pounce .mh { animation: mini-leap ${HOP.toFixed(3)}s infinite; }
@keyframes mini-z { 0%, 49.9% { z-index: 1 } 50%, 100% { z-index: -1 } }
@keyframes mini-x { 0% { transform: translateX(${RX}px); animation-timing-function: ease-in-out } 50% { transform: translateX(${-RX}px); animation-timing-function: ease-in-out } 100% { transform: translateX(${RX}px) } }
${lapY('mini-y', 0)}
${lapY('mini-y-fly', 25)}
${lapY('mini-y-swim', 10)}
@keyframes mini-f { 0%, 49.9% { transform: scaleX(-1) } 50%, 100% { transform: none } }
@keyframes mini-hover { 50% { transform: translateY(-6px) } }
@keyframes mini-paddle { 50% { transform: translateY(-8px) } }
@keyframes mini-leap { 0% { transform: none; animation-timing-function: ease-out } 35% { transform: translateY(-14px); animation-timing-function: ease-in } 70%, 100% { transform: none } }
${cycle('mini-run', ['run-a', 'run-b', 'run-c', 'run-b'])}
${cycle('mini-carry', ['carry-a', 'carry-b', 'carry-c', 'carry-b'])}
${cycle('mini-move', ['move-a', 'move-b', 'move-c', 'move-b'])}
@keyframes mini-pf { 0% { background-position: ${pos('move-a')} } 12% { background-position: ${pos('move-b')} } 70%, 100% { background-position: ${pos('move-c')} } }
.mini .spr.run { animation: mini-run .44s steps(1) infinite; }
.mini .spr.carry { animation: mini-carry .44s steps(1) infinite; }
.mini .spr.fly { animation: mini-move .36s steps(1) infinite; }
.mini .spr.swim { animation: mini-move .6s steps(1) infinite; }
.mini .spr.pounce { animation: mini-pf ${HOP.toFixed(3)}s steps(1) infinite; }
.mini .spr.bob { animation: mini-bob 2.4s ease-in-out infinite; }
.mini .spr.hop { animation: mini-hop 1.1s ease-out infinite; }
.mini .spr.breathe { animation: mini-breathe 3s ease-in-out infinite; }
.mini .spr.wave { animation: mini-rock .6s ease-in-out 3; }
.mini .spr.shake { animation: mini-shake .5s ease-in-out infinite; }
.mini .spr.call { animation: mini-call 1.6s ease-out infinite; }
.mini .spr.bow { animation: mini-bow 1.6s ease-in-out 1; }
@keyframes mini-bob { 50% { transform: translateY(-1px) } }
@keyframes mini-hop { 35% { transform: translateY(-8px) } 60%, 100% { transform: none } }
@keyframes mini-breathe { 50% { transform: scale(1.03, .97) } }
@keyframes mini-rock { 50% { transform: rotate(-6deg) } }
@keyframes mini-shake { 25% { transform: translateX(-1px) } 75% { transform: translateX(1px) } }
@keyframes mini-call { 0%, 40%, 100% { transform: none } 15% { transform: translateY(-4px) } 28% { transform: none } 34% { transform: translateY(-2px) } }
@keyframes mini-bow { 0% { transform: translateY(-16px); opacity: 0 } 25% { transform: none; opacity: 1 } 55% { transform: rotate(8deg) } 75% { transform: none } }
html.tucked .mini { visibility: hidden; }`
  }

  // 站位 → 绕圈上最近的那一点（0–1）：靠前的在前半圈（右往左），靠后的在后半圈（左往右）。
  // 待机跑一圈从这里起跑、跑回这里，不会先瞬移到她右边
  function phaseOf({ x, y }) {
    const c = v => Math.max(-1, Math.min(1, v))
    return y >= 0 ? Math.acos(c(x / RX)) / Math.PI / 2 : .5 + Math.acos(c(-x / RX)) / Math.PI / 2
  }

  // stage：小帮手放进去的那层（index.html 的 #figure：铺满 #stage、只装她身子，自己 isolation: isolate——后半圈的 z-index: -1 只沉到她身后，不沉到整页后面）；
  // 返回 { setCrew([{ id, sheet, move }]), setMood(mood), setOn(on), gift(id), size() }
  // 每个成员一个 .mini（外层定位 + z 层 → .mx 左右 → .my 前后 → .mh 飞 / 游 / 扑的起伏 → .mf 翻转 → .spr 精灵图）
  function attach(stage) {
    const style = document.createElement('style'); style.textContent = css(); (document.head || document.documentElement).appendChild(style)
    const members = new Map()   // id → 成员，按 crew 顺序
    let order = [], mood = 'idle', on = true
    let lapEpoch = 0             // 这一轮干活开始绕圈的时刻
    const laps = new Set()       // 待机时正在一起跑一圈的
    const onTrack = m => Math.abs(m.spot.x) <= RX   // 站位在跑道上（前四个）
    const visible = () => on && mood !== 'hidden'

    function make(c) {
      const div = cls => { const d = document.createElement('div'); d.className = cls; return d }
      const m = { id: c.id, sheet: '', move: c.move || 'run', timer: null, i: 0, spot: { x: RX, y: 0 } }
      m.el = div('mini off m-' + m.move); m.mx = div('mx'); m.my = div('my'); m.mh = div('mh'); m.mf = div('mf'); m.spr = div('spr')
      m.el.appendChild(m.mx); m.mx.appendChild(m.my); m.my.appendChild(m.mh); m.mh.appendChild(m.mf); m.mf.appendChild(m.spr)
      stage.appendChild(m.el)
      return m
    }
    // 先清空再换：同一个 class 也会从头播（扑跳的帧要和 .mh 的跳一起重来）
    const frame = (m, name, anim) => { m.spr.className = 'spr'; void m.spr.offsetWidth; m.spr.className = 'spr' + (name ? ' f-' + name : '') + (anim ? ' ' + anim : '') }
    const runAnim = (m, busy) => m.move === 'run' ? (busy ? 'carry' : 'run') : m.move   // 飞 / 游 / 扑的干活时也用自己的移动帧
    function lap(m, yes, delay, count) {
      const parts = [m.el, m.mx, m.my, m.mf]
      if (yes) { m.el.classList.remove('lap'); void m.el.offsetWidth }   // 重新起跑
      m.el.classList.toggle('lap', yes)
      for (const p of parts) { p.style.animationDelay = yes ? delay + 's' : ''; p.style.animationIterationCount = yes ? count : '' }
    }
    function place(m) {   // 站到自己的位置：靠前的大一点、盖住靠后的；身后的沉到她后面
      const { x, y } = m.spot
      m.mx.style.transform = `translateX(${x}px)`
      m.my.style.transform = `translateY(${y}px) scale(${(1 + y / 100).toFixed(3)})`
      m.el.style.zIndex = y < 0 ? '-1' : String(1 + Math.round(y / 4))
    }
    function stop(m) {
      clearTimeout(m.timer); m.timer = null; m.el.onanimationend = null
      laps.delete(m)
      m.el.classList.remove('f-gift')
    }
    function idle(m) {   // 站在自己的位置轻轻晃，隔 9–20 秒自己找点事：跑一圈 / 挥手 / 坐下看书（她自己的偶尔记笔记）
      stop(m); lap(m, false); frame(m, 'idle', 'bob')
      m.timer = setTimeout(() => {
        // 身后两侧那两个（在跑道外）不跑：从那里起跑和最前面那只同一个起点，会叠在一起
        const tricks = [...(onTrack(m) ? ['lap'] : []), 'wave', 'read', ...(m.i === 0 ? ['notes'] : [])]
        let t = tricks[Math.floor(Math.random() * tricks.length)]
        if (t === 'lap' && laps.size) t = 'wave'   // 已经在跑了就改成挥手
        if (t === 'lap') {
          // 站在跑道上的一起跑：各自从自己的位置起跑、跑一圈回到原位，不会有人站在跑道上挡路
          // （分两边站时左右两只正好在两端；人少挤在右边时第二个跟在第一个后面跑）
          for (const o of order) {
            if (!onTrack(o) || o.el.classList.contains('f-gift')) continue
            stop(o); laps.add(o)
            const p = phaseOf(o.spot)
            lap(o, true, (-p * LAP).toFixed(3), (1 + p).toFixed(3)); frame(o, null, runAnim(o, false))
            o.el.onanimationend = e => { if (e.target === o.el) idle(o) }
            o.timer = setTimeout(() => idle(o), LAP * 1000 + 500)   // 兜底：animationend 丢了也会回来；先到的那个调 idle，idle 里 stop 掉另一个
          }
        } else if (t === 'wave') { frame(m, 'wave', 'wave'); m.timer = setTimeout(() => idle(m), 1800) }
        else { frame(m, t, 'breathe'); m.timer = setTimeout(() => idle(m), 5000) }
      }, 9000 + Math.random() * 11000)
    }
    function think(m, n, notes) {   // 两帧来回换（歪头）；notes：换几次低头记一笔
      if (notes && n % 5 === 4) { frame(m, 'notes', 'breathe'); m.timer = setTimeout(() => think(m, n + 1, notes), 2600); return }
      frame(m, n % 2 ? 'think-b' : 'think-a', 'bob'); m.timer = setTimeout(() => think(m, n + 1, notes), 1500)
    }
    // 干活：大家一起绕圈，在圈上均匀错开（两只差半圈）。不留人站着：待机站位就在跑道上（左右两只正好在两端），
    // 站着的会挡住跑过来的那只。都按同一个起点算，中途重跑的（送完礼）也落在自己该在的位置
    function busy(m) {
      lap(m, true, (-((Date.now() - lapEpoch) / 1000 % LAP) - LAP * m.i / order.length).toFixed(3), 'infinite'); frame(m, null, runAnim(m, true))
    }
    function act(m) {   // 按现在的 mood 做事（不含错开的等待）
      stop(m); place(m)
      if (mood === 'busy') return busy(m)
      lap(m, false)
      if (mood === 'think') return think(m, 0, true)
      if (mood === 'read') return frame(m, 'read', 'breathe')
      if (mood === 'asking') return frame(m, 'point', 'call')
      if (mood === 'sleep') return frame(m, 'sleep', 'breathe')
      if (mood === 'happy') return frame(m, 'happy', 'hop')
      if (mood === 'wave') return frame(m, 'wave', 'wave')
      if (mood === 'worried') return frame(m, 'worried', 'shake')
      idle(m)
    }
    function render() {
      const show = visible()
      if (show && mood === 'busy') lapEpoch = Date.now()
      order.forEach((m, i) => {
        stop(m); m.i = i
        m.el.classList.toggle('off', !show)
        if (!show) { lap(m, false); frame(m, 'idle'); return }
        if (mood === 'busy' || mood === 'idle') return act(m)   // 干活、待机本来就各干各的
        lap(m, false); place(m)
        if (i === 0) return act(m)
        m.timer = setTimeout(() => act(m), i * 250)   // 其他 mood：一个接一个换，不齐刷刷
      })
    }
    return {
      setCrew(list) {
        const next = (list || []).filter(c => c && c.id && c.sheet).slice(0, MAX_CREW)
        const same = next.length === order.length && next.every((c, i) => order[i].id === c.id)
        const keep = new Set(next.map(c => c.id))
        for (const [id, m] of members) if (!keep.has(id)) { stop(m); m.el.remove(); members.delete(id) }
        order = next.map(c => members.get(c.id) || members.set(c.id, make(c)).get(c.id))
        const spots = spotsFor(order.length)
        next.forEach((c, i) => {   // 换衣服只换图，不重建、不打断动画
          const m = order[i]
          if (m.sheet !== c.sheet) { m.sheet = c.sheet; m.spr.style.backgroundImage = `url("${c.sheet.replace(/"/g, '%22')}")` }
          m.spot = spots[i]
        })
        if (!same) render()
      },
      setMood(m) { if (m === mood) return; mood = m; render() },
      setOn(v) { if (!!v === on) return; on = !!v; render() },
      gift(id) {   // 刚收到时演一次：从上面落下来、捧着礼物鞠个躬，3.2 秒后回到现在的 mood
        const m = members.get(id)
        if (!m || !visible()) return
        stop(m); lap(m, false); place(m); m.el.classList.add('f-gift'); frame(m, 'gift', 'bow')
        m.timer = setTimeout(() => act(m), 3200)
      },
      size() { return visible() ? order.length : 0 },
    }
  }

  // 移动方式按原版：gpt 飞，gemini、glm 扑，其他跑（deepseek 试过游，loki 觉得还是跑步好看）。
  // 皮肤另说的（MOVE_SKIN）：穿着它、用的又是它自己那套图时按皮肤的。连体衣的翅膀只是衣服上的装饰，跑着走不飞；
  // 皮肤没有自己的图、借原版那套时，帧是原版画的，照原版的走
  const MOVE = { gpt: 'fly', gemini: 'pounce', glm: 'pounce' }
  const MOVE_SKIN = { 'gpt-onesie': 'run' }
  const moveOf = (id, c) => (c && c.skin && MOVE_SKIN[c.skin] && c.poses && c.poses.mini && c.poses.mini[0] ? MOVE_SKIN[c.skin] : MOVE[id] || 'run')

  // 小帮手的图：先看姿态 mini；没有且穿着皮肤，就把皮肤目录的 idle 路径换成原角色的 mini.webp；都没有就是没有
  function sheetOf(id, c) {
    const own = c && c.poses && c.poses.mini && c.poses.mini[0]
    if (own) return own
    const idle = c && c.skin && c.poses && c.poses.idle && c.poses.idle[0]
    const from = c && c.skin ? `/characters/${c.skin}/` : ''
    if (!idle || !idle.includes(from)) return ''
    return idle.replace(from, `/characters/${id}/`).replace(/[^/]*$/, 'mini.webp')
  }

  // 种子洗牌：FNV 取种子 + mulberry（和 notebook-events.js 同一套写法，抄进来不跨文件依赖）
  function seeded(text) {
    let h = 2166136261
    for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
    return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  }

  // 该显示哪几个：她自己（有图的话）排第一，后面是好感度到 2 级的好友，按分数从高到低；
  // 好友多了按「今天 + 她的 id」每天轮换，同一天不变。friends: false（设置「只有她自己的」）就只要她自己
  const MAX_CREW = 6
  function crew(receiver, { store = {}, manifest = {}, today = '', levelOf = () => 0, friends: withFriends = true } = {}) {
    const chars = (manifest && manifest.characters) || {}
    const entry = id => ({ id, sheet: sheetOf(id, chars[id]), move: moveOf(id, chars[id]) })
    const self = chars[receiver] && !chars[receiver].egg ? entry(receiver) : null
    const mine = self && self.sheet ? [self] : []
    const friends = []
    for (const key of withFriends ? Object.keys(store || {}) : []) {
      const pair = key.split('+')
      if (pair.length !== 2 || !pair.includes(receiver)) continue
      const id = pair[0] === receiver ? pair[1] : pair[0]
      const rec = store[key] || {}
      const points = Number(rec.points) || 0
      if (id === receiver || levelOf(points) < 2) continue
      if (rec.giftShown !== true && (Number(rec.shown) || 0) < 2) continue   // 刚到好朋友、升级那段对话还没演：先不出来，等送礼那一幕
      if (!chars[id] || chars[id].egg) continue
      const e = entry(id)
      if (e.sheet) friends.push({ e, points })
    }
    friends.sort((a, b) => b.points - a.points)
    const room = MAX_CREW - mine.length
    let pick = friends
    if (friends.length > room) {
      const rnd = seeded(`${today}|${receiver}`)
      const bag = friends.slice()
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]] }
      pick = bag.slice(0, room).sort((a, b) => b.points - a.points)   // 洗完再按分数排回去，顺序稳定
    }
    return mine.concat(pick.map(f => f.e))
  }

  const api = { FRAMES, moodOf, moveOf, crew, MAX_CREW, spotsFor }
  root.MiniHelper = Object.assign({ attach }, api)
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
