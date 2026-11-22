import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

const pluginUrl = pathToFileURL(fileURLToPath(new URL("../integrations/opencode/crosspet.js", import.meta.url))).href
const { default: plugin } = await import(pluginUrl)
const allowedFields = new Set(["hook_event_name", "session_id", "model", "tool_name", "notification_type", "trigger"])

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "crosspet-opencode-"))
  const capture = join(root, "events.jsonl")
  const hook = join(root, "capture.cjs")
  await writeFile(hook, `
    const fs = require("node:fs")
    let input = ""
    process.stdin.on("data", chunk => { input += chunk })
    process.stdin.on("end", () => {
      fs.appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({ args: process.argv.slice(2), event: JSON.parse(input) }) + "\\n")
    })
  `)
  const saved = {}
  for (const key of ["CROSSPET_DATA_DIR", "CROSSPET_PYTHON", "CROSSPET_HOOK", "CAPTURE_FILE"]) {
    saved[key] = process.env[key]
  }
  Object.assign(process.env, {
    CROSSPET_DATA_DIR: root,
    CROSSPET_PYTHON: process.execPath,
    CROSSPET_HOOK: hook,
    CAPTURE_FILE: capture,
  })
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  return {
    capture,
    async events() {
      const text = await readFile(capture, "utf8").catch(() => "")
      return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    },
  }
}

async function waitFor(check, timeout = 4000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail("等待 OpenCode 事件转发超时")
}

function assertMetadataOnly(events) {
  assert.equal(events.length > 0, true)
  for (const { args, event } of events) {
    assert.deepEqual(args, ["opencode"])
    for (const key of Object.keys(event)) assert.equal(allowedFields.has(key), true, key)
  }
}

function v2Context() {
  const session = {}
  const tool = {}
  const queue = []
  let wake
  async function* stream(signal) {
    while (!signal.aborted) {
      if (!queue.length) await new Promise(resolve => { wake = resolve })
      if (signal.aborted) return
      yield queue.shift()
    }
  }
  return {
    session,
    tool,
    ctx: {
      session: { hook: async (name, fn) => { session[name] = fn } },
      tool: { hook: async (name, fn) => { tool[name] = fn } },
      event: { subscribe: ({ signal }) => stream(signal) },
    },
    emit(event) {
      queue.push(event)
      wake?.()
      wake = undefined
    },
  }
}

test("V2 覆盖工作、权限、提问、压缩和完成事件", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)

  await fake.session.prompt({ sessionID: "v2", prompt: { text: "private prompt" } })
  await fake.session.context({ sessionID: "v2", model: { providerID: "openai", id: "gpt-6" }, messages: ["private history"] })
  await fake.tool["execute.before"]({ sessionID: "v2", tool: "shell", input: { command: "private command" } })
  await fake.tool["execute.after"]({ sessionID: "v2", tool: "shell", status: "completed", result: { content: "private output" } })
  fake.emit({ id: "p1", type: "permission.asked", data: { sessionID: "v2", resources: ["private resource"] } })
  fake.emit({ id: "p2", type: "permission.replied", data: { sessionID: "v2", reply: "once" } })
  fake.emit({ id: "q1", type: "form.created", data: { form: { sessionID: "v2", fields: ["private question"] } } })
  fake.emit({ id: "q2", type: "form.replied", data: { sessionID: "v2", answer: { private: "answer" } } })
  fake.emit({ id: "c1", type: "session.compaction.started", data: { sessionID: "v2", reason: "auto" } })
  fake.emit({ id: "c2", type: "session.compaction.ended", data: { sessionID: "v2", reason: "auto", text: "private summary" } })
  fake.emit({ id: "done", type: "session.execution.succeeded", data: { sessionID: "v2" } })

  await waitFor(async () => (await f.events()).length === 11)
  const events = await f.events()
  assertMetadataOnly(events)
  assert.deepEqual(events.map(x => x.event.hook_event_name), [
    "UserPromptSubmit", "BeforeModel", "PreToolUse", "PostToolUse", "Notification", "PermissionResult",
    "Notification", "PermissionResult", "PreCompact", "PostCompact", "Stop",
  ])
  assert.equal(events[1].event.model, "openai/gpt-6")
  assert.equal(events[9].event.trigger, "auto")
  assert.equal(JSON.stringify(events).includes("private"), false)
})

