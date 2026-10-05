const { app, BrowserWindow, Menu, Tray, ipcMain, screen, shell, clipboard, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { paths, readJSON, loadCharacters, changedState, codexQuota, visiblePosition } = require('./core.cjs');

const bundle = path.resolve(__dirname, '../..');
const locations = paths();
const settingsFile = path.join(locations.root, 'settings.json');
const feedbackFile = path.join(locations.root, 'dev-feedback.md');
const charactersDir = path.join(locations.root, 'characters');
let settings = readJSON(settingsFile, {});
if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
let pet, dev, renameWindow, tray, watcher, manifest, currentId, ready = false, paused = false;
let pendingSwitch, dragTimer, drag, dragged = false;
const timers = [], stamps = new Map();
const json = JSON.stringify;

app.setName('CrossPet');
app.setPath('userData', path.join(locations.root, 'browser'));
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start).catch(error => {
  dialog.showErrorBox('CrossPet could not start', error.message);
  app.quit();
});

function saveSettings() {
  fs.writeFileSync(`${settingsFile}.tmp`, json(settings, null, 2));
  fs.renameSync(`${settingsFile}.tmp`, settingsFile);
}

function js(window, code) {
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  return window.webContents.executeJavaScript(code).catch(error => { console.error(error.message); return null; });
}

