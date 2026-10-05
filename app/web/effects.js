// CrossPet 特效：每个状态身边的小动画（SVG + SMIL），surroundings(pose) 返回 SVG 片段
// ART-BEGIN
           
                                                                                                      
                                                                                                                    

                                                           

// 画布比立绘宽一圈，特效画在人物周围的留白里（画布坐标）
const CW = 580
const CH = 560
const AW = 374
const AH = 420
const AX = (CW - AW) / 2 // 103
const AY = CH - AH - 22 // 118
const HEAD = { x: AX + 187, y: AY + 20 } // 头顶
const FOOT = `${AW / 2} ${AH}`
const INK = '#4a2418'

const ease = 'calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"'
const loop = 'repeatCount="indefinite"'

// ---- 身体动作（立绘坐标，围绕脚底） ----
const bob = (amp        , dur        ) =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-amp};0 0" keyTimes="0;0.5;1" ${ease} dur="${dur}" ${loop}/>`
const rock = (deg        , dur        ) =>
  `<animateTransform attributeName="transform" type="rotate" values="${-deg} ${FOOT};${deg} ${FOOT};${-deg} ${FOOT}" keyTimes="0;0.5;1" ${ease} dur="${dur}" ${loop}/>`
const shake = `<animateTransform attributeName="transform" type="translate" values="0 0;-6 0;6 0;-4 0;4 0;0 0;0 0" keyTimes="0;0.1;0.2;0.3;0.4;0.5;1" dur="1.4s" ${loop}/>`

const motion = (p      )         => {
  switch (p) {
    case 'listening': return bob(10, '0.8s')
    case 'thinking': return rock(2.5, '3s')
    case 'reading': return rock(1.2, '4s')
    case 'writing': return bob(3, '1s')
    case 'running': return bob(5, '0.45s')
    case 'searching': return rock(3, '2s')
    case 'delegating': return rock(2, '1.4s')
    case 'happy': return bob(18, '0.7s')
    case 'proud': return bob(12, '1s')
    case 'oops': return shake
    case 'surprised': return bob(12, '0.6s')
    case 'pat': return rock(3, '0.8s')
    case 'sleeping': return bob(2, '4.5s')
    case 'tired': return rock(1.5, '4.5s')
    case 'hum': return rock(3.5, '1.8s')
    case 'drawing': return rock(1.5, '2.4s')
    default: return bob(4, '3.2s')
  }
}

// ---- 背景光晕：每个状态一种颜色 ----
const AURA                                 = {
  idle: ['#ffd9b0', 0.35], listening: ['#ffb27a', 0.45], thinking: ['#9ec5ff', 0.45], reading: ['#ffe08a', 0.5],
  writing: ['#ffd38a', 0.45], running: ['#9be7b4', 0.45], searching: ['#a6e3ff', 0.45], delegating: ['#d7c4ff', 0.45],
  happy: ['#fff08a', 0.6], proud: ['#ffd54a', 0.6], oops: ['#ff9b9b', 0.5], surprised: ['#e8e2f0', 0.3],
  pat: ['#ffb6c8', 0.6], sleeping: ['#7f8fd1', 0.45], tired: ['#c9c2b8', 0.45], hum: ['#ffd0e6', 0.45],
  stretch: ['#ffe0b8', 0.35], yawn: ['#d8d0f0', 0.4], drawing: ['#ffd6e8', 0.45],
}
// 叠几层半透明圆当柔光（渐变的 stop-opacity 有的渲染器不认，这样最稳）
const aura = (p      ) => {
  const [c, o] = AURA[p]
  const rings = [250, 215, 180, 145, 110].map(r => `<circle cx="${CW / 2}" cy="${AY + 210}" r="${r}" fill="${c}" fill-opacity="${(o * 0.16).toFixed(3)}"/>`).join('')
  return `<g>${rings}<animate attributeName="opacity" values="0.7;1;0.7" dur="3s" ${loop}/></g>`
}

// ---- 小部件（画布坐标） ----
const fadeLoop = (dur        , begin        ) =>
  `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.75;1" dur="${dur}" begin="${begin}" ${loop}/>`
