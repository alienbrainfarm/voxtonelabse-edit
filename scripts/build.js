#!/usr/bin/env node
// Builds a distributable archive of the editor for one platform.
//   node scripts/build.js [platform] [arch]      (defaults: this machine)
// Platforms: darwin, win32, linux. Archs: arm64, x64.
// Output: dist/ToneLab-SE-Editor-<version>-<macOS|Windows|Linux>-<arch>.<zip|tar.gz>
//
// macOS and Windows get a zip, Linux a tar.gz. On macOS the app is ad-hoc
// signed so Apple Silicon will run it. Any platform can be built from any host:
// @electron/packager downloads the matching Electron binaries and edits the
// Windows exe's icon and version info in pure JavaScript. The ad-hoc signing
// step is the one thing that needs a Mac.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const { version } = require(path.join(root, 'package.json'));
const name = 'ToneLab SE Editor';
const label = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform];
if (!label) { console.error(`Unknown platform "${platform}"; use darwin, win32 or linux.`); process.exit(1); }

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const dist = path.join(root, 'dist');
const built = path.join(dist, `${name}-${platform}-${arch}`);
const archive = path.join(dist, `ToneLab-SE-Editor-${version}-${label}-${arch}.${platform === 'linux' ? 'tar.gz' : 'zip'}`);

run(process.execPath, [path.join(__dirname, 'package.js'), platform, arch, dist]);

if (platform === 'darwin' && process.platform === 'darwin') {
  const app = path.join(built, `${name}.app`);
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('xattr', ['-cr', app]);
}

fs.rmSync(archive, { force: true });
if (platform === 'darwin') {
  // ditto keeps the bundle's symlinks and metadata intact, which plain zip does not.
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(built, `${name}.app`), archive]);
} else if (platform === 'linux') {
  run('tar', ['-czf', archive, '-C', dist, path.basename(built)]);
} else {
  // bsdtar (macOS, Linux, and Windows 10+) writes a zip when the name ends in .zip.
  run('tar', ['-a', '-cf', archive, '-C', dist, path.basename(built)]);
}

const mb = (fs.statSync(archive).size / 1048576).toFixed(0);
console.log(`\nBuilt ${path.relative(root, archive)} (${mb} MB)`);
