// CrossPet × DeepSeek Harness
// - 监听 DeepSeek 的工作事件（收到消息 / 调工具 / 子任务 / 一轮结束），写 <状态目录>/deepseek-state.json
// - 通过 DeepSeek Harness 官方凭据接口取 API Key，每 10 分钟查一次余额，写 <状态目录>/deepseek-quota.json
// 状态目录默认 /tmp/crosspet，可在插件配置里改 stateDir。插件只观察，不改变 DeepSeek 的任何行为。
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const name = "crosspet";
export const inject = ["credentials"];

const ID = "deepseek";
const BIG_JOB_TOOLS = 8;
const BALANCE_EVERY_MS = 10 * 60 * 1000;

function poseForTool(name, args) {
  const t = String(name ?? "").toLowerCase();
  const input = (() => { try { return JSON.stringify(args ?? "").toLowerCase(); } catch { return ""; } })();
  if (/image_gen|imagegen|generate_image|draw|paint/.test(t) || input.includes("image_gen")) return "drawing";
  if (/read|grep|glob|list|view|cat/.test(t)) return "reading";
  if (/write|edit|patch|replace|create/.test(t)) return "writing";
  if (/web|fetch|browse|search|http/.test(t)) return "searching";
  if (/agent|task|subagent|delegate/.test(t)) return "delegating";
  return "running";
}

function failed(result) {
  if (!result || typeof result !== "object") return false;
  return result.isError === true || result.is_error === true || result.ok === false;
}

export function apply(ctx, config = {}) {
  const dir = config.stateDir || process.env.CROSSPET_STATE_DIR || "/tmp/crosspet";
  const lowBalance = typeof config.lowBalance === "number" ? config.lowBalance : 5;
  let tools = 0;

  async function writeJson(file, data) {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${file}`);
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, join(dir, file));
  }
  function state(pose, event, tool = "") {
    writeJson(`${ID}-state.json`, { pose, event, tool, ts: Date.now() / 1000 }).catch((e) =>
      ctx.logger?.warn?.(`crosspet: 写状态失败 ${String(e)}`),
    );
  }

  ctx.on("agent/created", () => state("idle", "SessionStart"));
  ctx.on("agent/pre-step", async ({ messages }, next) => {
    if (messages?.length) {
      tools = 0;
      state("listening", "UserPromptSubmit");
    }
    return next();
  });
  ctx.on("tools/pre-execute", async (exec, next) => {
    tools += 1;
    state(poseForTool(exec.name, exec.arguments), "PreToolUse", String(exec.name ?? ""));
    return next();
  });
  ctx.on("tools/post-execute", async (exec, result, next) => {
    state(failed(result) ? "oops" : "thinking", "PostToolUse", String(exec.name ?? ""));
    return next();
  });
  ctx.on("agent/turn-stopping", () => {
    state(tools >= BIG_JOB_TOOLS ? "proud" : "happy", "Stop");
    tools = 0;
  });
  ctx.on("subagent/start", () => state("delegating", "SubagentStart"));
  ctx.on("subagent/end", () => state("thinking", "SubagentStop"));

  // ---- 余额：用官方凭据接口拿 Key（值只在内存里用，不写盘、不打日志）----
  async function pollBalance() {
    try {
      const hit = await ctx.credentials.resolve("DEEPSEEK_API_KEY");
      if (!hit?.value) return;
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${hit.value}`, Accept: "application/json" },
      });
      if (!res.ok) return;
      const body = await res.json();
      const info = body?.balance_infos?.[0];
      if (!info) return;
      const total = Number(info.total_balance) || 0;
      const sym = info.currency === "USD" ? "$" : "¥";
      await writeJson(`${ID}-quota.json`, {
        text: `余额 ${sym}${total.toFixed(2)}`,
        low: body.is_available === false || total < lowBalance,
      });
    } catch (e) {
      ctx.logger?.warn?.(`crosspet: 查余额失败 ${String(e?.message ?? e)}`);
    }
  }
  ctx.effect(() => {
    pollBalance();
    const timer = setInterval(pollBalance, BALANCE_EVERY_MS);
    return () => clearInterval(timer);
  }, "crosspet: balance timer");
}