const rise = (dur        , begin        , dy        , dx = 0) =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy}" dur="${dur}" begin="${begin}" ${loop} additive="sum"/>`
const star = (x        , y        , s        , begin        , color = '#f5c542', dur = '1.2s') =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -12 L3 -3 L12 0 L3 3 L0 12 L-3 3 L-12 0 L-3 -3Z" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${dur}" begin="${begin}" ${loop}/></path>`
const heart = (x        , y        , s        , begin        ) =>
  `<g transform="translate(${x} ${y}) scale(${s})" opacity="0"><path d="M0 4 C-6 -4 -14 2 0 12 C14 2 6 -4 0 4Z" fill="#ff6b81" stroke="#fff" stroke-width="1.5"/>${fadeLoop('2.2s', begin)}${rise('2.2s', begin, -60, 10)}</g>`
const note = (x        , y        , ch        , begin        , color = '#d9822b') =>
  `<g transform="translate(${x} ${y})" opacity="0"><text font-size="38" fill="${color}" stroke="#fff" stroke-width="2" paint-order="stroke" font-family="serif">${ch}</text>${fadeLoop('2.6s', begin)}${rise('2.6s', begin, -60, 16)}</g>`
const mark = (x        , y        , ch        , color        , size = 54) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="900" fill="${color}" stroke="#fff" stroke-width="4" paint-order="stroke" font-family="sans-serif">${ch}<animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="0.9s" ${loop}/></text>`
const sweat = (x        , y        ) =>
  `<path d="M0 0 C-8 12 -8 22 0 22 C8 22 8 12 0 0Z" fill="#8fd3ff" stroke="#4aa3d8" stroke-width="2"><animateTransform attributeName="transform" type="translate" values="${x} ${y};${x} ${y + 18};${x} ${y}" dur="1.6s" ${loop}/></path>`

// 思考云朵，里面三个点依次亮
const thoughtCloud = (() => {
  const x = 470, y = 58
  const cloud = `<path d="M${x - 50} ${y + 18} a22 22 0 0 1 10 -40 a28 28 0 0 1 50 -10 a24 24 0 0 1 40 18 a20 20 0 0 1 -6 38 z" fill="#fff" stroke="${INK}" stroke-width="3"/>`
  const tail = `<circle cx="${x - 62}" cy="${y + 38}" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${x - 74}" cy="${y + 54}" r="5" fill="#fff" stroke="${INK}" stroke-width="3"/>`
  const dots = [0, 1, 2].map(i => `<circle cx="${x - 22 + i * 22}" cy="${y + 2}" r="6" fill="#5b8def" opacity="0.2"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="${i * 0.3}s" ${loop}/></circle>`).join('')
  return `<g>${tail}${cloud}${dots}<animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="2.4s" ${loop}/></g>`
})()

// 读书：左侧飘起的字符和书页
const floatingGlyphs = ['A', 'あ', '{ }', '∑', '文'].map((g, i) =>
  `<g transform="translate(${14 + (i % 2) * 30} ${330 - i * 6})" opacity="0"><text font-size="${24 + (i % 3) * 4}" style="fill: var(--glyph, #b5651d); stroke: var(--glyph-stroke, none); stroke-width: 1.2px; paint-order: stroke" font-family="serif" font-weight="bold">${g}</text>${fadeLoop('3.5s', `${i * 0.7}s`)}${rise('3.5s', `${i * 0.7}s`, -200, 6)}</g>`,
).join('')


