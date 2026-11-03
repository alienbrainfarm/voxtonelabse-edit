// ToneLab SE parameter definitions.
// Source: Korg "VOX ToneLabSE MIDI IMPLEMENTATION" v1.0 (2003-11-20), cross-checked
// against SeTnLbSE.EXE (name tables at DATA 0x418244.., expression-target tables
// at 0x4185b4 / 0x4187a5 / 0x41893e / 0x4189df, knob label bitmaps).
//
// Effect parameter "o" is the offset inside the effect's block, as in the
// implementation's TABLE 1-1..1-4. Byte offset in the program = block base + o.
// For delay, o=0 is the 16-bit TIME (bytes 32-33) and o>=2 are single bytes.
(function (TL) {
  'use strict';

  // TABLE *4: speed value -> Hz
  const SPEED_HZ = [];
  (function () {
    const runs = [[10, 0.100, 0.005], [15, 0.15, 0.01], [15, 0.30, 0.02], [10, 0.60, 0.04],
      [10, 1.00, 0.05], [15, 1.5, 0.1], [15, 3.0, 0.2], [10, 6.0, 0.4]];
    for (const [n, start, step] of runs) for (let i = 0; i < n; i++) SPEED_HZ.push(Math.round((start + i * step) * 1000) / 1000);
    SPEED_HZ.push(10.0);
  })();

  // As the original: raw 0-9 "%d.%03d Hz", raw 100 "10.00 Hz", otherwise "%d.%02d Hz".
  function hzText(hz) {
    return hz < 0.15 ? hz.toFixed(3) + ' Hz' : hz.toFixed(2) + ' Hz';
  }

  // Display formats. Each: text(raw) and parse(text) -> raw (or null).
  const num = s => { const v = parseFloat(String(s).replace(/[^0-9.+-]/g, '')); return isNaN(v) ? null : v; };
  const FMT = {
    k0: { text: r => (r / 10).toFixed(1), parse: s => { const v = num(s); return v === null ? null : Math.round(v * 10); } },
    k1: { text: r => ((r + 10) / 10).toFixed(1), parse: s => { const v = num(s); return v === null ? null : Math.round(v * 10) - 10; } },
    hz: {
      text: r => hzText(SPEED_HZ[r]),
      parse: s => {
        const v = num(s); if (v === null) return null;
        let best = 0; SPEED_HZ.forEach((hz, i) => { if (Math.abs(hz - v) < Math.abs(SPEED_HZ[best] - v)) best = i; });
        return best;
      },
    },
    ms: { text: r => r + ' ms', parse: s => num(s) },
    ms2: { text: r => (r * 2) + ' ms', parse: s => { const v = num(s); return v === null ? null : Math.round(v / 2); } },
    ms5: { text: r => (r * 5) + ' ms', parse: s => { const v = num(s); return v === null ? null : Math.round(v / 5); } },
    pitch: { text: r => { const v = r - 24; return (v >= 0 ? '+' : '') + v; }, parse: s => { const v = num(s); return v === null ? null : Math.round(v) + 24; } },
    fine: { text: r => { const v = r - 50; return (v >= 0 ? '+' : '') + v + ' cent'; }, parse: s => { const v = num(s); return v === null ? null : Math.round(v) + 50; } },
    nr: { text: r => r === 0 ? 'OFF' : (r * 0.2).toFixed(1), parse: s => /off/i.test(s) ? 0 : (num(s) === null ? null : Math.round(num(s) * 5)) },
    plus1: { text: r => String(r + 1), parse: s => { const v = num(s); return v === null ? null : Math.round(v) - 1; } },
    raw: { text: r => String(r), parse: s => num(s) },
  };
  function listFmt(options) {
    return {
      text: r => options[r] !== undefined ? options[r] : String(r),
      parse: s => { const i = options.findIndex(o => o.toUpperCase() === String(s).trim().toUpperCase()); return i >= 0 ? i : null; },
      options,
    };
  }

  // Parameter constructors: p(o, label, min, max, fmt, expTarget)
  const p = (o, label, min, max, fmt, exp) => ({ o, label, min, max, fmt, exp: !!exp });
  const K0 = (o, label, exp) => p(o, label, 0, 100, 'k0', exp);
  const K1 = (o, label, exp) => p(o, label, 0, 90, 'k1', exp);
  const L = (o, label, options) => p(o, label, 0, options.length - 1, listFmt(options), false);
  const ORDER = o => L(o, 'ORDER', ['PRE', 'POST']);
  const POLARITY = o => L(o, 'POLARITY', ['UP', 'DOWN']);
  const WAHTYPE = o => L(o, 'TYPE', ['V847', 'V848']);
  const SPEED = (o, label, min, exp) => p(o, label, min || 0, 100, 'hz', exp !== false);

  const drive = [K1(0, 'DRIVE', 1), K0(1, 'LEVEL', 1), K1(2, 'TONE', 1)];

  const PEDAL = {
    name: 'PEDAL', typeOffset: 13, base: 14, sw: [10, 0], expBase: 8, expPrefix: 'P/',
    types: [
      { name: 'COMP', params: [K1(0, 'SENS', 1), K0(1, 'LEVEL', 1), K1(2, 'ATTACK', 1)] },
      { name: 'ACOUSTIC', params: [K1(0, 'BODY', 1), K0(1, 'BASS', 1), K0(2, 'TREBLE', 1)] },
      { name: 'VOX WAH', params: [K1(1, 'CLOSE'), K1(2, 'OPEN'), K1(3, 'MANUAL', 1), WAHTYPE(4), ORDER(5)] },
      { name: 'AUTO WAH', params: [K0(0, 'SENS', 1), POLARITY(1), K1(2, 'ATTACK', 1), WAHTYPE(4), ORDER(5)] },
      { name: 'U-VIBE', params: [SPEED(0, 'SPEED', 50), K0(1, 'DEPTH', 1), K0(2, 'MIX')] },
      { name: 'BLK/ORG PHASE', params: [SPEED(0, 'SPEED'), K0(1, 'DEPTH', 1), K0(2, 'RESONANCE', 1), K1(3, 'MANUAL', 1), L(4, 'TYPE', ['BLK', 'ORG1', 'ORG2']), ORDER(5)] },
      { name: 'OCTAVE', params: [K0(0, 'DIRECT', 1), K0(1, '1 OCTAVE', 1), K0(2, '2 OCTAVE', 1)] },
      { name: 'RING MODULATOR', params: [K0(0, 'DIRECT', 1), K0(1, 'EFFECT', 1), K1(2, 'FILTER', 1), K0(3, 'MANUAL', 1)] },
      { name: 'TREBLE BOOST', params: drive },
      { name: 'TUBE OD', params: drive },
      { name: 'SUPER OD', params: drive },
      { name: 'BOUTIQUE', params: drive },
      { name: 'FAT DIST', params: drive },
      { name: 'ORANGE DIST', params: drive },
      { name: 'FUZZ', params: drive },
      { name: 'OCTAFUZZ', params: drive },
    ],
  };
  // Expression labels in the original are abbreviated (P/RESO, P/1OCT ...).
  const EXP_SHORT = { RESONANCE: 'RESO', '1 OCTAVE': '1OCT', '2 OCTAVE': '2OCT', FEEDBACK: 'FBACK', 'LO DAMP': 'LODAMP', 'HI DAMP': 'HIDAMP', DUCKING: 'DUCK' };

  const MODE3 = o => L(o, 'MODE', ['1', '2', '3']);
  const MOD = {
    name: 'MODULATION', typeOffset: 22, base: 23, sw: [10, 1], expBase: 16, expPrefix: 'M/',
    types: [
      { name: 'CLASSIC CHORUS', params: [SPEED(0, 'SPEED'), K0(1, 'DEPTH', 1), K1(3, 'MANUAL', 1), MODE3(4)] },
      { name: 'STEREO CHORUS', params: [SPEED(0, 'SPEED'), K0(1, 'DEPTH', 1), K1(3, 'MANUAL', 1), K0(5, 'MIX', 1)] },
      { name: 'CLASSIC FLANGER', params: [SPEED(0, 'SPEED'), K0(1, 'DEPTH', 1), K0(2, 'RESONANCE', 1), K1(3, 'MANUAL', 1), K0(4, 'OFFSET'), K0(5, 'MIX', 1)] },
      { name: 'BI CHORUS', params: [SPEED(0, 'SPEED1'), K0(1, 'DEPTH', 1), K0(2, 'RESONANCE', 1), SPEED(3, 'SPEED2'), L(4, 'MODE', ['SERIAL', 'PARA1', 'PARA2', 'PARA3']), K0(5, 'MIX', 1)] },
      { name: 'DUO PHASE', params: [SPEED(0, 'SPEED1'), K0(1, 'DEPTH', 1), K0(2, 'RESONANCE', 1), SPEED(3, 'SPEED2'), L(4, 'MODE', ['SERIAL1', 'SERIAL2', 'PARA1', 'PARA2', 'PARA3'])] },
      { name: 'TEXTREM', params: [SPEED(0, 'SPEED', 50), K0(1, 'DEPTH', 1), K0(4, 'SPREAD')] },
      { name: 'ROTARY', params: [SPEED(0, 'SPEED1', 45), K0(1, 'DEPTH', 1), SPEED(3, 'SPEED2', 45), K1(4, 'ACCEL', 1)] },
      { name: 'PITCH SHIFTER', params: [p(0, 'PITCH', 0, 48, 'pitch', 1), p(1, 'FINE', 0, 100, 'fine', 1), p(3, 'TRACKING', 5, 75, 'ms2'), K0(4, 'DIRECT', 1), K0(5, 'EFFECT', 1)] },
      { name: 'MOD DELAY', params: [SPEED(0, 'SPEED'), K0(1, 'DEPTH', 1), K0(2, 'FEEDBACK', 1), K1(3, 'TIME', 1), MODE3(4), K0(5, 'MIX', 1)] },
      { name: 'FILTRON', params: [K1(0, 'ATTACK', 1), K0(1, 'DEPTH', 1), K0(2, 'RESONANCE', 1), K1(3, 'MANUAL', 1), POLARITY(4), K0(5, 'SENS', 1)] },
      { name: 'TALK MOD', params: [K1(0, 'ATTACK', 1), K0(1, 'DEPTH', 1),
        L(2, 'TYPE', ['A-E', 'A-I', 'A-O', 'A-U', 'E-I', 'E-O', 'E-U', 'I-O', 'I-U', 'O-U']),
        K1(3, 'MANUAL', 1), POLARITY(4), K0(5, 'SENS', 1)] },
    ],
  };

  const T = (min, max, exp) => p(0, 'TIME', min, max, 'ms', exp);
  const dfb = [K0(2, 'FEEDBACK', 1), K1(3, 'TONE', 1)];
  const DELAY = {
    name: 'DELAY', typeOffset: 31, base: 32, sw: [10, 2], expBase: 24, expPrefix: 'D/', inputTarget: 'D/INPUT',
    types: [
      { name: 'ECHO PLUS', params: [T(26, 2000, 1), ...dfb, K0(5, 'LO DAMP', 1), K0(6, 'MIX', 1)] },
      { name: 'MULTI HEAD', params: [T(1, 2000), ...dfb, L(5, 'MODE', ['1', '2', '3', '4', '5']), K0(6, 'MIX', 1)] },
      { name: 'ANALOG DELAY', params: [T(1, 2000, 1), ...dfb, K0(6, 'MIX', 1)] },
      { name: 'MOD DELAY', params: [T(3, 2000, 1), ...dfb, SPEED(5, 'SPEED'), K0(6, 'MIX', 1)] },
      { name: 'SWEEP DELAY', params: [T(26, 2000, 1), ...dfb, K0(5, 'SENS', 1), K0(6, 'MIX', 1)] },
      { name: 'STEREO DELAY', params: [T(1, 4000), ...dfb, K0(4, 'DUCKING', 1), K0(6, 'MIX', 1)] },
      { name: 'CROSS DELAY', params: [T(1, 4000), ...dfb, K0(4, 'DUCKING', 1), K0(6, 'MIX', 1)] },
      { name: '2TAP DELAY', params: [T(1, 4000), ...dfb, K0(4, 'DUCKING', 1), K0(6, 'MIX', 1)] },
      { name: 'RHYTHM DELAY', params: [T(1, 4000), ...dfb, K0(4, 'DUCKING', 1), p(5, 'RHYTHM', 0, 10, 'plus1'), K0(6, 'MIX', 1)] },
      { name: 'HOLD DELAY', params: [T(1, 8000), ...dfb, K0(6, 'MIX', 1)] },
      { name: 'REVERSE DELAY', params: [T(26, 4000), ...dfb, K0(6, 'MIX')] },
    ],
  };
  // Delay knob slots on the panel: TIME, FEEDBACK, TONE, (o4), (o5), MIX
  DELAY.slotOf = o => (o === 0 ? 0 : o - 1);
  DELAY.byteOf = o => 32 + o;
  DELAY.addrOf = o => [6, o === 0 ? 0 : o - 1];

  const rev = [K1(0, 'TIME', 1), K0(1, 'LO DAMP', 1), K0(2, 'HI DAMP', 1), p(3, 'PRE DLY', 0, 100, 'ms'), K0(5, 'MIX', 1)];
  const REVERB = {
    name: 'REVERB', typeOffset: 40, base: 41, sw: [10, 3], expBase: 32, expPrefix: 'R/', inputTarget: 'R/INPUT',
    types: ['SPRING 1', 'SPRING 2', 'PLATE 1', 'PLATE 2', 'CHAMBER 1', 'CHAMBER 2', 'ROOM 1', 'ROOM 2', 'HALL 1', 'HALL 2']
      .map(name => ({ name, params: rev }))
      .concat([{ name: 'GATE', params: [p(0, 'TIME', 1, 100, 'ms5'), K0(1, 'LO DAMP', 1), K0(2, 'HI DAMP', 1), p(3, 'PRE DLY', 0, 100, 'ms'), L(4, 'SHAPE', ['1', '2']), K0(5, 'MIX')] }]),
  };

  for (const fx of [PEDAL, MOD, REVERB]) {
    fx.slotOf = fx.slotOf || (o => o);
    fx.byteOf = fx.byteOf || (o => fx.base + o);
    fx.addrOf = fx.addrOf || (o => [TL.model.paramAddress(fx.base + o)[0], o]);
  }

  // Per-type knob defaults by panel slot (null = unused), loaded when the effect
  // type changes. From the editor's {min,max,default} tables at DATA 0x419a10
  // (pedal), 0x419398 (mod), 0x4196c8 (delay), 0x4199f8 (reverb).
  const DEFAULTS = {
    PEDAL: [[19, 54, 19], [70, 56, 63], [null, 32, 36, 75, 1, 0], [50, 0, 38, null, 1, 0], [72, 50, 50], [50, 100, 26, 40, 0, 0],
      [50, 35, 17], [50, 100, 43, 55], [60, 60, 50], [21, 79, 71], [8, 91, 73], [35, 38, 69], [43, 42, 72], [45, 69, 66], [40, 69, 72], [54, 65, 74]],
    MODULATION: [[34, 58, null, 0, 0], [18, 31, null, 34, null, 40], [7, 71, 35, 67, 0, 75], [33, 43, 0, 38, 1, 56], [40, 76, 15, 20, 2],
      [96, 42, null, null, 0], [48, 50, null, 99, 40], [31, 50, null, 40, 100, 80], [41, 38, 28, 47, 0, 50], [28, 72, 60, 0, 0, 50], [40, 100, 4, 40, 1, 50]],
    DELAY: [[315, 38, 59, null, 19, 65], [205, 40, 52, null, 2, 60], [378, 34, 59, null, null, 65], [457, 39, 63, null, 16, 70], [457, 39, 63, null, 53, 70],
      [756, 44, 69, 0, null, 68], [756, 44, 69, 0, null, 68], [756, 44, 69, 0, null, 68], [504, 44, 69, 0, 5, 68], [4000, 0, 90, null, null, 85], [2000, 44, 69, null, null, 50]],
    REVERB: [[60, 16, 26, 0, null, 42], [50, 16, 26, 0, null, 42], [33, 17, 25, 30, null, 42], [42, 0, 30, 46, null, 43], [44, 18, 13, 42, null, 39],
      [51, 0, 32, 42, null, 39], [35, 46, 25, 0, null, 59], [64, 0, 12, 32, null, 58], [59, 0, 17, 0, null, 44], [63, 18, 21, 23, null, 43], [13, 31, 26, 0, 0, 28]],
  };

  // Mirror of the original editor's local resets on an effect type change
  // (InitXxxKnobsForType + ResetExpTargetsOnTypeChange): section on, knobs to
  // defaults, EXP pedals aimed at that section to OFF 0..100 (VOX WAH grabs EXP1).
  function applyTypeChange(prog, fx, type) {
    const M = TL.model;
    const oldTargets = [1, 2].map(n => expTargets(prog).find(t => t.code === (prog[EXP[n].target] & 0x3f)));
    prog[fx.typeOffset] = type;
    prog[fx.sw[0]] |= 1 << fx.sw[1];
    const t = fx.types[type], defs = DEFAULTS[fx.name][type] || [];
    for (const prm of t.params) {
      const d = defs[fx.slotOf(prm.o)];
      if (d !== null && d !== undefined) M.set(prog, fx.byteOf(prm.o), d);
    }
    [1, 2].forEach((n, i) => {
      if (oldTargets[i] && oldTargets[i].fx === fx) {
        prog[EXP[n].target] &= 0xc0;
        M.set(prog, EXP[n].min, 0);
        M.set(prog, EXP[n].max, 100);
      }
    });
    if (fx === PEDAL && type === 2) {
      prog[EXP[1].target] = (prog[EXP[1].target] & 0xc0) | PEDAL.expBase;
      M.set(prog, EXP[1].min, 0);
      M.set(prog, EXP[1].max, 90);
    }
  }

  const AMPS = ['AC15', 'AC15TB', 'AC30', 'AC30TB', 'UK BLUES', 'UK 68P', "UK '80S", "UK '90S", 'UK MODERN', 'RECTO', 'US HIGAIN', 'BOUTIQUE OD', 'BOUTIQUE CL', 'BLACK 2x12', 'TWEED 1x12', 'TWEED 4x10'];
  const AMP_LONG = ['AC15', 'AC15 Top Boost', 'AC30', 'AC30 Top Boost', 'UK BLUES', 'UK 68P', "UK '80s", "UK '90s", 'UK MODERN', 'RECTO', 'US High Gain', 'BOUTIQUE Over Drive', 'BOUTIQUE Clean', 'BLACK 2x12', 'TWEED 1x12', 'TWEED 4x10'];
  const CABS = ['TWEED 1x8', 'TWEED 1x12', 'TWEED 4x10', 'BLACK 2x10', 'BLACK 2x12', 'VOX AC15', 'VOX AC30', 'VOX AD412', 'UK H30 4x12', 'UK T75 4x12', 'US V30 4x12'];

  // Panel order (presence before ch volume, as on the hardware); offsets relative to the channel base.
  const AMP_KNOBS = [K0(0, 'GAIN'), K0(1, 'VR GAIN'), K0(2, 'TREBLE'), K0(3, 'MIDDLE'), K0(4, 'BASS'), K0(6, 'PRESENCE'), K0(5, 'CH VOL'), p(7, 'NR SENS', 0, 50, 'nr')];
  const AMP = {
    A: { type: 49, base: 50, cab: 58, ampSw: [10, 4], cabSw: [10, 5] },
    B: { type: 63, base: 64, cab: 72, ampSw: [10, 6], cabSw: [10, 7] },
  };

  const SWITCHES = {
    pedal: [10, 0], mod: [10, 1], delay: [10, 2], reverb: [10, 3],
    ampA: [10, 4], cabA: [10, 5], ampB: [10, 6], cabB: [10, 7],
    insert: [11, 0], abch: [11, 1],
  };

  const CHAINS = ['MODULATION → DELAY → REVERB', 'MODULATION → REVERB → DELAY', 'DELAY → MODULATION → REVERB',
    'DELAY → REVERB → MODULATION', 'REVERB → MODULATION → DELAY', 'REVERB → DELAY → MODULATION'];
  const CONTROL_TARGETS = ['INSERT On/Off', 'PEDAL On/Off', 'AMP On/Off', 'CABINET On/Off', 'MOD On/Off', 'DELAY On/Off',
    'REVERB On/Off', 'MOD TAP (SPEED)', 'DELAY TAP (TIME)', 'FLANGER (TRIG)', 'ROTARY (SPD-SW)', 'HOLD DELAY (HOLD)'];
  const FACTORS = ['1/6', '1/4', '1/3', '1/2', '2/3', '3/4', '1', '4/3', '3/2', '2', '3', '4'];

  const EXP = {
    1: { target: 77, min: 78, max: 80 },
    2: { target: 82, min: 83, max: 85 },
  };
  const VOLUME_LIKE = { min: 0, max: 100, fmt: 'k0' };

  // Expression targets available for a program (TABLE 1-7): depends on the
  // currently selected effect types. Returns [{code, name, param}].
  function expTargets(prog) {
    const list = [{ code: 0, name: '-- OFF --' }, { code: 1, name: 'VOLUME', param: VOLUME_LIKE }];
    for (const fx of [PEDAL, MOD, DELAY, REVERB]) {
      const type = fx.types[prog[fx.typeOffset]];
      let code = fx.expBase;
      if (fx.inputTarget) list.push({ code: code++, name: fx.inputTarget, param: VOLUME_LIKE });
      if (!type) continue;
      for (const prm of type.params) {
        if (!prm.exp) continue;
        list.push({ code: code++, name: fx.expPrefix + (EXP_SHORT[prm.label] || prm.label.replace(/\s/g, '')), param: prm, fx });
      }
    }
    list.push({ code: 40, name: 'A/GAIN A', param: VOLUME_LIKE }, { code: 41, name: 'A/VRGN A', param: VOLUME_LIKE },
      { code: 48, name: 'A/GAIN B', param: VOLUME_LIKE }, { code: 49, name: 'A/VRGN B', param: VOLUME_LIKE });
    return list;
  }

  function fmtOf(prm) { return typeof prm.fmt === 'string' ? FMT[prm.fmt] : prm.fmt; }

  // TABLE 2: global data (16 bytes)
  const GLOBAL = {
    channel: { offset: 0, addr: [0x40, 0] },
    bits: [
      { label: 'Program Change Out', bit: 0, addr: [0x41, 0] },
      { label: 'Control Change In & Out', bit: 1, addr: [0x41, 1] },
      { label: 'System Exclusive Out', bit: 2, addr: [0x41, 2] },
      { label: 'Hold Channel A/B', bit: 4, addr: [0x41, 4] },
      { label: 'Initialize Exp 1 Pedal Value', bit: 5, addr: [0x41, 5] },
      { label: 'Initialize Exp 2 Pedal Value', bit: 6, addr: [0x41, 6] },
    ],
    ccs: ['EXP 1 Pedal', 'EXP 2 Pedal', 'CONTROL Pedal', 'PEDAL On/Off', 'MOD On/Off', 'DELAY On/Off', 'REVERB On/Off', 'INSERT On/Off', 'A/B ch Select']
      .map((label, i) => ({ label, offset: 2 + i, addr: [0x42, i] })),
    output: { offset: 15, addr: [0x43, 1], options: ['Amp', 'Line'] },
  };
  // CC assignment value: 0 = Off, 1..0x60 = CC00..CC95
  const ccText = v => v === 0 ? 'OFF' : 'CC' + String(v - 1).padStart(2, '0');

  TL.params = {
    SPEED_HZ, FMT, fmtOf, listFmt,
    PEDAL, MOD, DELAY, REVERB, EFFECTS: [PEDAL, MOD, DELAY, REVERB],
    AMPS, AMP_LONG, CABS, AMP_KNOBS, AMP, SWITCHES,
    CHAINS, CONTROL_TARGETS, FACTORS, EXP, expTargets, GLOBAL, ccText, DEFAULTS, applyTypeChange,
  };
})(window.TL = window.TL || {});
