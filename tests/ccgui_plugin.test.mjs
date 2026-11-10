import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const template = await readFile(new URL('../integrations/ccgui/main.js', import.meta.url), 'utf8').catch(() => '')
const config = { windows: false, python: '/usr/bin/python3', hook: '/pet/crosspet-hook.py', data: '/pet', state: '/state' }

async function harness(options = {}) {
  assert.ok(template, 'CC GUI bridge plugin exists')
  const source = template.replace('const CONFIG = null', `const CONFIG = ${JSON.stringify({ ...config, ...options })}`)
  const { default: activate } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const calls = [], events = new Map()
  let turn, session
  const dispose = activate({
    hooks: {
      registerTurnHooks(h) { turn = h },
      registerSessionHooks(h) { session = h },
    },
    events: { on(name, fn) { events.set(name, fn) } },
    bridge: { async invoke(command, args) {
      assert.equal(command, 'plugin_exec_run')
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    } },
  })
  const flush = () => new Promise(resolve => setImmediate(resolve))
  const payloads = () => calls.map(c => JSON.parse(Buffer.from(c.args.at(-1), 'base64').toString('utf8')))
  return { turn, session, events, dispose, calls, flush, payloads }
}

function event(engine = 'codex', extra = {}) {
  return { runId: 'r1', turnId: 't1', engine, sessionId: 's1', workspace: { id: 'w1', path: '/secret/project' },
    occurredAt: new Date().toISOString(), ...extra }
}

test('all engines share start, tool, and completion events; only metadata crosses the bridge', async () => {
  const h = await harness()
  for (const engine of ['claude', 'codex', 'pi', 'omp', 'codebuddy', 'qwen', 'gemini', 'kimi', 'grok', 'new-cli']) {
    const e = event(engine, { runId: engine, prompt: 'SECRET', error: 'SECRET' })
    h.turn.onTurnStarted(e)
    h.turn.onRuntimeEvent({ ...e, kind: 'command-started', command: 'SECRET command' })
    h.turn.afterTurn({ ...e, status: 'completed' })
  }
  await h.flush()
  const p = h.payloads()
  assert.equal(p.length, 30)
  assert.deepEqual(p.slice(0, 3).map(x => x.hook_event_name), ['UserPromptSubmit', 'PreToolUse', 'Stop'])
  assert.ok(!JSON.stringify(p).includes('SECRET'))
  assert.ok(!JSON.stringify(p).includes('/secret/project'))
  assert.equal(h.calls[0].args[1], 'ccgui')
  assert.equal(h.calls[0].env.CROSSPET_STATE_DIR, '/state')
})

test('selected model is captured per run, including a pending session', async () => {
  const h = await harness()
  h.events.get('session://activated')({ engine: 'codex', sessionId: null, model: 'deepseek-v4' })
  h.turn.onTurnStarted(event('codex', { sessionId: null }))
  h.turn.onRuntimeEvent({ ...event(), kind: 'file-changed', path: 'SECRET' })
  h.events.get('session://selection-changed')({ engine: 'codex', sessionId: 'other', model: 'gpt-5' })
  h.turn.afterTurn({ ...event(), status: 'completed' })
  await h.flush()
  assert.deepEqual(h.payloads().map(x => x.model), ['deepseek-v4', 'deepseek-v4', 'deepseek-v4'])
  assert.equal(new Set(h.payloads().map(x => x.session_id)).size, 1)
})

test('a model reported after launch switches only its own run and retires the previous role', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event('pi', { sessionId: null }))
  h.turn.onRuntimeEvent({ ...event('pi'), kind: 'command-started' })
  h.events.get('session://selection-changed')({ engine: 'pi', sessionId: 's1', model: 'deepseek-v4' })
  h.turn.onRuntimeEvent({ ...event('pi'), kind: 'command-started' })
  h.turn.afterTurn({ ...event('pi'), status: 'completed' })
  await h.flush()
  const p = h.payloads()
  assert.deepEqual(p.map(e => [e.hook_event_name, e.model]), [
    ['UserPromptSubmit', 'pi'], ['PreToolUse', 'pi'], ['SessionEnd', 'pi'],
    ['PreToolUse', 'deepseek-v4'], ['Stop', 'deepseek-v4'],
  ])
  assert.equal(new Set(p.map(e => e.session_id)).size, 1)
  assert.ok(!('turn_id' in p[2]))
})