test("V2 区分工具错误、中断和会话错误", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)

  await fake.tool["execute.after"]({ sessionID: "v2", tool: "write", status: "error", error: new Error("private error") })
  fake.emit({ type: "session.execution.interrupted", data: { sessionID: "v2", reason: "user" } })
  fake.emit({ type: "session.execution.failed", data: { sessionID: "v2", error: { message: "private error" } } })

  await waitFor(async () => (await f.events()).length === 3)
  const events = await f.events()
  assertMetadataOnly(events)
  assert.deepEqual(events.map(x => x.event.hook_event_name), ["PostToolUseFailure", "Interrupt", "StopFailure"])
  assert.equal(JSON.stringify(events).includes("private"), false)
})

test("V2 子会话归到父会话，模型切换只更新路由，事件 id 不重复处理", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)

  fake.emit({ id: "root", type: "session.created", data: { sessionID: "parent", model: { providerID: "deepseek", id: "deepseek-v4" } } })
  fake.emit({ id: "child", type: "session.created", data: { sessionID: "child", parentID: "parent" } })
  fake.emit({ id: "child-done", type: "session.execution.succeeded", data: { sessionID: "child" } })
  fake.emit({ id: "model", type: "session.model.selected", data: { sessionID: "parent", model: { providerID: "kimi", id: "k3" } } })
  fake.emit({ id: "ask", type: "permission.asked", data: { sessionID: "parent" } })
  fake.emit({ id: "ask", type: "permission.asked", data: { sessionID: "parent" } })

  await waitFor(async () => (await f.events()).length === 5)
  const events = await f.events()
  assert.deepEqual(events.map(x => x.event.hook_event_name), [
    "SessionStart", "SubagentStart", "SubagentStop", "ModelChanged", "Notification",
  ])
  assert.deepEqual(events.map(x => x.event.session_id), ["parent", "parent", "parent", "parent", "parent"])
  assert.equal(events[0].event.model, "deepseek/deepseek-v4")
  assert.equal(events[3].event.model, "kimi/k3")
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal((await f.events()).length, 5)
})

test("V2 共享服务端里只处理当前项目的事件", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  fake.ctx.location = { directory: "/project/a" }
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  fake.emit({ type: "session.created", location: { directory: "/project/b" }, data: { sessionID: "other" } })
  fake.emit({ type: "session.created", location: { directory: "/project/a" }, data: { sessionID: "mine" } })
  await waitFor(async () => (await f.events()).length === 1)
  assert.deepEqual((await f.events()).map(x => x.event.session_id), ["mine"])
})

test("V2 服务端给几个项目各加载一份：不带 location 的事件只由认得这个会话的那份转发", async (t) => {
  const f = await fixture(t)
  const a = v2Context(), b = v2Context()
  a.ctx.location = { directory: "/project/a" }
  b.ctx.location = { directory: "/project/b" }
  const cleanups = [await plugin.setup(a.ctx), await plugin.setup(b.ctx)]
  t.after(() => cleanups.forEach(c => c()))
  const both = (event) => { a.emit(event); b.emit(event) }

  both({ id: "c", type: "session.created", location: { directory: "/project/a" }, data: { sessionID: "s1" } })
  both({ id: "d1", type: "session.execution.succeeded", data: { sessionID: "s1" } })
  // 插件加载前就开着的会话：靠自己的钩子认得它
  await b.session.prompt({ sessionID: "s2" })
  await b.session.context({ sessionID: "s2", model: { providerID: "deepseek", id: "v4" } })
  both({ id: "d2", type: "session.execution.interrupted", data: { sessionID: "s2" } })
  both({ id: "d3", type: "session.execution.succeeded", data: { sessionID: "nobody" } })

  await waitFor(async () => (await f.events()).length >= 5)
  await new Promise(resolve => setTimeout(resolve, 100))
  // 两份插件各自排队、各起进程写同一个文件，彼此的先后不固定：只比较各有几条
  const events = (await f.events()).map(x => `${x.event.hook_event_name} ${x.event.session_id}`).sort()
  assert.deepEqual(events, ["BeforeModel s2", "Interrupt s2", "SessionStart s1", "Stop s1", "UserPromptSubmit s2"])
})

