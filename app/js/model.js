// Program / global data model.
// A program is 92 bytes; the original editor's internal parameter id is the
// byte offset. paramAddress() reproduces FUN_00409736, which turns an offset
// (plus bit number for the switch bytes) into the (p1, p2) pair carried by a
// 0x41 parameter-change message.
(function (TL) {
  'use strict';

  const SIZE = 92;

  // 16-bit values stored big-endian across two bytes, sent as one 14-bit param.
  const WORD_OFFSETS = [32, 78, 80, 83, 85];

  function paramAddress(offset, bit) {
    if (offset < 10) return [0, offset];
    if (offset === 10) return [2, bit];
    if (offset === 11) return [2, bit + 8];
    if (offset === 12) return [2, 16];
    if (offset === 13) return [3, 0];
    if (offset <= 21) return [4, offset - 14];
    if (offset === 22) return [3, 1];
    if (offset <= 30) return [5, offset - 23];
    if (offset === 31) return [3, 2];
    if (offset <= 39) return [6, offset <= 33 ? 0 : offset - 33];
    if (offset === 40) return [3, 3];
    if (offset <= 48) return [7, offset - 41];
    if (offset === 49) return [3, 4];
    if (offset <= 57) return [8, offset - 50];
    if (offset === 58) return [3, 5];
    if (offset === 63) return [3, 6];
    if (offset >= 64 && offset <= 71) return [10, offset - 64];
    if (offset === 72) return [3, 7];
    if (offset === 77) return [12, 0];
    if (offset === 78 || offset === 79) return [12, 1];
    if (offset === 80 || offset === 81) return [12, 2];
    if (offset === 82) return [13, 0];
    if (offset === 83 || offset === 84) return [13, 1];
    if (offset === 85 || offset === 86) return [13, 2];
    if (offset >= 87) return [14, offset - 87];
    return null; // 59-62, 73-76: reserved, never sent
  }

  // Inverse of paramAddress, used for parameter changes coming from the device.
  // Returns {offset, bit?} or null.
  const reverse = new Map();
  for (let off = 0; off < SIZE; off++) {
    if (off === 10 || off === 11) {
      for (let bit = 0; bit < 8; bit++) {
        const a = paramAddress(off, bit);
        reverse.set(a[0] * 256 + a[1], { offset: off, bit });
      }
      continue;
    }
    const a = paramAddress(off);
    if (!a) continue;
    const key = a[0] * 256 + a[1];
    if (!reverse.has(key)) reverse.set(key, { offset: off });
  }
  function offsetForAddress(p1, p2) { return reverse.get(p1 * 256 + p2) || null; }

  function isWord(offset) { return WORD_OFFSETS.includes(offset); }

  function get(prog, offset, bit) {
    if (bit !== undefined) return (prog[offset] >> bit) & 1;
    if (isWord(offset)) return (prog[offset] << 8) | prog[offset + 1];
    return prog[offset];
  }

  // Writes the value into the program; returns the (p1,p2,value) to transmit.
  function set(prog, offset, value, bit) {
    if (bit !== undefined) {
      prog[offset] = (prog[offset] & ~(1 << bit)) | ((value ? 1 : 0) << bit);
      const a = paramAddress(offset, bit);
      return { p1: a[0], p2: a[1], value: value ? 1 : 0 };
    }
    if (isWord(offset)) {
      prog[offset] = (value >> 8) & 0xff;
      prog[offset + 1] = value & 0xff;
    } else {
      prog[offset] = value & 0xff;
    }
    const a = paramAddress(offset);
    return a ? { p1: a[0], p2: a[1], value } : null;
  }

  // Apply a parameter change received from the device.
  function applyRemote(prog, p1, p2, value) {
    const t = offsetForAddress(p1, p2);
    if (!t) return null;
    if (t.bit !== undefined) {
      prog[t.offset] = (prog[t.offset] & ~(1 << t.bit)) | ((value ? 1 : 0) << t.bit);
    } else if (isWord(t.offset)) {
      prog[t.offset] = (value >> 8) & 0xff;
      prog[t.offset + 1] = value & 0xff;
    } else {
      prog[t.offset] = value & 0xff;
    }
    return t;
  }

  function getName(prog) {
    let s = '';
    for (let i = 0; i < 8; i++) s += String.fromCharCode(prog[i] || 0x20);
    return s.replace(/\s+$/, '');
  }

  function setName(prog, name) {
    const changes = [];
    const padded = (name + '        ').slice(0, 8);
    for (let i = 0; i < 8; i++) {
      let c = padded.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) c = 0x20;
      if (prog[i] !== c) {
        prog[i] = c;
        changes.push({ p1: 0, p2: i, value: c });
      }
    }
    return changes;
  }

  function blankProgram() {
    const p = new Uint8Array(SIZE);
    for (let i = 0; i < 8; i++) p[i] = 0x20;
    return p;
  }

  function programLabel(n) {
    // The ToneLab SE shows programs as bank-number: 01-1 .. 24-4.
    const bank = Math.floor(n / 4) + 1;
    return String(bank).padStart(2, '0') + '-' + ((n % 4) + 1);
  }

  TL.model = {
    SIZE, paramAddress, offsetForAddress, isWord, get, set, applyRemote,
    getName, setName, blankProgram, programLabel,
  };
})(window.TL = window.TL || {});