// 跑命令：右上角小终端，一行行打字
const terminal = (() => {
  const x = 430, y = 40
  const lines = ['$ npm test', '✓ 12 passed', '$ git add .'].map((l, i) =>
    `<text x="${x + 10}" y="${y + 30 + i * 18}" font-size="14" fill="${i === 1 ? '#7CFC9A' : '#e8e8e8'}" font-family="monospace" opacity="0">${l}<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${(i * 0.25).toFixed(2)};${(i * 0.25 + 0.05).toFixed(2)};1" dur="3s" ${loop}/></text>`,
  ).join('')
  return `<g><rect x="${x}" y="${y}" width="130" height="86" rx="8" fill="#262626" stroke="#fff" stroke-width="3"/>` +
    `<circle cx="${x + 12}" cy="${y + 11}" r="4" fill="#ff5f56"/><circle cx="${x + 24}" cy="${y + 11}" r="4" fill="#ffbd2e"/><circle cx="${x + 36}" cy="${y + 11}" r="4" fill="#27c93f"/>${lines}` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="1.2s" ${loop}/></g>`
})()

const magnifier = `<g><circle r="22" fill="#cfefff" fill-opacity="0.55" stroke="${INK}" stroke-width="5"/><circle cx="-7" cy="-7" r="6" fill="#fff" opacity="0.8"/><path d="M15 15 L34 34" stroke="#8b5a2b" stroke-width="8" stroke-linecap="round"/>` +
  `<animateMotion path="M470 120 a40 26 0 1 1 1 0" dur="2.6s" ${loop}/></g>`
// 查资料：左上角一个小浏览器窗口，搜索框打字、结果一行行出来
const browser = (() => {
  const x = 22, y = 40
  const results = [0, 1, 2].map(i =>
    `<g opacity="0"><rect x="${x + 10}" y="${y + 46 + i * 15}" width="${[96, 78, 88][i]}" height="5" rx="2.5" fill="${i === 0 ? '#5b8def' : '#c9ced6'}"/>` +
    `<rect x="${x + 10}" y="${y + 53 + i * 15}" width="${[70, 84, 60][i]}" height="3" rx="1.5" fill="#e3e6eb"/>` +
    `<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${(0.3 + i * 0.15).toFixed(2)};${(0.36 + i * 0.15).toFixed(2)};1" dur="3.2s" ${loop}/></g>`,
  ).join('')
  return `<g><rect x="${x}" y="${y}" width="118" height="96" rx="9" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
    `<path d="M${x} ${y + 9} a9 9 0 0 1 9 -9 h100 a9 9 0 0 1 9 9 v9 h-118z" fill="#eef1f5"/>` +
    `<circle cx="${x + 10}" cy="${y + 9}" r="3" fill="#ff5f56"/><circle cx="${x + 20}" cy="${y + 9}" r="3" fill="#ffbd2e"/><circle cx="${x + 30}" cy="${y + 9}" r="3" fill="#27c93f"/>` +
    `<rect x="${x + 8}" y="${y + 24}" width="102" height="14" rx="7" fill="#f4f6f9" stroke="#c9ced6" stroke-width="1.5"/>` +
    `<circle cx="${x + 17}" cy="${y + 31}" r="3.2" fill="none" stroke="#8a93a0" stroke-width="1.5"/><path d="M${x + 19.5} ${y + 33.5} l3 3" stroke="#8a93a0" stroke-width="1.5" stroke-linecap="round"/>` +
    `<rect x="${x + 26}" y="${y + 29}" width="0" height="4" rx="2" fill="#8a93a0"><animate attributeName="width" values="0;52;52" keyTimes="0;0.28;1" dur="3.2s" ${loop}/></rect>` +
    `${results}<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="2.4s" ${loop}/></g>`
})()
const plane = `<path d="M488 300 Q525 240 578 160" stroke="#9a8fd0" stroke-width="2.5" stroke-dasharray="6 8" fill="none" opacity="0.7"/>` +
  `<g><path d="M0 0 L40 14 L0 28 L9 14Z" fill="#fff" stroke="${INK}" stroke-width="2.5"/><animateMotion path="M488 300 Q525 240 578 160" rotate="auto" dur="1.8s" ${loop}/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="1.8s" ${loop}/></g>`

const confetti = Array.from({ length: 10 }, (_, i) => {
  const x = i < 5 ? 14 + i * 18 : 486 + (i - 5) * 18
  const colors = ['#ff6b81', '#ffd54a', '#5b8def', '#7ed957', '#ff9f43']
  return `<rect x="${x}" y="-10" width="9" height="14" rx="2" fill="${colors[i % 5]}" opacity="0"><animate attributeName="opacity" values="0;1;1;0" dur="2.4s" begin="${(i % 5) * 0.35}s" ${loop}/><animateTransform attributeName="transform" type="translate" values="0 0;${(i % 2 ? 1 : -1) * 8} 300" dur="2.4s" begin="${(i % 5) * 0.35}s" ${loop}/></rect>`
}).join('')

// 被戳：头边弹出一个「!」小气泡（只弹一次），三道短冲击线闪一下就消失
const pokeBurst = (() => {
  const x = 452, y = 104
  const once = (begin        , dur        ) => `begin="${begin}" dur="${dur}" fill="freeze"`
  const bubble = `<g transform="translate(${x} ${y})"><g transform="scale(0)">` +
    `<path d="M-22 -18 h44 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-30 l-10 10 l2 -10 h-6 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10z" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
    `<text x="0" y="10" text-anchor="middle" font-size="28" font-weight="900" fill="#ff7a45" font-family="sans-serif">!</text>` +
    `<animateTransform attributeName="transform" type="scale" values="0;1.18;1" keyTimes="0;0.6;1" ${once('0s', '0.35s')}/></g></g>`
  const lines = [[-46, -30, -34, -20], [-52, -6, -38, -6], [-46, 18, -34, 8]].map(([x1, y1, x2, y2]) =>
    `<line x1="${x + x1}" y1="${y + y1}" x2="${x + x2}" y2="${y + y2}" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0">` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.6;1" ${once('0s', '0.7s')}/></line>`).join('')
  return bubble + lines
})()

const moonStars = `<path d="M90 60 a30 30 0 1 0 30 40 a24 24 0 1 1 -30 -40z" fill="#ffe9a8" stroke="#d9b35a" stroke-width="2"/>` +
  star(150, 40, 0.6, '0s', '#fff3c4', '2.4s') + star(480, 70, 0.8, '0.8s', '#fff3c4', '2.4s') + star(520, 150, 0.5, '1.6s', '#fff3c4', '2.4s')
const zz = `<g font-family="sans-serif" font-weight="900" fill="#e8a33d" stroke="#fff" stroke-width="3" paint-order="stroke">` +
  `<g transform="translate(420 140)" opacity="0"><text font-size="30">z</text>${fadeLoop('3s', '0s')}${rise('3s', '0s', -60, 20)}</g>` +
  `<g transform="translate(445 120)" opacity="0"><text font-size="42">Z</text>${fadeLoop('3s', '1.5s')}${rise('3s', '1.5s', -60, 20)}</g></g>`

