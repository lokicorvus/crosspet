'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../app/windows/core.cjs');
const root = path.resolve(__dirname, '..');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crosspet-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('Windows state path is per-user; explicit overrides work', () => {
  const p = core.paths({ LOCALAPPDATA: '/users/test/local' }, 'win32', '/users/test');
  assert.equal(p.state, path.join('/users/test/local', 'CrossPet/state'));
  assert.equal(core.paths({ CROSSPET_DATA_DIR: '/custom', CROSSPET_STATE_DIR: '/bridge' }, 'win32').state, '/bridge');
});
test('all four real characters and three eggs load with encoded file URLs', () => {
  const m = core.loadCharacters(path.join(root, 'characters'));
  assert.equal(Object.keys(m.characters).length, 7);
  assert.equal(Object.values(m.characters).filter(c => !c.egg).length, 4);
  assert.ok(m.characters.gpt.poses.idle[0].startsWith('file:'));
});
test('missing monitor and invalid saved bounds recover on-screen', () => {
  const d = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(core.clampPosition({ x: 5000, y: -800 }, d), { x: 1660, y: 0 });
  assert.deepEqual(core.clampPosition({ x: NaN, y: NaN }, d), { x: 1620, y: 638 });
});
test('partial JSON retries, duplicate polls deduplicate, stale state is ignored', t => {
  const dir = temp(t), file = path.join(dir, 'gpt-state.json'), stamps = new Map();
  fs.writeFileSync(file, '{'); assert.equal(core.readUpdates(dir, ['gpt'], stamps).length, 0); assert.equal(stamps.size, 0);
  core.writeJSON(file, { pose: 'writing', ts: Date.now() / 1000 });
  assert.equal(core.readUpdates(dir, ['gpt'], stamps).length, 1);
  assert.equal(core.readUpdates(dir, ['gpt'], stamps).length, 0);
  fs.utimesSync(file, 1, 1); stamps.clear(); assert.equal(core.readUpdates(dir, ['gpt'], stamps).length, 0);
});
test('quota reader handles partial first line and newest usable limit event', () => {
  const q = core.parseQuota('broken\n' + JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 93, window_minutes: 300, resets_at: 123 } } } }) + '\n{}');
  assert.equal(q.text, '5小时 剩余 7%'); assert.equal(q.low, true); assert.equal(q.windows[0].reset, 123);
  assert.equal(core.parseQuota('{"rate_limits":{}}'), null);
});
test('real Python hook produces consumable state through a path containing spaces', t => {
  const dir = path.join(temp(t), 'state with spaces');
  const exe = process.env.CROSSPET_TEST_PYTHON || 'python3';
  const result = spawnSync(exe, [path.join(root, 'integrations/crosspet-hook.py'), 'gpt'], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'write_file' }),
    env: { ...process.env, CROSSPET_STATE_DIR: dir }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const updates = core.readUpdates(dir, ['gpt'], new Map()); assert.equal(updates[0].value.pose, 'writing');
});

test('shared launch guard recognizes UNC but permits local and extended-local paths', () => {
  const slash = String.fromCharCode(92);
  assert.equal(core.isSharedExecutable(slash.repeat(2) + 'Mac' + slash + 'Home' + slash + 'CrossPet.exe', 'win32'), true);
  assert.equal(core.isSharedExecutable('//server/share/CrossPet.exe', 'win32'), true);
  assert.equal(core.isSharedExecutable(slash.repeat(2) + '?' + slash + 'UNC' + slash + 'server' + slash + 'CrossPet.exe', 'win32'), true);
  assert.equal(core.isSharedExecutable(slash.repeat(2) + '?' + slash + 'C:' + slash + 'CrossPet.exe', 'win32'), false);
  assert.equal(core.isSharedExecutable('C:/Apps/CrossPet.exe', 'win32'), false);
  assert.equal(core.isSharedExecutable('//server/share/CrossPet', 'darwin'), false);
});
