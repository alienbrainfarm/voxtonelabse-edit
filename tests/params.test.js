const assert = require('assert'), fs = require('fs'), path = require('path');
const TL = require('./load')('sysex.js', 'model.js', 'params.js');
const P = TL.params;
assert.strictEqual(P.SPEED_HZ.length, 101);
assert.strictEqual(P.SPEED_HZ[0x2d], 0.8); assert.strictEqual(P.SPEED_HZ[0x32], 1.0); assert.strictEqual(P.SPEED_HZ[0x63], 9.6);
const tlp = require('./load').preset('ToneLabSE_Preset.TLP');
let checked = 0, problems = [];
for (let n = 0; tlp && n < 96; n++) {
  const prog = Uint8Array.from(tlp.slice(32 + n * 92, 32 + n * 92 + 92));
  const name = TL.model.getName(prog);
  for (const fx of P.EFFECTS) {
    const type = fx.types[prog[fx.typeOffset]];
    if (!type) { problems.push(`${name}: ${fx.name} type ${prog[fx.typeOffset]}`); continue; }
    for (const prm of type.params) {
      const v = TL.model.get(prog, fx.byteOf(prm.o));
      checked++;
      if (v < prm.min || v > prm.max) problems.push(`${name}: ${fx.name}/${type.name}/${prm.label} = ${v} not in ${prm.min}..${prm.max}`);
    }
  }
  for (const ch of ['A', 'B']) {
    const a = P.AMP[ch];
    if (prog[a.type] > 15 || prog[a.cab] > 10) problems.push(name + ' amp/cab');
    for (const k of P.AMP_KNOBS) { checked++; const v = prog[a.base + k.o]; if (v < k.min || v > k.max) problems.push(`${name}: amp ${ch} ${k.label}=${v}`); }
  }
  for (const e of [1, 2]) {
    const x = P.EXP[e]; const code = prog[x.target] & 0x3f;
    const t = P.expTargets(prog).find(t => t.code === code);
    if (!t) { problems.push(`${name}: EXP${e} target code ${code} not available`); continue; }
    if (t.param) {
      for (const which of ['min', 'max']) {
        const v = TL.model.get(prog, x[which]); checked++;
        if (v < t.param.min || v > t.param.max) problems.push(`${name}: EXP${e} ${t.name} ${which}=${v} not in ${t.param.min}..${t.param.max}`);
      }
    }
  }
  if (prog[87] > 11 || prog[88] > 11 || prog[12] > 5) problems.push(name + ' chain/control');
}
console.log('checked', checked, 'values;', problems.length, 'problems');
problems.slice(0, 40).forEach(p => console.log('  ' + p));
// formats
assert.strictEqual(P.FMT.hz.text(0), '0.100 Hz'); assert.strictEqual(P.FMT.hz.text(100), '10.00 Hz'); assert.strictEqual(P.FMT.hz.text(60), '1.50 Hz');
assert.strictEqual(P.FMT.k1.text(90), '10.0'); assert.strictEqual(P.FMT.k1.parse('2.5'), 15);
assert.strictEqual(P.FMT.nr.text(0), 'OFF'); assert.strictEqual(P.FMT.nr.text(50), '10.0');
assert.strictEqual(P.FMT.hz.parse('1.45'), 59);
if (problems.length) process.exit(1);
