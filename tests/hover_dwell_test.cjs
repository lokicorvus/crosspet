// node tests/hover_dwell_test.cjs — fake clock, no browser or pointer polling.
const assert = require('node:assert/strict')
const {create, normalizeDelay} = require('../app/web/hover-dwell.js')
const {resolve} = require('../app/web/hover-themes.js')

function fixture() {
  let now = 0, next = 0, opened = 0, visible = true
  const timers = new Map()
  const dwell = create({
    open: () => opened++, visible: () => visible,
    schedule: (fn, delay) => { const id = ++next; timers.set(id, {fn, at: now + delay}); return id },
    cancel: id => timers.delete(id),
  })
  function advance(ms) {
    now += ms
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn() }
  }
  return {dwell, advance, timers, opened: () => opened, hide: () => { visible = false }}
}

assert.deepEqual([undefined, '2000', NaN, Infinity].map(normalizeDelay), [3000, 3000, 3000, 3000])
assert.deepEqual([-1, 3250, 999999].map(normalizeDelay), [1000, 3500, 10000])

// Unsupported hosts and default settings cannot open a menu.
{
  const f = fixture(); f.dwell.enter(); f.advance(60000)
  assert.equal(f.opened(), 0); assert.equal(f.timers.size, 0)
}
// One continuous dwell, no duplicate timers or reopen while stationary.
{
  const f = fixture(); f.dwell.configure({enabled: true}); f.dwell.enter(); f.dwell.enter()
  assert.equal(f.timers.size, 1)
  f.advance(2999); assert.equal(f.opened(), 0)
  f.advance(1); assert.equal(f.opened(), 1)
  f.advance(60000); assert.equal(f.opened(), 1); assert.equal(f.timers.size, 0)
  f.dwell.dismiss(); f.dwell.enter(); f.advance(4000); assert.equal(f.opened(), 1)
  f.dwell.leave(); f.dwell.enter(); f.advance(3000); assert.equal(f.opened(), 2)
}
// Leaving early and dragging/clicking cancel; release alone cannot arm it again.
{
  const f = fixture(); f.dwell.configure({enabled: true}); f.dwell.enter()
  f.advance(2000); f.dwell.leave(); f.advance(5000); assert.equal(f.opened(), 0)
  f.dwell.enter(); f.advance(2000); f.dwell.press(); f.advance(5000); assert.equal(f.opened(), 0)
  f.dwell.enter(); f.advance(5000); assert.equal(f.opened(), 0)
  f.dwell.leave(); f.dwell.enter(); f.advance(3000); assert.equal(f.opened(), 1)
}
// Turning off cancels a pending request; a changed delay starts a fresh dwell.
{
  const f = fixture(); f.dwell.configure({enabled: true}); f.dwell.enter(); f.advance(2000)
  f.dwell.configure({enabled: false}); f.advance(5000); assert.equal(f.opened(), 0)
  f.dwell.configure({enabled: true, delayMs: 1500}); f.advance(1000)
  f.dwell.configure({enabled: true, delayMs: 5000}); f.advance(4999); assert.equal(f.opened(), 0)
  f.advance(1); assert.equal(f.opened(), 1)
}
// Blur, hidden pages, and native dismissals cannot trigger a late opening.
for (const action of ['suspend', 'dismiss']) {
  const f = fixture(); f.dwell.configure({enabled: true}); f.dwell.enter(); f.advance(2000)
  f.dwell[action](); f.advance(5000); assert.equal(f.opened(), 0)
}
{
  const f = fixture(); f.dwell.configure({enabled: true}); f.dwell.enter(); f.hide()
  f.advance(4000); assert.equal(f.opened(), 0)
}

for (const role of ['claude', 'deepseek', 'gpt', 'gemini', 'glm', 'grok', 'qwen']) {
  assert.equal(resolve(role).id, role)
  assert.equal(resolve(role + '-custom-skin').id, role)
  assert.equal(resolve('egg-' + role).id, role)
}
assert.equal(resolve('unknown-character').id, 'claude')
console.log('PASS hover dwell: default off, delay, rearm, cancellation, visibility, seven themes and skins')
