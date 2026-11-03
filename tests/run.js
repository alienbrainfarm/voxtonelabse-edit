// Runs every *.test.js in this folder.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'))) {
  try { process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' })); }
  catch (e) { failed++; process.stdout.write((e.stdout || '') + (e.stderr || '')); console.log('FAILED: ' + f); }
}
process.exit(failed ? 1 : 0);
