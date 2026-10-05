// Build a portable folder using the Electron runtime already pinned in package-lock.json.
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../..');
if (process.platform !== 'win32') throw new Error('Build the Windows package on Windows.');
const runtime = path.dirname(require('electron'));
const out = path.join(repo, 'build', `CrossPet-win32-${process.arch}`);
// Only replace this build output, never a caller-provided directory or symlink.
if (fs.existsSync(out) && fs.lstatSync(out).isSymbolicLink()) throw new Error(`Refusing linked output: ${out}`);
if (fs.existsSync(path.dirname(out)) && fs.realpathSync(path.dirname(out)) !== path.dirname(out)) throw new Error('Refusing redirected build directory');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(runtime, out, { recursive: true });
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'CrossPet.exe'));
const dest = path.join(out, 'resources', 'app');
for (const name of ['app/web', 'app/icon/AppIcon.png', 'characters', 'integrations', 'tools/integrate.py', 'VERSION', 'LICENSE']) {
  fs.cpSync(path.join(repo, name), path.join(dest, name), { recursive: true, filter: source => path.basename(source) !== 'raw' && path.basename(source) !== '__pycache__' });
}
for (const name of ['main.cjs', 'core.cjs', 'preload.cjs', 'foreground.ps1', 'rename.html']) {
  fs.cpSync(path.join(__dirname, name), path.join(dest, 'app', 'windows', name));
}
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'crosspet', productName: 'CrossPet', version: fs.readFileSync(path.join(repo, 'VERSION'), 'utf8').trim(), main: 'app/windows/main.cjs' }, null, 2));
console.log(`Portable Windows app: ${path.join(out, 'CrossPet.exe')}`);
