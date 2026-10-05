'use strict';
// Run on macOS or Windows with Node 22.12+. Builds a portable folder, no Wine required.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hashes = {
  arm64: '1230310118a6330cd6385cfc04de48bc77c7d18c240fd5fa23d054e50b1ebb85',
  x64: '8766a8775746235e23cf5aee5027ab1060bb981d93110577adcf3508aa0cbd55',
};
(async () => {
  const { packager } = await import('@electron/packager');
  const arch = process.argv[2] || 'arm64';
  if (!hashes[arch]) throw new Error('Choose arm64 or x64');
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== version) throw new Error('package.json version must match VERSION');
  const [output] = await packager({ dir: root, out: path.join(root, 'build/windows'), name: 'CrossPet',
    platform: 'win32', arch, electronVersion: pkg.devDependencies.electron, appVersion: version,
    overwrite: true, asar: false, prune: true, executableName: 'CrossPet',
    icon: path.join(root, 'app/icon/AppIcon.ico'),
    ignore: [/^\/(build|docs|tests|\.git|node_modules)(\/|$)/, /\/raw(\/|$)/, /\.DS_Store$/],
    win32metadata: { CompanyName: 'lokicorvus', FileDescription: 'CrossPet Windows Preview', ProductName: 'CrossPet' },
  });
  // Chromium 自带几十种界面语言包（约 48 MB），桌宠只用得到中文和英文
  const locales = path.join(output, 'locales');
  for (const f of fs.readdirSync(locales)) if (!['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'].includes(f)) fs.rmSync(path.join(locales, f));
  const pyVersion = '3.13.13';
  const pyArch = arch === 'x64' ? 'amd64' : 'arm64';
  const url = `https://www.python.org/ftp/python/${pyVersion}/python-${pyVersion}-embed-${pyArch}.zip`;
  const cache = path.join(root, 'build/downloads'); fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `python-${pyVersion}-${arch}.zip`);
  if (!fs.existsSync(archive)) {
    const response = await fetch(url); if (!response.ok) throw new Error(`Python download: ${response.status}`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (hash !== hashes[arch]) throw new Error(`Python archive checksum mismatch: ${archive}`);
  const runtime = path.join(output, 'resources/app/runtime/python'); fs.mkdirSync(runtime, { recursive: true });
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${runtime.replaceAll("'", "''")}' -Force`]);
  else execFileSync('unzip', ['-q', archive, '-d', runtime]);
  for (const file of ['install.ps1', 'install.cmd', 'uninstall.ps1', 'uninstall.cmd'])
    fs.copyFileSync(path.join(root, 'app/windows', file), path.join(output, file));
  fs.copyFileSync(path.join(root, 'docs/windows.md'), path.join(output, 'Windows-README.md'));
  fs.writeFileSync(path.join(output, 'BUILD-INFO.json'), JSON.stringify({ version, arch, electron: pkg.devDependencies.electron,
    python: { version: pyVersion, url, sha256: hash }, builtAt: new Date().toISOString(), signed: false }, null, 2));
  console.log(`Built ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