// 额度低：一个快没电的电池
const battery = `<g transform="translate(450 70)"><rect width="70" height="34" rx="6" fill="#fff" stroke="${INK}" stroke-width="3"/><rect x="70" y="10" width="7" height="14" rx="2" fill="${INK}"/>` +
  `<rect x="5" y="5" width="12" height="24" rx="2" fill="#ff5f56"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" ${loop}/></rect></g>`
const gloom = [0, 1, 2, 3].map(i => `<line x1="${248 + i * 22}" y1="${AY - 62}" x2="${248 + i * 22}" y2="${AY - 22 + (i % 2) * 8}" stroke="#8b86a8" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`).join('')

// 伸懒腰：头顶几颗暖色小光点慢慢升起、淡出（取代原来的弧线）
const stretchGlow = [0, 1, 2, 3].map(i =>
  `<g transform="translate(${208 + i * 52} ${96 + (i % 2) * 10})" opacity="0">` +
  `<path d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8Z" fill="#ffcf8a"/>` +
  `${fadeLoop('2.8s', `${i * 0.5}s`)}${rise('2.8s', `${i * 0.5}s`, -36)}</g>`).join('')
const yawnBubble = `<g transform="translate(440 140)" opacity="0"><text font-size="34" fill="#9a8fd0" font-family="sans-serif" font-weight="bold">~♡</text>${fadeLoop('3s', '0s')}${rise('3s', '0s', -40, 10)}</g>`


// ---- 小卡片动画（和小终端同一套样式：圆角窗口 + 红黄绿三点，内容在动） ----
const winFrame = (x        , y        , w        , h        , dark         , accent = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${dark ? '#262626' : '#fff'}" stroke="${dark ? '#fff' : INK}" stroke-width="${dark ? 3 : 2.5}"/>` +
  (dark ? '' : `<path d="M${x} ${y + 9} a9 9 0 0 1 9 -9 h${w - 18} a9 9 0 0 1 9 9 v9 h-${w}z" fill="${accent || '#eef1f5'}"/>`) +
  `<circle cx="${x + 12}" cy="${y + 10}" r="3.5" fill="#ff5f56"/><circle cx="${x + 23}" cy="${y + 10}" r="3.5" fill="#ffbd2e"/><circle cx="${x + 34}" cy="${y + 10}" r="3.5" fill="#27c93f"/>`
const floatY = (dur = '2.4s', amp = 4) =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-amp};0 0" dur="${dur}" ${loop}/>`
const appear = (from        , to        , dur        ) =>
  `<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${from.toFixed(2)};${to.toFixed(2)};1" dur="${dur}" ${loop}/>`

// 大活完成：头顶落下一顶皇冠（回弹一下），金色渐变 + 珍珠尖 + 宝石，高光扫过，周围小星星闪
const crown = (() => {
  const W = 112, H = 70, x = HEAD.x - W / 2, y = HEAD.y - 88  // 底边 y≈101，留在头顶上方
  const body = 'M10 50 L4 14 L31 33 L56 3 L81 33 L108 14 L102 50 Z'
  const defs = `<defs><linearGradient id="cpGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4b8"/><stop offset="0.45" stop-color="#ffd54a"/><stop offset="1" stop-color="#e59a00"/></linearGradient>` +
    `<linearGradient id="cpBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf3a"/><stop offset="1" stop-color="#c98200"/></linearGradient>` +
    `<clipPath id="cpClip"><path d="${body}"/><rect x="5" y="46" width="102" height="18" rx="6"/></clipPath></defs>`
  const gem = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="${INK}" stroke-width="2.5"/><circle cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" r="${r * 0.32}" fill="#fff" opacity="0.9"/>`
  const pearl = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fffaf0" stroke="${INK}" stroke-width="2.5"/><circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.35}" fill="#fff"/>`
  const crownArt = `<path d="${body}" fill="url(#cpGold)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M12 46 L8 22 M31 37 L50 14" stroke="#fffbe0" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.85"/>` +
    `<rect x="5" y="46" width="102" height="18" rx="6" fill="url(#cpBand)" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M56 18 l10 12 l-10 12 l-10 -12z" fill="#ff5d7a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M52 26 l4 -5 l3 4z" fill="#fff" opacity="0.9"/>` +
    gem(26, 55, 5, '#5b8def') + gem(56, 55, 5.5, '#7ed957') + gem(86, 55, 5, '#5b8def') +
    pearl(4, 14, 6) + pearl(56, 3, 7) + pearl(108, 14, 6) +
    `<g clip-path="url(#cpClip)"><rect x="-40" y="-10" width="16" height="90" fill="#fff" opacity="0.7" transform="skewX(-20)">` +
    `<animate attributeName="x" values="-40;-40;150" keyTimes="0;0.55;1" dur="2.4s" begin="0.7s" ${loop}/></rect></g>`
  // 入场：从上面落下来回弹一下；之后轻轻上下浮、左右微晃
  const enter = `<animateTransform attributeName="transform" type="translate" values="0 -70;0 6;0 -2;0 0" keyTimes="0;0.6;0.8;1" dur="0.7s" fill="freeze" additive="sum"/>`
  const sway = `<animateTransform attributeName="transform" type="rotate" values="-3 ${W / 2} ${H};3 ${W / 2} ${H};-3 ${W / 2} ${H}" dur="2.6s" begin="0.7s" ${loop} additive="sum"/>`
  const sparkles = [[-22, 18, 1.1, '0.8s'], [W + 18, 10, 1.2, '1.3s'], [W + 8, 50, 0.8, '1.9s'], [-12, 52, 0.9, '2.3s']]
    .map(([sx, sy, sc, b]) => `<path transform="translate(${sx} ${sy}) scale(0)" d="M0 -12 C1 -3 3 -1 12 0 C3 1 1 3 0 12 C-1 3 -3 1 -12 0 C-3 -1 -1 -3 0 -12Z" fill="#ffd54a" stroke="#fff" stroke-width="2" paint-order="stroke">` +
      `<animateTransform attributeName="transform" type="scale" values="0;${sc};0" dur="1.4s" begin="${b}" ${loop} additive="sum"/></path>`).join('')
  return `<g transform="translate(${x} ${y})">${defs}<g>${enter}<g>${floatY('2s', 5)}<g>${sway}${crownArt}</g>${sparkles}</g></g></g>`
})()

