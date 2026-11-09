// 小本子在主桌宠页面里的记账：一轮、摸头 / 戳 / 生气、在桌面上的分钟、备份、补算、小成就说一句。
//   node tests/notebook_page_test.cjs
'use strict'
const { makePage } = require('./page_harness.cjs')
const POSES = ['idle', 'thinking', 'listening', 'reading', 'writing', 'happy', 'oops', 'surprised', 'pat', 'sleeping', 'annoyed', 'puffed', 'redhot', 'sulk']
const frames = id => Object.fromEntries(POSES.map(p => [p, [`${id}/${p}.webp`]]))
const manifest = (more = []) => ({ characters: {
  ...Object.fromEntries(more.map(id => [id, { name: id, greeting: 'hi', lines: {}, poses: frames(id) }])),
  claude: { name: 'Claude', greeting: 'hi', lines: {}, poses: frames('claude'), milestones: { round1: 'Claude 的第一轮！' },
    notebook: { notes: ['一', null, '三'], sign: '今天也加油' } },
  gpt: { name: 'GPT', greeting: 'hi', lines: {}, poses: frames('gpt') },
} })

async function page(role = 'main', saved, more) {
  const e = makePage()
  if (role === 'companion') e.run(`setRole('companion', { id: 'gpt@codex', key: 'gpt@codex', character: 'gpt', client: 'codex', label: '终端' })`)
  if (saved !== undefined) e.run(`restoreNotebook(${JSON.stringify(saved)})`)
  e.run(`init(${JSON.stringify(manifest(more))})`)
  await e.advance(1000)
  if (role === 'main' && e.state().charId !== 'claude') { e.run(`setCharacter('claude', true)`); await e.advance(1000) }
  return e
}
const nb = (e, ch = 'claude') => e.run(`notebookFor('${ch}')`)
const hookAt = (e, id, pose, event, ts) => e.run(`applyCharState('${id}', { pose: '${pose}', event: '${event}', ts: ${ts} })`)

