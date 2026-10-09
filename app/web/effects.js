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
  annoyed: ['#ffc4b0', 0.4], puffed: ['#ff9f86', 0.5], redhot: ['#ff4a2a', 0.75], sulk: ['#bcc0d6', 0.35], dizzy: ['#d8cfff', 0.45],
  coaxed: ['#ffc9de', 0.45], forgiven: ['#ffc9de', 0.55],
  pat: ['#ffb6c8', 0.6], sleeping: ['#7f8fd1', 0.45], tired: ['#c9c2b8', 0.45], hum: ['#ffd0e6', 0.45],
  stretch: ['#ffe0b8', 0.35], yawn: ['#d8d0f0', 0.4], drawing: ['#ffd6e8', 0.45],
  asking: ['#c9d4ff', 0.5], update: ['#ffe7a3', 0.55],
}
// 叠几层半透明圆当柔光（渐变的 stop-opacity 有的渲染器不认，这样最稳）
const aura = (p      ) => {
  const [c, o] = AURA[p]
  const rings = [250, 215, 180, 145, 110].map(r => `<circle cx="${CW / 2}" cy="${AY + 210}" r="${r}" fill="${c}" fill-opacity="${(o * 0.16).toFixed(3)}"/>`).join('')
  return `<g class="aura-rings">${rings}<animate attributeName="opacity" values="0.7;1;0.7" dur="3s" ${loop}/></g>`
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

// 等你回答：选项卡片——上面一行问题，后面三个点一跳一跳（在等你），下面两个选项，
// 一道蓝色高亮在两个选项之间来回挪（在等你挑），和聊天卡片、小终端同一套画法
const choiceCard = (() => {
  const x = 432, y = 30, D = '2.8s'
  const dots = [0, 1, 2].map(i =>
    `<circle cx="${x + 94 + i * 9}" cy="${y + 34}" r="3" fill="#9aa3ad"><animate attributeName="cy" values="${y + 34};${y + 30};${y + 34}" dur="0.9s" begin="${i * 0.15}s" ${loop}/></circle>`).join('')
  const option = (oy, w) =>
    `<rect x="${x + 12}" y="${oy}" width="102" height="20" rx="10" fill="#fff" stroke="#d5dbe3" stroke-width="2"/>` +
    `<circle cx="${x + 24}" cy="${oy + 10}" r="5" fill="#fff" stroke="#9aa3ad" stroke-width="2"/>` +
    `<rect x="${x + 36}" y="${oy + 7}" width="${w}" height="6" rx="3" fill="#c9ced6"/>`
  // 高亮：蓝边框 + 选中的小圆点，在两个选项之间来回挪，每个停一会儿
  const highlight = `<g><rect x="${x + 12}" y="${y + 48}" width="102" height="20" rx="10" fill="#5b8def" fill-opacity="0.14" stroke="#5b8def" stroke-width="2.5"/>` +
    `<circle cx="${x + 24}" cy="${y + 58}" r="2.6" fill="#5b8def"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 26;0 26;0 0" keyTimes="0;0.35;0.5;0.85;1" calcMode="spline" keySplines="0 0 1 1;0.45 0 0.55 1;0 0 1 1;0.45 0 0.55 1" dur="${D}" ${loop}/></g>`
  return `<g>${winFrame(x, y, 126, 104, false, '#eef0fb')}` +
    `<rect x="${x + 12}" y="${y + 30}" width="74" height="7" rx="3.5" fill="#6b4a3a" opacity="0.55"/>${dots}` +
    `${option(y + 48, 58)}${option(y + 74, 46)}${highlight}${floatY('2.6s')}</g>`
})()

// 有新版本：小窗口里一个往上跳的箭头、「NEW」标签和一条下载进度条，旁边几颗金色闪光
// progress：正在下载 / 安装时的真实进度（0–100），这时标签显示百分比、进度条停在真实位置；
// 到 100 是「正在安装」，进度条满格一闪一闪。没有 progress 时是发现新版本时的循环动画
const updateCard = (progress = null) => {
  const x = 432, y = 30, D = '2.4s'
  const arrow = `<g><circle cx="${x + 40}" cy="${y + 60}" r="20" fill="#ffe9a8" stroke="#e0a526" stroke-width="2.5"/>` +
    `<path d="M${x + 40} ${y + 70} v-20 m-9 9 l9 -9 l9 9" fill="none" stroke="#c07f0e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="1.1s" ${loop}/></g>`
  const label = progress === null ? 'NEW' : progress >= 100 ? '安装' : `${Math.round(progress)}%`
  const badge = `<rect x="${x + 70}" y="${y + 36}" width="44" height="20" rx="10" fill="#ff7a59"/>` +
    `<text x="${x + 92}" y="${y + 50.5}" text-anchor="middle" font-family="-apple-system, 'PingFang SC', 'Segoe UI', sans-serif" font-size="12" font-weight="700" fill="#fff">${label}</text>`
  const fill = progress === null
    ? `<rect x="${x + 70}" y="${y + 66}" width="0" height="8" rx="4" fill="#e0a526"><animate attributeName="width" values="0;44;44" keyTimes="0;0.8;1" dur="${D}" ${loop}/></rect>`
    : progress >= 100
      ? `<rect x="${x + 70}" y="${y + 66}" width="44" height="8" rx="4" fill="#e0a526"><animate attributeName="opacity" values="1;0.35;1" dur="1s" ${loop}/></rect>`
      : `<rect x="${x + 70}" y="${y + 66}" width="${(44 * Math.max(0, progress) / 100).toFixed(1)}" height="8" rx="4" fill="#e0a526"/>`
  const bar = `<rect x="${x + 70}" y="${y + 66}" width="44" height="8" rx="4" fill="#efe6d4"/>` + fill
  return `<g>${winFrame(x, y, 126, 100, false, '#fff6dc')}${arrow}${badge}${bar}${floatY('2.6s')}</g>` +
    star(80, 190, 0.9, '0.6s', '#ffd54a') + star(548, 360, 0.8, '0.2s', '#ffd54a') + star(60, 320, 0.7, '1s', '#ffd54a') + star(530, 220, 0.6, '0.9s')
}

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
const bubbles = [[30, 340, 9], [44, 400, 6], [26, 250, 7], [548, 350, 10], [540, 290, 6], [546, 220, 8], [300, 96, 7], [250, 108, 5]].map(([x, y, r], i) =>
  `<g transform="translate(${x} ${y})" opacity="0"><circle r="${r}" fill="#bfe6ff" fill-opacity="0.35" stroke="#5aa9e6" stroke-width="2"/>` +
  `<circle cx="${-r * 0.35}" cy="${-r * 0.35}" r="${Math.max(1.5, r * 0.25)}" fill="#fff" opacity="0.9"/>` +
  `${fadeLoop(`${2.6 + (i % 3) * 0.4}s`, `${(i * 0.37).toFixed(2)}s`)}${rise(`${2.6 + (i % 3) * 0.4}s`, `${(i * 0.37).toFixed(2)}s`, y > 200 ? -110 : -50, i % 2 ? 8 : -8)}</g>`).join('')
// 饭碗冒热气：右上角三缕蒸汽（DeepSeek 吃白饭）
const steam = [0, 1, 2].map(i =>
  `<path d="M${470 + i * 18} 140 q-8 -12 0 -24 t0 -24" stroke="#d9d4cc" stroke-width="4" fill="none" stroke-linecap="round" opacity="0">` +
  `${fadeLoop('2.2s', `${i * 0.5}s`)}<animateTransform attributeName="transform" type="translate" values="0 0;0 -26" dur="2.2s" begin="${i * 0.5}s" ${loop} additive="sum"/></path>`).join('')
// 庆祝：两侧彩纸 + 闪光（GPT reset、DeepSeek 吃大餐）
const fxCelebrate = confetti + star(500, 170, 1, '0.5s', '#ffd54a') + star(80, 200, 0.9, '0.9s', '#ffd54a') + star(548, 392, 0.8, '0.3s')
// 大成功但立绘里已经画了皇冠：只留几颗金色闪光，不再叠特效皇冠和奖杯
const fxVictory = star(510, 140, 1.1, '0.4s', '#ffd54a') + star(548, 330, 0.8, '0.2s', '#ffd54a') + star(70, 200, 0.9, '0.8s', '#ffd54a') + star(60, 330, 0.7, '1.1s', '#ffd54a')
// 价签（DeepSeek × GLM 的彩蛋）：右上角挂着一张晃来晃去的价签，旁边的箭头一跳一跳。
// down：DeepSeek 偷偷把 GLM 的价签改成打折（原价划掉）；up：GLM 顺手涨个价
const priceTag = (up) => {
  const x = 470, y = 40, color = up ? '#e5484d' : '#2f9e5b'
  const tag = `<g><line x1="${x + 30}" y1="${y - 14}" x2="${x + 30}" y2="${y + 4}" stroke="#8a7a70" stroke-width="2"/>` +
    `<path d="M${x + 6} ${y + 14} l18 -12 h40 a6 6 0 0 1 6 6 v52 a6 6 0 0 1 -6 6 h-40 l-18 -12 z" fill="#fffaf0" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<circle cx="${x + 20}" cy="${y + 14}" r="3.5" fill="#fff" stroke="${INK}" stroke-width="1.5"/>` +
    `<text x="${x + 45}" y="${y + 48}" text-anchor="middle" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="30" font-weight="800" fill="${INK}">¥</text>` +
    (up ? '' : `<line x1="${x + 32}" y1="${y + 46}" x2="${x + 60}" y2="${y + 26}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`) +
    `<animateTransform attributeName="transform" type="rotate" values="-7 ${x + 30} ${y - 14};7 ${x + 30} ${y - 14};-7 ${x + 30} ${y - 14}" dur="2.2s" ${loop}/></g>`
  const ax = x + 92
  const arrow = `<g><path d="${up ? `M${ax} ${y + 64} v-34 m-10 10 l10 -10 l10 10` : `M${ax} ${y + 24} v34 m-10 -10 l10 10 l10 -10`}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${up ? -6 : 6};0 0" dur="0.9s" ${loop}/></g>`
  // 画的时候按小尺寸算，整体放大到和其他小窗差不多大，右上角对齐
  return `<g transform="translate(${x} ${y}) scale(1.45) translate(${-x} ${-y}) translate(-40 -8)">${tag}${arrow}</g>`
}
// 红温：头顶两侧一团团白蒸汽往上冒
const puff = (x, y, begin) => `<g opacity="0"><circle cx="${x}" cy="${y}" r="13" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="${x + 13}" cy="${y - 6}" r="10" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
  `<circle cx="${x - 11}" cy="${y - 5}" r="8" fill="#fff" stroke="${INK}" stroke-width="2.5"/>${fadeLoop('1.4s', begin)}` +
  `<animateTransform attributeName="transform" type="translate" values="0 10;0 -34" dur="1.4s" begin="${begin}" ${loop}/></g>`
const angerSteam = puff(196, 118, '0s') + puff(384, 112, '0.5s') + puff(178, 150, '0.9s') + puff(402, 146, '0.3s')
// 鼓脸：只有一小团
const angerPuff = puff(392, 120, '0s')
// 被甩晕：头顶三颗小星星绕圈
const dizzyStars = [0, 1, 2].map(i => `<g>${star(0, 0, 0.55, `${i * 0.1}s`, '#ffd54a', '2s')}` +
  `<animateMotion path="M290 92 m-70 0 a70 20 0 1 0 140 0 a70 20 0 1 0 -140 0" dur="1.6s" begin="-${(i * 1.6 / 3).toFixed(2)}s" ${loop}/></g>`).join('')
const named = { bubbles, steam, celebrate: fxCelebrate, victory: fxVictory, priceDown: priceTag(false), priceUp: priceTag(true) }

// ---- 按时段 / 节日打招呼的环境特效 ----
// 和角色有关的东西（茶杯、装扮、道具）都画在立绘里；这里只做氛围，放在两侧（x<95 或 x>485）和头顶上方（y<105），不压人物
const fxOnce = (dur, begin = '0s') => `dur="${dur}" begin="${begin}" fill="freeze"`
// 入场：从透明淡入并轻轻落位
const fxEnter = (dy = 12, dur = '0.7s') =>
  `<animate attributeName="opacity" values="0;1" ${fxOnce(dur)}/><animateTransform attributeName="transform" type="translate" values="0 ${dy};0 0" ${fxOnce(dur)} additive="sum"/>`
// 从上往下飘落的小东西：shape(i) 返回以 (0,0) 为中心的图形
const fall = (xs, shape, { dur = 4, dy = 300, sway = 14, y0 = -10, spin = 0 } = {}) => xs.map((x, i) => {
  const d = `${(dur + (i % 3) * 0.6).toFixed(1)}s`, b = `${(i * 0.53).toFixed(2)}s`
  return `<g transform="translate(${x} ${y0 + (i % 4) * 18})" opacity="0"><g>${shape(i)}` +
    (spin ? `<animateTransform attributeName="transform" type="rotate" values="0;${spin * (i % 2 ? 1 : -1)}" dur="${d}" begin="${b}" ${loop}/>` : '') +
    `</g>${fadeLoop(d, b)}<animateTransform attributeName="transform" type="translate" values="0 0;${sway} ${dy * 0.5};${-sway / 2} ${dy}" dur="${d}" begin="${b}" ${loop} additive="sum"/></g>`
}).join('')
// 从下往上升起
const ascend = (pts, shape, { dur = 5, dy = -220 } = {}) => pts.map(([x, y], i) => {
  const d = `${(dur + (i % 3) * 0.7).toFixed(1)}s`, b = `${(i * 0.9).toFixed(2)}s`
  return `<g transform="translate(${x} ${y})" opacity="0">${shape(i)}${fadeLoop(d, b)}${rise(d, b, dy, i % 2 ? 10 : -10)}</g>`
}).join('')
const SIDES = [22, 48, 74, 506, 532, 558]

const sunDefs = `<defs><radialGradient id="fxSun" cx="40%" cy="38%" r="65%"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.55" stop-color="#ffd25e"/><stop offset="1" stop-color="#f5a623"/></radialGradient></defs>`
const sun = (x, y, r, raysDur = '14s') => {
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = i * 36, long = i % 2 === 0
    return `<path d="M0 ${-(r + 8)} L${long ? 5 : 4} ${-(r + (long ? 22 : 16))} L${long ? -5 : -4} ${-(r + (long ? 22 : 16))}Z" transform="rotate(${a})" fill="#ffc94a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`
  }).join('')
  return `<g transform="translate(${x} ${y})"><g>${rays}<animateTransform attributeName="transform" type="rotate" values="0;360" dur="${raysDur}" ${loop}/></g>` +
    `<circle r="${r}" fill="url(#fxSun)" stroke="${INK}" stroke-width="2.5"/><ellipse cx="${-r * 0.35}" cy="${-r * 0.4}" rx="${r * 0.28}" ry="${r * 0.18}" fill="#fff" opacity="0.7"/></g>`
}
const fxCloud = (x, y, s, dur, dx) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-34 10 a14 14 0 0 1 4 -27 a20 20 0 0 1 36 -6 a16 16 0 0 1 26 13 a12 12 0 0 1 -2 20z" fill="#fff" stroke="${INK}" stroke-width="2.2"/>` +
  `<path d="M-24 4 a10 10 0 0 1 10 -10" stroke="#dfe8f5" stroke-width="3" fill="none" stroke-linecap="round"/>` +
  `<animateTransform attributeName="transform" type="translate" values="0 0;${dx} 0;0 0" dur="${dur}" ${loop} additive="sum"/></g>`