// 听你说话：聊天卡片，你的消息滑进来，然后「正在输入」三个点跳动
const chatCard = (() => {
  const x = 432, y = 36, D = '3s'
  const dots = [0, 1, 2].map(i =>
    `<circle cx="${x + 26 + i * 11}" cy="${y + 66}" r="3.5" fill="#9aa3ad"><animate attributeName="cy" values="${y + 66};${y + 61};${y + 66}" dur="0.9s" begin="${i * 0.15}s" ${loop}/></circle>`).join('')
  return `<g>${winFrame(x, y, 126, 84, false)}` +
    `<g opacity="0"><rect x="${x + 44}" y="${y + 26}" width="72" height="22" rx="11" fill="#5b8def"/><rect x="${x + 54}" y="${y + 34}" width="46" height="5" rx="2.5" fill="#fff" opacity="0.9"/>` +
    `<animate attributeName="opacity" values="0;1;1" keyTimes="0;0.15;1" dur="${D}" ${loop}/><animateTransform attributeName="transform" type="translate" values="20 0;0 0;0 0" keyTimes="0;0.15;1" dur="${D}" ${loop}/></g>` +
    `<g opacity="0"><rect x="${x + 14}" y="${y + 55}" width="46" height="22" rx="11" fill="#eef1f5"/>${dots}${appear(0.3, 0.38, D)}</g>` +
    `${floatY()}</g>`
})()

// 读文件：代码查看器，一条高亮扫描线逐行往下扫
const viewerCard = (() => {
  const x = 432, y = 36
  const cols = ['#c678dd', '#61afef', '#98c379', '#61afef', '#e5c07b', '#98c379', '#c678dd']
  const lines = cols.map((c, i) =>
    `<rect x="${x + 22}" y="${y + 27 + i * 9}" width="${[58, 80, 46, 72, 36, 64, 50][i]}" height="4" rx="2" fill="${c}" opacity="0.85"/>` +
    `<rect x="${x + 9}" y="${y + 27 + i * 9}" width="7" height="4" rx="2" fill="#c9ced6"/>`).join('')
  return `<g>${winFrame(x, y, 126, 96, false)}${lines}` +
    `<rect x="${x + 4}" y="${y + 24}" width="118" height="10" rx="3" fill="#ffd36b" opacity="0.35"><animate attributeName="y" values="${y + 24};${y + 78};${y + 24}" dur="3.2s" ${loop}/></rect>` +
    `${floatY('2.8s')}</g>`
})()

// 写文件：编辑器，代码一行行打出来，左边冒出绿色 +，光标闪
const editorCard = (() => {
  const x = 432, y = 36, D = '3.6s'
  const widths = [70, 54, 84, 40, 66]
  const lines = widths.map((w, i) => {
    const t0 = 0.05 + i * 0.16, t1 = t0 + 0.12
    return `<text x="${x + 9}" y="${y + 33 + i * 11}" font-size="10" fill="#7CFC9A" font-family="monospace" opacity="0">+${appear(t0, t0 + 0.01, D)}</text>` +
      `<rect x="${x + 22}" y="${y + 27 + i * 11}" width="0" height="5" rx="2.5" fill="${['#e5c07b', '#61afef', '#98c379', '#c678dd', '#61afef'][i]}">` +
      `<animate attributeName="width" values="0;0;${w};${w}" keyTimes="0;${t0.toFixed(2)};${t1.toFixed(2)};1" dur="${D}" ${loop}/></rect>`
  }).join('')
  return `<g>${winFrame(x, y, 126, 92, true)}${lines}` +
    `<rect x="${x + 22}" y="${y + 80}" width="6" height="8" fill="#e8e8e8"><animate attributeName="opacity" values="1;0;1" dur="0.8s" calcMode="discrete" ${loop}/></rect>` +
    `${floatY('2s')}</g>`
})()