test('model updates affect only matching unfinished runs and repeated selections do not retire a role', async () => {
  const h = await harness()
  const own = event('pi'), other = event('pi', { runId: 'r2', sessionId: 's2' })
  const engine = event('codex', { runId: 'r3' }), done = event('pi', { runId: 'r4' })
  for (const e of [own, other, engine, done]) h.turn.onTurnStarted(e)
  h.turn.afterTurn({ ...done, status: 'completed' })
  for (const name of ['session://activated', 'session://selection-changed']) {
    h.events.get(name)({ engine: 'pi', sessionId: 's1', model: 'deepseek-v4' })
  }
  for (const e of [own, other, engine, done]) h.turn.onRuntimeEvent({ ...e, kind: 'command-started' })
  await h.flush()
  const p = h.payloads()
  assert.deepEqual(p.filter(e => e.hook_event_name === 'SessionEnd').map(e => [e.session_id, e.model]),
    [['ccgui:["pi","s1"]', 'pi']])
  assert.deepEqual(p.filter(e => e.hook_event_name === 'PreToolUse').map(e => e.model),
    ['deepseek-v4', 'pi', 'codex'])
})

test('a late selection binds a pending session for closing while preserving its bridge id', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event('pi', { sessionId: null }))
  h.events.get('session://activated')({ engine: 'pi', sessionId: 's1', model: 'deepseek-v4' })
  h.session.onClosed(event('pi'))
  await h.flush()
  const p = h.payloads()
  assert.deepEqual(p.map(e => [e.hook_event_name, e.model]),
    [['UserPromptSubmit', 'pi'], ['SessionEnd', 'pi'], ['SessionEnd', 'deepseek-v4']])
  assert.equal(new Set(p.map(e => e.session_id)).size, 1)
  assert.ok(p.slice(1).every(e => !('turn_id' in e)))
})

test('activating a new pending tab cannot change an identified running session', async () => {
  const h = await harness()
  h.events.get('session://activated')({ engine: 'pi', sessionId: 's1', model: 'gpt-5' })
  h.turn.onTurnStarted(event('pi'))
  h.events.get('session://activated')({ engine: 'pi', sessionId: null, model: 'deepseek-v4' })
  h.turn.onRuntimeEvent({ ...event('pi'), kind: 'command-started' })
  h.turn.afterTurn({ ...event('pi'), status: 'completed' })
  await h.flush()
  assert.deepEqual(h.payloads().map(e => [e.hook_event_name, e.model]),
    [['UserPromptSubmit', 'gpt-5'], ['PreToolUse', 'gpt-5'], ['Stop', 'gpt-5']])
})

test('permission, tool failures, interruption, and errors reach existing pet events', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event())
  h.turn.onRuntimeEvent({ ...event(), kind: 'permission-requested', tool: 'Bash', path: 'SECRET' })
  h.turn.onRuntimeEvent({ ...event(), kind: 'tool-finished', toolName: 'Read', status: 'failed' })
  h.turn.afterTurn({ ...event(), status: 'cancelled' })
  h.turn.onTurnStarted(event('pi', { runId: 'r2', turnId: 't2' }))
  h.turn.afterTurn({ ...event('pi', { runId: 'r2', turnId: 't2' }), status: 'failed', error: 'SECRET' })
  await h.flush()
  assert.deepEqual(h.payloads().map(x => x.hook_event_name),
    ['UserPromptSubmit', 'PermissionRequest', 'PostToolUseFailure', 'Interrupt', 'UserPromptSubmit', 'StopFailure'])
})

test('late events and duplicate terminal signals cannot revive a completed run', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event())
  h.turn.onRuntimeEvent({ ...event(), kind: 'assistant-completed' })
  h.turn.afterTurn({ ...event(), status: 'completed' })
  h.turn.onRuntimeEvent({ ...event(), kind: 'command-started' })
  await h.flush()
  assert.deepEqual(h.payloads().map(x => x.hook_event_name), ['UserPromptSubmit', 'Stop'])
})