const cases = [
  ['stop_after_prompt_records_round', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    await e.advance(60000)
    hookAt(e, 'claude', 'happy', 'Stop', T + 60)
    const v = nb(e)
    assert(v.rounds === 1, `rounds ${v.rounds}`)
    assert(v.workMs === 60000, `workMs ${v.workMs}`)
  }],
  ['round_without_prompt_starts_at_first_work_event', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'writing', 'PreToolUse', T)
    hookAt(e, 'claude', 'happy', 'Stop', T + 30)
    assert(nb(e).rounds === 1 && nb(e).workMs === 30000, JSON.stringify(nb(e)))
  }],
  ['current_counts_for_main_character', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'current', 'listening', 'UserPromptSubmit', T)
    hookAt(e, 'current', 'happy', 'Stop', T + 5)
    assert(nb(e).rounds === 1, JSON.stringify(nb(e)))
  }],
  ['reload_does_not_double_count', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    hookAt(e, 'claude', 'happy', 'Stop', T + 60)
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    hookAt(e, 'claude', 'happy', 'Stop', T + 60)
    assert(nb(e).rounds === 1, `rounds ${nb(e).rounds}`)
  }],
  ['pat_poke_angry_counted', async e => {
    e.run(`handleClick('pat')`)
    await e.advance(3000)
    e.run(`handleClick('poke')`)
    e.run(`notePoke('claude'); noteAngry('claude')`)
    const v = nb(e)
    assert(v.pats === 1 && v.pokes === 2 && v.angry === 1, JSON.stringify([v.pats, v.pokes, v.angry]))
  }],
  ['redhot_counts_angry', async e => {
    e.run(`addAnger(90); react()`)
    assert(nb(e).angry === 1, `angry ${nb(e).angry}`)
  }],
  ['minutes_tick_while_visible', async e => {
    e.run('setPageHidden(false)')
    await e.advance(180000)
    const m = nb(e).minutes
    assert(m === 3, `minutes ${m}`)
    e.run('setPageHidden(true)')
    await e.advance(180000)
    assert(nb(e).minutes === 3, `minutes while hidden ${nb(e).minutes}`)
  }],
  ['store_written_and_sent_to_shell', async e => {
    e.run(`notePoke('claude')`)
    const raw = e.run(`localStorage.getItem('crosspet-notebook')`)
    assert(raw && JSON.parse(raw).chars.claude.pokes === 1, `localStorage ${raw}`)
    const sent = e.msgs().filter(m => m.notebookStore).slice(-1)[0]
    assert(sent && sent.notebookStore.chars.claude.pokes === 1, 'no notebookStore message')
  }],
  ['restore_merges_saved', async () => {
    const saved = { v: 1, installedAt: 0, liveSince: 1, backfilled: true, chars: { claude: { rounds: 5, firstMet: 1 } } }
    const e = await page('main', saved)
    assert(nb(e).rounds === 5, `rounds ${nb(e).rounds}`)
    assert(!e.msgs().some(m => m.notebookBackfill), 'asked to backfill again')
  }],
  ['asks_backfill_once', async e => {
    assert(e.msgs().filter(m => m.notebookBackfill).length === 1, JSON.stringify(e.msgs().filter(m => m.notebookBackfill)))
    const T = e.clk.now()
    e.run(`applyNotebookBackfill({ installedAt: ${T - 30 * 86400000}, files: [{ source: 'codex', events: [{ t: ${T - 86400000}, k: 'r', m: 'gpt-5', end: ${T - 86400000 + 60000} }] }] })`)
    assert(nb(e, 'gpt').rounds === 1, JSON.stringify(nb(e, 'gpt')))
    assert(nb(e, 'gpt').backfilled === true, 'not marked backfilled')
    e.run(`setCharacter('gpt')`)
    await e.advance(2000)
    assert(e.msgs().filter(m => m.notebookBackfill).length === 1, 'asked twice')
    assert(!e.says().some(s => /第一轮/.test(s.line)), 'said a backfilled milestone')
  }],
  ['milestone_reached_says_line', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    hookAt(e, 'claude', 'happy', 'Stop', T + 5)
    await e.advance(500)
    assert(e.says().some(s => s.line === 'Claude 的第一轮！'), JSON.stringify(e.says().slice(-3)))
    assert(nb(e).milestones.some(m => m.id === 'round1'), 'milestone not stored')
  }],
  ['notebookFor_has_notes_and_sign', async e => {
    const v = nb(e)
    assert(JSON.stringify(v.notes) === '["一",null,"三"]' && v.sign === '今天也加油', JSON.stringify([v.notes, v.sign]))
    assert(nb(e, 'gpt').notes === null && nb(e, 'gpt').name === 'GPT', JSON.stringify(nb(e, 'gpt')))
  }],
  ['notebookFor_friend_has_image', async e => {
    e.run(`localStorage.setItem('crosspet-friendship', JSON.stringify({ 'claude+gpt': { points: 40 } }))`)
    const f = nb(e).friend
    assert(f && f.id === 'gpt' && f.image === 'gpt/idle.webp', JSON.stringify(f))
  }],
  ['companion_page_forwards', async () => {
    const c = await page('companion')
    c.run(`handleClick('poke')`)
    assert(c.msgs().some(m => m.poked === true), 'no poked message')
    c.run(`addAnger(90); react()`)
    assert(c.msgs().some(m => m.angered === true), 'no angered message')
    assert(c.run(`localStorage.getItem('crosspet-notebook')`) === null, 'companion wrote the notebook')
    assert(!c.msgs().some(m => m.notebookStore || m.notebookBackfill), 'companion did notebook work')
  }],
  ['pair_chat_logged_and_lingers', async e => {
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false; Math.random = () => 0; pairChatAt = 0; tryPairChat()`)
    await e.advance(11000)
    const st = e.state()
    assert(st.bubble !== '', 'bubble gone before 11s')
    await e.advance(30000)
    const chats = e.run(`noteStore().chats`)
    assert(chats && chats.length === 1 && chats[0].lines.length >= 2, JSON.stringify(chats))
    const calls = e.msgs().filter(m => m.companionCall && m.companionCall.fn === 'chat')
    assert(calls.length >= 1 && calls[0].companionCall.args[3] >= 12000, JSON.stringify(calls))
  }],
  ['poke_companion_triggers_reaction', async e => {
    // 认识了的两只：外壳转来「额外那只被戳了」，主桌宠 1.5 秒后说一句，被戳的那只回一句，记进小本子
    e.run(`friendStoreWrite(${JSON.stringify({ 'claude+gpt': { points: 1e6, shown: 3 } })})`)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false; notePoke('gpt')`)
    await e.advance(1000)
    assert(!e.run(`noteStore().chats`)?.length, '说之前要等 1.5 秒')
    await e.advance(20000)
    const chats = e.run(`noteStore().chats`)
    assert(chats && chats.length === 1, JSON.stringify(chats))
    assert(JSON.stringify(chats[0].lines.map(l => l[0])) === '["claude","gpt"]', JSON.stringify(chats[0]))
    assert(e.run(`PetTalk.REACT.poke.claude[2]`).includes(chats[0].lines[0][1]), chats[0].lines[0][1])
  }],
  ['no_reaction_while_busy', async e => {
    e.run(`friendStoreWrite(${JSON.stringify({ 'claude+gpt': { points: 1e6, shown: 3 } })})`)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false`)
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'writing', 'PreToolUse', T)
    e.run(`notePoke('gpt')`)
    await e.advance(20000)
    assert(!e.run(`noteStore().chats`)?.length, '主桌宠在干活时不该说')
    hookAt(e, 'claude', 'idle', 'SessionEnd', T + 21)
    await e.advance(1000)
    e.run(`notePoke('gpt')`)
    await e.advance(20000)
    assert(e.run(`noteStore().chats`)?.length === 1, '没说成的那次不该记冷却')
  }],
  ['main_done_gets_praise', async e => {
    // 主桌宠自己干完一轮大活（3 分钟）：旁边的朋友夸一句，她回一句
    e.run(`friendStoreWrite(${JSON.stringify({ 'claude+gpt': { points: 1e6, shown: 3 } })})`)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false`)
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    await e.advance(180000)
    hookAt(e, 'claude', 'happy', 'Stop', T + 180)
    await e.advance(20000)
    const chats = e.run(`noteStore().chats`) || []
    const said = chats.find(c => c.lines[0][0] === 'gpt' && c.lines[1]?.[0] === 'claude')
    assert(said && e.run(`PetTalk.REACT.done.gpt[2]`).includes(said.lines[0][1]), JSON.stringify(chats))
  }],
  ['notebook_for_picks_notes_and_sign', async e => {
    const T = e.clk.now() / 1000
    hookAt(e, 'claude', 'listening', 'UserPromptSubmit', T)
    hookAt(e, 'claude', 'happy', 'Stop', T + 30)
    const v = nb(e)
    assert(Array.isArray(v.notesPicked) && v.notesPicked.length === 3, JSON.stringify(v.notesPicked))
    assert(e.run(`NotebookLines.NOTES.claude.rounds[1]`).includes(v.notesPicked[0]), v.notesPicked[0])
    assert(typeof v.signPicked === 'string' && v.signPicked, v.signPicked)
    assert(v.notes[0] === '一' && v.sign === '今天也加油', 'character.json 的照旧带上')
  }],
  ['notebookFor_has_page2', async e => {
    // 一起站过（集合出来站一会儿）、是好朋友：第二页有她，留言用的是挑好的文案；刚说过的一段在「最近聊了什么」里
    e.run(`friendStoreWrite(${JSON.stringify({ 'claude+gpt': { points: 1e6, shown: 3 } })})`)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false`)
    await e.advance(120000)
    e.run(`noteChat([['claude', '你好'], ['gpt', '嗯。']])`)
    const p = nb(e).page2
    assert(p && p.friends.length === 1 && p.friends[0].id === 'gpt', JSON.stringify(p))
    assert(p.friends[0].levelName === '挚友' && p.friends[0].block.lines.length >= 2, JSON.stringify(p.friends[0]))
    assert(p.friends[0].image === 'gpt/idle.webp' && p.ownerImage === 'claude/idle.webp', JSON.stringify(p))
    assert(p.chats.length === 1 && p.chats[0].lines[1].name === 'GPT', JSON.stringify(p.chats))
    const empty = nb(e, 'grok')
    assert(empty.page2 && empty.page2.friends.length === 0, JSON.stringify(empty.page2))
  }],
  ['group_chat_when_gathered', async e => {
    // 三只两两都是挚友（升级都演过了），集合出来、闲着：群聊三句，各说一句，整段记进小本子
    const max = 1e6
    e.run(`friendStoreWrite(${JSON.stringify({ 'claude+gpt': { points: max, shown: 3 }, 'claude+grok': { points: max, shown: 3 }, 'gpt+grok': { points: max, shown: 3 } })})`)
    e.run(`gather()`)
    await e.advance(1500)
    e.run(`pageHidden = false; Math.random = () => 0; pairChatAt = 0; tryPairChat()`)
    await e.advance(40000)
    const chats = e.run(`noteStore().chats`)
    assert(chats && chats.length === 1, JSON.stringify(chats))
    const who = chats[0].lines.map(l => l[0])
    assert(who.length === 3 && new Set(who).size === 3, JSON.stringify(chats[0]))
    const calls = e.msgs().filter(m => m.companionCall && m.companionCall.fn === 'chat')
    assert(calls.length === 2, `额外那两只各说一句：${JSON.stringify(calls)}`)
  }, ['grok']],
]

function assert(ok, msg) { if (!ok) throw Error(msg) }
;(async () => {
  const failures = []
  for (const [name, fn, more] of cases) {
    try {
      const e = await page('main', undefined, more)
      await fn(e)
      if (e.errors.length) throw Error(`page errors: ${JSON.stringify(e.errors)}`)
    } catch (err) { failures.push({ name, error: err.message }) }
  }
  console.log(JSON.stringify({ passed: cases.length - failures.length, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})()
