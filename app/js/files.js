// .TLP (programs) and .TLG (global) files, byte-compatible with the original
// SoundEditor (WriteTlpTlgFile 0x0040bfd7 / ReadTlpTlgFile 0x0040ce20).
// See docs/files-global.md.
//
// 32-byte little-endian header:
//   0x00 u32 type: 0x2550 = ToneLab SE, 0x2540 = original ToneLab
//   0x10 u24 offset + u8 count: program section (92 bytes each)
//   0x14 u24 offset + u8 count: global section (16 bytes)
(function (TL) {
  'use strict';

  const N = 96, SIZE = 92, GSIZE = 16, HEADER = 32;
  const TYPE_SE = 0x2550, TYPE_TONELAB = 0x2540;

  function header(progCount, globalCount) {
    const h = new Uint8Array(HEADER);
    h[0] = TYPE_SE & 0xff; h[1] = TYPE_SE >> 8;
    if (progCount) { h[0x10] = HEADER; h[0x13] = progCount; }
    if (globalCount) {
      const off = HEADER + SIZE * progCount;
      h[0x14] = off & 0xff; h[0x15] = (off >> 8) & 0xff; h[0x16] = off >> 16; h[0x17] = globalCount;
    }
    return h;
  }

  function section(d, at) {
    return { offset: d[at] | (d[at + 1] << 8) | (d[at + 2] << 16), count: d[at + 3] };
  }

  // Returns {kind: 'se'|'tonelab', programs: Uint8Array[] (as stored), global: Uint8Array|null}
  function read(buf) {
    const d = new Uint8Array(buf);
    if (d.length < HEADER) throw new Error('Error: Invalid data file format');
    let type = d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24);
    if (type === 0) type = d[8] | (d[9] << 8) | (d[10] << 16) | (d[11] << 24);
    const kind = type === TYPE_SE ? 'se' : type === TYPE_TONELAB ? 'tonelab' : null;
    if (!kind) throw new Error('Error: Invalid data file format');
    const ps = section(d, 0x10), gs = section(d, 0x14);
    const programs = [];
    if (ps.offset && ps.count) {
      const count = Math.min(ps.count, N);
      if (ps.offset + count * SIZE > d.length) throw new Error('Error: Invalid data file format (truncated)');
      for (let n = 0; n < count; n++) programs.push(d.slice(ps.offset + n * SIZE, ps.offset + (n + 1) * SIZE));
    }
    let global = null;
    if (gs.offset && gs.count && gs.offset + GSIZE <= d.length) global = d.slice(gs.offset, gs.offset + GSIZE);
    return { kind, programs, global };
  }

  // Program-set file: 96 programs, original ToneLab programs converted to SE.
  function readTLP(buf) {
    const r = read(buf);
    if (!r.programs.length) throw new Error('This file contains no programs.');
    const count = r.programs.length;
    const programs = r.kind === 'tonelab' ? r.programs.map(p => TL.convertToneLab(p)) : r.programs;
    while (programs.length < N) programs.push(TL.model.blankProgram());
    return { kind: r.kind, count, programs };
  }

  function writeTLP(programs) {
    const out = new Uint8Array(HEADER + N * SIZE);
    out.set(header(N, 0), 0);
    for (let n = 0; n < N; n++) if (programs[n]) out.set(programs[n].subarray(0, SIZE), HEADER + n * SIZE);
    return out;
  }

  // File > Export: a .TLP holding one program (124 bytes).
  function writeProgram(prog) {
    const out = new Uint8Array(HEADER + SIZE);
    out.set(header(1, 0), 0);
    out.set(prog.subarray(0, SIZE), HEADER);
    return out;
  }

  function readTLG(buf) {
    const r = read(buf);
    if (r.kind !== 'se') throw new Error('Error: ToneLabSE SoundEditor can read a native Global data only.');
    if (!r.global) throw new Error('This file contains no Global data.');
    return r.global;
  }

  function writeTLG(global) {
    const out = new Uint8Array(HEADER + GSIZE);
    const h = header(0, 1);
    h[0x14] = HEADER;
    out.set(h, 0);
    out.set(global.subarray(0, GSIZE), HEADER);
    return out;
  }

  // Default export name: program name, trailing spaces trimmed, / : ; . * " < > ? \ -> _
  function exportName(name) {
    return (name.replace(/\s+$/, '').replace(/[/:;.*"<>?\\]/g, '_') || 'Program') + '.TLP';
  }

  async function saveFile(bytes, suggestedName, description, ext) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName, types: [{ description, accept: { 'application/octet-stream': ['.' + ext] } }] });
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
        return h.name;
      } catch (e) {
        if (e.name === 'AbortError') return null;
        throw e;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return suggestedName;
  }

  TL.files = { N, SIZE, HEADER, read, readTLP, writeTLP, writeProgram, readTLG, writeTLG, exportName, saveFile };
})(window.TL = window.TL || {});
