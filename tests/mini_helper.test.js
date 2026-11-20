// 迷你小帮手：主桌宠的姿态 → 小帮手在干嘛（app/web/mini-helper.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../app/web/mini-helper.js')

test('mood_of：思考、干活、等你、睡觉、出错各有各的；贴边藏起来；没列出的是待机', () => {
  assert.equal(M.moodOf('thinking'), 'think')
  assert.equal(M.moodOf('deepthink'), 'think')
  for (const p of ['writing', 'searching', 'busy_left', 'busy_right', 'swamped_left', 'compact', 'delegating']) assert.equal(M.moodOf(p), 'busy', p)
  assert.equal(M.moodOf('asking'), 'asking')
  assert.equal(M.moodOf('reading'), 'read')
  assert.equal(M.moodOf('sleeping'), 'sleep')
  assert.equal(M.moodOf('oops'), 'worried')
  assert.equal(M.moodOf('greet_morning'), 'wave')
  assert.equal(M.moodOf('fest_spring'), 'happy')
  for (const p of ['edge_left', 'edge_right_peek']) assert.equal(M.moodOf(p), 'hidden', p)
  for (const p of ['idle', 'tired', 'listening', 'pat', 'pop', undefined, null]) assert.equal(M.moodOf(p), 'idle', String(p))
})

test('frames：和 tools/mini_sheet.py 的格子顺序一样', () => {
  const py = require('fs').readFileSync(require('path').join(__dirname, '../tools/mini_sheet.py'), 'utf8')
  const list = JSON.parse(py.match(/FRAMES = (\[[\s\S]*?\])/)[1].replace(/'/g, '"'))
  assert.deepEqual(list, M.FRAMES)
})
