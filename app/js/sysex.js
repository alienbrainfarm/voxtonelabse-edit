// ToneLab SE SysEx codec.
// Reverse engineered from SeTnLbSE.EXE (FUN_004080c7 = sender, see docs/protocol.md).
//
//   F0 42 3n 6D 08 <func> [b1] [b2] <data> F7
//
// Payloads shorter than 8 bytes are sent as-is (masked to 7 bits); longer
// payloads use Korg's 7-in-8 packing: each group of up to 7 data bytes is
// preceded by a byte whose bit j holds the MSB of data byte j.
(function (TL) {
  'use strict';

  const KORG = 0x42;
  const MODEL = [0x6d, 0x08];
  const PROGRAM_SIZE = 92;
  const GLOBAL_SIZE = 16;
  const NUM_PROGRAMS = 96;

  const FUNC = {
    CUR_PROG_REQ: 0x10,
    PROG_REQ: 0x1c,        // 0x20 nn = one program, 00 00 = all programs
    GLOBAL_REQ: 0x0e,
    ALL_DATA_REQ: 0x0f,
    MODE_REQ: 0x12,
    WRITE_REQ: 0x11,       // 00 nn
    CUR_PROG_DUMP: 0x40,
    PARAM_CHANGE: 0x41,
    PROG_DUMP: 0x4c,       // 0x20 nn = one program, 00 00 = all programs
    PROG_CHANGE: 0x4e,     // 0x20 nn
    ALL_DATA_DUMP: 0x50,
    GLOBAL_DUMP: 0x51,
    // replies from the device (Korg ToneLabSE MIDI Implementation 1.0)
    MODE_DATA: 0x42,
    DATA_FORMAT_ERROR: 0x26,
    WRITE_COMPLETED: 0x21,
    WRITE_ERROR: 0x22,
    DATA_LOAD_COMPLETED: 0x23,
    DATA_LOAD_ERROR: 0x24,
  };

  function pack7(data) {
    const out = [];
    for (let i = 0; i < data.length; i += 7) {
      const group = data.slice(i, i + 7);
      let msbs = 0;
      group.forEach((b, j) => { if (b & 0x80) msbs |= 1 << j; });
      out.push(msbs);
      group.forEach(b => out.push(b & 0x7f));
    }
    return out;
  }

  function unpack7(data) {
    const out = [];
    for (let i = 0; i < data.length; i += 8) {
      const msbs = data[i];
      for (let j = 0; j < 7 && i + 1 + j < data.length; j++) {
        out.push(data[i + 1 + j] | ((msbs >> j) & 1 ? 0x80 : 0));
      }
    }
    return out;
  }

  function packedLength(n) { return n + Math.ceil(n / 7); }

  // Build a Korg/ToneLab SE message. extra: 0-2 address bytes after func.
  function build(channel, func, extra, data) {
    extra = extra || [];
    data = data ? Array.from(data) : [];
    const body = data.length >= 8 ? pack7(data) : data.map(b => b & 0x7f);
    return [0xf0, KORG, 0x30 | (channel & 0x0f), ...MODEL, func, ...extra, ...body, 0xf7];
  }

  const msg = {
    inquiry: () => [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7],
    currentProgramRequest: ch => build(ch, FUNC.CUR_PROG_REQ),
    programRequest: (ch, n) => build(ch, FUNC.PROG_REQ, [0x20, n]),
    allProgramsRequest: ch => build(ch, FUNC.PROG_REQ, [0x00, 0x00]),
    globalRequest: ch => build(ch, FUNC.GLOBAL_REQ),
    allDataRequest: ch => build(ch, FUNC.ALL_DATA_REQ),
    modeRequest: ch => build(ch, FUNC.MODE_REQ),
    currentProgramDump: (ch, prog) => build(ch, FUNC.CUR_PROG_DUMP, [], prog),
    programDump: (ch, n, prog) => build(ch, FUNC.PROG_DUMP, [0x20, n], prog),
    allProgramsDump: (ch, all) => build(ch, FUNC.PROG_DUMP, [0x00, 0x00], all),
    globalDump: (ch, glob) => build(ch, FUNC.GLOBAL_DUMP, [], glob),
    writeRequest: (ch, n) => build(ch, FUNC.WRITE_REQ, [0x00, n]),
    programChange: (ch, n) => build(ch, FUNC.PROG_CHANGE, [0x20, n]),
    paramChange: (ch, p1, p2, value) =>
      build(ch, FUNC.PARAM_CHANGE, [], [p1, p2, (value >> 7) & 0x7f, value & 0x7f]),
  };

  // Parse an incoming message. Returns null for anything that isn't ours.
  function parse(bytes) {
    bytes = Array.from(bytes);
    if (bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7) return null;
    if (bytes[1] === 0x7e && bytes[3] === 0x06 && bytes[4] === 0x02) {
      // Universal device inquiry reply: F0 7E 0n 06 02 42 <fam lo hi> <member lo hi> <ver x4> F7
      return {
        kind: 'inquiryReply',
        channel: bytes[2] & 0x0f,
        manufacturer: bytes[5],
        family: bytes[6] | (bytes[7] << 7),
        member: bytes[8] | (bytes[9] << 7),
        version: bytes.slice(10, 14),
      };
    }
    if (bytes[1] !== KORG || (bytes[2] & 0xf0) !== 0x30) return null;
    if (bytes[3] !== MODEL[0] || bytes[4] !== MODEL[1]) return null;
    const channel = bytes[2] & 0x0f;
    const func = bytes[5];
    const rest = bytes.slice(6, -1);
    const m = { channel, func, raw: bytes };
    switch (func) {
      case FUNC.CUR_PROG_DUMP:
        return Object.assign(m, { kind: 'currentProgram', data: unpack7(rest).slice(0, PROGRAM_SIZE) });
      case FUNC.PROG_DUMP: {
        const all = rest[0] === 0x00;
        const data = unpack7(rest.slice(2));
        return all
          ? Object.assign(m, { kind: 'allPrograms', data: data.slice(0, PROGRAM_SIZE * NUM_PROGRAMS) })
          : Object.assign(m, { kind: 'program', number: rest[1], data: data.slice(0, PROGRAM_SIZE) });
      }
      case FUNC.GLOBAL_DUMP:
        return Object.assign(m, { kind: 'global', data: unpack7(rest).slice(0, GLOBAL_SIZE) });
      case FUNC.ALL_DATA_DUMP:
        return Object.assign(m, { kind: 'allData', data: unpack7(rest) });
      case FUNC.PARAM_CHANGE:
        return Object.assign(m, {
          kind: 'param', p1: rest[0], p2: rest[1], value: ((rest[2] & 0x7f) << 7) | (rest[3] & 0x7f),
        });
      case FUNC.PROG_CHANGE:
      case FUNC.MODE_DATA:
        // 0moo0000: m = 0 program select / 1 fx on-off mode; oo = 00 mode+program, 01 mode only, 10 program only
        return Object.assign(m, {
          kind: func === FUNC.MODE_DATA ? 'modeData' : 'programChange',
          mode: (rest[0] >> 6) & 1, option: (rest[0] >> 4) & 3, number: rest[1],
        });
      case FUNC.DATA_LOAD_COMPLETED: return Object.assign(m, { kind: 'ack' });
      case FUNC.DATA_LOAD_ERROR: return Object.assign(m, { kind: 'nak' });
      case FUNC.DATA_FORMAT_ERROR: return Object.assign(m, { kind: 'formatError' });
      case FUNC.WRITE_COMPLETED: return Object.assign(m, { kind: 'writeOk', number: rest[1] });
      case FUNC.WRITE_ERROR: return Object.assign(m, { kind: 'writeError', number: rest[1] });
      default:
        return Object.assign(m, { kind: 'unknown', data: rest });
    }
  }

  TL.sysex = { FUNC, PROGRAM_SIZE, GLOBAL_SIZE, NUM_PROGRAMS, pack7, unpack7, packedLength, build, msg, parse };
})(window.TL = window.TL || {});
