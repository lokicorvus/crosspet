// 由 tools/integrate.py 在接入时填写本机路径。仅通过官方 SDK 观察事件和执行本地桥接。
// 契约：CC GUI SDK >= 0.3.24，不访问对话、工具参数、命令正文、错误正文或凭据。
const CONFIG = null

export default function activate(ctx) {
  if (!CONFIG) throw new Error('请在 CrossPet 的「设置 → 接入 AI」中接入 CC GUI')
  const runs = new Map(), selections = new Map()
  let activeSelection = null, disposed = false, queue = Promise.resolve()
  const keyOf = (engine, session) => JSON.stringify([engine, session])
  const quotePS = value => "'" + String(value).replaceAll("'", "''") + "'"
  // SDK 的工具显示名可能是「Read · 正在读取某路径」；只转发开头的工具标识。
  const toolId = value => {
    const name = String(value || '').split(/[·\s]/, 1)[0]
    return /^[-a-zA-Z0-9_.:]+$/.test(name) ? name.slice(0, 60) : ''
  }

  function selection(e) {
    if (!e || typeof e.engine !== 'string') return
    activeSelection = e
    const model = typeof e.model === 'string' ? e.model : ''
    selections.set(keyOf(e.engine, e.sessionId), model)
    if (selections.size > 200) selections.delete(selections.keys().next().value)
    const next = model || e.engine
    for (const run of runs.values()) {
      if (run.done || run.engine !== e.engine) continue
      // null 也可能代表另一个新建标签，不能覆盖已有明确会话的轮次。
      if (run.sessionId && run.sessionId !== e.sessionId) continue
      if (!run.sessionId && e.sessionId) run.sessionId = e.sessionId
      if (run.model === next) continue
      // 只让旧角色退场；不带 turn_id，避免把仍在进行的轮次记成已结束。
      send(run, 'SessionEnd', '', true)
      run.model = next
    }
  }
  ctx.events.on('session://activated', selection)
  ctx.events.on('session://selection-changed', selection)

  function send(run, name, tool = '', closing = false) {
    const payload = { hook_event_name: name, session_id: run.sid, model: run.model, tool_name: tool.slice(0, 60) }
    if (!closing) payload.turn_id = run.turnId
    // 串行交给同一份钩子：快速的命令完成、轮次完成不能越过工具开始事件。
    queue = queue.then(async () => {
      if (disposed) return
      // Windows PowerShell 5.1 还会在调用原生程序时剥掉 JSON 的双引号；
      // 即便命令本身用了 EncodedCommand，事件参数也必须单独用 UTF-8 base64 编码。
      const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
      let bin = 'python3', args = [CONFIG.hook, 'ccgui', '--event-base64', encoded]
      if (CONFIG.windows) {
        // SDK 的 exec 授权只接受裸命令名；PowerShell 调用随 CrossPet 安装的 Python，
        // 不要求用户另装 Python 或 Node。单引号转义后再用 UTF-16LE EncodedCommand 保留中文路径。
        const script = '& ' + [CONFIG.python, ...args].map(quotePS).join(' ') + '; exit $LASTEXITCODE'
        let bytes = ''
        for (let i = 0; i < script.length; i++) {
          const n = script.charCodeAt(i)
          bytes += String.fromCharCode(n & 255, n >> 8)
        }
        bin = 'powershell'
        args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', btoa(bytes)]
      }
      const result = await ctx.bridge.invoke('plugin_exec_run', {
        bin, args, env: { CROSSPET_DATA_DIR: CONFIG.data, CROSSPET_STATE_DIR: CONFIG.state,
          CROSSPET_CCGUI_TOKEN: CONFIG.token, PYTHONUTF8: '1' }, timeoutMs: 5000,
      })
      if (result.code !== 0) throw new Error('CrossPet 桥接未完成（退出码 ' + result.code + '）')
    }).catch(() => {
      // 不把宿主 / CLI 的错误正文带入日志，也不让桥接故障影响 AI 的轮次。
      if (!disposed) console.warn('[CrossPet] 桥接未完成，请在 CrossPet 接入页更新 CC GUI')
    })
  }

  function current(e) {
    const run = runs.get(e.runId)
    if (!run || run.done || run.turnId !== e.turnId || run.engine !== e.engine) return null
    if (e.sessionId) run.sessionId = e.sessionId
    return run
  }
  function finish(e, name) {
    const run = current(e)
    if (!run) return
    run.done = true
    send(run, name)
  }

  ctx.hooks.registerTurnHooks({
    onTurnStarted(e) {
      if (disposed || !e.runId || !e.turnId || !e.engine || runs.has(e.runId)) return
      const model = selections.get(keyOf(e.engine, e.sessionId))
        ?? (activeSelection?.engine === e.engine && activeSelection.sessionId === null ? activeSelection.model : '')
      const run = { engine: e.engine, sessionId: e.sessionId, turnId: e.turnId,
        sid: 'ccgui:' + keyOf(e.engine, e.sessionId || e.runId), model: model || e.engine, done: false }
      runs.set(e.runId, run)
      // 只裁剪已经结束的轮次；正在工作的会话不能被裁掉。
      if (runs.size > 200) for (const [id, old] of runs) {
        if (old.done) runs.delete(id)
        if (runs.size <= 200) break
      }
      send(run, 'UserPromptSubmit')
    },
    onRuntimeEvent(e) {
      if (disposed) return
      const run = current(e)
      if (!run) return
      switch (e.kind) {
        case 'command-started': send(run, 'PreToolUse', 'Bash'); break
        case 'file-changed': send(run, 'PreToolUse', 'Edit'); break
        case 'command-finished':
          send(run, e.status === 'failed' ? 'PostToolUseFailure' : 'PostToolUse', 'Bash'); break
        case 'tool-finished':
          send(run, e.status === 'failed' ? 'PostToolUseFailure' : 'PostToolUse', toolId(e.toolName)); break
        case 'permission-requested': send(run, 'PermissionRequest', toolId(e.tool)); break
        case 'assistant-completed': finish(e, 'Stop'); break
        case 'turn-cancelled': finish(e, 'Interrupt'); break
        case 'turn-failed': finish(e, 'StopFailure'); break
        case 'runtime-exited': finish(e, e.exitCode === 0 ? 'Stop' : 'StopFailure'); break
      }
    },
    afterTurn(e) {
      if (!disposed) finish(e, e.status === 'failed' ? 'StopFailure' : e.status === 'cancelled' ? 'Interrupt' : 'Stop')
    },
  })
  ctx.hooks.registerSessionHooks({
    onClosed(e) {
      if (disposed || !e.sessionId) return
      const closed = new Map()
      for (const [id, run] of runs) if (run.engine === e.engine && run.sessionId === e.sessionId) {
        // 每个角色都要关闭；最近用过的模型最后发送，保留正确的宿主映射。
        const key = keyOf(run.sid, run.model)
        closed.delete(key)
        closed.set(key, run)
        runs.delete(id)
      }
      for (const run of closed.values()) send(run, 'SessionEnd', '', true)
      selections.delete(keyOf(e.engine, e.sessionId))
    },
  })
  // SDK 自动回收注册的 hooks / events；阻止尚未发出的异步桥接。
  return () => { disposed = true; runs.clear(); selections.clear() }
}
