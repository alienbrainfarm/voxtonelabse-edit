const assert = require('assert');
const TL = require('./load')('sysex.js', 'model.js', 'params.js', 'midi.js', 'simulator.js');
const S = TL.sysex, F = S.FUNC;
const frame = (func, rest = []) => [0xf0, 0x42, 0x30, 0x6d, 8, func, ...rest, 0xf7];
const identity = [0xf0, 0x7e, 0, 6, 2, 0x42, 0x6d, 0, 8, 0, 0, 0, 1, 0, 0xf7];
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('truncated and oversized dumps cannot be parsed as complete replies', () => {
  for (const [func, address, size] of [[F.CUR_PROG_DUMP, [], 92], [F.PROG_DUMP, [0x20, 95], 92],
    [F.PROG_DUMP, [0, 0], 8832], [F.GLOBAL_DUMP, [], 16], [F.ALL_DATA_DUMP, [], 8940]]) {
    const payload = Array.from({ length: size }, (_, i) => i & 255);
    const valid = S.build(0, func, address, payload);
    assert.deepStrictEqual(Array.from(S.parse(valid).data), payload);
    for (const invalid of [frame(func, address), valid.slice(0, -2).concat(0xf7), valid.slice(0, -1).concat(0, 0xf7)]) {
      assert.strictEqual(S.parse(invalid), null, `function ${func}: bad size ${invalid.length}`);
    }
  }
});

test('framing, 7-bit bytes and bounded array input are required before decoding', () => {
  for (const bad of [null, undefined, {}, 'string', [], [0xf0, 0xf7], identity.slice(0, 7).concat(0xf7),
    identity.slice(0, -1).concat(0, 0xf7), frame(F.DATA_LOAD_COMPLETED, [0]),
    frame(F.DATA_LOAD_ERROR, [0]), frame(F.DATA_FORMAT_ERROR, [0])]) assert.strictEqual(S.parse(bad), null);
  for (const value of [-1, 128, 256, 0.5, NaN, undefined, '0']) {
    const bad = frame(F.PARAM_CHANGE, [6, 0, 0, 1]); bad[8] = value;
    assert.strictEqual(S.parse(bad), null, `invalid byte ${String(value)}`);
  }
  const huge = new Array(10226).fill(0);
  huge[Symbol.iterator] = () => { throw new Error('oversized input must not be copied'); };
  assert.strictEqual(S.parse(huge), null);
  const unbounded = { *[Symbol.iterator]() { throw new Error('iterable must not be consumed'); } };
  assert.strictEqual(S.parse(unbounded), null);
  const invalidId = identity.slice(); invalidId[2] = 16;
  assert.strictEqual(S.parse(invalidId), null);
  assert.strictEqual(S.parse(identity).kind, 'inquiryReply');
});

test('program addresses and mode flags are checked without using ignored program numbers', () => {
  for (const func of [F.PROG_REQ, F.PROG_DUMP]) {
    for (const address of [[1, 0], [0x21, 0], [0x20, 96], [0x20, 127]]) {
      const bad = func === F.PROG_DUMP ? S.build(0, func, address, new Uint8Array(92)) : frame(func, address);
      assert.strictEqual(S.parse(bad), null);
    }
  }
  for (const func of [F.WRITE_REQ, F.WRITE_COMPLETED, F.WRITE_ERROR]) {
    for (const bad of [[], [0], [1, 0], [0, 96], [0, 0, 0]]) assert.strictEqual(S.parse(frame(func, bad)), null);
    assert(S.parse(frame(func, [0, 95])));
  }
  for (const func of [F.PROG_CHANGE, F.MODE_DATA]) {
    for (const bad of [[], [0], [0, 96], [1, 0], [0x30, 0], [0x70, 0], [0, 0, 0]]) assert.strictEqual(S.parse(frame(func, bad)), null);
    assert(S.parse(frame(func, [0x40, 95])));
  }
  assert.strictEqual(S.parse(frame(F.MODE_DATA, [0x20, 0])), null);
  // Korg NOTE 6/7: p is unused for mode-only and all-program operations.
  assert.strictEqual(S.parse(frame(F.PROG_CHANGE, [0x50, 127])).option, 1);
  assert(S.parse(frame(F.PROG_REQ, [0, 127])));
  assert.strictEqual(S.parse(S.build(0, F.PROG_DUMP, [0, 127], new Uint8Array(8832))).kind, 'allPrograms');
  for (const func of [F.CUR_PROG_REQ, F.GLOBAL_REQ, F.ALL_DATA_REQ, F.MODE_REQ]) {
    assert(S.parse(frame(func))); assert.strictEqual(S.parse(frame(func, [0])), null);
  }
});