test('tool labels do not forward intent, file paths, arguments, or error messages', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event())
  h.turn.onRuntimeEvent({ ...event(), kind: 'tool-finished', toolName: 'Read · SECRET /private/file', status: 'completed', result: 'SECRET' })
  h.turn.onRuntimeEvent({ ...event(), kind: 'permission-requested', tool: 'Bash SECRET', error: 'SECRET' })
  await h.flush()
  const p = h.payloads()
  assert.deepEqual(p.slice(1).map(e => e.tool_name), ['Read', 'Bash'])
  assert.ok(!JSON.stringify(p).includes('SECRET'))
  assert.ok(!JSON.stringify(p).includes('/private/file'))
})

test('same session id from different engines stays isolated; closing retires only that engine', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event('codex'))
  h.turn.onTurnStarted(event('claude', { runId: 'r2' }))
  h.session.onClosed(event('codex'))
  h.turn.onRuntimeEvent({ ...event('codex'), kind: 'command-started' })
  h.turn.afterTurn({ ...event('claude', { runId: 'r2' }), status: 'completed' })
  await h.flush()
  const p = h.payloads()
  assert.notEqual(p[0].session_id, p[1].session_id)
  assert.deepEqual(p.map(x => x.hook_event_name), ['UserPromptSubmit', 'UserPromptSubmit', 'SessionEnd', 'Stop'])
  assert.ok(!('turn_id' in p[2]))
})

test('closing a session retires the new model even when completed runs retain the old model', async () => {
  const h = await harness()
  h.events.get('session://activated')({ engine: 'codex', sessionId: 's1', model: 'gpt-5' })
  const first = event(), second = event('codex', { runId: 'r2', turnId: 't2' })
  h.turn.onTurnStarted(first)
  h.turn.afterTurn({ ...first, status: 'completed' })
  h.turn.onTurnStarted(second)
  h.events.get('session://selection-changed')({ engine: 'codex', sessionId: 's1', model: 'deepseek-v4' })
  h.turn.onRuntimeEvent({ ...second, kind: 'command-started' })
  await h.flush()
  const before = h.payloads().length
  h.session.onClosed(second)
  h.turn.onRuntimeEvent({ ...second, kind: 'command-started' })
  await h.flush()
  const closing = h.payloads().slice(before)
  assert.deepEqual(closing.map(e => [e.hook_event_name, e.model]),
    [['SessionEnd', 'gpt-5'], ['SessionEnd', 'deepseek-v4']])
  assert.ok(closing.every(e => !('turn_id' in e)))
  assert.equal(new Set(h.payloads().map(e => e.session_id)).size, 1)
})

test('closing a session coalesces retired roles and leaves the latest model last', async () => {
  const h = await harness()
  for (const [i, model] of ['gpt-5', 'deepseek-v4', 'gpt-5'].entries()) {
    h.events.get('session://activated')({ engine: 'codex', sessionId: 's1', model })
    const e = event('codex', { runId: 'r' + i, turnId: 't' + i })
    h.turn.onTurnStarted(e)
    h.turn.afterTurn({ ...e, status: 'completed' })
  }
  await h.flush()
  const before = h.payloads().length
  h.session.onClosed(event())
  await h.flush()
  assert.deepEqual(h.payloads().slice(before).map(e => [e.hook_event_name, e.model]),
    [['SessionEnd', 'deepseek-v4'], ['SessionEnd', 'gpt-5']])
})

test('unloading stops queued bridge calls', async () => {
  const h = await harness()
  h.turn.onTurnStarted(event())
  h.dispose()
  await h.flush()
  assert.equal(h.calls.length, 0)
})

test('Windows uses the bundled Python through a quoted, encoded PowerShell invocation', async () => {
  const h = await harness({ windows: true, python: "C:/宠物's folder/python.exe", hook: "C:/pet's folder/crosspet-hook.py" })
  h.turn.onTurnStarted(event())
  await h.flush()
  const c = h.calls[0]
  assert.equal(c.bin, 'powershell')
  assert.ok(c.args.includes('-NoProfile'))
  const script = Buffer.from(c.args.at(-1), 'base64').toString('utf16le')
  assert.ok(script.includes("'C:/宠物''s folder/python.exe'"))
  assert.ok(script.includes("'C:/pet''s folder/crosspet-hook.py'"))
  assert.ok(script.includes('--event-base64'))
  assert.ok(script.includes('exit $LASTEXITCODE'))
})
