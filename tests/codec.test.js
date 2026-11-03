const assert0 = require("assert"), fs = require('fs'), path = require('path');
const J = x => JSON.parse(JSON.stringify(x, (k, v) => v instanceof Uint8Array ? Array.from(v) : v));
const assert = Object.assign((...a) => assert0(...a), assert0, { deepStrictEqual: (a, b, m) => assert0.deepStrictEqual(J(a), J(b), m) });
const TL = require('./load')('sysex.js', 'model.js');
const tlp = require('./load').preset('ToneLabSE_Preset.TLP');
if (!tlp) process.exit(0);
const progs = []; for (let n = 0; n < 96; n++) progs.push(Array.from(tlp.slice(32 + n * 92, 32 + n * 92 + 92)));

// pack/unpack round trip incl. high bits
for (const p of progs) assert.deepStrictEqual(TL.sysex.unpack7(TL.sysex.pack7(p)), p);
// full message round trip
const m = TL.sysex.parse(TL.sysex.msg.programDump(3, 17, progs[17]));
assert.strictEqual(m.kind, 'program'); assert.strictEqual(m.number, 17); assert.strictEqual(m.channel, 3);
assert.deepStrictEqual(m.data, progs[17]);
const all = TL.sysex.parse(TL.sysex.msg.allProgramsDump(0, progs.flat()));
assert.strictEqual(all.kind, 'allPrograms'); assert.deepStrictEqual(all.data, progs.flat());
assert.strictEqual(TL.sysex.msg.allProgramsDump(0, progs.flat()).length, 6 + 2 + TL.sysex.packedLength(8832) + 1);
// header bytes as in FUN_004080c7
assert.deepStrictEqual(TL.sysex.msg.paramChange(0, 6, 0, 315), [0xf0, 0x42, 0x30, 0x6d, 0x08, 0x41, 6, 0, 2, 59, 0xf7]);
assert.deepStrictEqual(TL.sysex.msg.programChange(0, 5), [0xf0, 0x42, 0x30, 0x6d, 0x08, 0x4e, 0x20, 5, 0xf7]);
// every addressable offset maps back to itself
for (let off = 0; off < 92; off++) {
  if (off === 10 || off === 11) { for (let b = 0; b < 8; b++) { const a = TL.model.paramAddress(off, b); assert.deepStrictEqual(TL.model.offsetForAddress(a[0], a[1]), { offset: off, bit: b }); } continue; }
  const a = TL.model.paramAddress(off); if (!a) continue;
  const back = TL.model.offsetForAddress(a[0], a[1]);
  const expect = TL.model.isWord(off - 1) ? off - 1 : off;
  assert.strictEqual(back.offset, expect, 'offset ' + off);
}
// parameter change round trip through applyRemote for 16-bit delay time
const p = Uint8Array.from(progs[0]); const c = TL.model.set(p, 32, 1234);
const q = Uint8Array.from(progs[0]); TL.model.applyRemote(q, c.p1, c.p2, c.value);
assert.strictEqual(TL.model.get(q, 32), 1234);
assert.strictEqual(TL.model.getName(Uint8Array.from(progs[6])), '  SOLO');
console.log('codec tests passed; names:', progs.slice(0, 8).map(p => TL.model.getName(Uint8Array.from(p))).join(' | '));
