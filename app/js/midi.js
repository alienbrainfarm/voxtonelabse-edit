// MIDI transport: Web MIDI (Chrome / Edge / Electron, macOS CoreMIDI underneath)
// plus an in-page simulated ToneLab SE for trying the editor without hardware.
(function (TL) {
  'use strict';

  const SIM_ID = '__sim__';

  class Midi {
    constructor() {
      this.access = null;
      this.input = null;
      this.output = null;
      this.channel = 0;
      this.listeners = new Set();
      this.waiters = [];
      this.log = null; // optional function(dir, bytes)
      this.sim = null;
    }

    async init() {
      if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI support. Use the ToneLab SE Editor app, Chrome or Edge.');
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => this.emit({ kind: 'portsChanged' });
    }

    inputs() {
      const list = this.access ? Array.from(this.access.inputs.values()).map(p => ({ id: p.id, name: p.name })) : [];
      return list.concat([{ id: SIM_ID, name: 'Simulated ToneLab SE (no hardware)' }]);
    }

    outputs() {
      const list = this.access ? Array.from(this.access.outputs.values()).map(p => ({ id: p.id, name: p.name })) : [];
      return list.concat([{ id: SIM_ID, name: 'Simulated ToneLab SE (no hardware)' }]);
    }

    open(inputId, outputId) {
      if (this.input && this.input.onmidimessage !== undefined) this.input.onmidimessage = null;
      this.input = null;
      this.output = null;
      if (inputId === SIM_ID || outputId === SIM_ID) {
        if (!this.sim) this.sim = new TL.SimulatedToneLab(bytes => this.receive(bytes));
        this.input = this.output = { sim: true, name: 'Simulated ToneLab SE' };
        return;
      }
      if (inputId && this.access) {
        this.input = this.access.inputs.get(inputId) || null;
        if (this.input) this.input.onmidimessage = e => this.receive(e.data);
      }
      if (outputId && this.access) this.output = this.access.outputs.get(outputId) || null;
    }

    get connected() { return !!(this.input && this.output); }

    send(bytes) {
      if (!this.output) throw new Error('No MIDI output selected');
      if (this.log) this.log('out', bytes);
      if (this.output.sim) this.sim.receive(Uint8Array.from(bytes));
      else this.output.send(bytes);
    }

    receive(data) {
      const bytes = Array.from(data);
      if (bytes[0] === 0xfe || bytes[0] === 0xf8) return; // active sensing / clock
      if (this.log) this.log('in', bytes);
      let m;
      if (bytes[0] === 0xf0) {
        m = TL.sysex.parse(bytes);
        if (m && m.channel !== undefined && m.kind !== 'inquiryReply' && m.channel !== this.channel) return;
      } else if ((bytes[0] & 0xf0) === 0xc0) {
        m = { kind: 'midiProgramChange', channel: bytes[0] & 0x0f, number: bytes[1] };
      } else if ((bytes[0] & 0xf0) === 0xb0) {
        m = { kind: 'cc', channel: bytes[0] & 0x0f, cc: bytes[1], value: bytes[2] };
      }
      if (!m) return;
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i];
        if (w.match(m)) {
          this.waiters.splice(i, 1);
          clearTimeout(w.timer);
          w.resolve(m);
          return;
        }
      }
      this.emit(m);
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(m) { this.listeners.forEach(fn => fn(m)); }

    // Send a message and wait for a reply matching `match`.
    request(bytes, match, timeoutMs) {
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        w.timer = setTimeout(() => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error('No reply from the ToneLab SE. Check the MIDI cables, the MIDI channel, and that System Exclusive Out is on in its Global settings.'));
        }, timeoutMs || 5000);
        this.waiters.push(w);
        try { this.send(bytes); } catch (e) { clearTimeout(w.timer); this.waiters.splice(this.waiters.indexOf(w), 1); reject(e); }
      });
    }

    // Dumps sent to the ToneLab are answered with DATA LOAD COMPLETED / ERROR.
    async sendWithAck(bytes, timeoutMs) {
      const r = await this.request(bytes, m => m.kind === 'ack' || m.kind === 'nak', timeoutMs || 5000);
      if (r.kind === 'nak') throw new Error('The ToneLab SE rejected the data (DATA LOAD ERROR).');
      return r;
    }
  }

  TL.Midi = Midi;
  TL.Midi.SIM_ID = SIM_ID;
})(window.TL = window.TL || {});
