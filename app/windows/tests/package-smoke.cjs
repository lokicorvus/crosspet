// Test the distributable with Chromium's loopback debugging interface, no extra dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const build = path.resolve(__dirname, '../../../build');
const executable = path.join(build, `CrossPet-win32-${process.arch}`, 'CrossPet.exe');
const profile = fs.mkdtempSync(path.join(build, 'package-smoke-'));
const child = spawn(executable, ['--remote-debugging-port=0'], {
  windowsHide: true,
  env: { ...process.env, CROSSPET_HOME: profile, CROSSPET_STATE_DIR: path.join(profile, 'state') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', startupError, socket;
child.on('error', error => { startupError = error; });
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });

(async () => {
  let port;
  for (let i = 0; i < 150; i++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Packaged app exited: ${output}`);
    port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) break;
    await wait(100);
  }
  assert.ok(port, `No debugging endpoint: ${output}`);
  let page;
  for (let i = 0; i < 100; i++) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = pages.find(p => p.type === 'page' && p.url.endsWith('/index.html'));
    if (page) break;
    await wait(100);
  }
  assert.ok(page, 'Packaged pet page must load');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 10000);
    pending.set(id, response => { clearTimeout(timer); response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  let state;
  for (let i = 0; i < 100; i++) {
    const result = await send('Runtime.evaluate', { expression: 'typeof devStatus === "function" && devStatus()', returnByValue: true });
    state = result.result.value;
    if (state?.charId) break;
    await wait(100);
  }
  assert.ok(state?.charId, 'Packaged animations must initialize');
  await wait(500);
  const rendered = await send('Runtime.evaluate', { expression: 'active.complete && active.naturalWidth > 0 && typeof require === "undefined"', returnByValue: true });
  assert.equal(rendered.result.value, true);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(build, 'windows-package-smoke.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(`PASS: packaged CrossPet.exe loads its bundled artwork and sandboxed renderer (${state.charId}).`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  socket?.close();
  if (child.pid && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
});
