// 反馈规则：用户选了哪类问题，就附这一类排查用得上的信息（设计见 docs/superpowers/specs/2026-10-21-feedback-redesign-design.md）。
// 只做判断和排版：选哪些段、日志怎么筛、记录怎么排、超长怎么缩；段落的原始内容由外壳收集（已打码）。
// 纯函数，反馈窗口（feedback.html）和测试（tests/feedback_plan.test.js）共用
;(function (root) {
  const KINDS = [
    { id: 'gone', label: '她不见了 / 打不开', sub: '崩溃、闪退、找不到她', follow: null, askStill: true, hint: '什么时候不见的、之前在做什么？例：右键换了个角色她就没了' },
    { id: 'action', label: 'AI 干活时她没反应', sub: '或者动作、表情不对', follow: 'ai', askStill: true, hint: '它在干什么的时候？例：它在思考时，她还在睡觉' },
    { id: 'character', label: '角色换得不对', sub: '换错人、少了角色', follow: 'character', askStill: true, hint: '换成了谁、应该是谁？例：用 Codex 时变成了 DeepSeek' },
    { id: 'quota', label: '额度 / 余额不对', sub: '', follow: 'quota', askStill: true, hint: '显示成了什么、应该是多少？例：余额一直显示 0' },
    { id: 'display', label: '画面不对', sub: '错位、模糊、大小不对', follow: null, askStill: true, hint: '哪里不对？例：气泡被挤到窗口外面' },
    { id: 'update', label: '更新失败', sub: '', follow: null, askStill: true, hint: '到哪一步出的问题、提示了什么？' },
    { id: 'perf', label: '卡顿 / 耗电', sub: '', follow: null, askStill: true, hint: '什么时候卡、卡成什么样？例：开着 Antigravity 时风扇狂转' },
    { id: 'idea', label: '建议 / 想要 / 夸夸', sub: '立绘建议、想要新角色或新 AI、夸夸', follow: null, askStill: false, hint: '想说什么都行（可以不填）' },
    { id: 'other', label: '其他', sub: '', follow: null, askStill: true, hint: '具体是哪里？' },
  ]
  const STILL = [{ id: 'now', label: '还在' }, { id: 'recent', label: '刚过去（几分钟内）' }, { id: 'earlier', label: '更早' }]
  const AI_NAMES = { codex: 'Codex', 'claude-hooks': 'Claude Code', 'claude-mod': 'Claude Code（增强版）', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity',
    gemini: 'Gemini CLI', qwen: 'Qwen Code', workbuddy: 'WorkBuddy', zcode: 'ZCode', hermes: 'Hermes Agent', grok: 'Grok Build' }
  const QUOTA_NAMES = { gpt: 'GPT（Codex）额度', gemini: 'Gemini（Antigravity）额度', deepseek: 'DeepSeek 余额', claude: 'Claude 额度' }
  // 接入 → 它的状态写在哪个角色名下（多模型宿主认不出的模型写 current）、轮次和换模型记录用的宿主名（<宿主>-turns.json / -host.json）
  const STATE_OF = { codex: 'gpt', 'claude-hooks': 'claude', 'claude-mod': 'claude', deepseek: 'deepseek', antigravity: 'gemini', gemini: 'gemini',
    qwen: 'qwen', workbuddy: 'current', zcode: 'glm', hermes: 'current', grok: 'grok' }
  const HOST_OF = { codex: 'gpt', 'claude-hooks': 'claude', 'claude-mod': 'claude', deepseek: 'deepseek', antigravity: 'gemini', gemini: 'gemini',
    qwen: 'qwen', workbuddy: 'workbuddy', zcode: 'zcode', hermes: 'hermes', grok: 'grok' }
  const DIAG_HEADING = { codex: '[Codex]', 'claude-hooks': '[Claude]', 'claude-mod': '[Claude]', deepseek: '[DeepSeek Harness]', gemini: '[Gemini CLI]',
    qwen: '[Qwen Code]', antigravity: '[Antigravity]', zcode: '[ZCode]', hermes: '[Hermes]', workbuddy: '[WorkBuddy]', grok: '[Grok Build]' }
  const TITLES = { window: '窗口', displays: '显示器', front: '前台', hidden: '藏起来的原因', page: '网页自报', renderRestart: '渲染重启记录', crashes: '崩溃报告',
    install: '安装', log: '相关日志', updateLog: '更新日志', seen: '最近收到消息', diag: '接入诊断', petEvents: '桌宠收到事件后的处理', switches: '最近换角色',
    settings: '设置', characters: '角色文件夹', perf: '性能', dpi: '缩放和画布' }
  const LOG_WORDS = {
    gone: ['全屏', '窗口', '置顶', '层级', '渲染', '启动', '崩溃', '界面异常', '藏', '立绘加载失败', '接班', '安装不完整'],
    action: ['状态', '接入', '自动出现', '钩子'],
    character: ['同步角色', '换角色', '角色'],
    quota: ['额度', '余额'],
    display: ['缩放', '画布', '网页大小'],
    perf: ['渲染', '定时任务'],
  }
  const hostOf = target => (target === 'codex-desktop' ? 'codex' : target)

  function followOptions(kind, facts) {
    const k = KINDS.find(x => x.id === kind)
    if (k?.follow === 'ai') return [...(facts.integrations || []).flatMap(id => id === 'codex'
      ? [{ id, label: 'Codex' }, { id: 'codex-desktop', label: 'ChatGPT 桌面版' }] : [{ id, label: AI_NAMES[id] || id }]), { id: 'unsure', label: '不确定' }]
    if (k?.follow === 'character') return [...(facts.characters || []).map(c => ({ id: c.id, label: c.name })), { id: 'missing', label: '角色列表里少了' }]
    if (k?.follow === 'quota') return (facts.quotas || []).map(id => ({ id, label: QUOTA_NAMES[id] || id }))
    return []
  }

  function sectionsFor(kind, target, facts) {
    switch (kind) {
      case 'gone': return ['window', 'displays', 'front', 'hidden', 'page', 'renderRestart', 'crashes', 'install', 'log']
      case 'action': {
        if (target === 'unsure') return ['seen', ...(facts?.integrations || []).map(i => 'events:' + i), 'petEvents', 'page', 'settings', 'log']
        const host = hostOf(target)
        return ['diag', 'seen', 'events:' + host, 'petEvents', 'page', `state:${STATE_OF[host] || host}|${HOST_OF[host] || host}`, 'settings', 'log']
      }
      case 'character': return ['characters', 'switches', 'front', 'settings', 'log']
      case 'quota': return ['quota:' + target, 'settings', 'log']
      case 'display': return ['dpi', 'displays', 'page', 'log']
      case 'update': return ['updateLog', 'install']
      case 'perf': return ['perf', 'settings', 'log']
      // 其他：说不清是哪类时用，每类都带一点（体积由 buildCard 的缩减兜着）
      case 'other': return ['window', 'displays', 'front', 'hidden', 'page', 'settings', 'seen', ...(facts?.integrations || []).map(i => 'events:' + i), 'petEvents', 'switches', 'install', 'log']
      default: return []
    }
  }

  function sliceDiag(diag, integration) {
    const lines = String(diag || '').split('\n')
    const head = DIAG_HEADING[integration]
    const i = head ? lines.findIndex(l => l.startsWith(head)) : -1
    if (i < 0) return integration === 'workbuddy' ? lines.filter(l => /^\s*WorkBuddy/.test(l)).join('\n') : ''   // 旧版诊断只有缩进的一行
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith('[')) j++
    return lines.slice(i, j).join('\n')
  }

  function filterLog(text, kind, max = 60) {
    const words = LOG_WORDS[kind]
    const lines = String(text || '').split('\n').filter(l => l.trim() && (!words || words.some(w => l.includes(w))))
    return lines.slice(-max).join('\n')
  }

  const hms = t => { const d = new Date(Number(t) * 1000); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':') }
  function parseJsonl(text) {
    return String(text || '').split('\n').map(l => { try { return l.trim() ? JSON.parse(l) : null } catch { return null } }).filter(Boolean)
  }
  // 钩子事件记录和桌宠处理记录都用这个：时间 [角色] 事件 工具或姿态 → 结果 详情 [会话]
  function formatLedger(jsonl, n, empty = '没有记录（插件版本早于 1.3.8，或从没收到消息）') {
    const rows = parseJsonl(jsonl).slice(-n)
    if (!rows.length) return empty
    return rows.map(r => `${hms(r.t)} ${[r.char, r.ev, r.tool || r.pose].filter(Boolean).join(' ')} → ${[r.result, r.detail].filter(Boolean).join(' ')}${r.sid ? ` [${r.sid}]` : ''}`).join('\n')
  }
  function formatSwitches(jsonl, n) {
    const rows = parseJsonl(jsonl).slice(-n)
    if (!rows.length) return '没有记录'
    return rows.map(r => `${hms(r.t)} ${r.from || '—'} → ${r.to}${r.skin ? '·' + r.skin : ''}  ${r.why}${r.via ? ' ' + r.via : ''}`).join('\n')
  }
  function formatSeen(json) {
    let m; try { m = JSON.parse(json) } catch { return String(json || '') }
    const now = Date.now() / 1000
    return Object.keys(m).sort().map(k => `${AI_NAMES[k] || k} ${m[k] ? Math.round((now - m[k]) / 60) + ' 分钟前' : '从没收到'}`).join('，')
  }
  function formatPage(json, n) {
    let p; try { p = JSON.parse(json) } catch { return String(json || '') }
    const head = `角色 ${p.char}${p.skin ? '·' + p.skin : ''}，姿态 ${p.pose}；图 ${p.img?.file || '—'}（${p.img?.complete ? '已加载' : '没加载完'} ${p.img?.w}×${p.img?.h}），`
      + `备用 ${p.spare?.file || '—'}；换图中 ${p.swapping ? '是' : '否'}，缩边 ${p.tucked || '否'}，彩蛋 ${p.egg || '否'}，页面藏着 ${p.pageHidden ? '是' : '否'}`
    const errors = (p.imageErrors || []).map(e => `${hms(e.t)} ${e.file}`).join('，')
    const verdicts = (p.verdicts || []).slice(-n).map(v => `${hms(v.t)} ${v.id} ${v.ev} ${v.pose} → ${v.verdict}`).join('\n')
    return [head, errors && '图片加载失败：' + errors, verdicts && '网页的判断：\n' + verdicts].filter(Boolean).join('\n')
  }

  // 某一家没有事件记录：结合「最近收到消息」分清是收到过却没记（插件比这次改版旧、或写不了数据目录）还是从没收到
  function emptyEvents(integration, seenJson) {
    let seen = 0; try { seen = Number(JSON.parse(seenJson || '{}')[integration]) || 0 } catch {}
    return seen ? '收到过消息却没有记录（插件版本比这次改版旧，或者写不了数据目录）' : '没有记录：从没收到这个 AI 的消息'
  }
  function render(id, raw, kind, target, n, sections) {
    return String(renderRaw(id, raw, kind, target, n, sections)).slice(0, n.text)   // 每段都有上限，整张卡才缩得进 19000 字节
  }
  function renderRaw(id, raw, kind, target, n, sections) {
    if (id === 'diag') return sliceDiag(raw, hostOf(target)) || '（诊断里没有这一家）'
    if (id === 'log') return filterLog(raw, kind, n.log)
    if (id === 'seen') return formatSeen(raw)
    if (id === 'page') return formatPage(raw, n.ledger)
    if (id === 'switches') return formatSwitches(raw, n.ledger)
    if (id === 'petEvents') return formatLedger(raw, n.ledger, '没有记录')
    if (id.startsWith('events:')) return formatLedger(raw, target === 'unsure' || kind === 'other' ? Math.min(10, n.ledger) : n.ledger, emptyEvents(id.slice(7), sections.seen))
    return String(raw).slice(0, n.text)
  }
  function title(id) {
    if (id.startsWith('events:')) return `事件记录 · ${AI_NAMES[id.slice(7)] || id.slice(7)}`
    if (id.startsWith('state:')) return `状态文件 · ${id.slice(6).split('|')[0]}`
    if (id.startsWith('quota:')) return `额度 · ${QUOTA_NAMES[id.slice(6)] || id.slice(6)}`
    return TITLES[id] || id
  }

  const LIMIT = 19000
  function buildCard({ kind, target, still, text, attach, facts, partial }) {
    const k = KINDS.find(x => x.id === kind) || KINDS[KINDS.length - 1]
    const opt = followOptions(kind, facts).find(o => o.id === target)
    const h = facts.header || {}
    const pt = content => ({ tag: 'plain_text', content })
    const stillLabel = STILL.find(s => s.id === still)?.label
    const choice = [`类型 ${k.label}`, opt && `补选 ${opt.label}`, stillLabel && `问题还在吗 ${stillLabel}`].filter(Boolean)
    const meta = [`版本 ${h.version || '?'}（${h.platform || '?'}）`, ...choice]
    if (attach) meta.push(`系统 ${h.os || '?'}`, `机器 ${String(h.install || '').slice(0, 8)}`, `角色 ${h.character || '—'}${h.skin ? '·' + h.skin : ''}`, `已运行 ${h.uptimeMin ?? '?'} 分钟`)
    const head = [{ tag: 'div', text: pt(text || '（没写）') }, { tag: 'hr' }, { tag: 'div', fields: meta.map(m => ({ is_short: true, text: pt(m) })) }]
    if (attach && partial) head.push({ tag: 'note', elements: [pt('排查信息没来得及收齐（外壳 8 秒内没交回来），这份只附了已收到的部分')] })
    const ids = attach ? sectionsFor(kind, target, facts).filter(id => facts.sections?.[id] != null) : []
    const make = n => ({
      msg_type: 'interactive',
      card: {
        header: { template: kind === 'gone' || kind === 'update' ? 'red' : kind === 'idea' ? 'green' : 'orange',
          title: pt(`CrossPet 反馈 · ${k.label}${opt ? ' · ' + opt.label : ''}`) },
        elements: [...head, ...ids.map(id => ({ tag: 'note', elements: [pt(`${title(id)}：\n${render(id, facts.sections[id], kind, target, n, facts.sections)}`)] }))],
      },
    })
    // 超长按顺序缩：先日志行数，再记录条数，最后每段文字；开头和用户的话不缩
    const n = { log: 60, ledger: 40, text: 4000 }
    const size = c => new TextEncoder().encode(JSON.stringify(c)).length
    let card = make(n)
    for (const key of ['log', 'ledger', 'text']) {
      while (size(card) > LIMIT && n[key] > 5) { n[key] = Math.floor(n[key] * 0.7); card = make(n) }
    }
    while (size(card) > LIMIT && n.text > 50) { n.text = Math.floor(n.text * 0.7); card = make(n) }
    return card
  }

  const api = { KINDS, STILL, followOptions, sectionsFor, sliceDiag, filterLog, formatLedger, buildCard }
  root.FeedbackPlan = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
