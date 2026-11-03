// Loads the browser scripts into Node with a fake `window`.
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load(...files) {
  const ctx = { window: {}, console, setTimeout, clearTimeout, Uint8Array, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.TL;
};

// Korg's factory preset files aren't in the repository. Copy them from the original
// installer into extracted/cab (or point TONELAB_PRESETS at them); tests that need
// them are skipped otherwise.
module.exports.preset = function preset(name) {
  const p = path.join(process.env.TONELAB_PRESETS || path.join(__dirname, '..', 'extracted', 'cab'), name);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  console.log(`skipped: ${name} not found (see tests/load.js)`);
  return null;
};