// 派帮手：任务列表，转圈的加载依次变成绿色对勾
const taskCard = (() => {
  const x = 432, y = 36, D = '3.6s'
  const rows = [0, 1, 2].map(i => {
    const cy = y + 34 + i * 18, done = 0.3 + i * 0.22
    return `<g><circle cx="${x + 16}" cy="${cy}" r="6" fill="none" stroke="#c9ced6" stroke-width="2.5"/>` +
      `<path d="M${x + 16} ${cy - 6} a6 6 0 0 1 6 6" stroke="#5b8def" stroke-width="2.5" fill="none"><animateTransform attributeName="transform" type="rotate" values="0 ${x + 16} ${cy};360 ${x + 16} ${cy}" dur="0.8s" ${loop}/>` +
      `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${done.toFixed(2)};${(done + 0.01).toFixed(2)};1" dur="${D}" ${loop}/></path>` +
      `<g opacity="0"><circle cx="${x + 16}" cy="${cy}" r="7" fill="#3fb950"/><path d="M${x + 12.5} ${cy} l2.5 2.5 l4.5 -5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>${appear(done, done + 0.01, D)}</g>` +
      `<rect x="${x + 30}" y="${cy - 3}" width="${[70, 56, 78][i]}" height="5" rx="2.5" fill="#c9ced6"/></g>`
  }).join('')
  return `<g>${winFrame(x, y, 126, 90, false)}${rows}${floatY('2.6s')}</g>`
})()

// 完成：清单卡片，三个勾依次画出来
const checklist = (() => {
  const x = 22, y = 40, D = '2.4s'
  const rows = [0, 1, 2].map(i => {
    const cy = y + 34 + i * 18, t0 = 0.1 + i * 0.18
    return `<rect x="${x + 10}" y="${cy - 7}" width="14" height="14" rx="3.5" fill="#fff" stroke="#3fb950" stroke-width="2"/>` +
      `<path d="M${x + 13} ${cy} l3 3.5 l6 -7" stroke="#3fb950" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-dasharray="16" stroke-dashoffset="16">` +
      `<animate attributeName="stroke-dashoffset" values="16;16;0;0" keyTimes="0;${t0.toFixed(2)};${(t0 + 0.12).toFixed(2)};1" dur="${D}" ${loop}/></path>` +
      `<rect x="${x + 32}" y="${cy - 3}" width="${[66, 52, 72][i]}" height="5" rx="2.5" fill="#c9ced6"/>`
  }).join('')
  return `<g>${winFrame(x, y, 118, 90, false, '#e6f6ea')}${rows}${floatY('2.2s')}</g>`
})()

// 出错：红色报错卡片，抖一抖
const errorCard = (() => {
  const x = 432, y = 36
  return `<g>${winFrame(x, y, 126, 78, false, '#fde2e1')}` +
    `<circle cx="${x + 22}" cy="${y + 40}" r="10" fill="#e5484d"/><path d="M${x + 18} ${y + 36} l8 8 M${x + 26} ${y + 36} l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>` +
    `<rect x="${x + 40}" y="${y + 33}" width="70" height="5" rx="2.5" fill="#e5484d" opacity="0.8"/><rect x="${x + 40}" y="${y + 43}" width="52" height="4" rx="2" fill="#f2a7a9"/>` +
    `<rect x="${x + 14}" y="${y + 60}" width="96" height="4" rx="2" fill="#f2a7a9"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;-4 0;4 0;-3 0;3 0;0 0;0 0" keyTimes="0;0.05;0.1;0.15;0.2;0.25;1" dur="1.6s" ${loop}/></g>`
})()