// 按实测 OpenCode 2.3.2 派子任务的事件顺序：task 工具马上返回、父会话这一轮马上「完成」，
// 子会话干完把结果送回来，父会话接着干再真正完成
test("V2 子会话：父会话一直演派小帮手，子会话的提问、模型、工具都不报，父会话中途的完成压着", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  fake.ctx.location = { directory: "/project/a" }
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  const at = { directory: "/project/a" }
  const names = async () => (await f.events()).map(x => `${x.event.hook_event_name} ${x.event.session_id}`)

  fake.emit({ id: "p", type: "session.created", location: at, data: { sessionID: "parent", model: { providerID: "deepseek", id: "v4" } } })
  await waitFor(async () => (await f.events()).length === 1)
  await fake.session.prompt({ sessionID: "parent" })
  await fake.session.context({ sessionID: "parent", model: { providerID: "deepseek", id: "v4" } })
  await fake.tool["execute.before"]({ sessionID: "parent", tool: "subagent" })
  await fake.tool["execute.after"]({ sessionID: "parent", tool: "subagent", status: "completed" })
  // 实测：子会话的 prompt 钩子比它的 session.created 事件先到
  await fake.session.prompt({ sessionID: "child" })
  fake.emit({ id: "c", type: "session.created", location: at, data: { sessionID: "child", parentID: "parent", model: { providerID: "deepseek", id: "v4" } } })
  await waitFor(async () => (await f.events()).length === 6)
  await fake.session.context({ sessionID: "parent", model: { providerID: "deepseek", id: "v4" } })
  await fake.session.context({ sessionID: "child", model: { providerID: "openai", id: "gpt-6" } })
  fake.emit({ id: "pd", type: "session.execution.succeeded", data: { sessionID: "parent" } })
  await fake.tool["execute.before"]({ sessionID: "child", tool: "read" })
  await fake.tool["execute.after"]({ sessionID: "child", tool: "read", status: "completed" })
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.deepEqual(await names(), [
    "SessionStart parent", "UserPromptSubmit parent", "BeforeModel parent", "PreToolUse parent", "PostToolUse parent", "SubagentStart parent",
  ])

  fake.emit({ id: "cd", type: "session.execution.succeeded", data: { sessionID: "child" } })
  await waitFor(async () => (await f.events()).length === 7)
  await fake.session.context({ sessionID: "parent", model: { providerID: "deepseek", id: "v4" } })
  fake.emit({ id: "pd2", type: "session.execution.succeeded", data: { sessionID: "parent" } })
  await waitFor(async () => (await f.events()).length === 8)
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual((await names()).slice(6), ["SubagentStop parent", "Stop parent"])
})

test("V2 子会话结束后父会话没接着干：补报一次完成", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  fake.emit({ id: "c", type: "session.created", data: { sessionID: "child", parentID: "parent" } })
  fake.emit({ id: "pd", type: "session.execution.succeeded", data: { sessionID: "parent" } })
  fake.emit({ id: "cd", type: "session.execution.succeeded", data: { sessionID: "child" } })
  await waitFor(async () => (await f.events()).length === 3, 6000)
  assert.deepEqual((await f.events()).map(x => x.event.hook_event_name), ["SubagentStart", "SubagentStop", "Stop"])
})