// 早上：右上角太阳升起，光芒慢慢转
const fxMorning = `${sunDefs}<g>${sun(520, 72, 26)}${fxEnter(40, '1.4s')}</g>` +
  star(60, 150, 0.7, '0.4s', '#ffd98a', '2.6s') + star(40, 260, 0.5, '1.3s', '#ffd98a', '2.6s')
// 中午：头顶高处的太阳 + 两朵飘过的云
const fxNoon = `${sunDefs}<g>${sun(70, 64, 24, '10s')}${fxEnter(-20, '0.9s')}</g>` +
  `<g>${fxCloud(512, 70, 0.9, '6s', -14)}${fxEnter(0, '1s')}</g><g>${fxCloud(530, 170, 0.6, '7s', 10)}${fxEnter(0, '1.4s')}</g>`
// 下午：两侧飘落的暖色花瓣
const petal = i => `<path d="M0 -9 C7 -6 7 5 0 9 C-7 5 -7 -6 0 -9Z" fill="${['#ffc1a8', '#ffd7a0', '#f9a98b'][i % 3]}" stroke="${INK}" stroke-width="1.4"/><path d="M0 -6 V6" stroke="#e98e6f" stroke-width="1"/>`
const fxAfternoon = fall(SIDES, petal, { dur: 4.4, dy: 360, sway: 18, spin: 220 })
// 晚上：两侧一闪一闪、慢慢飘的萤火虫
const firefly = i => `<circle r="9" fill="#fff3b0" opacity="0.35"/><circle r="4" fill="#ffe066" stroke="#d9a21b" stroke-width="1.2"/>`
const fxEvening = ascend([[40, 300], [70, 380], [30, 200], [520, 320], [548, 240], [505, 400]], firefly, { dur: 4.2, dy: -90 })
// 深夜：弯月 + 闪烁的星星 + 偶尔一颗流星
const moonDefs = `<defs><linearGradient id="fxMoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8d6"/><stop offset="1" stop-color="#f2cf6b"/></linearGradient></defs>`
const crescent = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -30 a30 30 0 1 0 26 45 a24 24 0 1 1 -26 -45z" fill="url(#fxMoon)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
  `<circle cx="-12" cy="6" r="3" fill="#e8c35a" opacity="0.7"/><circle cx="-6" cy="18" r="2" fill="#e8c35a" opacity="0.7"/></g>`
// 流星：头沿斜线划过，尾巴晚一点出发跟着走，所以先拖出一道光、再收短消失（不是一整根线平移）
const shootingStar = (() => {
  const [x0, y0, x1, y1] = [570, 12, 380, 88], t = 'dur="6s" ' + loop
  const kt = 'keyTimes="0;0.6;0.72;1"', ktTail = 'keyTimes="0;0.63;0.76;1"'
  return `<defs><linearGradient id="fxTail" gradientUnits="userSpaceOnUse" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"><stop offset="0" stop-color="#fff3c4" stop-opacity="0"/><stop offset="1" stop-color="#fffbe6"/></linearGradient></defs>` +
    `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0}" stroke="url(#fxTail)" stroke-width="3" stroke-linecap="round">` +
    `<animate attributeName="x2" values="${x0};${x0};${x1};${x1}" ${kt} ${t}/><animate attributeName="y2" values="${y0};${y0};${y1};${y1}" ${kt} ${t}/>` +
    `<animate attributeName="x1" values="${x0};${x0};${x1};${x1}" ${ktTail} ${t}/><animate attributeName="y1" values="${y0};${y0};${y1};${y1}" ${ktTail} ${t}/></line>` +
    `<circle r="3.2" fill="#fff" opacity="0"><animate attributeName="cx" values="${x0};${x0};${x1};${x1}" ${kt} ${t}/><animate attributeName="cy" values="${y0};${y0};${y1};${y1}" ${kt} ${t}/>` +
    `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.6;0.62;0.72;1" ${t}/></circle>`
})()
const fxNight = `${moonDefs}<g>${crescent(66, 76, 1)}${fxEnter(16, '1.2s')}</g>` +
  star(140, 36, 0.6, '0s', '#fff3c4', '2.2s') + star(500, 90, 0.8, '0.7s', '#fff3c4', '2.4s') + star(548, 190, 0.5, '1.4s', '#fff3c4', '2s') +
  star(30, 220, 0.5, '1.1s', '#fff3c4', '2.6s') + shootingStar
// 凌晨：淡淡的月亮和稀疏的星星
const fxDawn = `${moonDefs}<g opacity="0.85">${crescent(520, 66, 0.7)}${fxEnter(0, '1.5s')}</g>` +
  star(60, 70, 0.5, '0s', '#e8ecff', '3.4s') + star(36, 180, 0.4, '1.2s', '#e8ecff', '3.4s') + star(470, 40, 0.4, '2.1s', '#e8ecff', '3.4s')

// 万圣节：两侧扑扇翅膀的小蝙蝠
const bat = (path, dur, begin) => `<g opacity="0"><g><path d="M0 0 C-6 -10 -14 -12 -22 -6 C-18 -4 -16 0 -18 4 C-12 0 -6 2 0 6 C6 2 12 0 18 4 C16 0 18 -4 22 -6 C14 -12 6 -10 0 0Z" fill="#3b2a3f" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<circle cx="-3" cy="-1" r="1.4" fill="#ffd34d"/><circle cx="3" cy="-1" r="1.4" fill="#ffd34d"/>` +
  `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.35;1 1" dur="0.32s" ${loop}/></g>` +
  `<animate attributeName="opacity" values="0;1" ${fxOnce('0.6s', begin)}/><animateMotion path="${path}" dur="${dur}" begin="${begin}" ${loop}/></g>`
const fxHalloween = bat('M60 120 C20 90 90 60 50 30 C10 0 100 10 70 60 C40 110 100 140 60 120', '5s', '0s') +
  bat('M520 90 C560 60 490 40 530 20 C570 0 480 10 510 60 C540 110 480 120 520 90', '6s', '0.6s') +
  bat('M540 260 C570 230 500 220 530 200 C560 180 500 170 520 230 C540 290 510 290 540 260', '5.5s', '1.2s')
// 圣诞：雪花飘落
const flake = i => `<g transform="scale(${[1, 0.75, 0.9][i % 3]})"><circle r="7" fill="#fff" stroke="#9fb6d6" stroke-width="1.6"/>` +
  `<path d="M0 -5 V5 M-4.3 -2.5 L4.3 2.5 M-4.3 2.5 L4.3 -2.5" stroke="#9fb6d6" stroke-width="1.3" stroke-linecap="round"/></g>`
const fxChristmas = fall([...SIDES, 140, 440, 200, 380], flake, { dur: 5.2, dy: 420, sway: 16, spin: 120 })
// 元旦：两侧烟花一朵朵绽放
const firework = (x, y, color, begin) => {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30) * Math.PI / 180, x2 = (Math.cos(a) * 34).toFixed(1), y2 = (Math.sin(a) * 34).toFixed(1)
    return `<line x1="${(x2 * 0.35).toFixed(1)}" y1="${(y2 * 0.35).toFixed(1)}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<circle cx="${x2}" cy="${y2}" r="2.6" fill="#fff6c8"/>`
  }).join('')
  return `<g transform="translate(${x} ${y})"><g opacity="0">${rays}<circle r="5" fill="#fff6c8"/>` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.5;1" dur="2.4s" begin="${begin}" ${loop}/>` +
    `<animateTransform attributeName="transform" type="scale" values="0.2;1;1.15" keyTimes="0;0.35;1" dur="2.4s" begin="${begin}" ${loop}/></g></g>`
}
const fxNewYear = firework(70, 90, '#ff6b81', '0s') + firework(512, 70, '#ffd54a', '0.8s') + firework(530, 210, '#5b8def', '1.6s') + firework(50, 230, '#7ed957', '1.2s')
// 春节：两角挂着摇晃的红灯笼 + 金色闪光
const lanternDefs = `<defs><radialGradient id="fxLantern" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff8a6b"/><stop offset="0.6" stop-color="#e5352b"/><stop offset="1" stop-color="#b81f1a"/></radialGradient></defs>`
const redLantern = (x, s, begin) => `<g transform="translate(${x} 0) scale(${s})"><g>` +
  `<line x1="0" y1="0" x2="0" y2="34" stroke="${INK}" stroke-width="2"/>` +
  `<rect x="-10" y="32" width="20" height="7" rx="2" fill="#f2c14e" stroke="${INK}" stroke-width="1.6"/>` +
  `<ellipse cx="0" cy="64" rx="30" ry="26" fill="url(#fxLantern)" stroke="${INK}" stroke-width="2.4"/>` +
  `<path d="M-14 42 Q-22 64 -14 86 M0 38 V90 M14 42 Q22 64 14 86" stroke="#9e1915" stroke-width="1.4" fill="none" opacity="0.7"/>` +
  `<ellipse cx="-10" cy="54" rx="6" ry="9" fill="#ffb59e" opacity="0.6"/>` +
  `<rect x="-10" y="88" width="20" height="7" rx="2" fill="#f2c14e" stroke="${INK}" stroke-width="1.6"/>` +
  `<path d="M-5 95 V114 M0 95 V118 M5 95 V114" stroke="#f2c14e" stroke-width="2.4" stroke-linecap="round"/>` +
  `<animateTransform attributeName="transform" type="rotate" values="-6;6;-6" dur="2.6s" begin="${begin}" ${loop}/></g></g>`
