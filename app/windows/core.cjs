'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

function paths(env = process.env, platform = process.platform, home = os.homedir()) {
  const data = env.CROSSPET_DATA_DIR || (platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'CrossPet')
    : path.join(home, 'Library', 'Application Support', 'CrossPet-Windows-Preview'));
  return { data, state: env.CROSSPET_STATE_DIR || (platform === 'win32' ? path.join(data, 'state') : '/tmp/crosspet-preview'),
    codex: env.CODEX_HOME || path.join(home, '.codex') };
}
function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function loadCharacters(dir, names = {}) {
  const characters = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const root = path.join(dir, entry.name), info = readJSON(path.join(root, 'character.json'));
    if (!info || typeof info !== 'object') continue;
    const poses = {}; let blink = null, blinkBase = null;
    for (const file of fs.readdirSync(root).sort()) {
      if (!/\.(webp|png)$/i.test(file)) continue;
      const stem = path.parse(file).name, url = pathToFileURL(path.join(root, file)).href;
      if (stem === 'idle-blink') { blink = url; continue; }
      if (stem === 'idle') blinkBase = url;
      (poses[stem.split('-')[0]] ||= []).push(url);
    }
    if (info.egg ? !poses.pop : !poses.idle && !poses.default) continue;
    characters[entry.name] = { ...info, name: names[entry.name] || info.name, poses, blink, blinkBase };
  }
  return { characters };
}
// Cache only a successfully parsed file: a partial write must be retried next tick.
function readUpdates(dir, ids, stamps, now = Date.now()) {
  const updates = [];
  for (const id of ids) for (const kind of ['state', 'quota']) {
    const file = path.join(dir, `${id}-${kind}.json`), key = `${id}-${kind}`;
    try {
      const stat = fs.statSync(file), stamp = `${stat.mtimeMs}:${stat.size}`;
      if (stamps.get(key) === stamp || stat.size > 1_000_000) continue;
      if (kind === 'state' && now - stat.mtimeMs > 600_000) continue;
      const value = readJSON(file);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (kind === 'state' && (typeof value.pose !== 'string' || !Number.isFinite(value.ts))) continue;
      if (kind === 'quota' && value.text != null && typeof value.text !== 'string') continue;
      stamps.set(key, stamp);
      updates.push({ id, kind, value, time: stat.mtimeMs });
    } catch { /* Another process may be atomically replacing this file. */ }
  }
  return updates.sort((a, b) => a.time - b.time);
}
function clampPosition(position, displays, size = { width: 260, height: 362 }) {
  const target = displays.find(d => position && position.x >= d.x && position.x < d.x + d.width && position.y >= d.y && position.y < d.y + d.height) || displays[0];
  const x = Number.isFinite(position?.x) ? position.x : target.x + target.width - size.width - 40;
  const y = Number.isFinite(position?.y) ? position.y : target.y + target.height - size.height - 80;
  return { x: Math.round(Math.max(target.x, Math.min(x, target.x + Math.max(0, target.width - size.width)))),
    y: Math.round(Math.max(target.y, Math.min(y, target.y + Math.max(0, target.height - size.height)))) };
}
function findRateLimits(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.rate_limits && typeof obj.rate_limits === 'object') return obj.rate_limits;
  for (const value of Object.values(obj)) { const found = findRateLimits(value); if (found) return found; }
  return null;
}
function parseQuota(text) {
  for (const line of text.split('\n').reverse()) {
    if (!line.includes('"rate_limits"')) continue;
    let rl; try { rl = findRateLimits(JSON.parse(line)); } catch { continue; }
    if (!rl) continue;
    const windows = ['primary', 'secondary'].flatMap(key => {
      const w = rl[key]; if (!w || !Number.isFinite(w.used_percent)) return [];
      const m = Number(w.window_minutes) || 0;
      return [{ label: m >= 10080 ? '本周' : m >= 1440 ? '今日' : `${Math.max(1, Math.floor(m / 60))}小时`,
        used: w.used_percent, reset: w.resets_at || 0 }];
    });
    if (!windows.length) continue;
    return { text: windows.map(w => `${w.label} 剩余 ${Math.max(0, 100 - Math.round(w.used))}%`).join(' ｜ '),
      low: Math.max(...windows.map(w => w.used)) >= 90, windows };
  }
  return null;
}
function codexQuota(base, now = new Date()) {
  const files = [];
  for (let back = 0; back < 4; back++) {
    const day = new Date(now); day.setDate(day.getDate() - back);
    const dir = path.join(base, 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) {
      const file = path.join(dir, f); files.push({ file, mtime: fs.statSync(file).mtimeMs });
    } } catch { /* No sessions on this day. */ }
  }
  for (const { file } of files.sort((a, b) => b.mtime - a.mtime).slice(0, 8)) {
    let fd; try {
      fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 1_000_000));
      const n = fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
      const q = parseQuota(buf.subarray(0, n).toString('utf8')); if (q) return q;
    } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return null;
}
// Windows UNC paths (including the extended UNC form); extended local paths are not shares.
function isSharedExecutable(file, platform = process.platform) {
  if (platform !== 'win32') return false;
  const normalized = file.replaceAll('/', String.fromCharCode(92));
  return /^\\\\\?\\UNC\\/i.test(normalized) || /^\\\\[^?.]/.test(normalized);
}
module.exports = { isSharedExecutable, paths, readJSON, writeJSON, loadCharacters, readUpdates, clampPosition, parseQuota, codexQuota };
