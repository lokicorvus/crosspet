// 迷你小帮手：陪在桌宠脚边的小人（好感度礼物，送礼的逻辑还没做；现在角色目录里有 mini.webp 就出来）。
// 素材是一张横条 characters/<角色>/mini.webp（tools/mini_sheet.py 拼的），FRAMES 是格子顺序；
// 外壳把它当「姿态 mini」扫进清单，网页从 char().poses.mini 拿地址。
// 动作全交给代码：主桌宠换姿态时 moodOf(姿态) 决定小帮手在干嘛；绕圈跑、换帧、上下浮动都是 CSS 动画，
// 她干活一干几个小时时也不用 JS 每帧算位置。
// moodOf 是纯函数，网页和测试（tests/mini_helper.test.js）共用；attach 只在网页里用。
;(function (root) {
  const FRAMES = ['idle', 'happy', 'sleep', 'run-a', 'run-b', 'run-c', 'wave', 'read', 'worried',
    'think-a', 'think-b', 'notes', 'carry-a', 'carry-b', 'carry-c', 'point', 'gift']
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

  // 帧序列（帧名, 每帧毫秒）→ background-position 的关键帧
  const pos = name => `${(FRAMES.indexOf(name) / (FRAMES.length - 1) * 100).toFixed(4)}% 0`
  function cycle(id, names) {
    const step = 100 / names.length
    return `@keyframes ${id} {` + names.map((n, i) => `${(i * step).toFixed(2)}% { background-position: ${pos(n)} }`).join(' ') +
      ` 100% { background-position: ${pos(names[0])} } }`
  }
  function css() {
    const f = n => `#mini .spr.f-${n} { background-position: ${pos(n)} }`
    return `
#mini { position: absolute; left: 50%; bottom: ${BASE}px; width: 0; height: 0; z-index: 1; pointer-events: none; transition: opacity .3s; }
#mini.off { opacity: 0; }
#mini .mx, #mini .my, #mini .mf { position: absolute; left: 0; bottom: 0; }
#mini .mx { transform: translateX(${RX}px); }
#mini .spr { position: absolute; left: ${-W / 2}px; bottom: 0; width: ${W}px; height: ${H}px; background-repeat: no-repeat;
  background-size: ${FRAMES.length * 100}% 100%; transform-origin: 50% 100%; }
${FRAMES.map(f).join('\n')}
/* 绕圈：从她右边出发，前半圈从她前面往左跑（大一点、翻过来），后半圈绕到她身后往右跑（小一点、被她挡住） */
#mini.lap { animation: mini-z ${LAP}s infinite; }
#mini.lap .mx { animation: mini-x ${LAP}s infinite; }
#mini.lap .my { animation: mini-y ${LAP}s infinite; }
#mini.lap .mf { animation: mini-f ${LAP}s infinite; }
#mini.once, #mini.once .mx, #mini.once .my, #mini.once .mf { animation-iteration-count: 1; }
@keyframes mini-z { 0%, 49.9% { z-index: 1 } 50%, 100% { z-index: -1 } }
@keyframes mini-x { 0% { transform: translateX(${RX}px); animation-timing-function: ease-in-out } 50% { transform: translateX(${-RX}px); animation-timing-function: ease-in-out } 100% { transform: translateX(${RX}px) } }
@keyframes mini-y { 0% { transform: none; animation-timing-function: ease-out } 25% { transform: translateY(${RY}px) scale(1.05); animation-timing-function: ease-in }
  50% { transform: none; animation-timing-function: ease-out } 75% { transform: translateY(${-RY}px) scale(.9); animation-timing-function: ease-in } 100% { transform: none } }
@keyframes mini-f { 0%, 49.9% { transform: scaleX(-1) } 50%, 100% { transform: none } }
${cycle('mini-run', ['run-a', 'run-b', 'run-c', 'run-b'])}
${cycle('mini-carry', ['carry-a', 'carry-b', 'carry-c', 'carry-b'])}
#mini .spr.run { animation: mini-run .44s steps(1) infinite; }
#mini .spr.carry { animation: mini-carry .44s steps(1) infinite; }
#mini .spr.bob { animation: mini-bob 2.4s ease-in-out infinite; }
#mini .spr.hop { animation: mini-hop 1.1s ease-out infinite; }
#mini .spr.breathe { animation: mini-breathe 3s ease-in-out infinite; }
#mini .spr.wave { animation: mini-rock .6s ease-in-out 3; }
#mini .spr.shake { animation: mini-shake .5s ease-in-out infinite; }
#mini .spr.call { animation: mini-call 1.6s ease-out infinite; }
#mini .spr.bow { animation: mini-bow 1.6s ease-in-out 1; }
@keyframes mini-bob { 50% { transform: translateY(-1px) } }
@keyframes mini-hop { 35% { transform: translateY(-8px) } 60%, 100% { transform: none } }
@keyframes mini-breathe { 50% { transform: scale(1.03, .97) } }
@keyframes mini-rock { 50% { transform: rotate(-6deg) } }
@keyframes mini-shake { 25% { transform: translateX(-1px) } 75% { transform: translateX(1px) } }
@keyframes mini-call { 0%, 40%, 100% { transform: none } 15% { transform: translateY(-4px) } 28% { transform: none } 34% { transform: translateY(-2px) } }
@keyframes mini-bow { 0% { transform: translateY(-16px); opacity: 0 } 25% { transform: none; opacity: 1 } 55% { transform: rotate(8deg) } 75% { transform: none } }
html.tucked #mini { visibility: hidden; }`
  }

  // stage：#stage；返回 { setSheet(url | null), setMood(mood) , gift() }
  function attach(stage) {
    const style = document.createElement('style'); style.textContent = css(); document.head.appendChild(style)
    stage.style.isolation = 'isolate'   // 后半圈的 z-index: -1 只沉到她身后，不沉到整页后面
    const el = document.createElement('div'); el.id = 'mini'; el.className = 'off'
    el.innerHTML = '<div class="mx"><div class="my"><div class="mf"><div class="spr"></div></div></div></div>'
    stage.appendChild(el)
    const spr = el.querySelector('.spr')
    let sheet = null, mood = 'idle', timer = null, trick = 0
    const frame = (name, anim) => { spr.className = 'spr' + (name ? ' f-' + name : '') + (anim ? ' ' + anim : ''); void spr.offsetWidth }
    const lap = (on, once) => { el.classList.toggle('lap', on); el.classList.toggle('once', !!once) }
    function stop() { clearTimeout(timer); timer = null; el.onanimationend = null }
    function idle() {   // 站在她右脚边轻轻晃，隔一会儿自己找点事：跑一圈 → 挥手 → 坐下看会儿书
      stop(); lap(false); frame('idle', 'bob')
      timer = setTimeout(() => {
        const t = trick++ % 3
        if (t === 0) {
          lap(false); void el.offsetWidth; lap(true, true); frame(null, 'run')
          el.onanimationend = e => { if (e.target === el) idle() }
        } else if (t === 1) { frame('wave', 'wave'); timer = setTimeout(idle, 1800) }
        else { frame('read', 'breathe'); timer = setTimeout(idle, 5000) }
      }, 9000 + Math.random() * 6000)
    }
    function think(n) {   // 两帧来回换（歪头），换几次低头记一笔
      if (n % 5 === 4) { frame('notes', 'breathe'); timer = setTimeout(() => think(n + 1), 2600); return }
      frame(n % 2 ? 'think-b' : 'think-a', 'bob'); timer = setTimeout(() => think(n + 1), 1500)
    }
    function render() {
      stop()
      el.classList.toggle('off', !sheet || mood === 'hidden')
      if (!sheet || mood === 'hidden') { lap(false); return }
      if (mood === 'busy') { lap(true); frame(null, 'carry'); return }
      lap(false)
      if (mood === 'think') return think(0)
      if (mood === 'read') return frame('read', 'breathe')
      if (mood === 'asking') return frame('point', 'call')
      if (mood === 'sleep') return frame('sleep', 'breathe')
      if (mood === 'happy') return frame('happy', 'hop')
      if (mood === 'wave') return frame('wave', 'wave')
      if (mood === 'worried') return frame('worried', 'shake')
      idle()
    }
    return {
      setSheet(url) {
        const next = url || null
        if (next === sheet) return
        sheet = next
        spr.style.backgroundImage = sheet ? `url("${sheet.replace(/"/g, '%22')}")` : ''
        render()
      },
      setMood(m) { if (m === mood) return; mood = m; render() },
      gift() {   // 刚收到时演一次：从上面落下来、捧着礼物鞠个躬
        if (!sheet || mood === 'hidden') return
        stop(); lap(false); frame('gift', 'bow'); timer = setTimeout(render, 3200)
      },
    }
  }

  const api = { FRAMES, moodOf }
  root.MiniHelper = Object.assign({ attach }, api)
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
