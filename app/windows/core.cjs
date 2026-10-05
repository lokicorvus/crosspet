const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

function paths(env = process.env) {
  return {
    root: path.resolve(env.CROSSPET_HOME || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CrossPet')),
    state: path.resolve(env.CROSSPET_STATE_DIR || path.join(env.TEMP || env.TMP || os.tmpdir(), 'crosspet')),
    codex: env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  };
}

function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function loadCharacters(dir, names = {}) {
  const characters = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const base = path.join(dir, entry.name);
    const info = readJSON(path.join(base, 'character.json'));
    if (!info || typeof info !== 'object' || Array.isArray(info)) continue;
    const poses = {};
    let blink = null, blinkBase = null;
    for (const file of fs.readdirSync(base).sort()) {
      if (!/\.(webp|png)$/i.test(file)) continue;
      const stem = path.parse(file).name;
      const url = pathToFileURL(path.join(base, file)).href;
      if (stem === 'idle-blink') { blink = url; continue; }
      if (stem === 'idle') blinkBase = url;
      (poses[stem.split('-')[0]] ||= []).push(url);
    }
    if (info.egg ? !poses.pop : !(poses.idle || poses.default)) continue;
    characters[entry.name] = { ...info, name: names[entry.name] || info.name || entry.name, poses, blink, blinkBase };
  }
  return { characters };
}

// Do not consume a timestamp until JSON is readable: writers can be mid-write.
function changedState(file, stamps, now = Date.now()) {
  try {
    const stamp = fs.statSync(file).mtimeMs;
    if (stamps.get(file) === stamp || (file.endsWith('-state.json') && now - stamp > 600000)) return null;
    const data = readJSON(file);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    stamps.set(file, stamp);
    return data;
  } catch { return null; }
}

function quotaIn(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 1000000));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    for (const line of tail.toString('utf8').split('\n').reverse()) {
      if (!line.includes('"rate_limits"')) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      const limits = item.payload?.rate_limits || item.rate_limits;
      const windows = [];
      for (const key of ['primary', 'secondary']) {
        const w = limits?.[key];
        if (!Number.isFinite(w?.used_percent)) continue;
        const minutes = w.window_minutes || 0;
        const label = minutes >= 10080 ? '本周' : minutes >= 1440 ? '今日' : `${Math.max(1, Math.floor(minutes / 60))}小时`;
        windows.push({ label, used: w.used_percent, reset: w.resets_at || 0 });
      }
      if (windows.length) return {
        text: windows.map(w => `${w.label} 剩余 ${Math.max(0, 100 - Math.round(w.used))}%`).join(' ｜ '),
        low: windows.some(w => w.used >= 90), windows,
      };
    }
  } catch { /* A session may have been removed or still be writing. */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}

function codexQuota(base) {
  const files = [];
  for (let back = 0; back < 4; back++) {
    const day = new Date(); day.setDate(day.getDate() - back);
    const dir = path.join(base, 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    try {
      for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl'))) {
        const file = path.join(dir, name);
        try { files.push({ file, mtime: fs.statSync(file).mtimeMs }); } catch {}
      }
    } catch {}
  }
  for (const { file } of files.sort((a, b) => b.mtime - a.mtime).slice(0, 8)) {
    const quota = quotaIn(file);
    if (quota) return quota;
  }
  return null;
}

function visiblePosition(position, displays, width = 260, height = 362) {
  if (Array.isArray(position) && position.length === 2 && position.every(Number.isFinite)) {
    const [x, y] = position.map(Math.round);
    if (displays.some(({ workArea: a }) => x >= a.x && y >= a.y && x + width <= a.x + a.width && y + height <= a.y + a.height)) return { x, y };
  }
  const a = displays[0].workArea;
  return { x: a.x + Math.max(0, a.width - width - 40), y: a.y + Math.max(0, a.height - height - 100) };
}

module.exports = { paths, readJSON, loadCharacters, changedState, quotaIn, codexQuota, visiblePosition };
