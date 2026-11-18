// 小本子补算：外壳从各 AI 程序的本机记录里抽出精简事件（只有时间和模型名，没有内容），这里拼成「轮」记进小本子。
// 精简事件（毫秒）：{ t, k: 'p' } 你发了一句；{ t, k: 'a', m } 她回了一句；{ t, k: 'r', m, end } 一整轮（Codex 直接给）。
// 只补装 CrossPet 之后、新版开始记（store.liveSince）之前的；装之前的只进 before。新版第一次启动时在后台算一次。
;(function (root) {
  const Notebook = root.Notebook || (typeof require === 'function' ? require('./notebook.js') : null)

  // 模型名 → 角色：逐条照搬 integrations/crosspet-hook.py 的 character_for_model（同顺序、同关键字），改这里也要改钩子
  function characterForModel(model) {
    const m = String(model || '').toLowerCase()
    if (!m) return null
    if (m.includes('glm') || m.includes('zhipu') || m.includes('chatglm') || m.includes('z.ai') || m.includes('zai-')) return 'glm'
    if (m.includes('qwen') || m.includes('dashscope') || m.includes('bailian') || m.includes('tongyi') || m === 'coder-model') return 'qwen'
    if (m.includes('kimi') || m.includes('moonshot')) return 'kimi'
    if (m.includes('grok')) return 'grok'
    if (m.includes('deepseek')) return 'deepseek'
    if (m.includes('claude') || m.includes('anthropic')) return 'claude'
    if (m.includes('gemini')) return 'gemini'
    if (['gpt', 'o1', 'o3', 'o4', 'codex', 'chatgpt'].some(p => m.startsWith(p)) || m.includes('openai')) return 'gpt'
    return null
  }

  // 认不出模型（或对应的角色没装）时由程序自己的角色来演，同钩子的 SELF_HOSTS
  const SOURCE_CHARACTER = { 'claude-code': 'claude', codex: 'gpt' }
  function pick(source, model, installed) {
    const ch = characterForModel(model)
    return ch && (!installed || installed.includes(ch)) ? ch : SOURCE_CHARACTER[source]
  }

  const ok = e => e && typeof e === 'object' && Number.isFinite(e.t)

  function claudeRounds(events, installed) {
    const out = []
    let open = null   // { start, end, m }
    const close = () => { if (open && open.end) out.push({ ch: pick('claude-code', open.m, installed), start: open.start, end: open.end }) }
    for (const e of events.filter(ok).sort((x, y) => x.t - y.t)) {
      if (e.k === 'p') { close(); open = { start: e.t, end: 0, m: '' } }
      else if (e.k === 'a' && open) { open.end = e.t; open.m = e.m || open.m }
    }
    close()
    return out
  }

  function codexRounds(events, installed) {
    return events.filter(e => ok(e) && e.k === 'r' && Number.isFinite(e.end))
      .map(e => ({ ch: pick('codex', e.m, installed), start: e.t, end: e.end }))
  }

  // files: [{ source: 'claude-code' | 'codex', events }]；installed：装了的角色（不给就不查）
  function roundsOf(files, installed) {
    const out = []
    for (const f of Array.isArray(files) ? files : []) {
      if (!f || !Array.isArray(f.events)) continue
      if (f.source === 'claude-code') out.push(...claudeRounds(f.events, installed))
      else if (f.source === 'codex') out.push(...codexRounds(f.events, installed))
    }
    return out.sort((x, y) => x.start - y.start)
  }

  function apply(store, payload, installed) {
    if (store.backfilled) return store
    const p = payload || {}
    let s = { ...store, installedAt: store.installedAt || (Number.isFinite(p.installedAt) ? p.installedAt : 0) }
    for (const r of roundsOf(p.files, installed)) {
      if (r.end >= s.liveSince) continue
      s = Notebook.recordRound(s, r.ch, r.start, r.end)
      s = Notebook.checkMilestones(s, r.ch, r.end, { friendLevel: 0 }).store
    }
    return { ...s, backfilled: true }
  }

  const api = { characterForModel, roundsOf, apply }
  root.NotebookBackfill = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