const fxSpring = `${lanternDefs}<g>${redLantern(52, 0.95, '0s')}${fxEnter(-30, '0.9s')}</g><g>${redLantern(528, 0.95, '0.6s')}${fxEnter(-30, '1.1s')}</g>` +
  star(60, 230, 0.9, '0.3s', '#ffd54a') + star(520, 250, 1, '0.9s', '#ffd54a') + star(40, 330, 0.6, '1.4s', '#ffd54a') + star(548, 350, 0.7, '0.5s', '#ffd54a')
// 元宵：孔明灯慢慢升起
const skyLantern = i => `<g transform="scale(${[1, 0.8, 0.9][i % 3]})"><ellipse cx="0" cy="4" rx="20" ry="8" fill="#ffd27a" opacity="0.35"/>` +
  `<path d="M-13 -20 Q0 -26 13 -20 L10 12 Q0 15 -10 12Z" fill="#ffb347" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
  `<path d="M-5 -18 Q-7 -4 -5 10" stroke="#fff1c9" stroke-width="2.4" fill="none" opacity="0.8"/>` +
  `<ellipse cx="0" cy="12" rx="10" ry="2.6" fill="#ffe066" stroke="${INK}" stroke-width="1.4"/></g>`
const fxLantern = ascend([[46, 440], [80, 360], [30, 300], [520, 430], [550, 350], [500, 280]], skyLantern, { dur: 6, dy: -300 })
// 端午：竹叶飘落
const leaf = i => `<path d="M0 -14 C8 -8 8 8 0 14 C-8 8 -8 -8 0 -14Z" fill="${i % 2 ? '#7fbf6a' : '#5ea85a'}" stroke="${INK}" stroke-width="1.5"/><path d="M0 -12 V12" stroke="#3f7d43" stroke-width="1.2"/>`
const fxDragonBoat = fall(SIDES, leaf, { dur: 4.6, dy: 330, sway: 20, spin: 160 })
// 中秋：右上角一轮圆月 + 桂花飘落
const fullMoon = `<defs><radialGradient id="fxFull" cx="42%" cy="40%" r="62%"><stop offset="0" stop-color="#fffbe6"/><stop offset="0.7" stop-color="#ffe49a"/><stop offset="1" stop-color="#f3c85c"/></radialGradient></defs>` +
  `<g transform="translate(512 74)"><circle r="46" fill="#fff3c4" opacity="0.35"/><circle r="34" fill="url(#fxFull)" stroke="${INK}" stroke-width="2.5"/>` +
  `<circle cx="10" cy="-8" r="5" fill="#ecc96b" opacity="0.6"/><circle cx="-10" cy="10" r="3.5" fill="#ecc96b" opacity="0.6"/><circle cx="14" cy="14" r="2.5" fill="#ecc96b" opacity="0.6"/>` +
  `<animate attributeName="opacity" values="0;1" ${fxOnce('1.4s')}/></g>`
const osmanthus = i => `<g fill="#ffb627" stroke="${INK}" stroke-width="1">${[0, 90, 180, 270].map(a => `<ellipse cx="0" cy="-3.6" rx="2.4" ry="3.4" transform="rotate(${a})"/>`).join('')}<circle r="1.6" fill="#fff1b0" stroke="none"/></g>`
const fxMidAutumn = fullMoon + fall([22, 52, 82, 470, 540, 560], osmanthus, { dur: 4.8, dy: 320, sway: 14, spin: 180, y0: 140 })
// 国庆（出游主题）：白云飘过 + 一架纸飞机
const plane = `<g opacity="0"><path d="M0 0 L36 -12 L14 6Z" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M14 6 L36 -12 L18 14Z" fill="#dfe8f5" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
  `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="5s" ${loop}/>` +
  `<animateMotion path="M10 140 C60 60 140 40 200 60 S330 30 380 50 S500 90 560 40" dur="5s" ${loop}/></g>`
