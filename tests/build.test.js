// A Git Bash PATH can shadow Windows' ZIP-capable tar with GNU tar, which
// treats drive letters as remote hosts. Exercise the actual build script's
// subprocess boundary without downloading or packaging Electron in unit tests.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const commands = [];
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.js'), 'utf8'), {
  __dirname: 'D:\\project\\scripts',
  process: {
    platform: 'win32', arch: 'x64', argv: ['node', 'build.js', 'win32', 'x64'],
    execPath: 'C:\\node\\node.exe', env: { SystemRoot: 'C:\\Windows' },
  },
  console: { log() {}, error() {} },
  require(name) {
    if (name === 'child_process') return { execFileSync(cmd, args, opts) { commands.push({ cmd, args, opts }); } };
    if (name === 'fs') return { rmSync() {}, statSync() { return { size: 1024 }; } };
    if (name === 'path') return path.win32;
    if (name === 'D:\\project\\package.json') return { version: '1.0.1' };
    throw new Error('Unexpected module: ' + name);
  },
});

const archive = commands.find(c => c.args.includes('-cf'));
assert.strictEqual(archive.cmd, 'C:\\Windows\\System32\\tar.exe', 'Windows ZIP builds must not use Git Bash GNU tar');
assert.deepStrictEqual(Array.from(archive.args), [
  '-a', '-cf', 'D:\\project\\dist\\ToneLab-SE-Editor-1.0.1-Windows-x64.zip',
  '-C', 'D:\\project\\dist', 'ToneLab SE Editor-win32-x64',
]);
console.log('Build: Windows archive uses native ZIP-capable tar');