function trusted(event, window) {
  return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

function secureWindow(options, file) {
  const window = new BrowserWindow({ ...options, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    backgroundThrottling: false, spellcheck: false,
  } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(file);
  return window;
}

function syncResources() {
  fs.mkdirSync(charactersDir, { recursive: true });
  fs.mkdirSync(locations.state, { recursive: true });
  fs.copyFileSync(path.join(bundle, 'integrations', 'crosspet-hook.py'), path.join(locations.root, 'crosspet-hook.py'));
  // Match macOS: refresh bundled artwork, retain additional custom characters.
  fs.cpSync(path.join(bundle, 'characters'), charactersDir, { recursive: true });
}

function reloadCharacters() {
  manifest = loadCharacters(charactersDir, settings.names);
  const ids = Object.keys(manifest.characters).filter(id => !manifest.characters[id].egg);
  if (!ids.length) throw new Error(`No characters found in ${charactersDir}`);
  if (!ids.includes(currentId)) currentId = ids.includes(settings.character) ? settings.character : ids[0];
  js(pet, `init(${json(manifest)}); setCharacter(${json(currentId)}, true)`);
  js(dev, `boot(${json(manifest)})`);
}

function switchTo(id) {
  if (!manifest.characters[id] || manifest.characters[id].egg) return;
  currentId = id;
  settings.character = id;
  saveSettings();
  js(pet, `setCharacter(${json(id)})`);
}

function pollStates() {
  if (!ready) return;
  for (const [id, info] of Object.entries(manifest.characters)) {
    if (info.egg) continue;
    for (const kind of ['state', 'quota']) {
      const data = changedState(path.join(locations.state, `${id}-${kind}.json`), stamps);
      if (!data) continue;
      js(dev, `logEvent(${json(id)}, ${json(kind)}, ${json(data)}, ${paused})`);
      if (!paused) js(pet, `${kind === 'state' ? 'applyCharState' : 'setQuota'}(${json(id)}, ${json(data)})`);
    }
  }
}

function refreshQuota() {
  if (!ready || !settings.gptQuota || paused) return;
  const quota = codexQuota(locations.codex);
  if (quota) js(pet, `setQuota('gpt', ${json(quota)})`);
}

function watchForeground() {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  watcher = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'foreground.ps1'), '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  watcher.on('error', error => console.error('Foreground watcher:', error.message));
  watcher.stderr.on('data', data => console.error(String(data)));
  readline.createInterface({ input: watcher.stdout }).on('line', name => {
    if (name === '@mouse-up') { endDrag(true); return; }
    clearTimeout(pendingSwitch);
    const id = Object.keys(manifest.characters).findLast(id => {
      const apps = manifest.characters[id].windowsApps;
      return !manifest.characters[id].egg && Array.isArray(apps) && apps.some(appName => typeof appName === 'string' && appName.toLowerCase().replace(/\.exe$/, '') === name.trim().toLowerCase());
    });
    if (!id || id === currentId) return;
    pendingSwitch = setTimeout(() => { if (!paused) switchTo(id); }, 500);
  });
}

function resetPosition() {
  const { x, y } = visiblePosition(null, [screen.getPrimaryDisplay()]);
  pet.setPosition(x, y);
  settings.position = [x, y]; saveSettings();
}

function rename() {
  if (renameWindow && !renameWindow.isDestroyed()) { renameWindow.focus(); return; }
  const id = currentId;
  renameWindow = secureWindow({ width: 360, height: 185, resizable: false, autoHideMenuBar: true, alwaysOnTop: true }, path.join(__dirname, 'rename.html'));
  renameWindow.characterId = id;
  renameWindow.webContents.once('did-finish-load', () => js(renameWindow, `document.getElementById('name').value = ${json(manifest.characters[id].name)}`));
  renameWindow.on('closed', () => { renameWindow = null; });
}

function menuTemplate(advanced = false) {
  return [
    { label: 'Pat / 摸摸头', click: () => js(pet, "handleClick('pat')") },
    { label: 'Poke / 戳一下', click: () => js(pet, "handleClick('poke')") },
    { label: 'Easter egg / 召唤彩蛋', click: () => js(pet, 'playEgg(true)') },
    { type: 'separator' },
    { label: 'Character / 换角色', submenu: Object.entries(manifest.characters).filter(([, c]) => !c.egg).map(([id, c]) => ({ label: c.name, type: 'radio', checked: id === currentId, click: () => switchTo(id) })) },
    { label: 'Rename / 改名…', click: rename },
    { label: 'Show Codex quota / 显示 GPT 额度', type: 'checkbox', checked: !!settings.gptQuota, click: item => {
      settings.gptQuota = item.checked; saveSettings();
      if (item.checked) refreshQuota(); else js(pet, "setQuota('gpt', null)");
    } },
    { label: 'Start at login / 登录时启动', type: 'checkbox', enabled: app.isPackaged, checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }) },
    { label: 'Open characters / 打开角色文件夹', click: () => shell.openPath(charactersDir) },
    ...(advanced ? [{ label: 'Developer console / 开发者控制台…', click: openDevConsole }] : []),
    { label: 'Reload / 重新载入', click: () => pet.reload() },
    { label: 'Reset position / 回到右下角', click: resetPosition },
    { label: 'Windows source / Windows 项目主页', click: () => shell.openExternal('https://github.com/gypsyzz/crosspet') },
    { type: 'separator' },
    { label: 'Quit CrossPet / 退出', click: () => app.quit() },
  ];
}

function openDevConsole() {
  if (dev && !dev.isDestroyed()) { dev.show(); return; }
  dev = secureWindow({ width: 1060, height: 760, title: 'CrossPet Developer Console' }, path.join(bundle, 'app', 'web', 'devconsole.html'));
  dev.webContents.once('did-finish-load', () => js(dev, `setAppInfo(${json({ version: app.getVersion(), feedbackPath: feedbackFile })}); boot(${json(manifest)})`));
  dev.on('closed', () => {
    dev = null; paused = false; stamps.clear();
    js(pet, 'devRelease()'); pollStates(); refreshQuota();
  });
}

function endDrag(click) {
  clearInterval(dragTimer);
  if (!drag) return;
  if (dragged) { settings.position = pet.getPosition(); saveSettings(); }
  else if (click) js(pet, "handleClick('pat')");
  drag = null;
}

