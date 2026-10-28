// Claude Code 增强版 mod 的额度（integrations/claude-code/mod/hooks/register.ts 的 quotaOf）：node --test tests/claude_mod_quota.test.mjs
// node 24 直接剥掉 TypeScript 的类型来跑；register.ts 只有 import type，不需要 Claude Code 的运行环境
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotaOf } from '../integrations/claude-code/mod/hooks/register.ts'

test('额度条样式：quotaOf 带 bars（剩余比例、重置时刻 Unix 秒），text 不变', () => {
  const q = quotaOf([{ kind: 'five_hour', percentUsed: 9, resetsAt: '2026-10-21T05:00:00Z' }, { kind: 'seven_day', percentUsed: 41 }])
  assert.deepEqual(q.bars, [{ label: '5小时', left: 0.91, reset: 1792558800 }, { label: '本周', left: 0.59 }])
  assert.match(q.text, /^5小时 剩余 91% ｜ 本周 剩余 59%$/)
  assert.equal(q.low, false)
})

test('不显示的种类不进 bars；花费也是一条', () => {
  const q = quotaOf([{ kind: 'opus_weekly', percentUsed: 50 }, { kind: 'spend_limit', percentUsed: 95 }])
  assert.deepEqual(q.bars, [{ label: '花费', left: 0.05 }])
})
