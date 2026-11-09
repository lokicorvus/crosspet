// 小本子面板的七套角色主题（皮面手账、潮汐日志、冰晶匣、星夜、狐狸掌柜的流水账、毒舌批改本、扇底春风录）和面板 HTML。
// 定稿原型 build/notebook-preview.html；样式在 notebook-themes.css，字体在 fonts/notebook/。
// 浏览器里是 window.NotebookThemes；Node 测试里 require 进来（只拼字符串，不碰 DOM）。
// 规则：只画几何类插画（纹样、器物、光效），动物、人物不手画；批注 / 落款默认值在这里，character.json 的 notebook 覆盖。
;(function (root) {
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  const pt = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] }
  const f = n => (+n).toFixed(1)

  const ICON = {
    quill: '<path d="M14 1.5C8.5 2.5 4.6 6.5 3.2 12.6l1.2.3C5 10.6 6.2 9 7.6 7.9 7 9.5 6.8 10.6 6.8 10.6 10.8 9.8 13.3 6.6 14 1.5z" fill="currentColor"/><path d="M2.2 14.5 4.4 12.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    snow: '<g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"/><path d="M6.4 2.6 8 4.1l1.6-1.5M6.4 13.4 8 11.9l1.6 1.5"/></g>',
    star: '<path d="M8 1.2l1.6 4.6 4.6 1.6-4.6 1.6L8 13.6 6.4 9 1.8 7.4 6.4 5.8z" fill="currentColor"/>',
    moon: '<path d="M10.8 2.2A6 6 0 1 0 13.8 10 4.8 4.8 0 0 1 10.8 2.2z" fill="currentColor"/>',
    cloud: '<path d="M1.5 10.5c0-1.6 1.3-2.7 2.8-2.6C4.6 5.9 6.2 4.5 8 4.5c2 0 3.5 1.4 3.7 3.2 1.6 0 2.8 1.2 2.8 2.7v.1H1.5z" fill="currentColor"/><path d="M5.5 12.8h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    heart: '<path d="M8 14S1.5 9.7 1.5 5.6A3.3 3.3 0 0 1 8 4.2a3.3 3.3 0 0 1 6.5 1.4C14.5 9.7 8 14 8 14z"/>',
    hearts: '<path d="M8 14S1.5 9.7 1.5 5.6A3.3 3.3 0 0 1 8 4.2a3.3 3.3 0 0 1 6.5 1.4C14.5 9.7 8 14 8 14z" fill="currentColor"/>',
    flag: '<path d="M4 14V2.5M4 3h7.5l-1.8 2.6L11.5 8H4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
    slash: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    wave: '<path d="M1 9c2-3 4-3 6 0s4 3 6 0M1 13c2-3 4-3 6 0s4 3 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="4" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    coin: '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="6" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    sparkle: '<path d="M8 1l1.4 5.6L15 8l-5.6 1.4L8 15l-1.4-5.6L1 8l5.6-1.4z" fill="currentColor"/>',
  }
  const svg = (k, cls = '') => `<svg viewBox="0 0 16 16" class="${cls}" aria-hidden="true">${ICON[k]}</svg>`

  function snowflake(cx, cy, r, color, w, op = 1) {
    const arm = `<path d="M0 0V${-r}M0 ${-r * .38}l${-r * .2} ${-r * .2}M0 ${-r * .38}l${r * .2} ${-r * .2}M0 ${-r * .64}l${-r * .16} ${-r * .16}M0 ${-r * .64}l${r * .16} ${-r * .16}M0 ${-r * .86}l${-r * .08} ${-r * .08}M0 ${-r * .86}l${r * .08} ${-r * .08}"/>`
    let g = ''
    for (let i = 0; i < 6; i++) g += `<g transform="rotate(${i * 60})">${arm}</g>`
    const hex = [0, 1, 2, 3, 4, 5].map(i => pt(0, 0, r * .17, i * 60 - 90).map(f).join(',')).join(' ')
    return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${op}">${g}<polygon points="${hex}"/></g>`
  }
  function sparkle4(x, y, s, color, cls = '', delay = 0) {
    return `<path class="${cls}" style="animation-delay:${delay}s" transform="translate(${x} ${y}) scale(${s})" d="M0-8 1.6-1.6 8 0 1.6 1.6 0 8-1.6 1.6-8 0-1.6-1.6z" fill="${color}"/>`
  }
  function starfield(n, seed, w = 364, h = 720) {
    const R = rng(seed); let s = ''
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = R() * h, r = R() * 1.1 + .35, o = .35 + R() * .65
      const tw = R() < .35 ? ` class="tw" style="animation-delay:${(R() * 3).toFixed(2)}s"` : ''
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff" opacity="${o.toFixed(2)}"${tw}/>`
    }
    return s
  }

  const ART = {
    claude: {
      icon: 'quill', notes: [null, '辛苦啦～', null], sign: '—— 今天也加油 · Claude',
      fg: () => {
        const corner = `<path d="M0 0h30L0 30z" fill="url(#brass)"/><path d="M4 4h16L4 20z" fill="none" stroke="#fff3c9" stroke-width=".7" opacity=".7"/><circle cx="9" cy="9" r="2.2" fill="#8a5a1c"/><circle cx="8.4" cy="8.4" r=".8" fill="#ffeeb8"/>`
        return `<svg width="364" height="40" style="left:0;top:0"><defs><linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d98a"/><stop offset=".5" stop-color="#c8963e"/><stop offset="1" stop-color="#8f6222"/></linearGradient></defs>
          <g>${corner}</g><g transform="translate(364 0) scale(-1 1)">${corner}</g></svg>
          <svg width="364" height="40" style="left:0;bottom:0"><g transform="translate(0 40) scale(1 -1)">${corner}</g><g transform="translate(364 40) scale(-1 -1)">${corner}</g></svg>`
      },
      head: () => `<div class="ribbon"></div>
        <svg style="position:absolute;right:-8px;top:-10px;width:110px;height:96px" viewBox="0 0 110 96">
          <ellipse cx="66" cy="86" rx="24" ry="4" fill="#d9c29a" opacity=".5"/>
          <path d="M50 62h32l3 18c0 4-4 6-19 6s-19-2-19-6z" fill="#3c2a22"/>
          <path d="M53 57h26v6H53z" fill="#5a4033"/><path d="M55 72c6 3 16 3 24 0" stroke="#7b6152" stroke-width="1.2" fill="none"/>
          <path d="M60 66c4-24 18-46 40-58-4 10-6 16-12 22 4 0 6-1 8-2-6 12-16 22-26 28 4 1 7 0 9-1-6 6-12 9-19 11z" fill="#fff8ea" stroke="#c49a6c" stroke-width="1"/>
          <path d="M61 64c10-16 22-34 36-52" stroke="#b07a48" stroke-width="1" fill="none"/>
          <g fill="#e2b98a"><circle cx="30" cy="34" r="1.4"/><circle cx="40" cy="22" r="1"/></g>
        </svg>`,
    },
    deepseek: {
      icon: 'wave', notes: ['来活啦！', null, null], sign: '—— 咕噜咕噜～',
      fg: () => {
        let sc = '', holes = ''
        for (let i = 0; i < 27; i++) { const x = i * 14 + 7; sc += `<circle cx="${x}" cy="9" r="7.5"/>`; holes += `<circle cx="${x}" cy="10" r="1.8"/>` }
        return `<svg width="364" height="24" style="left:0;top:0"><g fill="#fff" stroke="#b9dcef" stroke-width=".8">${sc}</g><rect width="364" height="8" fill="#fff"/>
          <path d="M0 8.5H364" stroke="#b9dcef" stroke-width=".8"/><g fill="#d9eef8">${holes}</g>
          <g fill="#2c4fa6"><path d="M174 2l-12-4v14z"/><path d="M190 2l12-4v14z"/><circle cx="182" cy="5" r="4"/></g></svg>`
      },
      bg: () => {
        const R = rng(7); let b = ''
        for (let i = 0; i < 9; i++) { const s = 4 + R() * 10; b += `<span class="bubble" style="left:${(R() * 92).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${(7 + R() * 7).toFixed(1)}s;animation-delay:${(-R() * 12).toFixed(1)}s"></span>` }
        return `<svg width="364" height="720" style="left:0;top:0"><g fill="#fff" opacity=".4"><path d="M70 0h34L60 520H40z"/><path d="M170 0h22L150 460h-14z"/><path d="M260 0h40L250 560h-22z"/></g></svg>${b}
          <svg viewBox="0 0 364 70" style="left:0;bottom:0;width:100%;height:70px" preserveAspectRatio="none">
            <path d="M0 34Q46 20 91 34T182 34T273 34T364 34V70H0Z" fill="#b6def0" opacity=".55"/>
            <path d="M0 48Q46 36 91 48T182 48T273 48T364 48V70H0Z" fill="#9fd1ea" opacity=".5"/>
            <g fill="none" stroke="#7fbcd8" stroke-width="3" stroke-linecap="round" opacity=".55"><path d="M22 70c-6-12 6-18 0-30"/><path d="M34 70c4-8-4-12 0-20"/></g>
          </svg>`
      },
      head: () => {
        let sc = ''
        for (let j = 0; j < 12; j++) for (let k = -1; k < 8; k++) {
          const x = k * 20 + (j % 2) * 10, y = j * 6
          sc += `<g transform="translate(${x} ${y})">${[10, 7, 4].map(r => `<circle r="${r}" fill="#eaf7fd" stroke="#7fc0e0" stroke-width="1"/>`).join('')}</g>`
        }
        return `<svg style="position:absolute;right:-22px;top:-30px;width:140px;height:104px" viewBox="0 0 140 96">
          <defs><radialGradient id="seafade" cx="1" cy="0" r="1"><stop offset=".25" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
            <mask id="seamask"><rect width="140" height="96" fill="url(#seafade)"/></mask></defs>
          <g mask="url(#seamask)" opacity=".9">${sc}</g>
          <g fill="none" stroke="#7fc0e0" stroke-width="1.2"><circle cx="34" cy="70" r="5"/><circle cx="22" cy="56" r="3"/><circle cx="40" cy="48" r="2"/></g>
          <path d="M31.5 67.5a3 3 0 0 1 2-1.4" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        </svg>`
      },
    },
    gpt: {
      icon: 'snow', notes: [null, null, '……嗯。'], sign: '改好了再叫你。',
      bg: () => {
        const R = rng(3); let tri = ''
        for (let i = 0; i < 14; i++) { const x = R() * 364, y = R() * 680, s = 30 + R() * 70; tri += `<path d="M${f(x)} ${f(y)}l${f(s)} ${f(s * .35)}l${f(-s * .45)} ${f(s * .8)}z" fill="${R() < .5 ? '#ffffff' : '#d7e4f3'}" opacity="${(.25 + R() * .35).toFixed(2)}"/>` }
        return `<svg width="364" height="720" style="left:0;top:0">${tri}</svg>
          <svg width="120" height="120" style="left:-30px;bottom:-30px">${snowflake(60, 60, 50, '#d2e0f0', 2.4)}</svg>`
      },
      fg: () => `<svg width="364" height="20" style="left:0;top:0"><path d="M1 18 18 1H346L363 18" fill="none" stroke="#b9cde6" stroke-width="1.6"/></svg>
        <svg width="364" height="20" style="left:0;bottom:0"><path d="M1 2 18 19H346L363 2" fill="none" stroke="#b9cde6" stroke-width="1.6"/></svg>`,
      head: () => `<svg style="position:absolute;right:0;top:-10px;width:110px;height:100px" viewBox="0 0 120 110">
          <defs><radialGradient id="ice" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#dfeafa"/><stop offset="1" stop-color="#dfeafa" stop-opacity="0"/></radialGradient></defs>
          <circle cx="64" cy="52" r="50" fill="url(#ice)"/>
          ${snowflake(64, 52, 40, '#94b0d8', 2.4)}${snowflake(64, 52, 40, '#ffffff', .8)}
          ${snowflake(14, 90, 10, '#b0c6e4', 1.3)}
          ${sparkle4(108, 20, .8, '#94b0d8', 'tw', 0)}${sparkle4(22, 28, .6, '#b0c6e4', 'tw', 1.2)}${sparkle4(106, 94, .5, '#94b0d8', 'tw', .6)}
        </svg>`,
    },
    gemini: {
      icon: 'star', notes: ['冲呀！', null, '再摸摸喵'], sign: '喵～ Gemini',
      outer: () => {
        const ear = `<path d="M4 46C6 26 14 8 30 0c10 10 18 26 22 46z" fill="#3a2f78"/><path d="M14 42c2-14 8-26 16-32 6 8 11 20 13 32z" fill="#f2a7c9" opacity=".55"/>`
        return `<svg width="56" height="48" style="position:absolute;left:46px;top:-30px;z-index:-1">${ear}</svg><svg width="56" height="48" style="position:absolute;right:46px;top:-30px;transform:scaleX(-1);z-index:-1">${ear}</svg>`
      },
      bg: () => `<svg width="364" height="720" style="left:0;top:0">${starfield(75, 11)}
          <defs><linearGradient id="shoot" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
          <path d="M24 300l64-24" stroke="url(#shoot)" stroke-width="1.4" stroke-linecap="round"/></svg>
          <svg width="364" height="60" style="left:0;bottom:0">${[[24, 46, -20], [50, 30, -14], [80, 40, -8], [106, 24, -2], [134, 32, 4]].map(([x, y, r], i) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(.8)" fill="#f4cb7f" opacity="${.18 + i * .06}"><ellipse cx="0" cy="4" rx="5" ry="4.2"/><circle cx="-5.5" cy="-3" r="2"/><circle cx="-1.8" cy="-6" r="2"/><circle cx="2.2" cy="-6" r="2"/><circle cx="5.6" cy="-3" r="2"/></g>`).join('')}</svg>`,
      head: () => `<svg style="position:absolute;right:-4px;top:-10px;width:128px;height:94px" viewBox="0 0 150 110">
          <defs><radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".5"/><stop offset="1" stop-color="#ffe6a8" stop-opacity="0"/></radialGradient></defs>
          <circle cx="112" cy="40" r="36" fill="url(#glow)"/>
          <path d="M120 20a21 21 0 1 0 9 31 17 17 0 0 1-9-31z" fill="#ffe6a8"/>
          <g stroke="#f4cb7f" stroke-width=".9" opacity=".7" fill="none"><path d="M10 34 30 24 50 36 42 62M30 24 26 50 42 62 62 84M50 36 70 50"/></g>
          ${[[10, 34], [30, 24], [50, 36], [42, 62], [26, 50], [62, 84], [70, 50]].map(([x, y], i) => sparkle4(x, y, i % 3 ? .4 : .6, '#fff3d0', 'tw', i * .4)).join('')}
        </svg>`,
    },
    glm: {
      icon: 'coin', notes: ['记下来～', null, '这个值多少呢'], sign: '—— 已入账 · GLM',
      fg: () => `<div class="frame"></div>`,
      head: () => {
        const rods = [0, 1, 2, 3, 4, 5]
        const up = [1, 0, 1, 1, 0, 1], down = [2, 4, 1, 3, 0, 2]
        let beads = ''
        rods.forEach(i => {
          const x = 14 + i * 14
          beads += `<line x1="${x}" y1="8" x2="${x}" y2="64" stroke="#8a5a2c" stroke-width="1.2"/>`
          for (let k = 0; k < 2; k++) { const y = up[i] && k === 1 ? 22 : 12 + k * 7 - (up[i] && k === 0 ? 0 : 0); beads += `<ellipse cx="${x}" cy="${up[i] && k === 1 ? 21 : 11 + k * 6}" rx="6" ry="3.2" fill="${k === 1 && up[i] ? '#b8322a' : '#3b4a7a'}"/>` }
          for (let k = 0; k < 5; k++) { const moved = k < down[i]; const y = moved ? 33 + k * 6 : 39 + k * 6 + (5 - down[i] > 0 ? 0 : 0); beads += `<ellipse cx="${x}" cy="${moved ? 33 + k * 6 : 40 + k * 5}" rx="6" ry="2.8" fill="${moved ? '#b8322a' : '#3b4a7a'}"/>` }
        })
        const coin = (x, y, r) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#e3b866" stroke="#a87a2e" stroke-width="1"/><circle r="${r * .72}" fill="none" stroke="#a87a2e" stroke-width=".7"/><rect x="${-r * .26}" y="${-r * .26}" width="${r * .52}" height="${r * .52}" fill="#fdf8ec" stroke="#a87a2e" stroke-width=".8"/></g>`
        return `<svg style="position:absolute;right:-8px;top:-8px;width:122px;height:96px" viewBox="0 0 122 96">
          <g transform="translate(14 6) rotate(-6 50 36)">
            <rect x="0" y="0" width="98" height="72" rx="4" fill="#6b3f1e"/><rect x="4" y="4" width="90" height="64" rx="2" fill="#f6ead2"/>
            <rect x="4" y="25" width="90" height="4" fill="#6b3f1e"/>
            <g transform="translate(-4 0)">${beads}</g>
          </g>
          <path d="M8 4v22" stroke="#b8322a" stroke-width="1.4"/>
          <g transform="translate(8 34)"><path d="M-8 0a8 8 0 0 1 16 0v4h-16z" fill="#e3b866" stroke="#a87a2e"/><rect x="-9" y="3" width="18" height="3" rx="1.5" fill="#c99a3e"/><circle cy="9" r="2.2" fill="#a87a2e"/></g>
          ${coin(26, 84, 9)}${coin(42, 88, 7)}
        </svg>`
      },
    },
    grok: {
      icon: 'slash',
      notes: ['还行', null, '摸够没'], ring: 2, sign: '阅 · Grok',
      fg: () => `<div class="tape" style="left:-16px;top:14px;transform:rotate(-38deg)"></div><div class="tape" style="right:-18px;bottom:16px;transform:rotate(-38deg)"></div>`,
      head: () => `<svg style="position:absolute;right:-4px;top:-6px;width:118px;height:92px" viewBox="0 0 118 92">
          <defs><filter id="stamp" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="5" result="n"/>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.45" result="m"/>
            <feComposite in="SourceGraphic" in2="m" operator="in" result="s"/>
            <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="2" result="d"/>
            <feDisplacementMap in="s" in2="d" scale="3"/></filter></defs>
          <g filter="url(#stamp)" transform="rotate(-12 60 48)" fill="#ef4a4a" stroke="#ef4a4a">
            <rect x="14" y="18" width="92" height="56" rx="5" fill="none" stroke-width="3"/>
            <rect x="19" y="23" width="82" height="46" rx="3" fill="none" stroke-width="1.2"/>
            <text x="60" y="52" text-anchor="middle" font-size="25" font-weight="900" stroke="none" font-family="Kaiti SC,STKaiti,KaiTi,serif" letter-spacing="4">已阅</text>
            <text x="60" y="64" text-anchor="middle" font-size="8.5" stroke="none" font-weight="700" letter-spacing="2">一般 · 还能更好</text>
          </g>
        </svg>`,
    },
    qwen: {
      icon: 'cloud', notes: [null, null, '有点意思呢'], sign: '一笔一笔，写漂亮些',
      fg: () => `<div class="frame"></div>`,
      bg: () => {
        const cloud = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"><path d="M0 10c0-6 8-8 12-4 0-8 12-10 16-2 6-4 14 0 12 6"/><path d="M8 10c-2-4 4-6 6-2"/><path d="M-4 14h48"/></g>`
        return `<svg width="364" height="140" style="left:0;top:0">${cloud(22, 40, .8, '#e3d3ae')}${cloud(300, 70, .7, '#e3d3ae')}</svg>`
      },
      head: () => {
        const cx = 130, cy = 118, R = 114, r = 36, a0 = 198, a1 = 342, n = 14
        let folds = '', ribs = ''
        for (let i = 0; i < n; i++) {
          const s = a0 + (a1 - a0) * i / n, e = a0 + (a1 - a0) * (i + 1) / n
          const [x1, y1] = pt(cx, cy, R, s), [x2, y2] = pt(cx, cy, R, e), [x3, y3] = pt(cx, cy, r, e), [x4, y4] = pt(cx, cy, r, s)
          folds += `<path d="M${f(x1)} ${f(y1)}A${R} ${R} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r} ${r} 0 0 0 ${f(x4)} ${f(y4)}z" fill="${i % 2 ? '#38458f' : '#4352a6'}"/>`
        }
        for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; const [x, y] = pt(cx, cy, r, a); const edge = i === 0 || i === n; ribs += `<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" stroke="${edge ? '#7a4a26' : '#b98a55'}" stroke-width="${edge ? 3 : 1.2}"/>` }
        const [ox1, oy1] = pt(cx, cy, R, a0), [ox2, oy2] = pt(cx, cy, R, a1), [ix1, iy1] = pt(cx, cy, r, a0), [ix2, iy2] = pt(cx, cy, r, a1)
        const blossom = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288].map(a => { const [px, py] = pt(0, 0, 3.6, a - 90); return `<circle cx="${f(px)}" cy="${f(py)}" r="3" fill="#f6c7cf"/>` }).join('')}<circle r="1.6" fill="#f3d27a"/></g>`
        return `<svg class="fan" viewBox="0 0 260 124">
          <defs><linearGradient id="fanshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
            <clipPath id="fanclip"><path d="M${f(ox1)} ${f(oy1)}A${R} ${R} 0 0 1 ${f(ox2)} ${f(oy2)}L${f(ix2)} ${f(iy2)}A${r} ${r} 0 0 0 ${f(ix1)} ${f(iy1)}z"/></clipPath></defs>
          ${ribs}
          <g>${folds}</g>
          <g clip-path="url(#fanclip)">
            <rect width="260" height="124" fill="url(#fanshade)"/>
            <path d="M36 70c10-14 26-16 36-6 6-14 26-14 32 0 10-8 24-2 22 10" fill="none" stroke="#e8c877" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
            <path d="M156 46c8-10 22-10 28 0 8-6 18-2 18 6" fill="none" stroke="#e8c877" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>
            <path d="M92 30c22 6 42 22 56 44M118 50c-6-6-4-12 2-14M134 62c2-8 8-10 14-8" stroke="#232955" stroke-width="1.8" fill="none" stroke-linecap="round"/>
            ${blossom(102, 34, 1)}${blossom(122, 48, .8)}${blossom(146, 72, 1.1)}${blossom(150, 54, .7)}${blossom(92, 30, .6)}
            <circle cx="200" cy="36" r="12" fill="#f6e3a8" opacity=".92"/>
          </g>
          <path d="M${f(ox1)} ${f(oy1)}A${R} ${R} 0 0 1 ${f(ox2)} ${f(oy2)}" fill="none" stroke="#d8b25a" stroke-width="3"/>
          <path d="M${f(ix1)} ${f(iy1)}A${r} ${r} 0 0 1 ${f(ix2)} ${f(iy2)}" fill="none" stroke="#d8b25a" stroke-width="1.5"/>
          <circle cx="${cx}" cy="${cy}" r="4.5" fill="#d8b25a" stroke="#7a4a26" stroke-width="1"/>
        </svg>`
      },
    },
  }

  let hid = 0
  function hearts(n) {
    let out = ''
    for (let i = 0; i < 10; i++) {
      const fill = Math.max(0, Math.min(1, n - i)), id = 'h' + (hid++)
      out += `<svg viewBox="0 0 16 16"><defs><clipPath id="${id}"><rect width="${16 * fill}" height="16"/></clipPath></defs><g fill="var(--line-strong)">${ICON.heart}</g><g fill="var(--accent)" clip-path="url(#${id})">${ICON.heart}</g></svg>`
    }
    return out
  }

  // 封面（翻书动画用）：合着的时候看到的那一面。只画几何纹样和书名签
  const COVER = {
    claude: () => {
      const corner = `<path d="M0 0h34L0 34z" fill="url(#cbrass)"/><circle cx="10" cy="10" r="2.4" fill="#8a5a1c"/>`
      return `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="none"><defs><linearGradient id="cbrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d98a"/><stop offset=".5" stop-color="#c8963e"/><stop offset="1" stop-color="#8f6222"/></linearGradient></defs>
        <rect x="14" y="14" width="336" height="572" rx="8" fill="none" stroke="#d9a873" stroke-width="1.4" stroke-dasharray="5 4" opacity=".7"/>
        <g>${corner}</g><g transform="translate(364 0) scale(-1 1)">${corner}</g><g transform="translate(0 600) scale(1 -1)">${corner}</g><g transform="translate(364 600) scale(-1 -1)">${corner}</g></svg>
        <div class="cv-label"><span class="cv-icon">${svg('quill')}</span><span class="cv-title">随身手册</span><span class="cv-sub">CLAUDE · NOTEBOOK</span></div>`
    },
    deepseek: () => {
      let sc = ''
      for (let i = 0; i < 27; i++) sc += `<circle cx="${i * 14 + 7}" cy="9" r="7.5"/>`
      return `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="xMidYMin slice"><g fill="#fff" opacity=".18"><path d="M70 0h34L60 520H40z"/><path d="M170 0h22L150 460h-14z"/><path d="M260 0h40L250 560h-22z"/></g>
        <g fill="#fff" stroke="#b9dcef" stroke-width=".8">${sc}</g><rect width="364" height="8" fill="#fff"/>
        <g fill="#2c4fa6"><path d="M174 4l-14-5v16z"/><path d="M190 4l14-5v16z"/><circle cx="182" cy="7" r="4.5"/></g>
        <g fill="none" stroke="#ffffffaa" stroke-width="1.3"><circle cx="64" cy="430" r="9"/><circle cx="84" cy="400" r="5"/><circle cx="300" cy="300" r="7"/><circle cx="286" cy="270" r="3.5"/></g></svg>
        <div class="cv-label"><span class="cv-icon">${svg('wave')}</span><span class="cv-title">潮汐日志</span><span class="cv-sub">咕噜 · 咕噜</span></div>`
    },
    gpt: () => `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="xMidYMid slice">${snowflake(182, 250, 92, '#ffffff', 3, .9)}${snowflake(182, 250, 92, '#9fb9de', 1, .9)}
        ${snowflake(60, 470, 22, '#ffffff', 1.6, .7)}${snowflake(310, 90, 16, '#ffffff', 1.4, .6)}
        <path d="M1 18 18 1H346L363 18M1 582 18 599H346L363 582" fill="none" stroke="#ffffffb0" stroke-width="1.6"/></svg>
        <div class="cv-label"><span class="cv-title">冰晶匣</span><span class="cv-sub">GPT</span></div>`,
    gemini: () => `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="xMidYMid slice">${starfield(60, 29, 364, 600)}
        <path d="M206 150a40 40 0 1 0 18 60 32 32 0 0 1-18-60z" fill="#ffe6a8"/>
        <g stroke="#f4cb7f" stroke-width=".9" opacity=".6" fill="none"><path d="M70 380 110 360 150 384 134 436M110 360 102 412 134 436"/></g>
        ${[[70, 380], [110, 360], [150, 384], [134, 436], [102, 412]].map(([x, y], i) => sparkle4(x, y, .6, '#fff3d0', 'tw', i * .4)).join('')}</svg>
        <div class="cv-label"><span class="cv-title">小心愿</span><span class="cv-sub">喵 · GEMINI</span></div>`,
    glm: () => `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="none"><g stroke="#e9c37a" stroke-width="1.4" opacity=".75">${[90, 210, 330, 450].map(y => `<path d="M0 ${y}h22"/>`).join('')}</g>
        ${[90, 210, 330, 450].map(y => `<circle cx="11" cy="${y}" r="2.6" fill="#3a1410"/>`).join('')}</svg>
        <div class="cv-label cv-vertical"><span class="cv-title">流水账</span></div>
        <svg class="cv-coin" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#e3b866" stroke="#a87a2e" stroke-width="1.5"/><circle cx="20" cy="20" r="12.5" fill="none" stroke="#a87a2e"/><rect x="15" y="15" width="10" height="10" fill="#7d1d17" stroke="#a87a2e"/></svg>`,
    grok: () => `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="xMidYMid slice"><path d="M30 520q40-30 80 0t80 0 80 0" fill="none" stroke="#ef4a4a" stroke-width="2" opacity=".55"/></svg>
        <div class="cv-label cv-tape"><span class="cv-title">批改本</span><span class="cv-sub">GROK · 别乱翻</span></div>`,
    qwen: () => `<svg class="cv-art" viewBox="0 0 364 600" preserveAspectRatio="none"><g stroke="#d8b25a" stroke-width="1.2" opacity=".8">${[70, 200, 330, 460].map(y => `<path d="M0 ${y}h20"/>`).join('')}</g>
        ${[70, 200, 330, 460].map(y => `<circle cx="10" cy="${y}" r="2.4" fill="#1d2552"/>`).join('')}</svg>
        <div class="cv-label cv-vertical"><span class="cv-title">扇底春风录</span></div><div class="cv-seal">千问</div>`,
  }

  const BOOKS = {
    claude: 'Claude 的随身手册', deepseek: '大肥鱼的潮汐日志', gpt: '白龙的冰晶匣', gemini: '星光里的小心愿',
    glm: '狐狸掌柜的流水账', grok: 'Grok 的毒舌批改本', qwen: '扇底春风录',
  }
  function themeFor(id) {
    const key = Object.prototype.hasOwnProperty.call(ART, id) ? id : 'claude'
    const a = ART[key]
    return { id: key, book: BOOKS[key], icon: a.icon, notes: a.notes || [null, null, null], sign: a.sign ?? null, cover: key, art: a }
  }
  // character.json 的 notebook 写了就用她的；没写用打开时按数字挑好的（notebook-lines.js）；都没有用主题自带的
  const noteFor = (theme, view, i) => (view && Array.isArray(view.notes) && view.notes[i]) || (view && Array.isArray(view.notesPicked) && view.notesPicked[i]) || theme.notes[i] || null
  const signFor = (theme, view) => (view && view.sign) || (view && view.signPicked) || theme.sign || null

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const md = s => { const [, m, d] = String(s).split('-').map(Number); return `${m} 月 ${d} 日` }
  const mdOf = ms => { const d = new Date(ms); return `${d.getMonth() + 1} 月 ${d.getDate()} 日` }
  const num = n => Number(n || 0).toLocaleString('en-US')
  function hoursOrMinutes(ms) {
    const min = Math.floor((ms || 0) / 60_000)
    return min < 60 ? `${min} 分钟` : `${Math.round(min / 60)} 小时`
  }
  function duration(ms) {
    const min = Math.floor((ms || 0) / 60_000)
    if (min < 1) return '不到 1 分'
    const h = Math.floor(min / 60), m = min % 60
    return h ? (m ? `${h} 小时 ${m} 分` : `${h} 小时`) : `${m} 分`
  }
  const MS_ICON = { days7: 'hearts', days30: 'hearts', days100: 'hearts', days365: 'hearts', round1: 'flag', round100: 'flag', round1000: 'flag',
    busy50: 'sparkle', night: 'moon', pats100: 'hearts', friend: 'star' }

  // 头像：探头头像 avatar.webp 优先（和 idle 同一个文件夹），没有就用待机图
  function avatarImg(image) {
    if (!image) return '<img alt="">'
    const avatar = String(image).replace(/[^/]+$/, 'avatar.webp')
    return `<img src="${esc(avatar)}" data-fallback="${esc(image)}" alt="">`
  }

  function panel(v, t) {
    const a = t.art
    const ring = `<svg class="ring" viewBox="0 0 100 44" preserveAspectRatio="none"><path d="M14 24C10 10 40 3 66 6s26 18 12 26-58 8-66-2c-4-6 2-12 14-16" fill="none" stroke="#ef4a4a" stroke-width="1.6" stroke-linecap="round" opacity=".9"/></svg>`
    const stat = (i, n, u, l) => { const note = noteFor(t, v, i); return `<div class="stat">${a.ring === i ? ring : ''}<div class="n">${n}<small>${u}</small></div><div class="l">${l}</div>${note ? `<span class="note">${esc(note)}</span>` : ''}</div>` }
    const meta = v.firstMet ? `认识第 <b>${num(v.daysKnown)}</b> 天 · ${mdOf(v.firstMet)}初见` : '还没一起干过活呢'
    const headText = `<div class="kicker">${svg(a.icon)}我们的小本子</div><div class="title">${esc(t.book)}</div><div class="meta">${meta}</div>`
    const head = t.id === 'qwen'
      ? `<div class="hd">${a.head()}${headText}<div class="seal">千问</div></div>`
      : `<div class="hd">${a.head ? a.head() : ''}${headText}</div>`
    const work = hoursOrMinutes(v.workMs).split(' ')
    const f = v.friend
    const friend = f ? `<div class="rule">${svg(a.icon)}最好的朋友</div>
      <div class="friend">${avatarImg(f.image)}<div><div class="who">${esc(f.name)}</div><div class="rel">${esc(f.level)} · ${+(+f.hearts).toFixed(2)}</div></div><div class="hearts">${hearts(f.hearts)}</div></div>` : ''
    const list = (v.milestones || []).slice(0, 4)
    const ms = list.length
      ? `<ul class="ms">${list.map((m, i) => `<li${i === 0 ? ' class="new"' : ''}><span class="badge">${svg(MS_ICON[m.id] || 'sparkle')}</span><span class="t">${esc(m.label)}</span><span class="date">${md(m.date)}</span></li>`).join('')}</ul>`
      : `<p class="empty">还没有小成就，一起加油吧</p>`
    const extra = (v.before > 0 ? `<div class="aside">认识你之前，你已经和她干了 <b>${num(v.before)}</b> 轮</div>` : '')
      + (v.backfilled ? `<div class="aside">含装 CrossPet 之后、新版之前从 AI 程序记录里补算的部分</div>` : '')
    const sign = signFor(t, v)
    return `<div class="wrap">${a.outer ? a.outer() : ''}<section class="nb t-${t.id}">
    <div class="bg">${a.bg ? a.bg() : ''}</div>
    <div class="sheet">
      <button class="close" title="收起" data-action="close">×</button>
      ${head}
      <div class="stats">${stat(0, num(v.rounds), '轮', '一起干的活')}${stat(1, work[0], work[1], '干活时长')}${stat(2, num(v.pats), '次', '摸头')}</div>
      <dl>
        <dt>最忙的一天</dt><dd>${v.busiest ? `${md(v.busiest.date)} <span class="dim">· ${num(v.busiest.rounds)} 轮</span>` : '<span class="dim">—</span>'}</dd>
        <dt>最长的一次</dt><dd>${v.longestMs ? duration(v.longestMs) : '<span class="dim">—</span>'}</dd>
        <dt>在桌面上</dt><dd>${hoursOrMinutes(v.minutes * 60_000)}</dd>
        <dt>戳 / 惹她生气</dt><dd>${num(v.pokes)} <span class="dim">/</span> ${num(v.angry)} 次</dd>
      </dl>
      ${friend}
      <div class="rule">${svg('sparkle')}小成就</div>
      ${ms}
      <div class="foot">和大家一起 <b>${num(v.total && v.total.days)}</b> 天 · 一共 <b>${num(v.total && v.total.rounds)}</b> 轮${extra}</div>${sign ? `<span class="sign">${esc(sign)}</span>` : ''}
    </div>
    <div class="fg">${a.fg ? a.fg() : ''}</div>
    <div class="turn" aria-hidden="true"><div class="leaf l2"></div><div class="leaf l1"></div><div class="cover c-${t.cover}">${COVER[t.cover]()}</div></div>
  </section></div>`
  }

  const api = { themeFor, noteFor, signFor, panel, hoursOrMinutes, duration, IDS: Object.keys(BOOKS) }
  root.NotebookThemes = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