test("V2 工具做完紧跟的 context 不报 BeforeModel（不然工具动作被思考盖掉），换了模型才报", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  const deepseek = { providerID: "deepseek", id: "v4" }
  await fake.session.prompt({ sessionID: "s" })
  await fake.session.context({ sessionID: "s", model: deepseek })
  await fake.tool["execute.before"]({ sessionID: "s", tool: "read" })
  await fake.tool["execute.after"]({ sessionID: "s", tool: "read", status: "completed" })
  await fake.session.context({ sessionID: "s", model: deepseek })
  await fake.session.context({ sessionID: "s", model: { providerID: "openai", id: "gpt-6" } })
  // 下一轮提问：开头照样报
  await fake.session.prompt({ sessionID: "s" })
  await fake.session.context({ sessionID: "s", model: { providerID: "openai", id: "gpt-6" } })
  await waitFor(async () => (await f.events()).length === 7)
  await new Promise(resolve => setTimeout(resolve, 100))
  const events = await f.events()
  assert.deepEqual(events.map(x => x.event.hook_event_name), [
    "UserPromptSubmit", "BeforeModel", "PreToolUse", "PostToolUse", "BeforeModel", "UserPromptSubmit", "BeforeModel",
  ])
  assert.equal(events[4].event.model, "openai/gpt-6")
})

test("V2 提问一直等不到 context 钩子也照样转发", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  await fake.session.prompt({ sessionID: "lonely" })
  await waitFor(async () => (await f.events()).length === 1)
  assert.deepEqual((await f.events()).map(x => x.event.hook_event_name), ["UserPromptSubmit"])
})

test("全局表单和关闭后的事件不转发", async (t) => {
  const f = await fixture(t)
  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  fake.emit({ type: "form.created", data: { form: { sessionID: "global", fields: [] } } })
  cleanup()
  fake.emit({ type: "session.execution.succeeded", data: { sessionID: "closed" } })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(await f.events(), [])
})

test("V2 插件到真实公共钩子的端到端链路", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "crosspet-opencode-e2e-"))
  const data = join(root, "data")
  const state = join(root, "state")
  const character = join(data, "characters", "claude")
  await mkdir(character, { recursive: true })
  await mkdir(state)
  await writeFile(join(character, "character.json"), '{"name":"Claude"}')
  await writeFile(join(character, "idle.webp"), "test")
  await writeFile(join(data, "ai-autostart-off"), "test")
  const saved = {}
  const env = {
    CROSSPET_DATA_DIR: data,
    CROSSPET_STATE_DIR: state,
    CROSSPET_PYTHON: "python3",
    CROSSPET_HOOK: fileURLToPath(new URL("../integrations/crosspet-hook.py", import.meta.url)),
  }
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    process.env[key] = value
  }
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })

  const fake = v2Context()
  const cleanup = await plugin.setup(fake.ctx)
  t.after(cleanup)
  await fake.session.prompt({ sessionID: "real-v2", prompt: { text: "private prompt" } })
  await fake.session.context({ sessionID: "real-v2", model: { providerID: "anthropic", id: "claude-sonnet-5" } })
  await fake.tool["execute.before"]({ sessionID: "real-v2", tool: "read", input: { filePath: "/private" } })
  fake.emit({ type: "session.execution.succeeded", data: { sessionID: "real-v2" } })

  const stateFile = join(state, "claude-state.json")
  await waitFor(async () => {
    const current = JSON.parse(await readFile(stateFile, "utf8").catch(() => "{}"))
    return current.event === "Stop"
  })
  const current = JSON.parse(await readFile(stateFile, "utf8"))
  assert.equal(current.pose, "happy")
  assert.equal(current.host, "opencode")
  assert.equal(current.session, "real-v2")
  const client = JSON.parse(await readFile(join(state, "claude@opencode-state.json"), "utf8"))
  assert.equal(client.client, "opencode")
  const records = (await readFile(join(data, "events", "opencode.jsonl"), "utf8")).trim().split("\n")
  assert.equal(JSON.parse(records.at(-1)).result, "shown")
})

