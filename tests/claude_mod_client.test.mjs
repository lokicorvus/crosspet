// Claude Code 增强版 mod 写客户端（多桌宠按「角色 + 客户端」各站一只）：node --test tests/claude_mod_client.test.mjs
// 用假的引擎接口（$）跑 register.ts 的 tool.call：状态目录、HOME 都指到临时目录，不碰真实的 /tmp/crosspet 和数据目录。
// 规则同 crosspet-hook.py 的 detect_client：CLAUDE_CODE_ENTRYPOINT 是 claude-desktop → claude-desktop，其他值或没有 → claude-cli
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { register } from '../integrations/claude-code/mod/hooks/register.ts'

delete process.env.CLAUDE_CODE_ENTRYPOINT   // 测试本身跑在 Claude Code 里，继承来的值不能算数

const root = mkdtempSync(join(tmpdir(), 'crosspet-mod-client-'))
const stateDir = join(root, 'state')   // mod 把状态目录缓存在模块里，整个文件共用一个
const handlers = {}
register((name, f) => { handlers[name] = f })

function engine(sid, entrypoint) {
  const env = { CROSSPET_STATE_DIR: stateDir, HOME: root, CLAUDE_CODE_ENTRYPOINT: entrypoint }
  return {
    env: { get: async (k) => env[k] },
    session: { id: async () => sid },
    fs: {
      write: async (p, s) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, s) },
      read: async (p) => readFile(p, 'utf8'),
      exists: async (p) => existsSync(p),
      stat: async (p) => stat(p),
    },
    process: { run: async () => ({ stdout: '', exitCode: 1 }) },
  }
}
const json = (f) => JSON.parse(readFileSync(join(stateDir, f), 'utf8'))
const callTool = (sid, entrypoint) =>
  handlers['tool.call'](engine(sid, entrypoint), { tool: 'Bash' }, async () => ({ isError: false }))

test('ENTRYPOINT=claude-desktop：会话条目带 client，另写 claude@claude-desktop-state.json，主文件不带 client', async () => {
  await callTool('s-desktop', 'claude-desktop')
  assert.equal(json('claude-sessions.json')['s-desktop'].client, 'claude-desktop')
  const extra = json('claude@claude-desktop-state.json')
  assert.equal(extra.client, 'claude-desktop')
  assert.equal(extra.pose, 'thinking')
  assert.equal(extra.event, 'PostToolUse')
  const main = json('claude-state.json')
  assert.equal(main.pose, 'thinking')
  assert.ok(!('client' in main), JSON.stringify(main))
})

test('ENTRYPOINT 是 cli 或没有：都算 claude-cli', async () => {
  await callTool('s-cli', 'cli')
  await callTool('s-none', undefined)
  const sessions = json('claude-sessions.json')
  assert.equal(sessions['s-cli'].client, 'claude-cli')
  assert.equal(sessions['s-none'].client, 'claude-cli')
  assert.equal(json('claude@claude-cli-state.json').client, 'claude-cli')
})
