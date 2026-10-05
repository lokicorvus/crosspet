// CrossPet × DeepSeek Harness
// - 监听 DeepSeek 的工作事件（收到消息 / 调工具 / 子任务 / 一轮结束），写 <状态目录>/deepseek-state.json
// - 每 10 分钟查一次余额（有 API Key 用 Key；没有就用 Harness 里登录的账号），写 <状态目录>/deepseek-quota.json
// 状态目录默认 /tmp/crosspet，可在插件配置里改 stateDir。插件只观察，不改变 DeepSeek 的任何行为。
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

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
  const data = process.env.CROSSPET_DATA_DIR || join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "CrossPet");
  const dir = config.stateDir || process.env.CROSSPET_STATE_DIR || (process.platform === "win32" ? join(data, "state") : "/tmp/crosspet");
  const lowBalance = typeof config.lowBalance === "number" ? config.lowBalance : 5;
  let tools = 0;

  let writes = 0;
  async function writeJson(file, data) {
    await mkdir(dir, { recursive: true });
    // 临时文件名每次不同：几次写入同时发生时（比如启动时查两次余额、连续的工作事件）不会互相抢同一个文件
    const tmp = join(dir, `.${file}.${process.pid}.${++writes}`);
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
  // 压缩上下文：会话日志里的 compaction/start、compaction/end
  ctx.on("session/event", (_session, event) => {
    if (event?.type === "compaction/start") state("compact", "PreCompact");
    else if (event?.type === "compaction/end") state("thinking", "PostCompact");
  });
  ctx.on("subagent/end", () => state("thinking", "SubagentStop"));

  // ---- 余额 ----
  // 两条路，都是 Harness 官方接口，Key / 登录凭据都只在 Harness 内部使用，插件只拿到余额数字：
  // 1. 配置了 API Key（模型页填的 sk-…）：用凭据接口取 Key，调官方余额接口（值只在内存里用，不写盘、不打日志）
  // 2. 没有 Key、但在 Harness 里登录了 DeepSeek 账号：调 Harness 自己的账号服务 deepseekAccount.getBalance
  // 账号服务不是每个版本都有：用 ctx.inject 声明成「有就用」，没有时插件照常工作
  let account = null;
  ctx.inject(["deepseekAccount"], (sub) => {
    account = sub.deepseekAccount;
    sub.effect(() => {
      pollBalance();
      return () => { account = null; };
    }, "crosspet: account balance");
  });

  const show = (total, currency, available = true) => writeJson(`${ID}-quota.json`, {
    text: `余额 ${currency === "USD" ? "$" : "¥"}${total.toFixed(2)}`,
    balance: total,  // 桌宠比对用：余额变多（充值）时播「大口吃白饭」
    low: !available || total < lowBalance,
  });

  async function balanceByKey() {
    const hit = await ctx.credentials.resolve("DEEPSEEK_API_KEY");
    if (!hit?.value) return "no-key";
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${hit.value}`, Accept: "application/json" },
    });
    if (!res.ok) return `HTTP ${res.status}`;
    const body = await res.json();
    const info = body?.balance_infos?.[0];
    if (!info) return "no-balance";
    await show(Number(info.total_balance) || 0, info.currency, body.is_available !== false);
    return "ok";
  }

  async function balanceByAccount() {
    if (!account?.getBalance) return "no-account";
    const r = await account.getBalance({
      version: "crosspet", locale: "zh-CN", timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    });
    if (r === null) return "not-signed-in";
    if (r?.status !== "ready") return "failed";
    // 现金钱包 + 赠送钱包，人民币优先
    const wallets = [...(r.value || []), ...(r.bonusWallets || [])];
    const currency = wallets.some((w) => w.currency === "CNY") ? "CNY" : wallets[0]?.currency;
    if (!currency) return "no-balance";
    const total = wallets.filter((w) => w.currency === currency).reduce((sum, w) => sum + (Number(w.balance) || 0), 0);
    await show(total, currency);
    return "ok";
  }

  async function pollBalance() {
    try {
      const byKey = await balanceByKey();
      if (byKey === "ok") return;
      const byAccount = await balanceByAccount();
      if (byAccount === "ok") return;
      if (byKey === "no-key" && ["no-account", "not-signed-in"].includes(byAccount)) {
        // 两样都没有：名牌上说清楚怎么办，别一声不吭
        await writeJson(`${ID}-quota.json`, { text: "余额：请在 Harness 登录账号或填 API Key", low: false });
        return;
      }
      ctx.logger?.warn?.(`crosspet: 查余额失败（API Key：${byKey}，账号：${byAccount}）`);
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
