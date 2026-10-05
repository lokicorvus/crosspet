'use strict';
// Explicit --smoke-test only: isolated data, real bundled Python, rendered image checks.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const core = require('./core.cjs');
const { screen, BrowserWindow } = require('electron');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function processRun(exe, args, options, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { ...options, windowsHide: true }); let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${exe}`)); }, 20000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`${exe} exited ${code}: ${stderr}\n${stdout}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
exports.run = async ({ app, pet, dirs, source, smokeDir, poll, switchTo, openDev, foregroundName }) => {
  const report = { platform: process.platform, arch: process.arch, versions: process.versions, checks: [] };
  const check = (name, detail) => { report.checks.push({ name, detail, passed: true }); fs.writeFileSync(path.join(smokeDir, 'progress.json'), JSON.stringify(report, null, 2)); };
  const js = code => pet.webContents.executeJavaScript(code);
  for (let i = 0; i < 100; i++) { if (!pet.webContents.isLoading() && await js('typeof charId !== "undefined" && !!charId')) break; await sleep(100); }
  await sleep(800);
  assert.equal(pet.isAlwaysOnTop(), true); assert.equal(pet.isFocusable(), false); assert.equal(pet.isVisible(), true);
  check('native-window', { alwaysOnTop: true, focusable: false, bounds: pet.getBounds() });
  await js('void (Math.random = () => 0.5)'); // stable smoke screenshots and clicks
  for (const id of ['claude', 'gpt', 'deepseek', 'gemini']) {
    await switchTo(id); await sleep(850);
    const image = await js('({id:charId, loaded:active.complete && active.naturalWidth > 0, caption:document.getElementById("caption").textContent})');
    assert.equal(image.id, id); assert.equal(image.loaded, true);
    fs.writeFileSync(path.join(smokeDir, `${id}.png`), (await pet.webContents.capturePage()).toPNG());
    check(`render-${id}`, image);
  }
  const bitmap = (await pet.webContents.capturePage()).toBitmap();
  let transparent = 0, opaque = 0;
  for (let i = 3; i < bitmap.length; i += 4) { if (bitmap[i] === 0) transparent++; if (bitmap[i] === 255) opaque++; }
  assert.ok(transparent > 0 && opaque > 0); check('transparent-pixels', { transparent, opaque });
  const python = path.join(source, 'runtime/python/python.exe');
  const hook = path.join(source, 'integrations/crosspet-hook.py');
  const opts = { env: { ...process.env, PYTHONUTF8: '1' } };
  for (const [event, tool, pose] of [['UserPromptSubmit', '', 'listening'], ['PreToolUse', 'write_file', 'writing'], ['Stop', '', 'happy']]) {
    await processRun(python, [hook, 'gpt'], opts, JSON.stringify({ hook_event_name: event, tool_name: tool }));
    await poll(); await sleep(pose === 'listening' ? 700 : 2800);
    const status = await js('devStatus()'); assert.equal(status.charId, 'gpt'); assert.equal(status.pose, pose);
    check(`hook-${event}`, status.pose);
  }
  core.writeJSON(path.join(dirs.state, 'gpt-quota.json'), { text: '测试额度 剩余 7%', low: true });
  await poll(); assert.equal(await js('document.getElementById("quota").textContent'), '测试额度 剩余 7%');
  check('quota-file', true);
  await js("devShow('gpt','writing','Windows 钩子已连接')"); await sleep(600);
  fs.writeFileSync(path.join(smokeDir, 'hook-writing.png'), (await pet.webContents.capturePage()).toPNG());
  await js('devRelease()');
  // Exercise preload/IPC through Chromium input dispatch, not direct handleClick().
  pet.webContents.sendInputEvent({ type: 'mouseDown', x: 130, y: 200, button: 'left', clickCount: 1 });
  pet.webContents.sendInputEvent({ type: 'mouseUp', x: 130, y: 200, button: 'left', clickCount: 1 });
  await sleep(500); assert.equal((await js('devStatus()')).pose, 'pat'); check('click-preload-ipc', true);
  // Real Win32 pointer input: verify DPI-aware dragging and that the pet never activates.
  if (process.platform === 'win32') {
    const before = pet.getBounds();
    const from = screen.dipToScreenPoint({ x: before.x + 130, y: before.y + 200 });
    const to = screen.dipToScreenPoint({ x: before.x + 80, y: before.y + 170 });
    const driver = `import ctypes,time,json
u=ctypes.windll.user32
u.SetProcessDPIAware()
u.GetForegroundWindow.restype=ctypes.c_void_p
old=u.GetForegroundWindow()
u.SetCursorPos(${from.x},${from.y})
time.sleep(.2)
u.mouse_event(2,0,0,0,0)
time.sleep(.2)
u.SetCursorPos(${to.x},${to.y})
time.sleep(.3)
u.mouse_event(4,0,0,0,0)
time.sleep(.2)
print(json.dumps({'before':old,'after':u.GetForegroundWindow()}))`;
    const focus = JSON.parse(await processRun(python, ['-c', driver], opts));
    await sleep(300);
    const after = pet.getBounds();
    assert.equal(after.x, before.x - 50); assert.equal(after.y, before.y - 30);
    assert.equal(focus.after, focus.before);
    assert.deepEqual(core.readJSON(path.join(dirs.data, 'settings.json')).position, { x: after.x, y: after.y });
    check('native-drag-dpi-focus-persistence', { before, after, focusUnchanged: true });
  }
  // Each install/remove runs with a fake user profile; no real AI configuration is touched.
  const home = path.join(smokeDir, 'fake user'); fs.mkdirSync(home, { recursive: true });
  const env = { ...opts.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex') };
  const integrator = path.join(source, 'tools/integrate.py');
  const expected = { 'claude-hooks': '.claude/settings.json', codex: '.codex/hooks.json', gemini: '.gemini/settings.json', antigravity: '.gemini/config/hooks.json' };
  for (const [target, rel] of Object.entries(expected)) {
    await processRun(python, [integrator, 'install', target], { env });
    const file = path.join(home, rel), first = fs.readFileSync(file, 'utf8');
    await processRun(python, [integrator, 'install', target], { env }); assert.equal(fs.readFileSync(file, 'utf8'), first);
    const data = JSON.parse(first);
    const find = obj => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.command) return obj.command;
      for (const value of Object.values(obj)) { const c = find(value); if (c) return c; }
      return null;
    };
    const command = find(data); assert.ok(command.includes('crosspet-hook.py')); assert.ok(!command.includes('$HOME'));
    // Same cmd.exe parsing used by native Windows command hooks, including spaces in paths.
    await processRun(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { env, windowsVerbatimArguments: true }, JSON.stringify({ hook_event_name: 'SessionStart' }));
    await processRun(python, [integrator, 'uninstall', target], { env });
    assert.ok(!fs.readFileSync(file, 'utf8').includes('crosspet-hook.py'));
    check(`integration-${target}`, 'install / repeat / command execution / uninstall');
  }
  // Check actual foreground notifications with a known test window, not an AI login.
  const probePath = path.join(smokeDir, 'CrossPetProbe.exe');
  await processRun('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(source, 'app/windows/foreground-probe.ps1'), '-Output', probePath], opts);
  const mappingFile = path.join(dirs.data, 'windows-apps.json'), mapping = core.readJSON(mappingFile);
  core.writeJSON(mappingFile, { ...mapping, 'crosspetprobe.exe': 'deepseek' });
  await switchTo('claude'); await sleep(600);
  const probe = spawn(probePath, [], { windowsHide: false, stdio: 'ignore' });
  try {
    let status;
    for (let i = 0; i < 60; i++) {
      await sleep(100); status = await js('devStatus()');
      if (foregroundName() === 'crosspetprobe.exe' && status.charId === 'deepseek') break;
    }
    assert.equal(foregroundName(), 'crosspetprobe.exe'); assert.equal(status.charId, 'deepseek');
    check('foreground-switch', { process: 'CrossPetProbe.exe', character: status.charId });
  } finally { probe.kill(); core.writeJSON(mappingFile, mapping); }
  openDev(); await sleep(1800);
  const dev = BrowserWindow.getAllWindows().find(w => w !== pet);
  assert.ok(dev);
  assert.equal(await dev.webContents.executeJavaScript('typeof boot'), 'function');
  fs.writeFileSync(path.join(smokeDir, 'developer-console.png'), (await dev.webContents.capturePage()).toPNG());
  check('developer-console-open', true);
  assert.ok(foregroundName()); check('foreground-helper', foregroundName());
  fs.writeFileSync(path.join(smokeDir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
};
