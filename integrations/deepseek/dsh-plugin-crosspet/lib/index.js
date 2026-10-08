// CrossPet × DeepSeek Harness
// - 监听 Harness 的工作事件（收到消息 / 调工具 / 子任务 / 一轮结束），写 <状态目录>/<角色>-state.json
//   Harness 能接好几家模型：按会话实际在用的模型选角色（DeepSeek / GPT / Claude / Gemini），
//   当前角色另外记在 deepseek-host.json，桌宠切到 Harness 窗口时按它换角色
// - 每 10 分钟查一次余额（有 API Key 用 Key；没有就用 Harness 里登录的账号），写 <状态目录>/deepseek-quota.json
// - 跟着 AI 出现：Harness 启动、新会话、发消息时，桌宠没开着就把它打开（用户从菜单退出后到 Harness 重开前不管；在设置 / 插件配置 autostart: false 里关掉了也不管）
// 状态目录默认 /tmp/crosspet，可在插件配置里改 stateDir。插件只观察，不改变 DeepSeek 的任何行为。
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const name = "crosspet";
export const inject = ["credentials"];

const ID = "deepseek";
const PLUGIN_VERSION = "1.2.4";  // 出现在 deepseek-plugin.json 里，用来确认跑的是哪一版插件
const BIG_JOB_TOOLS = 8;
const BALANCE_EVERY_MS = 10 * 60 * 1000;

function poseForTool(name, args) {
  const t = String(name ?? "").toLowerCase();
  const input = (() => { try { return JSON.stringify(args ?? "").toLowerCase(); } catch { return ""; } })();
  if (t === "ask_user_question" || t === "ask_user") return "asking";  // 停下来问你问题、让你选选项
  if (/image_gen|imagegen|generate_image|draw|paint/.test(t) || input.includes("image_gen")) return "drawing";
  if (/read|grep|glob|list|view|cat/.test(t)) return "reading";
  if (/write|edit|patch|replace|create/.test(t)) return "writing";
  if (/web|fetch|browse|search|http/.test(t)) return "searching";
  if (/agent|task|subagent|delegate/.test(t)) return "delegating";
  return "running";
}

