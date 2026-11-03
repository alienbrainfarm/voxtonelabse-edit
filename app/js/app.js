// ToneLab SE Editor — main controller (edit window + librarian).
(function (TL) {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const P = TL.params, M = TL.model, S = TL.sysex;

  // ---------------------------------------------------------------- prefs
  const PREF_KEY = 'tonelabse.prefs';
  const prefs = Object.assign({
    midiIn: '', midiOut: '', channel: 0,
    autoSysExOut: true, restoreSysExOut: true,
    warnProgChgTarget: true, warnProgChgEditor: true, warnIgnorePedal: true, warnIgnoreChAB: true,
    textColor: 'Dodger', audition: true,
  }, load(PREF_KEY));
  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ } }
  const TEXT_COLORS = { 'Salmon Red': '#ff7a6b', Dodger: '#3fa0ff', 'Light Blue': '#9fd3ff', 'Lime Green': '#7dff6a',
    Goldenrod: '#e8b923', 'Dark Orange': '#ff9a1f', Orchid: '#e07ad8', Silver: '#c8ccd4', White: '#ffffff' };

  // ---------------------------------------------------------------- state
  const midi = new TL.Midi();
  const state = {
    edit: TL.SimulatedToneLab.initProgram('INIT'),
    source: { set: 'device', index: 0 },  // where the edit buffer came from
    dirty: false,                          // unsaved edits in the edit buffer
    showCh: 'A',
    showFx: 'mod',
    tab: 'device',
    device: { programs: new Array(96).fill(null), current: 0, global: null, sysExOutWas: null },
    files: { file1: null, file2: null },   // {name, programs[96], dirty}
    selection: { set: 'device', items: new Set(), anchor: 0 },
    clipboard: [],
    busy: false,
  };

  // ---------------------------------------------------------------- utilities
  let toastTimer;
  function toast(text, isErr) {
    const t = $('#toast');
    t.textContent = text;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 2600);
  }
  function setStatus(text, cls) { const s = $('#status'); s.textContent = text; s.className = 'status ' + cls; }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue;
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach(c => c != null && e.append(c));
    return e;
  }
  function fillSelect(sel, options, value) {
    sel.innerHTML = '';
    options.forEach((o, i) => sel.append(new Option(typeof o === 'string' ? o : o.name, typeof o === 'string' ? i : o.code)));
    if (value !== undefined) sel.value = value;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Modal dialogs ------------------------------------------------------------
  function dialog(title, body, buttons) {
    return new Promise(resolve => {
      const d = $('#dialog'), f = $('#dialog-form');
      f.innerHTML = '';
      f.append(el('h2', { text: title }), body, el('div', { class: 'actions' },
        buttons.map((b, i) => el('button', { value: b.value, class: i === buttons.length - 1 ? 'primary' : '', text: b.label }))));
      // Resolve from the submit itself (synchronous); the dialog's close event can be
      // deferred while the window is in the background.
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      f.onsubmit = e => finish(e.submitter ? e.submitter.value : 'cancel');
      d.oncancel = () => finish('cancel');
      d.onclose = () => finish(d.returnValue || 'cancel');
      d.returnValue = 'cancel';
      d.showModal();
    });
  }
  async function confirm(title, text, okLabel) {
    const r = await dialog(title, el('p', { text }), [{ label: 'Cancel', value: 'cancel' }, { label: okLabel || 'OK', value: 'ok' }]);
    return r === 'ok';
  }
  function progressDialog(title) {
    const bar = el('progress', { max: 100, value: 0 }), label = el('div', { class: 'hint', text: '' });
    const d = $('#dialog'), f = $('#dialog-form');
    f.innerHTML = '';
    f.append(el('h2', { text: title }), bar, label);
    d.showModal();
    return { update(p, text) { bar.value = p; if (text) label.textContent = text; }, close() { d.close(); } };
  }

  // ---------------------------------------------------------------- MIDI out
  // Parameter changes are coalesced per address so fast knob drags don't flood the
  // pedal's 31.25 kbaud input; dumps wait for the stream to settle first.
  const pending = new Map();
  let flushTimer = null, lastParamSent = 0;
  function sendParam(c) {
    if (!c || !midi.connected) return;
    pending.set(c.p1 * 256 + c.p2, c);
    if (!flushTimer) flushTimer = setTimeout(flushParams, 15);
  }
  function flushParams() {
    flushTimer = null;
    for (const c of pending.values()) {
      try { midi.send(S.msg.paramChange(midi.channel, c.p1, c.p2, c.value)); } catch (e) { toast(e.message, true); }
    }
    pending.clear();
    lastParamSent = Date.now();
  }
  async function settle() {
    if (flushTimer) { clearTimeout(flushTimer); flushParams(); }
    const wait = 250 - (Date.now() - lastParamSent);
    if (wait > 0) await sleep(wait);
  }

  // ---------------------------------------------------------------- editing
  function markDirty() {
    if (!state.dirty) { state.dirty = true; renderEditSource(); renderList(); }
  }

  // Change one program byte (or bit) in the edit buffer and send it.
  function edit(offset, value, bit, opts) {
    const c = M.set(state.edit, offset, value, bit);
    if (state.source.set === 'device' || prefs.audition) sendParam(c);
    const ignorable = opts && opts.ignorable;
    if (!ignorable) markDirty();
  }

  function setExpTarget(n, code) {
    const x = P.EXP[n];
    state.edit[x.target] = (state.edit[x.target] & 0xc0) | code;
    sendParam({ p1: M.paramAddress(x.target)[0], p2: 0, value: code });
    const t = P.expTargets(state.edit).find(t => t.code === code);
    if (t && t.param) {
      // A new target gets its full range, as the hardware does when re-assigning.
      edit(x.min, t.param.min);
      edit(x.max, t.param.max);
    }
    markDirty();
    renderExp();
  }

  async function setEffectType(fx, type) {
    // Only the type is transmitted; the pedal re-initialises the effect itself,
    // and we mirror that locally exactly as the original editor did.
    edit(fx.typeOffset, type);
    P.applyTypeChange(state.edit, fx, type);
    renderPanel();
    if (midi.connected && (state.source.set === 'device' || prefs.audition)) {
      // Then read back what the pedal actually holds, in case firmware differs.
      await settle();
      try {
        const r = await midi.request(S.msg.currentProgramRequest(midi.channel), m => m.kind === 'currentProgram', 3000);
        state.edit = Uint8Array.from(r.data);
      } catch (e) { /* offline edit continues with clamped values */ }
    }
    renderPanel();
  }

  // ---------------------------------------------------------------- panel UI
  const knobs = { pedal: [], amp: [], fx: [], exp1: [], exp2: [] };

  function makeKnob(container, list, spec, onchange) {
    const f = P.fmtOf(spec);
    const k = new TL.Knob({ label: spec.label, min: spec.min, max: spec.max, format: f.text, parse: f.parse, onchange });
    container.append(k.el);
    list.push(k);
    return k;
  }
  function emptyKnob(container) { const d = el('div', { class: 'knob empty' }); container.append(d); }

  function buildStatic() {
    fillSelect($('#pedal-type'), P.PEDAL.types.map(t => t.name));
    fillSelect($('#mod-type'), P.MOD.types.map(t => t.name));
    fillSelect($('#delay-type'), P.DELAY.types.map(t => t.name));
    fillSelect($('#reverb-type'), P.REVERB.types.map(t => t.name));
    for (const ch of ['A', 'B']) { fillSelect($('#amp-' + ch), P.AMPS); fillSelect($('#cab-' + ch), P.CABS); }
    fillSelect($('#chain'), P.CHAINS);
    fillSelect($('#control'), P.CONTROL_TARGETS);
    fillSelect($('#factor'), P.FACTORS);

    $('#pedal-type').onchange = e => setEffectType(P.PEDAL, +e.target.value);
    $('#mod-type').onchange = e => { state.showFx = 'mod'; setEffectType(P.MOD, +e.target.value); };
    $('#delay-type').onchange = e => { state.showFx = 'delay'; setEffectType(P.DELAY, +e.target.value); };
    $('#reverb-type').onchange = e => { state.showFx = 'reverb'; setEffectType(P.REVERB, +e.target.value); };
    for (const ch of ['A', 'B']) {
      const a = P.AMP[ch];
      $('#amp-' + ch).onchange = e => {
        selectChannelFor(ch);
        edit(a.type, +e.target.value);
        M.set(state.edit, a.ampSw[0], 1, a.ampSw[1]);
        state.showCh = ch; renderPanel();
      };
      $('#cab-' + ch).onchange = e => {
        selectChannelFor(ch);
        edit(a.cab, +e.target.value);
        M.set(state.edit, a.cabSw[0], 1, a.cabSw[1]);
        state.showCh = ch; renderPanel();
      };
    }
    $('#chain').onchange = e => edit(12, +e.target.value);
    $('#control').onchange = e => {
      state.edit[87] = (state.edit[87] & 0xc0) | +e.target.value;
      sendParam({ p1: 14, p2: 0, value: +e.target.value });
      markDirty();
    };
    $('#factor').onchange = e => edit(88, +e.target.value);
    $('#exp1-target').onchange = e => setExpTarget(1, +e.target.value);
    $('#exp2-target').onchange = e => setExpTarget(2, +e.target.value);

    const lamps = {
      '#sw-insert': P.SWITCHES.insert, '#sw-pedal': P.SWITCHES.pedal, '#sw-mod': P.SWITCHES.mod,
      '#sw-delay': P.SWITCHES.delay, '#sw-reverb': P.SWITCHES.reverb,
      '#sw-amp-A': P.SWITCHES.ampA, '#sw-cab-A': P.SWITCHES.cabA, '#sw-amp-B': P.SWITCHES.ampB, '#sw-cab-B': P.SWITCHES.cabB,
    };
    for (const sel in lamps) {
      const [off, bit] = lamps[sel];
      $(sel).onclick = e => {
        e.stopPropagation();
        edit(off, M.get(state.edit, off, bit) ? 0 : 1, bit, { ignorable: prefs.warnIgnorePedal && false });
        renderSwitches();
      };
    }
    document.querySelectorAll('.ch-tab').forEach(b => {
      b.onclick = () => {
        const ch = b.dataset.ch;
        if (state.showCh === ch) {
          // Clicking the shown channel again selects it on the pedal.
          edit(11, ch === 'B' ? 1 : 0, 1, { ignorable: prefs.warnIgnoreChAB });
        }
        state.showCh = ch;
        renderAmp();
        if (state.tab === 'note') renderTab();
      };
    });
    document.querySelectorAll('.fx-tab').forEach(t => {
      t.addEventListener('click', e => {
        if (e.target.tagName === 'SELECT' || e.target.classList.contains('lamp')) return;
        state.showFx = t.dataset.fx;
        renderFx();
      });
      t.querySelector('select').addEventListener('focus', () => { state.showFx = t.dataset.fx; renderFx(); });
    });

    const name = $('#prog-name');
    name.addEventListener('input', () => {
      // The ToneLab SE displays ASCII 0x20-0x5F only: upper case, digits, punctuation.
      const pos = name.selectionStart;
      name.value = name.value.toUpperCase().replace(/[^\x20-\x5f]/g, '');
      name.setSelectionRange(pos, pos);
    });
    name.addEventListener('change', () => {
      const changes = M.setName(state.edit, name.value);
      changes.forEach(sendParam);
      if (changes.length) { markDirty(); renderList(); }
      name.value = M.getName(state.edit);
    });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

    // amp knobs (8 fixed)
    for (const spec of P.AMP_KNOBS) {
      makeKnob($('#amp-knobs'), knobs.amp, spec, v => { selectChannelFor(state.showCh); edit(P.AMP[state.showCh].base + spec.o, v); });
    }
  }

  // Editing a channel's amp makes it the active channel on the pedal, so you hear it
  // (SelectAmpChannelForControl in the original).
  function selectChannelFor(ch) {
    const want = ch === 'B' ? 1 : 0;
    if (M.get(state.edit, 11, 1) !== want) {
      edit(11, want, 1, { ignorable: prefs.warnIgnoreChAB });
      renderSwitches();
    }
  }

  function renderPanel() {
    $('#prog-name').value = M.getName(state.edit).padEnd(0);
    $('#pedal-type').value = state.edit[13];
    $('#mod-type').value = state.edit[22];
    $('#delay-type').value = state.edit[31];
    $('#reverb-type').value = state.edit[40];
    $('#chain').value = state.edit[12];
    $('#control').value = state.edit[87] & 0x3f;
    $('#factor').value = state.edit[88];
    for (const ch of ['A', 'B']) { $('#amp-' + ch).value = state.edit[P.AMP[ch].type]; $('#cab-' + ch).value = state.edit[P.AMP[ch].cab]; }
    renderSwitches();
    renderPedal();
    renderAmp();
    renderFx();
    renderExp();
    renderEditSource();
  }

  function renderSwitches() {
    const S_ = P.SWITCHES;
    const map = { '#sw-insert': S_.insert, '#sw-pedal': S_.pedal, '#sw-mod': S_.mod, '#sw-delay': S_.delay, '#sw-reverb': S_.reverb,
      '#sw-amp-A': S_.ampA, '#sw-cab-A': S_.cabA, '#sw-amp-B': S_.ampB, '#sw-cab-B': S_.cabB };
    for (const sel in map) {
      const on = !!M.get(state.edit, map[sel][0], map[sel][1]);
      $(sel).classList.toggle('on', on);
      $(sel).setAttribute('aria-pressed', on);
    }
    const active = M.get(state.edit, 11, 1) ? 'B' : 'A';
    document.querySelectorAll('.ch-tab').forEach(b => b.classList.toggle('active', b.dataset.ch === active));
  }

  function renderEffectKnobs(container, list, fx) {
    container.innerHTML = '';
    list.length = 0;
    const type = fx.types[state.edit[fx.typeOffset]];
    if (!type) return;
    const slots = new Array(6).fill(null);
    type.params.forEach(prm => { slots[fx.slotOf(prm.o)] = prm; });
    slots.forEach(prm => {
      if (!prm) { emptyKnob(container); return; }
      const off = fx.byteOf(prm.o);
      const k = makeKnob(container, list, prm, v => { edit(off, v); if (prm.exp) renderExp(); });
      k.set(M.get(state.edit, off));
    });
  }

  function renderPedal() { renderEffectKnobs($('#pedal-knobs'), knobs.pedal, P.PEDAL); }

  function renderAmp() {
    const a = P.AMP[state.showCh];
    knobs.amp.forEach((k, i) => k.set(state.edit[a.base + P.AMP_KNOBS[i].o]));
    document.querySelectorAll('.ch-tab').forEach(b => b.classList.toggle('shown', b.dataset.ch === state.showCh));
    $('#amp-note').textContent = 'Knobs show ' + state.showCh + ' channel: ' + P.AMP_LONG[state.edit[a.type]] + ' / ' + P.CABS[state.edit[a.cab]] +
      '. Click the shown channel tab again to make it the active channel.';
  }

  function renderFx() {
    const fx = { mod: P.MOD, delay: P.DELAY, reverb: P.REVERB }[state.showFx];
    document.querySelectorAll('.fx-tab').forEach(t => t.classList.toggle('shown', t.dataset.fx === state.showFx));
    renderEffectKnobs($('#fx-knobs'), knobs.fx, fx);
  }

  function renderExp() {
    const targets = P.expTargets(state.edit);
    for (const n of [1, 2]) {
      const x = P.EXP[n], code = state.edit[x.target] & 0x3f;
      const sel = $('#exp' + n + '-target');
      fillSelect(sel, targets, code);
      const t = targets.find(t => t.code === code);
      const box = $('#exp' + n + '-knobs');
      box.innerHTML = '';
      knobs['exp' + n] = [];
      if (!t || !t.param) { emptyKnob(box); emptyKnob(box); continue; }
      for (const which of ['min', 'max']) {
        const spec = Object.assign({}, t.param, { label: which.toUpperCase() });
        const k = makeKnob(box, knobs['exp' + n], spec, v => edit(x[which], v));
        k.set(M.get(state.edit, x[which]));
      }
    }
  }

  function renderEditSource() {
    const s = state.source;
    const where = s.set === 'device' ? 'ToneLab SE ' + M.programLabel(s.index)
      : (state.files[s.set] ? state.files[s.set].name : s.set) + ' ' + M.programLabel(s.index);
    $('#edit-source').textContent = 'Editing ' + where + (state.dirty ? ' (edited)' : '');
    document.title = 'ToneLab SE Editor — ' + M.getName(state.edit).trim() + (state.dirty ? ' *' : '');
  }

  // ---------------------------------------------------------------- librarian
  const TABS = [['device', 'ToneLab SE'], ['file1', 'File 1'], ['file2', 'File 2'], ['global', 'Global'], ['note', 'Note']];

  function buildTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    TABS.forEach(([id, label]) => {
      const b = el('button', { role: 'tab', 'aria-selected': state.tab === id, text: id.startsWith('file') && state.files[id] ? state.files[id].name.slice(0, 14) : label });
      b.onclick = () => { state.tab = id; buildTabs(); renderTab(); };
      nav.append(b);
    });
  }

  function setPrograms(set) { return set === 'device' ? state.device.programs : state.files[set] && state.files[set].programs; }

  function renderTab() {
    const body = $('#tab-body');
    body.innerHTML = '';
    if (state.tab === 'device' || state.tab.startsWith('file')) renderLibrary(body);
    else if (state.tab === 'global') renderGlobal(body);
    else renderNote(body);
  }

  function renderLibrary(body) {
    const set = state.tab;
    if (set !== 'device' && !state.files[set]) {
      body.append(
        el('p', { class: 'hint', text: 'No program set loaded in ' + (set === 'file1' ? 'File 1' : 'File 2') + '.' }),
        el('div', { class: 'toolbar' },
          el('button', { text: 'New empty set', onclick: () => newSet(set) }),
          el('button', { text: 'Open .TLP…', onclick: () => openFile(set) }),
          el('button', { text: 'Receive all from ToneLab', onclick: () => receiveAllInto(set), disabled: !midi.connected || null })));
      return;
    }
    const isDev = set === 'device';
    const tb = el('div', { class: 'toolbar' });
    if (isDev) {
      tb.append(
        el('button', { text: 'Receive all', title: 'Read all 96 programs from the ToneLab SE', onclick: () => receiveDeviceAll(), disabled: !midi.connected || null }),
        el('button', { text: 'Copy', onclick: copySel }),
        el('button', { text: 'Paste', onclick: pasteSel, title: 'Writes pasted programs into the ToneLab SE' }),
        el('button', { text: 'Export…', onclick: exportSel }),
        el('button', { text: 'Import…', onclick: () => importInto('device') }),
        el('button', { text: 'Save set as…', onclick: () => saveSet('device') }));
    } else {
      const f = state.files[set];
      body.append(el('div', { class: 'file-title', text: f.name + (f.dirty ? ' (modified)' : '') }));
      tb.append(
        el('button', { text: 'Save…', onclick: () => saveSet(set) }),
        el('button', { text: 'Cut', onclick: () => { copySel(); clearSel(); } }),
        el('button', { text: 'Copy', onclick: copySel }),
        el('button', { text: 'Paste', onclick: pasteSel }),
        el('button', { text: 'Clear', onclick: clearSel }),
        el('button', { text: 'Import…', onclick: () => importInto(set) }),
        el('button', { text: 'Export…', onclick: exportSel }),
        el('button', { text: 'Receive selected', onclick: () => receiveSelected(set), disabled: !midi.connected || null }),
        el('button', { text: 'Transmit selected', onclick: () => transmitSelected(set), disabled: !midi.connected || null }),
        el('button', { text: 'Transmit all', onclick: () => transmitAll(set), disabled: !midi.connected || null }),
        el('button', { text: 'Close', onclick: () => closeSet(set) }));
    }
    body.append(tb);
    const list = el('div', { class: 'prog-list', id: 'prog-list', tabindex: 0, role: 'listbox', 'aria-multiselectable': 'true' });
    list.addEventListener('keydown', listKeys);
    body.append(list);
    body.append(el('div', { class: 'side-section' },
      el('h3', { text: 'Write' }),
      el('div', { class: 'toolbar' },
        el('button', { class: 'primary', text: 'Write current program…', onclick: writeDialog }),
        el('label', { class: 'hint' }, (() => {
          const c = el('input', { type: 'checkbox' }); c.checked = prefs.audition;
          c.onchange = () => { prefs.audition = c.checked; savePrefs(); };
          return c;
        })(), ' Audition file programs on the ToneLab'))));
    renderList();
  }

  function renderList() {
    const list = $('#prog-list');
    if (!list) return;
    const set = state.tab, progs = setPrograms(set);
    if (!progs) return;
    if (state.selection.set !== set) state.selection = { set, items: new Set(), anchor: 0 };
    list.innerHTML = '';
    progs.forEach((p, i) => {
      const isCurrent = state.source.set === set && state.source.index === i;
      const name = p ? M.getName(p) : (set === 'device' ? '(not received)' : '');
      const item = el('div', {
        class: 'item' + (state.selection.items.has(i) ? ' sel' : '') + (isCurrent ? ' current' : '') + (isCurrent && state.dirty ? ' dirty' : ''),
        role: 'option', 'aria-selected': state.selection.items.has(i),
      }, el('span', { class: 'num', text: M.programLabel(i) + ':' }), el('span', { class: 'name', text: isCurrent ? M.getName(state.edit) : name }));
      item.onclick = e => clickItem(i, e);
      item.ondblclick = () => selectProgram(set, i);
      list.append(item);
    });
    const cur = list.querySelector('.current');
    if (cur && !list.dataset.scrolled) { cur.scrollIntoView({ block: 'nearest' }); list.dataset.scrolled = '1'; }
  }

  function clickItem(i, e) {
    const sel = state.selection;
    if (e.shiftKey) {
      sel.items.clear();
      for (let j = Math.min(sel.anchor, i); j <= Math.max(sel.anchor, i); j++) sel.items.add(j);
      renderList();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      sel.items.has(i) ? sel.items.delete(i) : sel.items.add(i);
      sel.anchor = i;
      renderList();
      return;
    }
    sel.items = new Set([i]);
    sel.anchor = i;
    selectProgram(state.tab, i);
  }

  function listKeys(e) {
    const sel = state.selection;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.max(0, Math.min(95, sel.anchor + (e.key === 'ArrowDown' ? 1 : -1)));
      clickItem(i, { shiftKey: e.shiftKey });
      const items = $('#prog-list').children;
      if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'c') { e.preventDefault(); copySel(); }
    if (mod && e.key === 'v') { e.preventDefault(); pasteSel(); }
    if (mod && e.key === 'x' && state.tab !== 'device') { e.preventDefault(); copySel(); clearSel(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.tab !== 'device') { e.preventDefault(); clearSel(); }
  }

  async function guardUnsaved(fromDevice) {
    if (!state.dirty) return true;
    const want = fromDevice ? prefs.warnProgChgTarget : prefs.warnProgChgEditor;
    if (!want) return true;
    return confirm('Unsaved edits', 'Are you sure you want to go to another program without saving the program you just edited?', 'Discard edits');
  }

  async function selectProgram(set, i) {
    if (state.source.set === set && state.source.index === i && !state.dirty) return;
    if (!(await guardUnsaved(false))) { renderList(); return; }
    const progs = setPrograms(set);
    if (set === 'device') {
      if (midi.connected) {
        try {
          await settle();
          noteOwnProgramSend();
          await midi.sendWithAck(S.msg.programChange(midi.channel, i), 3000);
          const r = await midi.request(S.msg.currentProgramRequest(midi.channel), m => m.kind === 'currentProgram', 3000);
          state.edit = Uint8Array.from(r.data);
          progs[i] = Uint8Array.from(r.data);
          state.device.current = i;
        } catch (e) { toast(e.message, true); return; }
      } else if (progs[i]) {
        state.edit = Uint8Array.from(progs[i]);
      } else { toast('Connect to the ToneLab SE to load its programs.', true); return; }
    } else {
      state.edit = Uint8Array.from(progs[i]);
      if (midi.connected && prefs.audition) {
        try { await settle(); noteOwnProgramSend(); await midi.sendWithAck(S.msg.currentProgramDump(midi.channel, state.edit), 3000); } catch (e) { toast(e.message, true); }
      }
    }
    state.source = { set, index: i };
    state.dirty = false;
    renderPanel();
    renderList();
    if (state.tab === 'note') renderTab();
  }

  function copySel() {
    const progs = setPrograms(state.tab);
    state.clipboard = [...state.selection.items].sort((a, b) => a - b).map(i => progs[i] ? Uint8Array.from(progs[i]) : null).filter(Boolean);
    toast(state.clipboard.length + ' program(s) copied');
  }
  async function pasteSel() {
    if (!state.clipboard.length) return;
    const set = state.tab, progs = setPrograms(set);
    const start = Math.min(...(state.selection.items.size ? state.selection.items : [0]));
    const count = Math.min(state.clipboard.length, 96 - start);
    if (set === 'device') {
      if (!midi.connected) { toast('Not connected.', true); return; }
      if (!(await confirm('Write to ToneLab SE', 'Overwrite ' + count + ' program(s) in the ToneLab SE starting at ' + M.programLabel(start) + '?', 'Write'))) return;
      await transfer('Writing programs…', async step => {
        for (let k = 0; k < count; k++) {
          await midi.sendWithAck(S.msg.programDump(midi.channel, start + k, state.clipboard[k]), 5000);
          progs[start + k] = Uint8Array.from(state.clipboard[k]);
          step((k + 1) / count, M.programLabel(start + k));
        }
      });
    } else {
      for (let k = 0; k < count; k++) progs[start + k] = Uint8Array.from(state.clipboard[k]);
      state.files[set].dirty = true;
    }
    state.selection.items = new Set(Array.from({ length: count }, (_, k) => start + k));
    renderTab();
  }
  function clearSel() {
    const set = state.tab;
    if (set === 'device') return;
    const progs = setPrograms(set);
    state.selection.items.forEach(i => { progs[i] = M.blankProgram(); });
    state.files[set].dirty = true;
    renderTab();
  }

  async function transfer(title, fn) {
    if (state.busy) return;
    state.busy = true;
    setStatus('Transferring…', 'busy');
    const pd = progressDialog(title);
    try {
      await settle();
      await fn((frac, text) => pd.update(frac * 100, text));
      pd.close();
      toast('Done.');
      return true;
    } catch (e) {
      pd.close();
      toast(e.message, true);
      return false;
    } finally {
      state.busy = false;
      setStatus(midi.connected ? 'Connected' : 'Not connected', midi.connected ? 'on' : 'off');
    }
  }

  async function receiveDeviceAll() {
    await transfer('Receiving data…', async step => {
      step(0.1, 'Requesting all programs');
      const r = await midi.request(S.msg.allProgramsRequest(midi.channel), m => m.kind === 'allPrograms', 15000);
      if (r.data.length !== 96 * 92) throw new Error('Receive Error: Data size is not correct.');
      for (let n = 0; n < 96; n++) state.device.programs[n] = Uint8Array.from(r.data.slice(n * 92, n * 92 + 92));
      step(1);
    });
    renderTab();
  }

  async function receiveAllInto(set) {
    await receiveDeviceAll();
    if (!state.device.programs.every(Boolean)) return;
    state.files[set] = { name: 'ToneLabSE.TLP', programs: state.device.programs.map(p => Uint8Array.from(p)), dirty: true };
    buildTabs();
    renderTab();
  }

  async function receiveSelected(set) {
    const items = [...state.selection.items].sort((a, b) => a - b);
    if (!items.length) { toast('Select programs first.'); return; }
    if (!(await confirm('Receive', 'Replace ' + items.length + ' program(s) in this set with the ToneLab SE\'s programs at the same numbers?', 'Receive'))) return;
    await transfer('Receiving data…', async step => {
      for (let k = 0; k < items.length; k++) {
        const n = items[k];
        const r = await midi.request(S.msg.programRequest(midi.channel, n), m => m.kind === 'program' && m.number === n, 5000);
        state.files[set].programs[n] = Uint8Array.from(r.data);
        state.device.programs[n] = Uint8Array.from(r.data);
        step((k + 1) / items.length, M.programLabel(n));
      }
    });
    state.files[set].dirty = true;
    renderTab();
  }

  async function transmitSelected(set) {
    const items = [...state.selection.items].sort((a, b) => a - b);
    if (!items.length) { toast('Select programs first.'); return; }
    if (!(await confirm('Transmit', 'Overwrite ' + items.length + ' program(s) in the ToneLab SE at the same numbers?', 'Transmit'))) return;
    await transfer('Sending data…', async step => {
      for (let k = 0; k < items.length; k++) {
        const n = items[k];
        await midi.sendWithAck(S.msg.programDump(midi.channel, n, state.files[set].programs[n]), 5000);
        state.device.programs[n] = Uint8Array.from(state.files[set].programs[n]);
        step((k + 1) / items.length, M.programLabel(n));
      }
    });
  }

  async function transmitAll(set) {
    if (!(await confirm('Transmit all programs', 'This will overwrite ALL 96 programs in your ToneLab SE with "' + state.files[set].name + '". Continue?', 'Overwrite all'))) return;
    await transfer('Sending data…', async step => {
      step(0.1, 'All programs');
      const all = [];
      state.files[set].programs.forEach(p => all.push(...p));
      await midi.sendWithAck(S.msg.allProgramsDump(midi.channel, all), 20000);
      state.files[set].programs.forEach((p, n) => { state.device.programs[n] = Uint8Array.from(p); });
      step(1);
    });
  }

  async function writeDialog() {
    const sets = [['device', 'Write to ToneLab SE']];
    if (state.files.file1) sets.push(['file1', 'Store to ' + state.files.file1.name]);
    if (state.files.file2) sets.push(['file2', 'Store to ' + state.files.file2.name]);
    const defSet = state.source.set;
    const dest = el('select', { name: 'dest' }); sets.forEach(([v, l]) => dest.append(new Option(l, v))); dest.value = defSet;
    const prog = el('select', { name: 'prog' });
    const fillProgs = () => {
      prog.innerHTML = '';
      const progs = setPrograms(dest.value);
      for (let n = 0; n < 96; n++) prog.append(new Option(M.programLabel(n) + '  ' + (progs && progs[n] ? M.getName(progs[n]) : ''), n));
      prog.value = state.source.set === dest.value ? state.source.index : 0;
    };
    dest.onchange = fillProgs; fillProgs();
    const r = await dialog('Write current program', el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Destination' }), dest),
      el('div', { class: 'field' }, el('label', { text: 'Program' }), prog)),
    [{ label: 'Cancel', value: 'cancel' }, { label: 'Write', value: 'ok' }]);
    if (r !== 'ok') return;
    const set = dest.value, n = +prog.value;
    if (set === 'device') {
      if (!midi.connected) { toast('Not connected.', true); return; }
      const ok = await transfer('Writing…', async step => {
        await midi.sendWithAck(S.msg.currentProgramDump(midi.channel, state.edit), 5000);
        step(0.5);
        const w = await midi.request(S.msg.writeRequest(midi.channel, n), m => m.kind === 'writeOk' || m.kind === 'writeError', 5000);
        if (w.kind === 'writeError') throw new Error('The ToneLab SE reported a write error.');
        state.device.programs[n] = Uint8Array.from(state.edit);
        state.device.current = n;
        step(1);
      });
      if (!ok) return;
    } else {
      state.files[set].programs[n] = Uint8Array.from(state.edit);
      state.files[set].dirty = true;
    }
    state.source = { set, index: n };
    state.dirty = false;
    renderEditSource();
    renderTab();
  }

  // ---------------------------------------------------------------- files
  function newSet(set) {
    state.files[set] = { name: 'Untitled-' + (set === 'file1' ? 1 : 2) + '.TLP', programs: Array.from({ length: 96 }, () => M.blankProgram()), dirty: false };
    buildTabs(); renderTab();
  }

  function pickFile() {
    return new Promise(resolve => {
      const input = $('#file-input');
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  async function readProgramSet(file) {
    const buf = await file.arrayBuffer();
    const r = TL.files.readTLP(buf);
    if (r.kind === 'tonelab' &&
      !(await confirm('ToneLab program file', "ToneLabSE SoundEditor converts ToneLab's data files. This file was made for the original ToneLab; its programs will be converted for the ToneLab SE.", 'Convert'))) return null;
    return r;
  }

  async function openFile(target) {
    const file = await pickFile();
    if (!file) return;
    try {
      if (/\.tlg$/i.test(file.name)) { await openGlobal(file); return; }
      const r = await readProgramSet(file);
      if (!r) return;
      let set = target;
      if (!set) set = !state.files.file1 ? 'file1' : !state.files.file2 ? 'file2' : null;
      if (!set) { toast("Can't open any more Program files. Close File 1 or File 2 first.", true); return; }
      state.files[set] = { name: file.name, programs: r.programs, dirty: false };
      state.tab = set;
      buildTabs(); renderTab();
    } catch (e) { toast(e.message, true); }
  }

  async function saveSet(set) {
    const progs = setPrograms(set);
    if (progs.some(p => !p)) { toast('Receive all programs from the ToneLab SE first.', true); return; }
    const name = set === 'device' ? 'ToneLabSE.TLP' : state.files[set].name;
    try {
      const saved = await TL.files.saveFile(TL.files.writeTLP(progs), name, 'ToneLab Program File', 'TLP');
      if (saved && set !== 'device') { state.files[set].name = saved; state.files[set].dirty = false; buildTabs(); renderTab(); }
    } catch (e) { toast(e.message, true); }
  }

  async function closeSet(set) {
    if (state.files[set].dirty && !(await confirm('Close', 'Discard changes to ' + state.files[set].name + '?', 'Discard'))) return;
    state.files[set] = null;
    if (state.source.set === set) state.source = { set: 'device', index: state.device.current };
    buildTabs(); renderTab(); renderEditSource();
  }

  // Export: a one-program .TLP (124 bytes), as the original did.
  async function exportSel() {
    const progs = setPrograms(state.tab);
    const i = state.selection.items.size ? Math.min(...state.selection.items) : state.source.index;
    const p = state.source.set === state.tab && state.source.index === i ? state.edit : progs[i];
    if (!p) { toast('Nothing to export.', true); return; }
    try { await TL.files.saveFile(TL.files.writeProgram(p), TL.files.exportName(M.getName(p).trim()), 'ToneLab Program File', 'TLP'); } catch (e) { toast(e.message, true); }
  }

  async function importInto(set) {
    const file = await pickFile();
    if (!file) return;
    let r;
    try { r = await readProgramSet(file); } catch (e) { toast(e.message, true); return; }
    if (!r) return;
    const src = el('select'); r.programs.forEach((p, n) => src.append(new Option(M.programLabel(n) + '  ' + M.getName(p), n)));
    const dst = el('select'); const progs = setPrograms(set);
    for (let n = 0; n < 96; n++) dst.append(new Option(M.programLabel(n) + '  ' + (progs[n] ? M.getName(progs[n]) : ''), n));
    dst.value = state.selection.items.size ? Math.min(...state.selection.items) : 0;
    const res = await dialog('Import Program', el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Program in ' + file.name }), src),
      el('div', { class: 'field' }, el('label', { text: 'Destination (will be overwritten)' }), dst)),
    [{ label: 'Cancel', value: 'cancel' }, { label: 'Import', value: 'ok' }]);
    if (res !== 'ok') return;
    const p = r.programs[+src.value], n = +dst.value;
    if (set === 'device') {
      if (!midi.connected) { toast('Not connected.', true); return; }
      await transfer('Sending data…', async () => { await midi.sendWithAck(S.msg.programDump(midi.channel, n, p), 5000); });
      progs[n] = Uint8Array.from(p);
    } else {
      progs[n] = Uint8Array.from(p);
      state.files[set].dirty = true;
    }
    renderTab();
  }

  // ---------------------------------------------------------------- global tab
  function renderGlobal(body) {
    const g = state.device.global;
    if (!g) {
      body.append(el('p', { class: 'hint', text: midi.connected ? 'Global settings have not been received yet.' : 'Connect to the ToneLab SE to edit its Global settings.' }),
        el('div', { class: 'toolbar' }, el('button', { text: 'Receive Global', onclick: receiveGlobal, disabled: !midi.connected || null }),
          el('button', { text: 'Open .TLG…', onclick: () => openFile() })));
      return;
    }
    const sendG = (addr, value) => { if (midi.connected) midi.send(S.msg.paramChange(midi.channel, addr[0], addr[1], value)); };
    const G = P.GLOBAL;
    body.append(el('div', { class: 'side-section' }, el('h3', { text: 'MIDI' }),
      el('div', { class: 'form-grid' }, el('label', { text: 'MIDI Channel' }), el('span', { text: String((g[0] & 0x0f) + 1) + '  (change on the ToneLab)' }))));
    const msgs = el('div', { class: 'side-section' }, el('h3', { text: 'MIDI Messages / Settings' }));
    G.bits.forEach(b => {
      const c = el('input', { type: 'checkbox', id: 'g-bit-' + b.bit });
      c.checked = !!((g[1] >> b.bit) & 1);
      c.onchange = () => { g[1] = (g[1] & ~(1 << b.bit)) | ((c.checked ? 1 : 0) << b.bit); sendG(b.addr, c.checked ? 1 : 0); };
      msgs.append(el('label', { class: 'check', for: 'g-bit-' + b.bit }, c, b.label));
    });
    body.append(msgs);
    const ccs = el('div', { class: 'form-grid' });
    G.ccs.forEach(c => {
      const s = el('select');
      for (let v = 0; v <= 0x60; v++) s.append(new Option(P.ccText(v), v));
      s.value = g[c.offset];
      s.onchange = () => { g[c.offset] = +s.value; sendG(c.addr, +s.value); };
      ccs.append(el('label', { text: c.label }), s);
    });
    body.append(el('div', { class: 'side-section' }, el('h3', { text: 'Control Change' }), ccs));
    const out = el('select'); G.output.options.forEach((o, i) => out.append(new Option(o, i))); out.value = g[15] & 1;
    out.onchange = () => { g[15] = +out.value; sendG(G.output.addr, +out.value); };
    body.append(el('div', { class: 'side-section' }, el('h3', { text: 'Output' }), el('div', { class: 'form-grid' }, el('label', { text: 'Output Select' }), out)));
    body.append(el('div', { class: 'toolbar' },
      el('button', { text: 'Receive Global', onclick: receiveGlobal, disabled: !midi.connected || null }),
      el('button', { text: 'Save .TLG…', onclick: saveGlobal }),
      el('button', { text: 'Open .TLG…', onclick: () => openFile() })));
    if (state.device.version) body.append(el('div', { class: 'hint', text: 'Target: VOX ToneLabSE   Version: ' + state.device.version }));
  }

  async function receiveGlobal() {
    try {
      const r = await midi.request(S.msg.globalRequest(midi.channel), m => m.kind === 'global', 4000);
      state.device.global = Uint8Array.from(r.data);
      if (state.tab === 'global') renderTab();
    } catch (e) { toast(e.message, true); }
  }

  async function saveGlobal() {
    try { await TL.files.saveFile(TL.files.writeTLG(state.device.global), 'Global.TLG', 'ToneLab Global File', 'TLG'); } catch (e) { toast(e.message, true); }
  }

  async function openGlobal(file) {
    let g;
    try { g = TL.files.readTLG(await file.arrayBuffer()); } catch (e) { toast(e.message, true); return; }
    if (!(await confirm('Load Global settings', 'Send these Global settings to the ToneLab SE? (The MIDI channel is kept.)', 'Send'))) return;
    g[0] = (g[0] & 0xf0) | midi.channel;
    if (midi.connected) await transfer('Sending data…', async () => { await midi.sendWithAck(S.msg.globalDump(midi.channel, g), 5000); });
    state.device.global = g;
    state.tab = 'global'; buildTabs(); renderTab();
  }

  // ---------------------------------------------------------------- note tab
  function renderNote(body) {
    const a = P.AMP[state.showCh];
    let kind = state.noteKind || 'amp';
    const text = el('div', { class: 'note-text' });
    const update = () => {
      const ch = state.noteCh || state.showCh, aa = P.AMP[ch];
      text.textContent = kind === 'amp'
        ? P.AMP_LONG[state.edit[aa.type]] + '\n\n' + TL.notes.amps[state.edit[aa.type]]
        : P.CABS[state.edit[aa.cab]] + '\n\n' + TL.notes.cabs[state.edit[aa.cab]];
    };
    const radio = (name, value, label, checked, fn) => {
      const r = el('input', { type: 'radio', name, value }); r.checked = checked; r.onchange = fn;
      return el('label', { class: 'check' }, r, label);
    };
    body.append(text, el('div', { class: 'note-pick' },
      el('div', {}, el('b', { text: 'A ch: ' }),
        radio('note', 'A-amp', 'AMP', (state.noteCh || state.showCh) === 'A' && kind === 'amp', () => { state.noteCh = 'A'; kind = state.noteKind = 'amp'; update(); }),
        radio('note', 'A-cab', 'CAB', (state.noteCh || state.showCh) === 'A' && kind === 'cab', () => { state.noteCh = 'A'; kind = state.noteKind = 'cab'; update(); })),
      el('div', {}, el('b', { text: 'B ch: ' }),
        radio('note', 'B-amp', 'AMP', (state.noteCh || state.showCh) === 'B' && kind === 'amp', () => { state.noteCh = 'B'; kind = state.noteKind = 'amp'; update(); }),
        radio('note', 'B-cab', 'CAB', (state.noteCh || state.showCh) === 'B' && kind === 'cab', () => { state.noteCh = 'B'; kind = state.noteKind = 'cab'; update(); }))));
    update();
    void a;
  }

  // ---------------------------------------------------------------- MIDI setup & connect
  function fillPorts() {
    const ins = midi.inputs(), outs = midi.outputs();
    const fill = (sel, ports, want) => {
      sel.innerHTML = '';
      sel.append(new Option('None', ''));
      ports.forEach(p => sel.append(new Option(p.name, p.id)));
      const match = ports.find(p => p.id === want) || ports.find(p => /tonelab|vox/i.test(p.name) && p.id !== TL.Midi.SIM_ID);
      sel.value = match ? match.id : '';
    };
    fill($('#midi-in'), ins, prefs.midiIn);
    fill($('#midi-out'), outs, prefs.midiOut);
  }

  async function connect() {
    prefs.midiIn = $('#midi-in').value;
    prefs.midiOut = $('#midi-out').value;
    prefs.channel = +$('#midi-ch').value;
    savePrefs();
    if (!prefs.midiIn || !prefs.midiOut) { toast('Choose a MIDI In and a MIDI Out port.', true); return; }
    midi.channel = prefs.channel;
    midi.open(prefs.midiIn, prefs.midiOut);
    if (midi.sim) midi.sim.channel = midi.channel;
    setStatus('Connecting…', 'busy');
    try {
      // Who's there? (Device inquiry is answered on any channel.)
      try {
        const inq = await midi.request(S.msg.inquiry(), m => m.kind === 'inquiryReply', 2000);
        if (inq.manufacturer !== 0x42 || inq.family !== 0x6d || inq.member !== 0x08) {
          throw new Error('The device on these ports is not a ToneLab SE (Korg family ' + inq.family.toString(16) + ', member ' + inq.member.toString(16) + ').');
        }
        if (inq.channel !== midi.channel) {
          toast('The ToneLab SE is on MIDI channel ' + (inq.channel + 1) + '; switching to it.');
          midi.channel = prefs.channel = inq.channel; $('#midi-ch').value = inq.channel; savePrefs();
          if (midi.sim) midi.sim.channel = midi.channel;
        }
        state.device.version = inq.version[2] + '.' + String(inq.version[0]).padStart(2, '0');
      } catch (e) {
        if (/not a ToneLab/.test(e.message)) throw e;
      }
      const g = await midi.request(S.msg.globalRequest(midi.channel), m => m.kind === 'global', 4000);
      state.device.global = Uint8Array.from(g.data);
      // Turn on the pedal's SysEx Out so knob moves on the pedal show up here.
      const sysExOn = (g.data[1] >> 2) & 1;
      state.device.sysExOutWas = sysExOn;
      if (!sysExOn && prefs.autoSysExOut) {
        midi.send(S.msg.paramChange(midi.channel, 0x41, 2, 1));
        state.device.global[1] |= 4;
      }
      try {
        const mode = await midi.request(S.msg.modeRequest(midi.channel), m => m.kind === 'modeData', 2000);
        state.device.current = mode.number;
      } catch (e) { /* older firmware: fall back to program 01-1 */ }
      setStatus('Connected', 'on');
      state.source = { set: 'device', index: state.device.current };
      await receiveDeviceAll();
      const cur = await midi.request(S.msg.currentProgramRequest(midi.channel), m => m.kind === 'currentProgram', 4000);
      state.edit = Uint8Array.from(cur.data);
      state.dirty = false;
      renderPanel();
      buildTabs();
      renderTab();
      toast('Connected to ToneLab SE' + (state.device.version ? ' (version ' + state.device.version + ')' : ''));
    } catch (e) {
      setStatus('Not connected', 'err');
      midi.open(null, null);
      toast(e.message, true);
    }
    $('#btn-connect').textContent = midi.connected ? 'Reconnect' : 'Connect';
  }

  function restoreSysExOut() {
    if (midi.connected && prefs.restoreSysExOut && state.device.sysExOutWas === 0) {
      try { midi.send(S.msg.paramChange(midi.channel, 0x41, 2, 0)); } catch (e) { /* closing anyway */ }
    }
  }

  // Messages the pedal sends on its own (SysEx Out on).
  // After we send a program change or a program dump the pedal can bounce
  // parameter changes back; ignore those for a moment (the original's echo counter).
  let deviceProgTimer = null, suppressEchoUntil = 0;
  function noteOwnProgramSend() { suppressEchoUntil = Date.now() + 300; }

  // Byte offsets of the parameters the expression pedals currently drive.
  function pedalAssignedOffsets() {
    const offs = new Set();
    const targets = P.expTargets(state.edit);
    for (const n of [1, 2]) {
      const t = targets.find(t => t.code === (state.edit[P.EXP[n].target] & 0x3f));
      if (!t) continue;
      if (t.fx && t.param) offs.add(t.fx.byteOf(t.param.o));
      else if (t.name === 'A/GAIN A') offs.add(50);
      else if (t.name === 'A/VRGN A') offs.add(51);
      else if (t.name === 'A/GAIN B') offs.add(64);
      else if (t.name === 'A/VRGN B') offs.add(65);
    }
    return offs;
  }

  async function reloadCurrentFromDevice(number) {
    const r = await midi.request(S.msg.currentProgramRequest(midi.channel), x => x.kind === 'currentProgram', 3000);
    state.edit = Uint8Array.from(r.data);
    if (number !== undefined) {
      state.device.current = number;
      state.device.programs[number] = Uint8Array.from(r.data);
      state.source = { set: 'device', index: number };
    }
    state.dirty = false;
    renderPanel(); renderList();
  }

  let programChangeBusy = false;
  function onMidi(m) {
    if (m.kind === 'portsChanged') { fillPorts(); return; }
    if (m.kind === 'param') {
      if (m.p1 >= 0x40) { onRemoteGlobal(m); return; }
      if (Date.now() < suppressEchoUntil || programChangeBusy) return;
      const t = M.applyRemote(state.edit, m.p1, m.p2, m.value);
      if (!t) return;
      if (m.p1 === 3 && m.p2 <= 3) {
        // Effect type turned on the pedal: it re-initialises that effect; fetch the result.
        P.applyTypeChange(state.edit, P.EFFECTS[m.p2], m.value);
        setTimeout(() => reloadCurrentFromDevice().then(markDirty).catch(() => {}), 150);
      }
      const ignorePedal = prefs.warnIgnorePedal && pedalAssignedOffsets().has(t.offset);
      const ignoreAB = prefs.warnIgnoreChAB && t.offset === 11 && t.bit === 1;
      if (!ignorePedal && !ignoreAB) markDirty();
      clearTimeout(deviceProgTimer);
      deviceProgTimer = setTimeout(renderPanel, 30);
      return;
    }
    if (m.kind === 'programChange' && m.option !== 1) {
      // Program chosen with the pedal's own switches.
      if (programChangeBusy) return;
      programChangeBusy = true;
      (async () => {
        try {
          if (state.dirty && prefs.warnProgChgTarget && state.source.set === 'device') {
            const ok = await confirm('Program changed on the ToneLab SE',
              'Are you sure you want to go to another program without saving the current program?', 'Discard edits');
            if (!ok) {
              // Put the pedal back where it was, with our edits.
              await settle();
              noteOwnProgramSend();
              await midi.sendWithAck(S.msg.programChange(midi.channel, state.source.index), 3000);
              await midi.sendWithAck(S.msg.currentProgramDump(midi.channel, state.edit), 3000);
              return;
            }
          }
          await sleep(50);
          await reloadCurrentFromDevice(m.number);
        } catch (e) { toast(e.message, true); } finally { programChangeBusy = false; }
      })();
      return;
    }
    if (m.kind === 'writeOk') {
      // A write done with the pedal's WRITE button.
      state.device.programs[m.number] = Uint8Array.from(state.edit);
      if (state.source.set === 'device') { state.source.index = m.number; state.dirty = false; }
      renderEditSource(); renderList();
    }
  }

  function onRemoteGlobal(m) {
    const g = state.device.global;
    if (!g) return;
    if (m.p1 === 0x40) {
      g[0] = (g[0] & 0xf0) | (m.value & 0x0f);
      midi.channel = prefs.channel = m.value & 0x0f;
      $('#midi-ch').value = midi.channel; savePrefs();
    } else if (m.p1 === 0x41) {
      g[1] = (g[1] & ~(1 << m.p2)) | ((m.value ? 1 : 0) << m.p2);
    } else if (m.p1 === 0x42 && m.p2 <= 8) {
      g[2 + m.p2] = m.value;
    } else if (m.p1 === 0x43 && m.p2 === 1) {
      g[15] = m.value;
    }
    if (state.tab === 'global') renderTab();
  }

  // ---------------------------------------------------------------- preferences
  async function prefsDialog() {
    const box = (key, label) => {
      const c = el('input', { type: 'checkbox', name: key }); c.checked = !!prefs[key];
      return el('label', { class: 'check' }, c, label);
    };
    const color = el('select', { name: 'textColor' }); Object.keys(TEXT_COLORS).forEach(k => color.append(new Option(k, k))); color.value = prefs.textColor;
    const body = el('div', {},
      el('h3', { text: 'SysEx-Out setting of ToneLab SE' }),
      box('autoSysExOut', 'Enable SysEx Out automatically on connect'),
      box('restoreSysExOut', 'Restore the previous setting on exit'),
      el('h3', { text: 'Careless program change warning' }),
      box('warnProgChgTarget', 'Change by ToneLab SE'),
      box('warnProgChgEditor', 'Change by the Editor'),
      box('warnIgnorePedal', 'Ignore pedal-assigned parameters edited by ToneLab SE'),
      box('warnIgnoreChAB', 'Ignore channel A/B'),
      el('h3', { text: 'Text color' }),
      el('div', { class: 'field' }, el('label', { text: 'Strings and values' }), color));
    const r = await dialog('Preferences', body, [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok' }]);
    if (r !== 'ok') return;
    body.querySelectorAll('input[type=checkbox]').forEach(c => { prefs[c.name] = c.checked; });
    prefs.textColor = color.value;
    savePrefs();
    applyColor();
  }
  function applyColor() { document.documentElement.style.setProperty('--value', TEXT_COLORS[prefs.textColor] || TEXT_COLORS.Dodger); }

  // ---------------------------------------------------------------- startup
  async function start() {
    applyColor();
    buildStatic();
    buildTabs();
    renderPanel();
    renderTab();
    const ch = $('#midi-ch');
    for (let i = 0; i < 16; i++) ch.append(new Option(String(i + 1), i));
    ch.value = prefs.channel;
    midi.on(onMidi);
    try {
      await midi.init();
    } catch (e) {
      toast((e && e.message) || 'MIDI access was denied.', true);
    }
    fillPorts();
    $('#btn-connect').onclick = connect;
    $('#btn-open').onclick = () => openFile();
    $('#btn-prefs').onclick = prefsDialog;
    window.addEventListener('beforeunload', restoreSysExOut);
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      try {
        if (/\.tlg$/i.test(f.name)) return openGlobal(f);
        const r = await readProgramSet(f);
        if (!r) return;
        const set = !state.files.file1 ? 'file1' : !state.files.file2 ? 'file2' : null;
        if (!set) { toast("Can't open any more Program files.", true); return; }
        state.files[set] = { name: f.name, programs: r.programs, dirty: false };
        state.tab = set; buildTabs(); renderTab();
      } catch (err) { toast(err.message, true); }
    });
    if (prefs.midiIn && prefs.midiOut && prefs.midiIn !== TL.Midi.SIM_ID && $('#midi-in').value === prefs.midiIn && $('#midi-out').value === prefs.midiOut) connect();
  }

  TL.app = { state, midi, connect, selectProgram, prefs };
  start();
})(window.TL = window.TL || {});