ipcMain.on('crosspet:drag', (event, phase) => {
  if (!trusted(event, pet)) return;
  if (phase !== 'start') { endDrag(phase === 'end'); return; }
  endDrag(false);
  drag = { cursor: screen.getCursorScreenPoint(), origin: pet.getPosition(), started: Date.now() }; dragged = false;
  dragTimer = setInterval(() => {
    // Bound the capture in case Windows cancels a gesture without a pointerup.
    if (Date.now() - drag.started > 30000) { endDrag(false); return; }
    const p = screen.getCursorScreenPoint(), dx = p.x - drag.cursor.x, dy = p.y - drag.cursor.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    if (dragged) pet.setPosition(Math.round(drag.origin[0] + dx), Math.round(drag.origin[1] + dy));
  }, 16);
});
ipcMain.on('crosspet:menu', (event, advanced) => {
  if (trusted(event, pet)) Menu.buildFromTemplate(menuTemplate(advanced === true)).popup({ window: pet });
});
ipcMain.on('crosspet:rename', (event, name) => {
  if (!trusted(event, renameWindow) || typeof name !== 'string' || name.length > 80) return;
  settings.names ||= {};
  settings.names[renameWindow.characterId] = name.trim();
  saveSettings(); reloadCharacters(); renameWindow.close();
});
ipcMain.on('crosspet:dev', async (event, message) => {
  if (!trusted(event, dev) || !message || typeof message !== 'object') return;
  switch (message.cmd) {
    case 'pet':
      if (typeof message.code === 'string') await js(pet, message.code);
      break;
    case 'status': {
      const status = await js(pet, 'devStatus()');
      if (status) js(dev, `onPetStatus(${json(status)})`);
      break;
    }
    case 'pause':
      paused = message.on === true;
      if (!paused) { stamps.clear(); pollStates(); refreshQuota(); }
      break;
    case 'save':
      if (typeof message.text !== 'string') break;
      fs.writeFileSync(feedbackFile, message.text, 'utf8'); clipboard.writeText(message.text);
      js(dev, `onSaved(${json(feedbackFile)})`);
      break;
    case 'reveal': shell.showItemInFolder(feedbackFile); break;
    case 'reload': pet.reload(); break;
  }
});

async function start() {
  syncResources();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
    ...details.responseHeaders,
    'Content-Security-Policy': ["default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data:"],
  } }));
  const displays = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter(d => d.id !== screen.getPrimaryDisplay().id)];
  pet = secureWindow({
    ...visiblePosition(settings.position, displays), width: 260, height: 362,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    title: 'CrossPet', icon: path.join(bundle, 'app', 'icon', 'AppIcon.png'),
  }, path.join(bundle, 'app', 'web', 'index.html'));
  pet.webContents.on('did-start-loading', () => { ready = false; });
  pet.webContents.on('did-finish-load', () => {
    reloadCharacters(); stamps.clear(); ready = true; pollStates(); refreshQuota();
    pet.showInactive();
  });
  pet.on('closed', () => app.quit());
  screen.on('display-removed', () => { const { x, y } = visiblePosition(pet.getPosition(), screen.getAllDisplays()); pet.setPosition(x, y); });
  tray = new Tray(path.join(bundle, 'app', 'icon', 'AppIcon.png'));
  tray.setToolTip('CrossPet');
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate(true))));
  tray.on('double-click', () => { resetPosition(); pet.showInactive(); });
  timers.push(setInterval(pollStates, 300), setInterval(refreshQuota, 60000));
  // Load the manifest before the first foreground notification arrives.
  manifest = loadCharacters(charactersDir, settings.names);
  watchForeground();
}

app.on('second-instance', () => { if (pet && !pet.isDestroyed()) pet.showInactive(); });
app.on('before-quit', () => {
  ready = false;
  timers.forEach(clearInterval); clearInterval(dragTimer); clearTimeout(pendingSwitch);
  watcher?.kill(); tray?.destroy();
});

module.exports = { menuTemplate, openDevConsole, pollStates };
