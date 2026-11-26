// CrossPet × OpenCode V2：只把事件元数据交给共同的 crosspet-hook.py。
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HOST = "opencode"

function modelName(model) {
  if (!model) return ""
  if (typeof model === "string") return model
  const provider = String(model.providerID || model.provider || "")
  const id = String(model.modelID || model.id || "")
  return provider && id ? `${provider}/${id}` : id || provider
}

function sessionID(properties) {
  return String(properties?.sessionID || properties?.info?.id || properties?.id || "")
}

function createSender() {
  let chain = Promise.resolve()
  let closed = false
  let active = null

  function dispatch(event) {
    if (closed) return Promise.resolve()
    const root = process.env.CROSSPET_DATA_DIR || (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "CrossPet")
      : process.platform === "linux"
        ? join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "crosspet")
        : join(homedir(), "Library", "Application Support", "CrossPet"))
    const hook = process.env.CROSSPET_HOOK || join(root, "crosspet-hook.py")
    if (!existsSync(hook)) return Promise.resolve()
    const python = process.env.CROSSPET_PYTHON || (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "CrossPet", "python", "python.exe")
      : "python3")

    return new Promise((resolve) => {
      let child
      try {
        child = spawn(python, [hook, HOST], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
      } catch {
        resolve()
        return
      }
      active = child
      let finished = false
      const timer = setTimeout(() => {
        try { child.kill() } catch {}
        finish()
      }, 8000)
      function finish() {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (active === child) active = null
        resolve()
      }
      child.on("error", finish)
      child.on("exit", finish)
      child.stdin.on("error", () => {})
      child.stdin.end(JSON.stringify(event))
    })
  }

  function send(name, sid, fields = {}) {
    if (closed) return
    const event = { hook_event_name: name, session_id: String(sid || "") }
    for (const key of ["model", "tool_name", "notification_type", "trigger"]) {
      if (fields[key]) event[key] = String(fields[key])
    }
    chain = chain.then(() => dispatch(event)).catch(() => {})
  }
  send.close = () => {
    closed = true
    try { active?.kill() } catch {}
  }
  return send
}

const PROMPT_WAIT = 300   // 提问等 context 钩子最多这么久（毫秒），见 setup
const STOP_WAIT = 3000    // 子会话都结束后，父会话这么久（毫秒）没接着干就补报完成，见 sessionTracker

// 这份插件认得哪些会话（实测 OpenCode 2.3.2）：
// - 服务端给每个打开过的项目各加载一份全局插件（实测 3 份），事件流每份都收到全部事件。
//   session.execution.* 之类不带 location，按项目过滤拦不住，每份都转发就成了 3 条 Stop。
//   所以只转发认得的会话：带本项目 location 的 session.created 里看到的，或本份插件的钩子里出现过的
//   （prompt / context / tool 钩子只在会话所在项目那份插件里触发）。没有 location 的旧版本（拿不到目录）照旧全转发。
// - 子会话（task 派出去的）：父会话一直演「派小帮手」，到子会话结束（SubagentStop）为止。
//   子会话自己的提问、模型、工具都不报：它的提问不是用户发的，它的读写一报就把「派小帮手」盖掉了。
//   OpenCode 的 task 是异步的：派出去后父会话这一轮马上就「完成」了（execution.succeeded），子会话的结果之后再送回来、
//   父会话接着干。所以父会话还有子会话在跑时，它的完成先压着；子会话都结束后父会话 STOP_WAIT 内没接着干，才补报 Stop。
function sessionTracker(locationDirectory) {
  const owned = new Set()
  const parents = new Map()
  const heldStops = new Map()   // 父会话 → 压着的完成（true）或补报的计时器
  const trim = (set) => { if (set.size > 1000) set.delete(set.values().next().value) }
  return {
    own(sid) { if (sid) { owned.add(sid); trim(owned) } },
    owns(sid) { return !locationDirectory || owned.has(sid) },
    addChild(sid, parent) { parents.set(sid, parent); if (parents.size > 1000) parents.delete(parents.keys().next().value) },
    parentOf(sid) { return parents.get(sid) },
    dropChild(sid) { parents.delete(sid) },
    hasChildren(parent) { for (const p of parents.values()) if (p === parent) return true; return false },
    holdStop(parent) { heldStops.set(parent, true) },
    // 子会话都结束了：父会话 STOP_WAIT 内没接着干就补报
    releaseStop(parent, send) {
      if (heldStops.get(parent) !== true) return
      heldStops.set(parent, setTimeout(() => { heldStops.delete(parent); send("Stop", parent) }, STOP_WAIT))
    },
    // 父会话自己接着干了 / 真的完成了：不用补报
    cancelStop(parent) { const t = heldStops.get(parent); if (t !== undefined) { clearTimeout(t); heldStops.delete(parent) } },
    close() { for (const t of heldStops.values()) clearTimeout(t); heldStops.clear() },
  }
}