const fxNational = `<g>${fxCloud(70, 70, 0.8, '7s', 12)}${fxEnter(0, '1s')}</g><g>${fxCloud(520, 120, 0.7, '6s', -12)}${fxEnter(0, '1.3s')}</g>` + plane

const GREET_FX = {
  greet_morning: fxMorning, greet_noon: fxNoon, greet_afternoon: fxAfternoon, greet_evening: fxEvening, greet_night: fxNight, greet_dawn: fxDawn,
  fest_halloween: fxHalloween, fest_christmas: fxChristmas, fest_newyear: fxNewYear, fest_spring: fxSpring, fest_lantern: fxLantern,
  fest_dragonboat: fxDragonBoat, fest_midautumn: fxMidAutumn, fest_national: fxNational,
}
Object.assign(AURA, {
  greet_morning: ['#ffe2a8', 0.5], greet_noon: ['#fff0a8', 0.5], greet_afternoon: ['#ffd2b8', 0.45], greet_evening: ['#ffc98a', 0.5],
  greet_night: ['#9fb0e8', 0.45], greet_dawn: ['#c9bff0', 0.45],
  fest_halloween: ['#ffb36b', 0.5], fest_christmas: ['#cfe6ff', 0.5], fest_newyear: ['#ffe08a', 0.6], fest_spring: ['#ff9b8a', 0.55],
  fest_lantern: ['#ffcf8a', 0.55], fest_dragonboat: ['#a8e0b8', 0.5], fest_midautumn: ['#ffe7a3', 0.55], fest_national: ['#bfe0ff', 0.5],
})

