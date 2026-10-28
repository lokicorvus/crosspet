// 插件更新提醒（网页层规则 app/web/plugin-update.js）：node --test tests/plugin_update.test.js
const test = require('node:test')
const assert = require('node:assert')
const { advice } = require('../app/web/plugin-update.js')

const p = (installed, running, bundled = '1.3.5') => ({ id: 'deepseek', label: 'DeepSeek Harness', bundled, installed, running })

test('装的比自带的旧：提醒去设置里点「更新」', () => {
  const a = advice(p('1.3.4', '1.3.4'))
  assert.equal(a.kind, 'update')
  assert.match(a.text, /1\.3\.4 → 1\.3\.5/)
  assert.match(a.say, /接入 AI/)   // 桌宠说的话告诉用户去哪；设置页那一行就在「接入 AI」里，写「点右边的更新」
})

test('装的旧、跑的更旧：先提醒更新（更新完再提醒重开）', () => {
  assert.equal(advice(p('1.3.4', '1.3.2')).kind, 'update')
})

test('装好了新的、Harness 还跑着旧的：提醒完全退出再打开', () => {
  const a = advice(p('1.3.5', '1.3.2'))
  assert.equal(a.kind, 'restart')
  assert.match(a.text, /完全退出/)
})

test('都是新的：不提醒', () => {
  assert.equal(advice(p('1.3.5', '1.3.5')), null)
})

test('Harness 还没跑过插件（没有自检）：只看装的', () => {
  assert.equal(advice(p('1.3.5', null)), null)
  assert.equal(advice(p('1.3.4', null)).kind, 'update')
})

test('接入了但插件文件不在：也提醒更新', () => {
  assert.equal(advice(p(null, null)).kind, 'update')
})

test('版本号按数字比，不按字符串（1.3.10 比 1.3.9 新）', () => {
  assert.equal(advice(p('1.3.10', '1.3.10', '1.3.9')), null)
  assert.equal(advice(p('1.3.9', '1.3.9', '1.3.10')).kind, 'update')
})

test('自带的版本读不到：不提醒（免得乱报）', () => {
  assert.equal(advice(p('1.3.4', '1.3.4', null)), null)
})

test('随包的插件比 1.3.8-beta.1 里那版（1.3.8，没有事件记录）新：装过 beta.1 的人会被提醒更新', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'), 'utf8')
  const bundled = src.match(/PLUGIN_VERSION = "([^"]+)"/)[1]
  assert.equal(advice(p('1.3.8', '1.3.8', bundled)).kind, 'update')
})

// DeepSeek Harness 装 / 更新任何插件时会校验所有插件 package.json 的版本号：1.3.8-beta.2 带的 "1.3.8.1"（四段）
// 不是合法版本号，会把用户装别的插件也拦住。插件版本必须是三段的合法版本号，并且和随包的 package.json 一致
test('插件版本号是合法的三段版本号，和随包 package.json 一致', () => {
  const fs = require('fs'), path = require('path')
  const dir = path.join(__dirname, '../integrations/deepseek/dsh-plugin-crosspet')
  const bundled = fs.readFileSync(path.join(dir, 'lib/index.js'), 'utf8').match(/PLUGIN_VERSION = "([^"]+)"/)[1]
  assert.match(bundled, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, bundled)
})

test('装过 beta.2（插件 1.3.8.1）的人也会被提醒更新，好把错的版本号换掉', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../integrations/deepseek/dsh-plugin-crosspet/lib/index.js'), 'utf8')
  const bundled = src.match(/PLUGIN_VERSION = "([^"]+)"/)[1]
  assert.equal(advice(p('1.3.8.1', '1.3.8.1', bundled)).kind, 'update')
})
