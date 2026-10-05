'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crosspet', {
  postDev: message => ipcRenderer.send('dev', message),
  rename: name => ipcRenderer.send('rename', name),
});
window.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/index.html')) return;
  // 立绘是 <img>，浏览器默认可以「拖走图片」：一按住移动就变成拖图片、发 pointercancel，窗口拖不动。
  // 关掉图片拖拽和文字选择，拖动全部交给主进程移动窗口。
  const style = document.createElement('style');
  style.textContent = 'img, svg { -webkit-user-drag: none; user-select: none; pointer-events: none; } body { touch-action: none; }';
  document.head.append(style);
  document.addEventListener('dragstart', e => e.preventDefault());
  let down = false;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    down = true; document.documentElement.setPointerCapture(e.pointerId); ipcRenderer.send('drag', 'start');
  });
  document.addEventListener('pointermove', () => { if (down) ipcRenderer.send('drag', 'move'); });
  document.addEventListener('pointerup', e => {
    if (e.button !== 0 || !down) return;
    down = false; ipcRenderer.send('drag', 'end');
  });
  document.addEventListener('pointercancel', () => { if (down) { down = false; ipcRenderer.send('drag', 'cancel'); } });
  document.addEventListener('lostpointercapture', () => { if (down) { down = false; ipcRenderer.send('drag', 'cancel'); } });
  // 按住 Shift 右键才显示「开发者控制台」（macOS 版是 ⌥）
  document.addEventListener('contextmenu', e => { e.preventDefault(); ipcRenderer.send('menu', { developer: e.shiftKey }); });
});
