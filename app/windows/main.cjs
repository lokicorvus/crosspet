'use strict';
const { app, BrowserWindow, Menu, Tray, ipcMain, screen, shell, dialog, clipboard, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFile } = require('node:child_process');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const core = require('./core.cjs');

// Chromium child processes cannot start from some Windows network providers (e.g. Parallels).
// Hand off before Electron initializes GPU/renderer processes; keep the local app sandbox enabled.
if (app.isPackaged && core.isSharedExecutable(process.execPath)) {
  const bootstrapDir = core.paths().data;
  fs.mkdirSync(bootstrapDir, { recursive: true });
  const bootstrapLog = fs.openSync(path.join(bootstrapDir, 'shared-launch.log'), 'a');
  fs.writeSync(bootstrapLog, `${new Date().toISOString()} Shared launch: ${process.execPath}\n`);
  // Finish the native handoff before Chromium begins asynchronous GPU initialization.
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'shared-launch.ps1'), '-PackageDirectory', path.dirname(process.execPath)],
    { windowsHide: true, stdio: ['ignore', bootstrapLog, bootstrapLog], cwd: process.env.TEMP || process.env.SystemRoot });
  fs.writeSync(bootstrapLog, `Helper exit: ${result.status}; ${result.error?.message || ''}\n`);
  fs.closeSync(bootstrapLog);
  if (result.error) dialog.showErrorBox('CrossPet 启动失败', `请将整个文件夹复制到 Windows 本地磁盘后运行。\n${result.error.message}`);
  app.exit(result.status || (result.error ? 1 : 0));
  return;
}

const source = path.resolve(__dirname, '../..');
const smokeIndex = process.argv.indexOf('--smoke-test');
const smokeDir = smokeIndex >= 0 ? path.resolve(process.argv[smokeIndex + 1] || 'crosspet-smoke') : null;
if (smokeDir) {
  process.env.CROSSPET_DATA_DIR = path.join(smokeDir, 'data');
  process.env.CROSSPET_STATE_DIR = path.join(smokeDir, 'state');
}
const dirs = core.paths();
fs.mkdirSync(dirs.data, { recursive: true });
fs.mkdirSync(dirs.state, { recursive: true });
app.setPath('userData', path.join(dirs.data, 'browser'));
const settingsFile = path.join(dirs.data, 'settings.json');
const settings = { followEvents: true, followApps: true, names: {}, ...core.readJSON(settingsFile, {}) };
let pet, dev, renameWindow, tray, foreground, drag, manifest, ready = false, paused = false;
let startupFailureShown = false;
let selected = settings.character || 'claude', stamps = new Map(), focusTimer, lastForeground = '', quitting = false;
const timers = [];
const log = text => fs.appendFileSync(path.join(dirs.data, 'windows.log'), `${new Date().toISOString()} ${text}\n`);
const save = () => core.writeJSON(settingsFile, settings);
const python = path.join(source, 'runtime', 'python', 'python.exe');
const feedback = path.join(dirs.data, 'feedback.txt');
function call(window, fn, ...args) {
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  return window.webContents.executeJavaScript(`${fn}(${args.map(v => JSON.stringify(v)).join(',')})`).catch(e => { log(`${fn}: ${e.message}`); return null; });
}
function secureWindow(win, file) {
  const expected = pathToFileURL(file).href;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== expected) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('preload-error', (_, __, err) => log(`preload: ${err.message}`));
  win.webContents.on('render-process-gone', (_, details) => {
    log(`renderer gone: ${JSON.stringify(details)}`);
    if (quitting || win !== pet || startupFailureShown) return;
    startupFailureShown = true;
    const message = `桌宠画面启动失败：${details.reason}。\n日志：${path.join(dirs.data, 'windows.log')}`;
    if (smokeDir) { fs.writeFileSync(path.join(smokeDir, 'failure.txt'), message); app.quit(); return; }
    dialog.showMessageBox({ type: 'error', title: 'CrossPet 启动失败', message, buttons: ['关闭'] }).then(() => app.quit());
  });
}
const prefs = () => ({ preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
  sandbox: true, backgroundThrottling: false });
