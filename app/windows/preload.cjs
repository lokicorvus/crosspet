const { contextBridge, ipcRenderer } = require('electron');

// The console can drive the pet page, but neither page gets Node or arbitrary IPC.
contextBridge.exposeInMainWorld('crosspet', {
  dev: message => ipcRenderer.send('crosspet:dev', message),
  rename: name => ipcRenderer.send('crosspet:rename', name),
});

window.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/index.html')) return;
  document.addEventListener('contextmenu', event => {
    event.preventDefault();
    ipcRenderer.send('crosspet:menu', event.altKey);
  });
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    document.documentElement.setPointerCapture(event.pointerId);
    ipcRenderer.send('crosspet:drag', 'start');
  });
  document.addEventListener('pointerup', event => {
    if (event.button === 0) ipcRenderer.send('crosspet:drag', 'end');
  });
  document.addEventListener('pointercancel', () => ipcRenderer.send('crosspet:drag', 'cancel'));
});
