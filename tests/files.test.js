const assert = require('assert'), fs = require('fs'), path = require('path');
const TL = require('./load')('sysex.js', 'model.js', 'params.js', 'convert.js', 'files.js');
const se = require('./load').preset('ToneLabSE_Preset.TLP');
const tl = require('./load').preset('ToneLab_Preset.TLP');
if (!se || !tl) process.exit(0);
const hex = a => Buffer.from(a).toString('hex');

// SE set: read -> write is byte-identical to the factory file written by the original editor
const r = TL.files.readTLP(se);
assert.strictEqual(r.kind, 'se');
assert.strictEqual(hex(TL.files.writeTLP(r.programs)), hex(se));
// export: 124 bytes, count 1, reads back as program 1 + blanks
const ex = TL.files.writeProgram(r.programs[6]);
assert.strictEqual(ex.length, 124);
assert.strictEqual(hex(ex.slice(0x10, 0x18)), '2000000100000000');
const back = TL.files.readTLP(ex);
assert.strictEqual(back.count, 1); assert.strictEqual(hex(back.programs[0]), hex(r.programs[6]));
assert.strictEqual(TL.model.getName(back.programs[1]), '');
// global
const g = Uint8Array.from([0, 7, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
const tlg = TL.files.writeTLG(g);
assert.strictEqual(tlg.length, 48); assert.strictEqual(hex(tlg.slice(0x10, 0x18)), '0000000020000001');
assert.strictEqual(hex(TL.files.readTLG(tlg)), hex(g));
assert.strictEqual(TL.files.exportName('  SOLO'), '  SOLO.TLP');
assert.strictEqual(TL.files.exportName('MR.CLEAN'), 'MR_CLEAN.TLP');

// original ToneLab set -> converted
const c = TL.files.readTLP(tl);
assert.strictEqual(c.kind, 'tonelab');
const expected0 = ('42 4c 49 5a 5a 41 52 44 00 00 fe 00 00 09 2c 58 3c 00 00 00 00 00 01 16 0d 00 28 00 21 00 00 00 01 b8 28 ' +
  '28 00 13 28 00 07 40 1e 22 20 00 2c 00 00 08 4f 32 30 40 32 3a 25 26 08 00 00 00 00 08 4f 32 30 40 32 3a ' +
  '25 26 08 00 00 00 00 00 00 00 00 64 01 00 00 00 64 08 06 00 00 00'); // docs/files-global.md 3.4 example
assert.strictEqual(hex(c.programs[0]), expected0.replace(/\s/g, ''));
// every converted program must be a legal SE program
const P = TL.params; const problems = [];
c.programs.forEach(prog => {
  const name = TL.model.getName(prog);
  for (const fx of P.EFFECTS) {
    const type = fx.types[prog[fx.typeOffset]];
    if (!type) { problems.push(name + ' ' + fx.name + ' type'); continue; }
    for (const prm of type.params) {
      const v = TL.model.get(prog, fx.byteOf(prm.o));
      if (v < prm.min || v > prm.max) problems.push(`${name}: ${fx.name}/${type.name}/${prm.label}=${v}`);
    }
  }
  for (const n of [1, 2]) {
    const x = P.EXP[n], t = P.expTargets(prog).find(t => t.code === (prog[x.target] & 63));
    if (!t) { problems.push(`${name}: EXP${n} code ${prog[x.target]}`); continue; }
    if (t.param) for (const w of ['min', 'max']) { const v = TL.model.get(prog, x[w]); if (v < t.param.min || v > t.param.max) problems.push(`${name}: EXP${n} ${t.name} ${w}=${v}`); }
  }
});
console.log('files tests passed; converted ToneLab set:', c.programs.slice(0, 6).map(p => TL.model.getName(p)).join(' | '), '; problems:', problems.length);
problems.slice(0, 20).forEach(p => console.log('  ' + p));
if (problems.length) process.exit(1);