// 模型 → 角色：先看模型名，再看 provider 名（provider 是用户自己起的路由名，可能叫什么都有），都认不出算 DeepSeek。
// 插件配置里的 characters 可以覆盖，比如 { "my-gateway": "gpt" }（键是 provider 或模型名）
function characterFor(provider, model, custom = {}) {
  const p = String(provider ?? ""), m = String(model ?? "");
  if (custom[m]) return custom[m];
  if (custom[p]) return custom[p];
  for (const s of [m.toLowerCase(), p.toLowerCase()]) {
    if (/deepseek/.test(s)) return "deepseek";
    if (/claude|anthropic/.test(s)) return "claude";
    if (/gemini|google|vertex/.test(s)) return "gemini";
    if (/gpt|codex|openai|chatgpt|(^|[^a-z])o[1-9]/.test(s)) return "gpt";
  }
  return ID;
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
  // 当前在用的模型对应的角色：每条会话事件都看一眼会话的请求路由（和 Harness 自带插件一样用 requestContext）
  const custom = config.characters && typeof config.characters === "object" ? config.characters : {};
  let character = ID;
  function noteRoute(session) {
    let route;
    try { route = session?.requestContext?.(); } catch { return; }
    if (!route?.provider && !route?.model) return;
    const next = characterFor(route.provider, route.model, custom);
    if (next === character) return;
    character = next;
    writeJson(`${ID}-host.json`, { character, provider: route.provider ?? "", model: route.model ?? "", ts: Date.now() / 1000 })
      .catch(() => {});
  }

  function state(pose, event, tool = "") {
    writeJson(`${character}-state.json`, { pose, event, tool, ts: Date.now() / 1000 }).catch((e) =>
      ctx.logger?.warn?.(`crosspet: 写状态失败 ${String(e)}`),
    );
  }

  // ---- 跟着 AI 出现 ----
  // 桌宠在跑时把自己的进程号写在 <状态目录>/pet.pid；从菜单手动退出时在数据目录写 user-quit（Harness 重开或重启电脑后作废），
  // 设置里关掉时写 ai-autostart-off。用独立进程打开（detached），Harness 退出时桌宠不会被一起关掉
  const appData = process.platform === "win32" ? data : join(homedir(), "Library", "Application Support", "CrossPet");
  let lastEnsure = 0;
  function noteAutostart(source, result) {  // 写进 <状态目录>/autostart.txt，排查「为什么没出来」用
    const at = new Date().toLocaleString("zh-CN", { hour12: false });
    // Windows 上带 BOM：系统自带的 PowerShell 5 没有 BOM 就按 GBK 读，中文会乱码
    const bom = process.platform === "win32" ? "\ufeff" : "";
    mkdir(dir, { recursive: true }).then(() => writeFile(join(dir, "autostart.txt"), `${bom}${at} deepseek ${source}：${result}\n`)).catch(() => {});
  }
  function ensurePet(source) {
    if (config.autostart === false) return noteAutostart(source, "不打开：插件配置里 autostart 是 false");
    if (Date.now() - lastEnsure < 30000) return;
    lastEnsure = Date.now();
    try {
      // 手动退出过：Harness 是在那之后才打开的（关掉重开过、或者重启过电脑）就作废，否则先不管
      const quitFlag = join(appData, "user-quit");
      if (existsSync(quitFlag)) {
        const hm = (ms) => new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
        const started = Date.now() - process.uptime() * 1000, quitAt = statSync(quitFlag).mtimeMs;
        if (started < quitAt)
          return noteAutostart(source, `不打开：从菜单手动退出过，Harness 是在那之前就开着的（Harness 打开于 ${hm(started)}，退出于 ${hm(quitAt)}）`);
      }
      if (existsSync(join(appData, "ai-autostart-off"))) return noteAutostart(source, "不打开：设置里关掉了「AI 开始工作时自动出现」");
      try {
        process.kill(Number(readFileSync(join(dir, "pet.pid"), "utf8").trim()), 0);
        return noteAutostart(source, "已经在跑");
      } catch (e) {
        if (e?.code === "EPERM") return noteAutostart(source, "已经在跑");
      }
      let child;
      if (process.platform === "win32") {
        const exe = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "CrossPet", "CrossPet.exe");
        if (!existsSync(exe)) return noteAutostart(source, `不打开：没找到 ${exe}`);
        child = spawn(exe, [], { detached: true, stdio: "ignore", cwd: dirname(exe) });
      } else if (process.platform === "darwin") {
        child = spawn("/usr/bin/open", ["-g", "-b", "io.github.crosspet"], { detached: true, stdio: "ignore" });
      } else return;
      child.on("error", (e) => noteAutostart(source, `打开失败：${String(e?.message ?? e)}`));
      child.unref();
      noteAutostart(source, "已打开");
    } catch (e) {
      noteAutostart(source, `出错：${String(e?.message ?? e)}`);
      ctx.logger?.warn?.(`crosspet: 打开桌宠失败 ${String(e?.message ?? e)}`);
    }
  }
  ctx.effect(() => {
    const timer = setTimeout(() => ensurePet("Harness 启动"), 2500);  // 稍微错开 Harness 自己的启动
    return () => clearTimeout(timer);
  }, "crosspet: open pet with Harness");

  ctx.on("agent/created", () => { state("idle", "SessionStart"); ensurePet("新会话"); });
  ctx.on("agent/pre-step", async ({ messages }, next) => {
    if (messages?.length) {
      ensurePet("发消息");
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
  // 要你授权：只旁听，决定原样交回给 Harness。自动放行的请求也会经过这里，
  // 所以超过 0.4 秒还没答复（真的在等人）才换成等你回答的表情，免得干活时一闪一闪
  ctx.on("approval/request", async (_request, next) => {
    const waiting = setTimeout(() => state("asking", "PermissionRequest"), 400);
    try {
      return await next();
    } finally {
      clearTimeout(waiting);
    }
  });
  ctx.on("subagent/start", () => state("delegating", "SubagentStart"));
  // 压缩上下文：会话日志里的 compaction/start、compaction/end
  ctx.on("session/event", (session, event) => {
    noteRoute(session);
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
  try {
    ctx.inject(["deepseekAccount"], (sub) => {
      account = sub.deepseekAccount;
      sub.effect(() => {
        pollBalance();
        return () => { account = null; };
      }, "crosspet: account balance");
    });
  } catch (e) {
    // 万一这个版本的 Harness 不支持：只是少了「用账号查余额」，工作状态和用 Key 查余额照常
    ctx.logger?.warn?.(`crosspet: 账号服务不可用 ${String(e?.message ?? e)}`);
  }

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

  // 每次查余额都把过程记到 deepseek-plugin.json（只有结果代码，没有 Key / 令牌），
  // 余额不显示时看它就知道卡在哪一步：Harness 的日志不落盘，没有别的办法看
  const diagnose = (info) => writeJson(`${ID}-plugin.json`, { plugin: PLUGIN_VERSION, at: new Date().toISOString(),
    accountService: !!account?.getBalance, ...info }).catch(() => {});

  async function pollBalance() {
    let byKey = "not-tried", byAccount = "not-tried";
    try {
      byKey = await balanceByKey().catch((e) => `error: ${String(e?.message ?? e)}`);
      if (byKey !== "ok") byAccount = await balanceByAccount().catch((e) => `error: ${String(e?.message ?? e)}`);
      await diagnose({ apiKey: byKey, account: byAccount });
      if (byKey === "ok" || byAccount === "ok") return;
      if (byKey === "no-key" && ["no-account", "not-signed-in"].includes(byAccount)) {
        // 两样都没有：名牌上说清楚怎么办，别一声不吭
        await writeJson(`${ID}-quota.json`, { text: "余额：请在 Harness 登录账号或填 API Key", low: false });
        return;
      }
      ctx.logger?.warn?.(`crosspet: 查余额失败（API Key：${byKey}，账号：${byAccount}）`);
    } catch (e) {
      await diagnose({ apiKey: byKey, account: byAccount, error: String(e?.message ?? e) });
      ctx.logger?.warn?.(`crosspet: 查余额失败 ${String(e?.message ?? e)}`);
    }
  }
  ctx.effect(() => {
    pollBalance();
    const timer = setInterval(pollBalance, BALANCE_EVERY_MS);
    return () => clearInterval(timer);
  }, "crosspet: balance timer");
}