// 每个姿态周围的细节
const surroundings = (p      )         => {
  switch (p) {
    case 'idle': return star(80, 180, 0.6, '0s', '#ffc58a', '3s') + star(500, 260, 0.5, '1.5s', '#ffc58a', '3s')
    case 'listening': return chatCard
    case 'asking': return choiceCard
    case 'update': return updateCard(window.CrossFx?.updateProgress ?? null)
    case 'thinking': return thoughtCloud
    case 'reading': return viewerCard + floatingGlyphs
    case 'writing': return editorCard
    case 'running': return terminal
    case 'searching': return magnifier + browser
    case 'delegating': return taskCard  // 子任务依次完成；「派出分身」交给立绘表现
    case 'happy': return checklist + confetti + star(500, 170, 1, '0.5s') + star(548, 392, 0.9, '0.3s')
    case 'proud': return trophy + crown + star(510, 140, 1.1, '0.4s', '#ffd54a') + star(548, 330, 0.8, '0.2s', '#ffd54a')
    case 'oops': return errorCard
    case 'surprised': return pokeBurst
    case 'pat': return heart(440, 160, 1.8, '0s') + heart(480, 220, 1.3, '0.7s') + heart(110, 190, 1.5, '1.1s') + heart(90, 280, 1.1, '1.6s')
    case 'sleeping': return moonStars + zz
    case 'tired': return battery + gloom
    case 'hum': return musicCard + note(40, 250, '♪', '0s', '#e07a9a') + note(70, 290, '♫', '1.2s')
    case 'stretch': return stretchGlow
    case 'yawn': return yawnBubble
    case 'drawing': return easelCard
    case 'redhot': return angerSteam
    case 'puffed': return angerPuff
    case 'dizzy': return dizzyStars
    case 'coaxed': case 'forgiven': return heart(440, 160, 1.4, '0s') + heart(110, 200, 1.1, '0.8s')
  }
  return GREET_FX[p]
}

const sceneSvg = (art     , p      )         => {
  const scale = Math.min(AW / art.width, AH / art.height)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}">${aura(p)}` +
    `<ellipse cx="${CW / 2}" cy="${CH - 22}" rx="125" ry="11" fill="#000" opacity="0.12"/>` +
    `<g transform="translate(${AX} ${AY})"><g>${motion(p)}<g transform="scale(${scale})">${art.inner}</g></g></g>` +
    `${surroundings(p)}</svg>`
}

// 多会话的小卡片：每个对话正在做的事只取主要的那个道具（不带星星、彩带这些散在四周的点缀），网页裁好放进桌宠两侧
const cardProp = (p      )         => {
  switch (p) {
    case 'listening': return chatCard
    case 'asking': return choiceCard
    case 'reading': return viewerCard
    case 'writing': case 'compact': return editorCard
    case 'running': return terminal
    case 'searching': return browser
    case 'delegating': return taskCard
    case 'drawing': return easelCard
    case 'oops': case 'surprised': return errorCard
    case 'happy': case 'proud': return checklist
  }
  return thoughtCloud
}

window.CrossFx = { surroundings, named, cardProp, AURA, CW, CH, AX, AY, AW, AH }