// 哼歌：迷你播放器，均衡器跳动，进度条往前走
const musicCard = (() => {
  const x = 432, y = 36
  const bars = [0, 1, 2, 3, 4].map(i =>
    `<rect x="${x + 50 + i * 12}" y="${y + 30}" width="7" height="22" rx="2" fill="#e07a9a"><animate attributeName="height" values="${[8, 18, 12, 20, 10][i]};${[20, 8, 22, 10, 18][i]};${[8, 18, 12, 20, 10][i]}" dur="${0.6 + i * 0.08}s" ${loop}/>` +
    `<animate attributeName="y" values="${y + 52 - [8, 18, 12, 20, 10][i]};${y + 52 - [20, 8, 22, 10, 18][i]};${y + 52 - [8, 18, 12, 20, 10][i]}" dur="${0.6 + i * 0.08}s" ${loop}/></rect>`).join('')
  return `<g>${winFrame(x, y, 126, 76, false, '#fde7f0')}` +
    `<rect x="${x + 10}" y="${y + 26}" width="30" height="30" rx="6" fill="#f7c6d8"/><text x="${x + 17}" y="${y + 48}" font-size="18" fill="#c2577f" font-family="serif">♪</text>` +
    `${bars}<rect x="${x + 10}" y="${y + 63}" width="106" height="4" rx="2" fill="#f3d3df"/>` +
    `<rect x="${x + 10}" y="${y + 63}" width="0" height="4" rx="2" fill="#e07a9a"><animate attributeName="width" values="0;106" dur="6s" ${loop}/></rect>` +
    `${floatY('2.6s')}</g>`
})()

