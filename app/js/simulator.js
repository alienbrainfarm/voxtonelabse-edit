// A software ToneLab SE that speaks the same SysEx as the hardware, so the
// editor can be tried (and tested) without a pedal attached.
(function (TL) {
  'use strict';

  class SimulatedToneLab {
    constructor(reply) {
      this.reply = bytes => setTimeout(() => reply(Uint8Array.from(bytes)), 5);
      this.channel = 0;
      this.programs = [];
      for (let n = 0; n < TL.sysex.NUM_PROGRAMS; n++) this.programs.push(SimulatedToneLab.initProgram('SIM ' + TL.model.programLabel(n)));
      this.current = 0;
      this.edit = Uint8Array.from(this.programs[0]);
      this.global = new Uint8Array(TL.sysex.GLOBAL_SIZE);
    }

    static initProgram(name) {
      const p = TL.model.blankProgram();
      TL.model.setName(p, name);
      p[10] = 0xfa; p[12] = 0; p[13] = 8; p[14] = 30; p[15] = 50; p[16] = 50;
      p[22] = 0; p[23] = 20; p[24] = 50; p[26] = 50;
      p[31] = 0; p[32] = 1; p[33] = 44; p[34] = 30; p[35] = 60; p[38] = 30;
      p[40] = 5; p[41] = 40; p[42] = 20; p[43] = 30; p[44] = 10; p[46] = 30;
      p[49] = 3; p.set([50, 100, 50, 50, 50, 50, 50, 10], 50); p[58] = 6;
      p[63] = 6; p.set([60, 100, 50, 50, 50, 50, 50, 10], 64); p[72] = 9;
      p[77] = 1; p[81] = 100; p[82] = 1; p[86] = 100; p[87] = 4; p[88] = 6;
      return p;
    }

    send(func, extra, data) { this.reply(TL.sysex.build(this.channel, func, extra, data)); }

    receive(bytes) {
      const F = TL.sysex.FUNC;
      if (bytes[0] === 0xf0 && bytes[1] === 0x7e && bytes[3] === 0x06 && bytes[4] === 0x01) {
        this.reply([0xf0, 0x7e, this.channel, 0x06, 0x02, 0x42, 0x6d, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0xf7]);
        return;
      }
      const m = TL.sysex.parse(bytes);
      if (!m || m.kind === 'inquiryReply' || m.channel !== this.channel) return;
      const rest = bytes.slice(6, -1);
      switch (m.func) {
        case F.CUR_PROG_REQ: this.send(F.CUR_PROG_DUMP, [], this.edit); break;
        case F.PROG_REQ:
          if (rest[0] === 0x20) this.send(F.PROG_DUMP, [0x20, rest[1]], this.programs[rest[1]]);
          else this.send(F.PROG_DUMP, [0, 0], this.programs.flatMap(p => Array.from(p)));
          break;
        case F.GLOBAL_REQ: this.send(F.GLOBAL_DUMP, [], this.global); break;
        case F.CUR_PROG_DUMP: this.edit = Uint8Array.from(m.data); this.send(F.DATA_LOAD_COMPLETED); break;
        case F.PROG_DUMP:
          if (m.kind === 'program') this.programs[m.number] = Uint8Array.from(m.data);
          else for (let n = 0; n < this.programs.length; n++) this.programs[n] = Uint8Array.from(m.data.slice(n * 92, n * 92 + 92));
          this.send(F.DATA_LOAD_COMPLETED);
          break;
        case F.GLOBAL_DUMP: this.global = Uint8Array.from(m.data); this.send(F.DATA_LOAD_COMPLETED); break;
        case F.PARAM_CHANGE:
          if (m.p1 === 3 && m.p2 <= 3) TL.params.applyTypeChange(this.edit, TL.params.EFFECTS[m.p2], m.value);
          else TL.model.applyRemote(this.edit, m.p1, m.p2, m.value);
          this.send(F.DATA_LOAD_COMPLETED);
          break;
        case F.PROG_CHANGE:
          if (m.option !== 1) {
            this.current = rest[1];
            this.edit = Uint8Array.from(this.programs[this.current]);
          }
          this.send(F.DATA_LOAD_COMPLETED);
          break;
        case F.MODE_REQ: this.send(F.MODE_DATA, [0x00, this.current]); break;
        case F.WRITE_REQ:
          this.programs[rest[1]] = Uint8Array.from(this.edit);
          this.send(F.WRITE_COMPLETED, [0x00, rest[1]]);
          break;
      }
    }

    // Simulate the user turning a knob on the pedal itself.
    turnKnob(offset, value) {
      const c = TL.model.set(this.edit, offset, value);
      if (c) this.send(TL.sysex.FUNC.PARAM_CHANGE, [], [c.p1, c.p2, (c.value >> 7) & 0x7f, c.value & 0x7f]);
    }
  }

  TL.SimulatedToneLab = SimulatedToneLab;
})(window.TL = window.TL || {});
