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

function toolEvent(send, name, input) {
  send(name, input?.sessionID, { tool_name: String(input?.tool || "") })
}

function v2Events(send, locationDirectory) {
  const children = new Map()
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
    const sid = sessionID(p)
    switch (event.type) {
      case "session.created":
        if (p.parentID) {
          children.set(sid, String(p.parentID))
          send("SubagentStart", p.parentID, { model: modelName(p.model) })
        } else {
          send("SessionStart", sid, { model: modelName(p.model) })
        }
        break
      case "session.model.selected":
        if (!children.has(sid)) send("ModelChanged", sid, { model: modelName(p.model) })
        break
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const parent = children.get(sid)
        if (parent) {
          children.delete(sid)
          send("SubagentStop", parent)
          break
        }
        send(event.type === "session.execution.succeeded" ? "Stop"
          : event.type === "session.execution.failed" ? "StopFailure" : "Interrupt", sid)
        break
      }
      case "session.deleted": {
        const parent = children.get(sid)
        children.delete(sid)
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
    const onEvent = v2Events(send, ctx.location?.directory)
    const controller = new AbortController()

    await ctx.session.hook("prompt", (event) => {
      send("UserPromptSubmit", event.sessionID)
    })
    await ctx.session.hook("context", (event) => {
      send("BeforeModel", event.sessionID, { model: modelName(event.model) })
    })
    await ctx.tool.hook("execute.before", (event) => toolEvent(send, "PreToolUse", event))
    await ctx.tool.hook("execute.after", (event) => {
      toolEvent(send, event.status === "error" ? "PostToolUseFailure" : "PostToolUse", event)
    })

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
      send.close()
    }
  },
}