function syncResources() {
  const chars = path.join(dirs.data, 'characters');
  // 和 macOS 版一样：内置角色每次启动整份覆盖（这样更新后能拿到新立绘）；用户自己加的角色文件夹不动。
  // 想改内置角色，复制一份换个文件夹名再改（见 docs/自定义角色.md）。
  fs.mkdirSync(chars, { recursive: true });
  for (const entry of fs.readdirSync(path.join(source, 'characters'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.rmSync(path.join(chars, entry.name), { recursive: true, force: true });
    fs.cpSync(path.join(source, 'characters', entry.name), path.join(chars, entry.name), { recursive: true,
      filter: src => !/[\\/]raw([\\/]|$)/.test(src) });
  }
  for (const file of fs.readdirSync(path.join(source, 'characters')).filter(f => f.endsWith('.md')))
    fs.copyFileSync(path.join(source, 'characters', file), path.join(chars, file));
  const mappings = path.join(dirs.data, 'windows-apps.json');
  if (!fs.existsSync(mappings)) fs.copyFileSync(path.join(__dirname, 'apps.json'), mappings);
  fs.copyFileSync(path.join(source, 'integrations', 'crosspet-hook.py'), path.join(dirs.data, 'crosspet-hook.py'));
  manifest = core.loadCharacters(chars, settings.names);
}
function switchTo(id) {
  if (!manifest.characters[id] || manifest.characters[id].egg) return;
  selected = id; settings.character = id; save();
  return call(pet, 'setCharacter', id);
}
async function poll() {
  if (!ready) return;
  const ids = Object.keys(manifest.characters).filter(id => !manifest.characters[id].egg);
  const updates = core.readUpdates(dirs.state, ids, stamps);
  if (!paused && settings.followEvents) {
    const active = updates.filter(u => u.kind === 'state' && !['idle', 'sleeping'].includes(u.value.pose)
      && Date.now() / 1000 - u.value.ts < 30).at(-1);
    if (active && active.id !== selected) switchTo(active.id);
  }
  for (const u of updates) {
    call(dev, 'logEvent', u.id, u.kind, u.value, paused);
    if (!paused) await call(pet, u.kind === 'state' ? 'applyCharState' : 'setQuota', u.id, u.value);
  }
}
function startForeground() {
  if (process.platform !== 'win32') return;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  foreground = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'foreground.ps1')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  readline.createInterface({ input: foreground.stdout }).on('line', line => {
    lastForeground = line.trim().toLowerCase(); clearTimeout(focusTimer); keepOnTop();
    focusTimer = setTimeout(() => {
      if (!ready || paused || !settings.followApps) return;
      const mapping = core.readJSON(path.join(dirs.data, 'windows-apps.json'), {});
      const id = mapping[lastForeground]; if (id && id !== selected) switchTo(id);
    }, 500);
  });
  foreground.stderr.on('data', () => log('Foreground helper reported an error; event following remains available.'));
  foreground.on('error', e => log(`Foreground unavailable: ${e.message}`));
  foreground.on('exit', code => { if (!quitting) log(`Foreground helper exited: ${code}`); });
}
// 普通的「置顶」级别会被其他激活的窗口盖住：用最高的 screen-saver 级别，并在每次切换前台窗口时重新置顶一次
function keepOnTop() {
  if (!pet || pet.isDestroyed()) return;
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.moveTop();
}
function refreshQuota() { if (ready && settings.gptQuota) call(pet, 'setQuota', 'gpt', core.codexQuota(dirs.codex)); }
function recenter() {
  const p = core.clampPosition(null, [screen.getPrimaryDisplay().workArea]); pet.setPosition(p.x, p.y);
  settings.position = p; save();
}
function openDev() {
  if (dev && !dev.isDestroyed()) { dev.show(); return; }
  dev = new BrowserWindow({ width: 1060, height: 760, title: 'CrossPet 开发者控制台', autoHideMenuBar: true, webPreferences: prefs() });
  const file = path.join(source, 'app/web/devconsole.html'); secureWindow(dev, file);
  dev.webContents.once('did-finish-load', () => {
    call(dev, 'setAppInfo', { version: `${app.getVersion()} Windows preview`, feedbackPath: feedback });
    call(dev, 'boot', manifest);
  });
  dev.on('closed', () => { dev = null; paused = false; call(pet, 'devRelease'); });
  dev.loadFile(file);
}
function rename() {
  if (renameWindow && !renameWindow.isDestroyed()) { renameWindow.focus(); return; }
  renameWindow = new BrowserWindow({ width: 360, height: 210, resizable: false, autoHideMenuBar: true, title: 'CrossPet 改名', webPreferences: prefs() });
  renameWindow.character = selected;
  const file = path.join(__dirname, 'rename.html'); secureWindow(renameWindow, file); renameWindow.loadFile(file);
  renameWindow.on('closed', () => { renameWindow = null; });
}
function integrate(action, target) {
  if (!fs.existsSync(python)) { dialog.showErrorBox('未找到随包 Python', '请使用 build:windows 生成的完整目录，或在源码目录使用 Python 运行 tools/integrate.py。'); return; }
  execFile(python, [path.join(source, 'tools/integrate.py'), action, target], {
    windowsHide: true, timeout: 15000, env: { ...process.env, PYTHONUTF8: '1', CROSSPET_DATA_DIR: dirs.data, CROSSPET_STATE_DIR: dirs.state },
  }, (err, stdout, stderr) => dialog.showMessageBox({ type: err ? 'error' : 'info', title: 'CrossPet AI 接入',
    message: err ? '接入操作未完成' : '接入配置已更新', detail: `${stdout || ''}\n${stderr || ''}`.trim() || String(err || ''), buttons: ['确定'] }));
}
// 每天查一次 GitHub 上最新的 Release（只读公开的版本号，不发送任何数据），和 macOS 版一样
let latestRelease = null;
const newer = (tag, current) => {
  const a = tag.replace(/^v/i, '').split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
};
async function checkForUpdate() {
  try {
    const r = await fetch('https://api.github.com/repos/lokicorvus/crosspet/releases/latest', { headers: { 'User-Agent': 'CrossPet' } });
    if (!r.ok) return;
    const { tag_name: tag, html_url: url } = await r.json();
    if (typeof tag !== 'string' || !newer(tag, app.getVersion())) return;
    const first = latestRelease?.tag !== tag;
    latestRelease = { tag, url: typeof url === 'string' && url.startsWith('https://github.com/') ? url : 'https://github.com/lokicorvus/crosspet/releases/latest' };
    if (first) call(pet, 'notifyUpdate', tag);
  } catch (e) { log(`update check: ${e.message}`); }
}
function menu(developer = false) {
  const toggler = (label, key) => ({ label, type: 'checkbox', checked: !!settings[key], click: item => {
    settings[key] = item.checked; save();
    if (key === 'gptQuota') { if (item.checked) refreshQuota(); else call(pet, 'setQuota', 'gpt', null); }
  } });
  return Menu.buildFromTemplate([
    ...(latestRelease ? [{ label: `⬆️ 有新版本 ${latestRelease.tag}，点这里下载`, click: () => shell.openExternal(latestRelease.url) }, { type: 'separator' }] : []),
    { label: '摸摸头', click: () => call(pet, 'handleClick', 'pat') },
    { label: '戳一下', click: () => call(pet, 'handleClick', 'poke') },
    { label: '召唤彩蛋', click: () => call(pet, 'playEgg', true) },
    { type: 'separator' },
    ...Object.entries(manifest.characters).filter(([, c]) => !c.egg).map(([id, c]) => ({ label: `换成 ${c.name}`, type: 'radio', checked: selected === id, click: () => switchTo(id) })),
    { label: '给当前角色改名…', click: rename },
    { type: 'separator' },
    toggler('跟随前台 AI 应用', 'followApps'), toggler('跟随 AI 工作事件（含终端）', 'followEvents'),
    toggler('显示 GPT 额度（读取本机 Codex 会话）', 'gptQuota'),
    { label: '登录时自动启动', type: 'checkbox', enabled: app.isPackaged && !smokeDir,
      checked: app.isPackaged && !smokeDir && app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }) },
    { label: '接入 AI', submenu: [['claude-hooks', 'Claude Code'], ['codex', 'Codex'], ['deepseek', 'DeepSeek Harness'],
      ['antigravity', 'Antigravity'], ['gemini', 'Gemini CLI']].map(([target, label]) => ({ label,
      submenu: [{ label: '接入 / 更新', click: () => integrate('install', target) }, { label: '撤销接入', click: () => integrate('uninstall', target) }] })) },
    { type: 'separator' },
    { label: '打开角色文件夹', click: () => shell.openPath(path.join(dirs.data, 'characters')) },
    { label: '打开设置和状态目录', click: () => shell.openPath(dirs.data) },
    { label: '移回主屏幕', click: recenter },
    ...(developer ? [{ label: '开发者控制台…', click: openDev }] : []),
    { label: `检查更新（当前 ${app.getVersion()}）`, click: () => shell.openExternal('https://github.com/lokicorvus/crosspet/releases/latest') },
    { type: 'separator' }, { label: '退出', click: () => app.quit() },
  ]);
}
ipcMain.on('menu', (event, opts) => { if (event.sender === pet?.webContents) menu(!!opts?.developer).popup({ window: pet }); });
ipcMain.on('drag', (event, phase) => {
  if (event.sender !== pet?.webContents) return;
  if (smokeDir) log(`drag ${phase} moved=${drag?.moved}`);
  if (phase === 'start') drag = { cursor: screen.getCursorScreenPoint(), bounds: pet.getBounds(), moved: false };
  else if (drag && ['move', 'end'].includes(phase)) {
    const p = screen.getCursorScreenPoint(), dx = p.x - drag.cursor.x, dy = p.y - drag.cursor.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) pet.setPosition(drag.bounds.x + dx, drag.bounds.y + dy);
    if (phase === 'end') {
      if (!drag.moved) call(pet, 'handleClick', 'pat');
      else { settings.position = { x: pet.getBounds().x, y: pet.getBounds().y }; save(); }
      drag = null;
    }
  } else if (phase === 'cancel') {
    // Windows transparent windows can emit pointercancel instead of pointerup after moving.
    // Keep the final position, but never turn a cancelled gesture into a click.
    if (drag?.moved) { settings.position = { x: pet.getBounds().x, y: pet.getBounds().y }; save(); }
    drag = null;
  }
});
ipcMain.on('rename', (event, name) => {
  if (event.sender !== renameWindow?.webContents || typeof name !== 'string') return;
  const id = renameWindow.character; settings.names[id] = name.trim().slice(0, 40); save();
  syncResources(); call(pet, 'setName', id, manifest.characters[id].name); call(dev, 'boot', manifest); renameWindow.close();
});
ipcMain.on('dev', async (event, msg) => {
  if (event.sender !== dev?.webContents || !msg || typeof msg !== 'object') return;
  switch (msg.cmd) {
    // Existing local developer console sends JS expressions. No Node access in either renderer.
    case 'pet': if (typeof msg.code === 'string') pet.webContents.executeJavaScript(msg.code).catch(e => log(`dev: ${e.message}`)); break;
    case 'status': call(dev, 'onPetStatus', await call(pet, 'devStatus')); break;
    case 'pause': paused = !!msg.on; break;
    case 'save': if (typeof msg.text === 'string' && msg.text.length < 1_000_000) {
      fs.writeFileSync(feedback, msg.text); clipboard.writeText(msg.text); call(dev, 'onSaved', feedback);
    } break;
    case 'reveal': if (fs.existsSync(feedback)) shell.showItemInFolder(feedback); break;
    case 'reload': ready = false; pet.reload(); break;
  }
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) { recenter(); pet.showInactive(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // All content is local; only the explicit release-menu action opens a browser.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
    syncResources();
    const pos = core.clampPosition(settings.position, screen.getAllDisplays().map(d => d.workArea));
    pet = new BrowserWindow({ ...pos, width: 260, height: 362, transparent: true, backgroundColor: '#00000000',
      frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, webPreferences: prefs() });
    pet.setAlwaysOnTop(true, 'screen-saver');
    pet.setVisibleOnAllWorkspaces(true);
    const file = path.join(source, 'app/web/index.html'); secureWindow(pet, file);
    pet.webContents.on('did-finish-load', async () => {
      await call(pet, 'init', manifest); await switchTo(selected); ready = true; stamps.clear();
      await poll(); refreshQuota(); pet.showInactive(); keepOnTop();
    });
    pet.loadFile(file);
    tray = new Tray(path.join(source, 'app/icon/AppIcon.png')); tray.setToolTip('CrossPet · Windows 预览版');
    tray.on('right-click', () => tray.popUpContextMenu(menu())); tray.on('double-click', () => { recenter(); pet.showInactive(); });
    screen.on('display-removed', () => { const p = core.clampPosition(pet.getBounds(), screen.getAllDisplays().map(d => d.workArea)); pet.setPosition(p.x, p.y); });
    timers.push(setInterval(() => poll().catch(e => log(e.message)), 300), setInterval(refreshQuota, 60000),
      setInterval(checkForUpdate, 24 * 3600 * 1000));
    if (!smokeDir) setTimeout(checkForUpdate, 20000);
    startForeground();
    if (smokeDir) require('./smoke.cjs').run({ app, pet, dirs, source, smokeDir, poll, switchTo, openDev,
      foregroundName: () => lastForeground }).catch(e => {
      fs.writeFileSync(path.join(smokeDir, 'failure.txt'), e.stack); process.exitCode = 1; app.quit();
    });
  }).catch(e => { log(e.stack); dialog.showErrorBox('CrossPet 启动失败', e.message); app.exit(1); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true; for (const timer of timers) clearInterval(timer); clearTimeout(focusTimer);
  foreground?.kill(); tray?.destroy();
});