// 大活完成：金奖杯（渐变 + 星星徽章 + 高光扫过），底下一块深色底座
const trophy = (() => {
  const x = 34, y = 62
  const cup = 'M8 4 H72 V26 C72 46 58 58 40 58 C22 58 8 46 8 26 Z'
  const defs = `<defs><linearGradient id="cpTro" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e59a00"/><stop offset="0.35" stop-color="#ffe680"/><stop offset="0.6" stop-color="#ffd54a"/><stop offset="1" stop-color="#d08800"/></linearGradient>` +
    `<clipPath id="cpTroClip"><path d="${cup}"/></clipPath></defs>`
  return `<g transform="translate(${x} ${y})">${defs}<g>` +
    `<path d="M10 10 H0 C-2 30 10 36 18 38 M70 10 H80 C82 30 70 36 62 38" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M10 10 H0 C-2 30 10 36 18 38 M70 10 H80 C82 30 70 36 62 38" fill="none" stroke="#ffcf3a" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="${cup}" fill="url(#cpTro)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<rect x="4" y="0" width="72" height="9" rx="4.5" fill="#ffe680" stroke="${INK}" stroke-width="3"/>` +
    `<path transform="translate(40 30)" d="M0 -12 L3.5 -4 L12 -3.5 L5.5 2 L7.5 10.5 L0 6 L-7.5 10.5 L-5.5 2 L-12 -3.5 L-3.5 -4Z" fill="#fff6c2" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
    `<g clip-path="url(#cpTroClip)"><rect x="-30" y="-10" width="12" height="80" fill="#fff" opacity="0.75" transform="skewX(-20)">` +
    `<animate attributeName="x" values="-30;-30;110" keyTimes="0;0.5;1" dur="2.2s" begin="0.4s" ${loop}/></rect></g>` +
    `<path d="M34 58 H46 V68 H34Z" fill="#e0a800" stroke="${INK}" stroke-width="2.5"/>` +
    `<rect x="18" y="67" width="44" height="13" rx="4" fill="#6b4a3a" stroke="${INK}" stroke-width="2.5"/><rect x="30" y="71" width="20" height="5" rx="2" fill="#ffd54a"/>` +
    `${floatY('1.8s', 6)}</g></g>`
})()

// 画画：画板卡片，彩色笔触一笔笔画出来，小画笔跟着走，下面一排调色盘
const easelCard = (() => {
  const x = 432, y = 36, D = '3.6s'
  const strokes = [
    ['M16 64 Q40 30 64 52 T112 40', '#ff8fab', 0.05], ['M18 78 Q50 58 80 74 T114 66', '#7ec8e3', 0.3], ['M30 46 q10 -14 22 0', '#ffd166', 0.55],
  ].map(([d, c, t]) =>
    `<path d="${d}" transform="translate(${x} ${y})" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="140" stroke-dashoffset="140">` +
    `<animate attributeName="stroke-dashoffset" values="140;140;0;0" keyTimes="0;${t};${(Number(t) + 0.22).toFixed(2)};1" dur="${D}" ${loop}/></path>`).join('')
  const palette = ['#ff8fab', '#ffd166', '#7ec8e3', '#9be7b4'].map((c, i) =>
    `<circle cx="${x + 20 + i * 14}" cy="${y + 96}" r="5" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`).join('')
  const brush = `<g><path d="M0 0 l14 -14 l4 4 l-14 14z" fill="#c8a06a" stroke="${INK}" stroke-width="1.5"/><path d="M0 0 l-5 5 l3 2z" fill="#ff8fab"/>` +
    `<animateMotion path="M${x + 16} ${y + 64} Q${x + 40} ${y + 30} ${x + 64} ${y + 52} T${x + 112} ${y + 40} M${x + 18} ${y + 78} Q${x + 50} ${y + 58} ${x + 80} ${y + 74} T${x + 114} ${y + 66}" dur="${D}" ${loop}/></g>`
  return `<g>${winFrame(x, y, 126, 108, false, '#fde7f0')}<rect x="${x + 8}" y="${y + 24}" width="110" height="64" rx="4" fill="#fffdf8" stroke="#e5ddd0" stroke-width="1.5"/>` +
    `${strokes}${palette}${brush}${floatY('2.8s')}</g>`
})()


// ---- 可被角色点名使用的特效（character.json 的 fx 字段）----
// 深海泡泡：两侧和头顶的泡泡摇摇晃晃往上冒（DeepSeek 思考 / 深度思考 / 游泳）
const bubbles = [[40, 330, 9], [70, 380, 6], [26, 250, 7], [505, 340, 10], [540, 300, 6], [520, 230, 8], [300, 96, 7], [250, 108, 5]].map(([x, y, r], i) =>
  `<g transform="translate(${x} ${y})" opacity="0"><circle r="${r}" fill="#bfe6ff" fill-opacity="0.35" stroke="#5aa9e6" stroke-width="2"/>` +
  `<circle cx="${-r * 0.35}" cy="${-r * 0.35}" r="${Math.max(1.5, r * 0.25)}" fill="#fff" opacity="0.9"/>` +
  `${fadeLoop(`${2.6 + (i % 3) * 0.4}s`, `${(i * 0.37).toFixed(2)}s`)}${rise(`${2.6 + (i % 3) * 0.4}s`, `${(i * 0.37).toFixed(2)}s`, y > 200 ? -110 : -50, i % 2 ? 8 : -8)}</g>`).join('')
// 饭碗冒热气：右上角三缕蒸汽（DeepSeek 吃白饭）
const steam = [0, 1, 2].map(i =>
  `<path d="M${470 + i * 18} 140 q-8 -12 0 -24 t0 -24" stroke="#d9d4cc" stroke-width="4" fill="none" stroke-linecap="round" opacity="0">` +
  `${fadeLoop('2.2s', `${i * 0.5}s`)}<animateTransform attributeName="transform" type="translate" values="0 0;0 -26" dur="2.2s" begin="${i * 0.5}s" ${loop} additive="sum"/></path>`).join('')
// 庆祝：两侧彩纸 + 闪光（GPT reset、DeepSeek 吃大餐）
const fxCelebrate = confetti + star(500, 170, 1, '0.5s', '#ffd54a') + star(80, 200, 0.9, '0.9s', '#ffd54a') + star(490, 380, 0.8, '0.3s')
// 大成功但立绘里已经画了皇冠：只要奖杯和闪光，不再叠特效皇冠
const fxVictory = trophy + star(510, 140, 1.1, '0.4s', '#ffd54a') + star(500, 340, 0.8, '0.2s', '#ffd54a')
const named = { bubbles, steam, celebrate: fxCelebrate, victory: fxVictory }

// 每个姿态周围的细节
const surroundings = (p      )         => {
  switch (p) {
    case 'idle': return star(80, 180, 0.6, '0s', '#ffc58a', '3s') + star(500, 260, 0.5, '1.5s', '#ffc58a', '3s')
    case 'listening': return chatCard
    case 'thinking': return thoughtCloud
    case 'reading': return viewerCard + floatingGlyphs
    case 'writing': return editorCard
    case 'running': return terminal
    case 'searching': return magnifier + browser
    case 'delegating': return taskCard + plane
    case 'happy': return checklist + confetti + star(500, 170, 1, '0.5s') + star(490, 380, 0.9, '0.3s')
    case 'proud': return trophy + crown + star(510, 140, 1.1, '0.4s', '#ffd54a') + star(500, 340, 0.8, '0.2s', '#ffd54a')
    case 'oops': return errorCard
    case 'surprised': return pokeBurst
    case 'pat': return heart(440, 160, 1.8, '0s') + heart(480, 220, 1.3, '0.7s') + heart(110, 190, 1.5, '1.1s') + heart(90, 280, 1.1, '1.6s')
    case 'sleeping': return moonStars + zz
    case 'tired': return battery + gloom
    case 'hum': return musicCard + note(40, 250, '♪', '0s', '#e07a9a') + note(70, 290, '♫', '1.2s')
    case 'stretch': return stretchGlow
    case 'yawn': return yawnBubble
    case 'drawing': return easelCard
  }
}

const sceneSvg = (art     , p      )         => {
  const scale = Math.min(AW / art.width, AH / art.height)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}">${aura(p)}` +
    `<ellipse cx="${CW / 2}" cy="${CH - 22}" rx="125" ry="11" fill="#000" opacity="0.12"/>` +
    `<g transform="translate(${AX} ${AY})"><g>${motion(p)}<g transform="scale(${scale})">${art.inner}</g></g></g>` +
    `${surroundings(p)}</svg>`
}

window.CrossFx = { surroundings, named, AURA, CW, CH, AX, AY, AW, AH }
