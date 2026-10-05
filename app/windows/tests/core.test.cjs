const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { loadCharacters, changedState, quotaIn, visiblePosition, paths } = require('../core.cjs');

test('all bundled characters, variants, blink frames and eggs load', () => {
  const { characters } = loadCharacters(path.resolve(__dirname, '../../../characters'), { gpt: 'My dragon' });
  assert.equal(Object.keys(characters).length, 7);
  assert.equal(characters.gpt.name, 'My dragon');
  assert.equal(characters.gpt.poses.idle.length, 3);
  assert.ok(characters.gpt.blink.endsWith('/idle-blink.webp'));
  assert.ok(characters.gpt.blinkBase.endsWith('/idle.webp'));
  assert.ok(characters['egg-gpt'].egg);
  assert.ok(characters['egg-gpt'].poses.pop.length);
  for (const c of Object.values(characters)) {
    for (const frames of Object.values(c.poses)) for (const url of frames) assert.ok(fs.existsSync(fileURLToPath(url)));
  }
});

test('state reader retries incomplete writes, rejects stale state and retains quota', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crosspet-test-'));
  try {
    const file = path.join(dir, 'gpt-state.json'), stamps = new Map();
    fs.writeFileSync(file, '{');
    assert.equal(changedState(file, stamps), null);
    assert.equal(stamps.size, 0);
    fs.writeFileSync(file, '{"pose":"reading"}');
    assert.equal(changedState(file, stamps).pose, 'reading');
    assert.equal(changedState(file, stamps), null);
    const past = new Date(Date.now() - 700000);
    fs.utimesSync(file, past, past);
    assert.equal(changedState(file, stamps), null);
    const quota = path.join(dir, 'gpt-quota.json');
    fs.writeFileSync(quota, '{"low":true}'); fs.utimesSync(quota, past, past);
    assert.equal(changedState(quota, stamps).low, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('quota parser reads newest valid rate limits after a partial tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crosspet-test-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    const record = used => JSON.stringify({ payload: { rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 2000000000 } } } });
    fs.writeFileSync(file, `${'中文'.repeat(200000)}\n${record(20)}\n${record(95)}\n{"rate_limits":`);
    const quota = quotaIn(file);
    assert.equal(quota.text, '5小时 剩余 5%');
    assert.equal(quota.low, true);
    assert.equal(quota.windows[0].reset, 2000000000);
    assert.equal(quotaIn(path.join(dir, 'missing')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('saved placement handles negative monitor coordinates and unplugged monitors', () => {
  const screens = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }];
  assert.deepEqual(visiblePosition([-500, 200], screens), { x: -500, y: 200 });
  assert.deepEqual(visiblePosition([6000, 200], screens), { x: 1620, y: 578 });
  assert.deepEqual(visiblePosition([NaN, 0], screens), { x: 1620, y: 578 });
});

test('Windows app and state paths honor explicit overrides', () => {
  const local = path.resolve('test local');
  const temp = path.resolve('test temp');
  assert.equal(paths({ LOCALAPPDATA: local, TEMP: temp }).root, path.join(local, 'CrossPet'));
  assert.equal(paths({ LOCALAPPDATA: local, TEMP: temp }).state, path.join(temp, 'crosspet'));
  assert.equal(paths({ CROSSPET_HOME: local, CROSSPET_STATE_DIR: temp }).state, temp);
});