function v2Events(send, locationDirectory, sessions = sessionTracker(locationDirectory)) {
  const seen = new Set()
  return (event) => {
    if (!event) return
    // 共享服务端可能给多个项目各装一份全局插件：只处理当前实例所在项目的事件。
    if (locationDirectory && event.location?.directory && event.location.directory !== locationDirectory) return
    if (event.id) {
      if (seen.has(event.id)) return
      seen.add(event.id)
      if (seen.size > 1000) seen.delete(seen.values().next().value)
    }
    const p = event.data || event.properties || {}
    const sid = event.type?.startsWith("form.") && p.form ? String(p.form.sessionID || "") : sessionID(p)
    if (event.location?.directory) sessions.own(sid)
    else if (!sessions.owns(sid)) return
    switch (event.type) {
      case "session.created":
        if (p.parentID) {
          sessions.addChild(sid, String(p.parentID))
          send("SubagentStart", p.parentID, { model: modelName(p.model) })
        } else {
          send("SessionStart", sid, { model: modelName(p.model) })
        }
        break
      case "session.model.selected":
        if (!sessions.parentOf(sid)) send("ModelChanged", sid, { model: modelName(p.model) })
        break
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const parent = sessions.parentOf(sid)
        if (parent) {
          sessions.dropChild(sid)
          send("SubagentStop", parent)
          if (!sessions.hasChildren(parent)) sessions.releaseStop(parent, send)
          break
        }
        sessions.cancelStop(sid)
        if (event.type === "session.execution.succeeded" && sessions.hasChildren(sid)) {
          sessions.holdStop(sid)
          break
        }
        send(event.type === "session.execution.succeeded" ? "Stop"
          : event.type === "session.execution.failed" ? "StopFailure" : "Interrupt", sid)
        break
      }
      case "session.deleted": {
        const parent = sessions.parentOf(sid)
        sessions.dropChild(sid)
        send(parent ? "SubagentStop" : "SessionEnd", parent || sid)
        break
      }
      case "session.compaction.started":
        send("PreCompact", sid)
        break
      case "session.compaction.ended":
        send("PostCompact", sid, { trigger: p.reason || "auto" })
        break
      case "session.compaction.failed":
        send("PostToolUseFailure", sid)
        break
      case "permission.asked":
        send("Notification", sid, { notification_type: "permission_prompt" })
        break
      case "permission.replied":
        send("PermissionResult", sid)
        break
      case "form.created": {
        const formSession = String(p.form?.sessionID || "")
        if (formSession && formSession !== "global") {
          send("Notification", formSession, { notification_type: "permission_prompt" })
        }
        break
      }
      case "form.replied":
      case "form.cancelled":
        send("PermissionResult", sid)
        break
    }
  }
}

export default {
  id: "crosspet",

  async setup(ctx) {
    const send = createSender()
    const sessions = sessionTracker(ctx.location?.directory)
    const onEvent = v2Events(send, ctx.location?.directory, sessions)
    const controller = new AbortController()

    // 子会话的 prompt 钩子比它的 session.created 事件先到（实测差几十毫秒），当时还认不出是子会话。
    // 所以提问先压着：等到这个会话的 context 钩子（带模型，紧跟着就来）再决定，PROMPT_WAIT 内没等到也照发
    const pending = new Map()
    function flushPrompt(sid, model) {
      clearTimeout(pending.get(sid))
      pending.delete(sid)
      if (!sessions.parentOf(sid)) send("UserPromptSubmit", sid, { model })
    }
    // context 钩子每一步都来（每个工具做完紧跟着一次，实测只隔二三十毫秒）。每次都报 BeforeModel 的话，
    // 桌宠 0.3 秒读一次状态，刚报的读文件、跑命令、派小帮手就被「思考」盖掉，一个都看不到。
    // 工具做完本来就会回到思考（PostToolUse），所以只在一轮开头（刚提问）和换了模型时报
    const lastModel = new Map()
    await ctx.session.hook("prompt", (event) => {
      const sid = String(event?.sessionID || "")
      sessions.own(sid)
      sessions.cancelStop(sid)
      lastModel.delete(sid)
      clearTimeout(pending.get(sid))
      pending.set(sid, setTimeout(() => flushPrompt(sid, ""), PROMPT_WAIT))
    })
    await ctx.session.hook("context", (event) => {
      const sid = String(event?.sessionID || "")
      sessions.own(sid)
      const model = modelName(event?.model)
      if (pending.has(sid)) flushPrompt(sid, model)
      if (sessions.parentOf(sid)) return   // 子会话：父会话在演派小帮手，它的模型也不能把父会话的角色换掉
      sessions.cancelStop(sid)
      if (lastModel.has(sid) && lastModel.get(sid) === model) return
      lastModel.set(sid, model)
      if (lastModel.size > 1000) lastModel.delete(lastModel.keys().next().value)
      send("BeforeModel", sid, { model })
    })
    const tool = (name) => (event) => {
      const sid = String(event?.sessionID || "")
      sessions.own(sid)
      if (sessions.parentOf(sid)) return   // 子会话的工具：不盖掉父会话的派小帮手
      sessions.cancelStop(sid)
      send(name, sid, { tool_name: String(event?.tool || "") })
    }
    const before = tool("PreToolUse"), after = tool("PostToolUse"), failed = tool("PostToolUseFailure")
    await ctx.tool.hook("execute.before", before)
    await ctx.tool.hook("execute.after", (event) => (event?.status === "error" ? failed : after)(event))

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) onEvent(event)
      } catch {
        if (!controller.signal.aborted) {
          // 事件流断开不能让插件的其他钩子失效；OpenCode 重载插件时会重新订阅。
        }
      }
    })()

    return () => {
      controller.abort()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
      sessions.close()
      send.close()
    }
  },
}