test('parameter changes cannot exceed addresses, type tables or storage ranges', () => {
  const valid = [[0, 7, 126], [2, 9, 1], [2, 16, 5], [3, 0, 15], [3, 1, 10], [3, 2, 10], [3, 3, 10],
    [3, 4, 15], [3, 5, 10], [3, 6, 15], [3, 7, 10], [4, 5, 100], [6, 0, 8000], [8, 7, 50],
    [12, 0, 49], [12, 1, 8000], [13, 2, 8000], [14, 1, 11], [0x40, 0, 15], [0x41, 6, 1], [0x42, 8, 96], [0x43, 1, 1]];
  for (const values of valid) assert.strictEqual(S.parse(S.msg.paramChange(0, ...values)).value, values[2]);
  for (const values of [[127, 0, 0], [0, 8, 65], [2, 10, 1], [2, 17, 0], [2, 0, 2], [2, 16, 6],
    [3, 0, 16], [3, 0, 127], [3, 1, 11], [3, 2, 11], [3, 3, 11], [3, 4, 16], [3, 5, 11], [3, 8, 0],
    [4, 6, 0], [4, 0, 256], [6, 0, 8001], [6, 6, 0], [8, 7, 51], [8, 0, 101],
    [12, 3, 0], [12, 1, 8001], [14, 2, 0], [14, 1, 12], [0x40, 0, 16], [0x40, 1, 0],
    [0x41, 3, 1], [0x41, 7, 1], [0x41, 0, 2], [0x42, 9, 0], [0x42, 0, 97], [0x43, 0, 1], [0x43, 1, 2]]) {
    assert.strictEqual(S.parse(S.msg.paramChange(0, ...values)), null, values.join(','));
  }
  for (const rest of [[], [6, 0, 0], [6, 0, 0, 1, 0]]) assert.strictEqual(S.parse(frame(F.PARAM_CHANGE, rest)), null);
});

test('invalid effect types leave every program byte unchanged and do not throw', () => {
  for (const fx of TL.params.EFFECTS) {
    for (const type of [-1, fx.types.length, 127, 256, 0.5, NaN, undefined, '0']) {
      const prog = TL.SimulatedToneLab.initProgram('SECURITY');
      const before = Array.from(prog);
      assert.strictEqual(TL.params.applyTypeChange(prog, fx, type), false);
      assert.deepStrictEqual(Array.from(prog), before);
    }
  }
  const prog = TL.SimulatedToneLab.initProgram('SECURITY');
  TL.params.applyTypeChange(prog, TL.params.PEDAL, 2);
  assert.strictEqual(prog[13], 2); assert.strictEqual(prog[15], 32); assert.strictEqual(prog[77] & 63, 8);
});

test('invalid input cannot satisfy a pending request, emit events or reach the logger', async () => {
  const midi = new TL.Midi(), events = [], logs = [];
  midi.output = { send() {} }; // Hardware I/O is the only external dependency.
  midi.on(m => events.push(m)); midi.log = (direction, data) => logs.push([direction, data]);
  const pending = midi.request(S.msg.currentProgramRequest(0), m => m.kind === 'currentProgram', 1000);
  logs.length = 0;
  midi.receive(frame(F.CUR_PROG_DUMP));
  assert.strictEqual(midi.waiters.length, 1);
  for (const bad of [[0xc0], [0xc0, 0, 0], [0xc0, 96], [0xb0, 1], [0xb0, 1, 0x80], [0xb0, 1, 1, 1], null,
    [0xc0, -1], [0xc0, 1.5], S.msg.paramChange(0, 3, 0, 127)]) midi.receive(bad);
  assert.strictEqual(events.length, 0); assert.strictEqual(logs.length, 0);
  midi.receive(S.msg.currentProgramDump(0, new Uint8Array(92)));
  assert.strictEqual((await pending).data.length, 92);
  midi.receive([0xc0, 95]); midi.receive([0xb0, 1, 127]);
  assert.deepStrictEqual(events.map(m => m.kind), ['midiProgramChange', 'cc']);
});

test('the simulator still answers identity, program, bank, global, mode and write exchanges', async () => {
  const midi = new TL.Midi(); midi.open(TL.Midi.SIM_ID, TL.Midi.SIM_ID);
  for (const [request, kind, length] of [[S.msg.inquiry(), 'inquiryReply'], [S.msg.currentProgramRequest(0), 'currentProgram', 92],
    [S.msg.programRequest(0, 95), 'program', 92], [S.msg.allProgramsRequest(0), 'allPrograms', 8832],
    [S.msg.globalRequest(0), 'global', 16], [S.msg.modeRequest(0), 'modeData'], [S.msg.writeRequest(0, 95), 'writeOk']]) {
    const reply = await midi.request(request, m => m.kind === kind, 1000);
    if (length) assert.strictEqual(reply.data.length, length);
  }
  await midi.sendWithAck(S.msg.paramChange(0, 3, 0, 2), 1000);
  assert.strictEqual(midi.sim.edit[13], 2);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok:', name); }
    catch (e) { failed++; console.error('FAIL:', name, e); }
  }
  process.exit(failed ? 1 : 0);
})();
