// Real Windows/Electron integration check; does not touch the user's settings or hooks.
const { app, BrowserWindow, screen, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const build = path.resolve(__dirname, '../../../build');
fs.mkdirSync(build, { recursive: true });
const profile = fs.mkdtempSync(path.join(build, 'smoke-'));
process.env.CROSSPET_HOME = profile;
process.env.CROSSPET_STATE_DIR = path.join(profile, 'state');
const failures = [];
let copiedText;
clipboard.writeText = text => { copiedText = text; }; // Do not replace the user's clipboard during a test.
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _file, error) => failures.push(error.message));
  contents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') failures.push(details.reason); });
});
const host = require('../main.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await wait(100); }
  throw new Error(`Timed out waiting for Windows UI: ${check.toString()}`);
}

app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/index.html')));
  const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
  const evaluate = code => pet.webContents.executeJavaScript(code);
  await until(async () => !!(await evaluate('typeof devStatus === "function" && devStatus().charId')));
  assert.equal(pet.isAlwaysOnTop(), true);
  assert.equal(pet.isFocusable(), false);
  assert.deepEqual(await evaluate('[typeof require, typeof process]'), ['undefined', 'undefined']);
  assert.equal(pet.webContents.getLastWebPreferences().sandbox, true);
  await evaluate("window.crosspet.dev({cmd:'save', text:'must not be accepted from pet'})");
  await wait(100);
  assert.equal(fs.existsSync(path.join(profile, 'dev-feedback.md')), false);

  const origin = pet.getPosition();
  const from = screen.dipToScreenPoint({ x: origin[0] + 130, y: origin[1] + 180 });
  const to = screen.dipToScreenPoint({ x: origin[0] + 160, y: origin[1] + 200 });
  const restore = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  await new Promise((resolve, reject) => {
    const mouse = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'drag.ps1'), '-FromX', String(from.x), '-FromY', String(from.y), '-ToX', String(to.x), '-ToY', String(to.y), '-RestoreX', String(restore.x), '-RestoreY', String(restore.y)], { windowsHide: true, stdio: 'ignore' });
    mouse.on('error', reject); mouse.on('exit', code => code === 0 ? resolve() : reject(new Error('Mouse fixture failed')));
  });
  await wait(100);
  assert.deepEqual(pet.getPosition(), [origin[0] + 30, origin[1] + 20], 'Native Windows drag must move the window');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).position, pet.getPosition());

  const choices = host.menuTemplate().find(item => item.submenu).submenu;
  assert.equal(choices.length, 4);
  for (const choice of choices) {
    choice.click();
    await wait(650);
    assert.equal(await evaluate("document.getElementById('caption').textContent"), choice.label);
    assert.equal(await evaluate("active.complete && active.naturalWidth > 0"), true);
  }

  // A real hook process writes a real file which the running window must consume.
  choices.find(item => item.label === 'GPT').click(); await wait(700);
  const hook = path.resolve(__dirname, '../../../integrations/crosspet-hook.py');
  const result = spawnSync('python', [hook, 'gpt'], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'read_file' }), encoding: 'utf8', env: process.env, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  await until(async () => (await evaluate('devStatus().pose')) === 'reading', 6000);
  fs.writeFileSync(path.join(profile, 'state/gpt-quota.json'), '{"text":"Test quota 5%","low":true}');
  await until(async () => (await evaluate('devStatus().quota.gpt?.low')) === true);
  await wait(400);
  const image = await pet.webContents.capturePage();
  fs.writeFileSync(path.join(build, 'windows-smoke.png'), image.toPNG());
  assert.ok(image.getSize().width >= 260);
  const pixels = image.toBitmap();
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value === 0), 'Window must have transparent pixels');
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 200), 'Character must be visible');

  // Exercise the actual Win32 foreground watcher using an Electron test window.
  const gptFile = path.join(profile, 'characters/gpt/character.json');
  const gpt = JSON.parse(fs.readFileSync(gptFile, 'utf8')); gpt.windowsApps = ['electron.exe'];
  fs.writeFileSync(gptFile, JSON.stringify(gpt));
  choices.find(item => item.label === 'Claude').click();
  pet.reload(); await wait(900);
  const focusWindow = new BrowserWindow({ width: 200, height: 100, title: 'CrossPet focus test' });
  await focusWindow.loadURL('data:text/html,CrossPet foreground test'); focusWindow.show(); focusWindow.focus();
  await until(async () => (await evaluate('devStatus().charId')) === 'gpt');
  focusWindow.close();

  host.menuTemplate().find(item => item.label?.startsWith('Rename')).click();
  await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/rename.html')));
  const rename = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/rename.html'));
  await until(() => !rename.webContents.isLoading());
  await rename.webContents.executeJavaScript('window.crosspet.rename("Windows dragon")');
  await until(async () => (await evaluate("document.getElementById('caption').textContent")) === 'Windows dragon');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).names.gpt, 'Windows dragon');

  host.openDevConsole();
  await until(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/devconsole.html')));
  const dev = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/devconsole.html'));
  await until(async () => (await dev.webContents.executeJavaScript('typeof manifest !== "undefined" && Object.keys(manifest.characters).length')) === 7);
  await dev.webContents.executeJavaScript(`window.crosspet.dev({cmd:'pet', code:"devShow('gpt', 'drawing', 'Windows test')"})`);
  await until(async () => (await evaluate('devStatus().pose')) === 'drawing');
  await dev.webContents.executeJavaScript("window.crosspet.dev({cmd:'save', text:'CrossPet Windows smoke test'})");
  await until(() => fs.existsSync(path.join(profile, 'dev-feedback.md')));
  assert.equal(fs.readFileSync(path.join(profile, 'dev-feedback.md'), 'utf8'), 'CrossPet Windows smoke test');
  assert.equal(copiedText, 'CrossPet Windows smoke test');
  dev.close();
  await until(async () => !(await evaluate('devStatus().held')));
  assert.deepEqual(failures, []);
  console.log(`PASS: Windows rendering, transparency, native dragging, hook delivery, quota, foreground detection, rename, developer console, IPC isolation. Screenshot: ${path.join(build, 'windows-smoke.png')}`);
  app.quit();
}).catch(error => {
  console.error(error.stack);
  app.once('will-quit', () => app.exit(1));
  app.quit();
});
