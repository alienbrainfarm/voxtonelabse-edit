// Rotary knob widget: drag vertically, scroll, arrow keys, or double-click the
// value to type it (like the original editor).
(function (TL) {
  'use strict';

  const SWEEP = 270; // degrees

  class Knob {
    constructor(opts) {
      this.label = opts.label;
      this.min = opts.min;
      this.max = opts.max;
      this.format = opts.format || (v => String(v));
      this.parse = opts.parse || null;
      this.onchange = opts.onchange;
      this.value = opts.min;

      const el = this.el = document.createElement('div');
      el.className = 'knob';
      el.innerHTML =
        '<div class="knob-label"></div>' +
        '<div class="knob-dial" tabindex="0" role="slider">' +
        '<svg viewBox="0 0 60 60"><circle class="knob-ring" cx="30" cy="30" r="27"/>' +
        '<path class="knob-arc-bg"/><path class="knob-arc"/>' +
        '<circle class="knob-cap" cx="30" cy="30" r="19"/>' +
        '<line class="knob-pointer" x1="30" y1="30" x2="30" y2="14"/></svg></div>' +
        '<input class="knob-value" spellcheck="false">';
      this.labelEl = el.querySelector('.knob-label');
      this.dial = el.querySelector('.knob-dial');
      this.arc = el.querySelector('.knob-arc');
      this.pointer = el.querySelector('.knob-pointer');
      this.input = el.querySelector('.knob-value');
      el.querySelector('.knob-arc-bg').setAttribute('d', arcPath(0, 1));
      this.labelEl.textContent = this.label;
      this.dial.setAttribute('aria-label', this.label);

      this.dial.addEventListener('pointerdown', e => this.startDrag(e));
      this.dial.addEventListener('wheel', e => {
        e.preventDefault();
        this.nudge(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      this.dial.addEventListener('keydown', e => {
        const big = Math.max(1, Math.round((this.max - this.min) / 10));
        const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: big, PageDown: -big }[e.key];
        if (k) { e.preventDefault(); this.nudge(k); }
        if (e.key === 'Home') this.commit(this.min);
        if (e.key === 'End') this.commit(this.max);
      });
      this.dial.addEventListener('dblclick', () => { this.input.focus(); this.input.select(); });
      this.input.addEventListener('focus', () => this.input.select());
      this.input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { this.input.blur(); }
        if (e.key === 'Escape') { this.render(); this.input.blur(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.nudge(e.key === 'ArrowUp' ? 1 : -1); this.input.select(); }
      });
      this.input.addEventListener('change', () => {
        const v = this.parse ? this.parse(this.input.value) : null;
        if (v === null || isNaN(v)) this.render();
        else this.commit(v);
      });
      this.render();
    }

    setRange(min, max) { this.min = min; this.max = max; this.render(); }

    set(v) { this.value = v; this.render(); }

    nudge(d) { this.commit(this.value + d); }

    commit(v) {
      v = Math.max(this.min, Math.min(this.max, Math.round(v)));
      if (v === this.value) { this.render(); return; }
      this.value = v;
      this.render();
      if (this.onchange) this.onchange(v);
    }

    startDrag(e) {
      e.preventDefault();
      this.dial.focus();
      this.dial.setPointerCapture(e.pointerId);
      this.el.classList.add('active');
      const startY = e.clientY, startV = this.value;
      const range = this.max - this.min;
      const pxPerStep = Math.max(1, 150 / Math.max(1, range));
      const move = ev => {
        const fine = ev.shiftKey ? 4 : 1;
        this.commit(startV + Math.round((startY - ev.clientY) / (pxPerStep * fine)));
      };
      const up = () => {
        this.el.classList.remove('active');
        this.dial.removeEventListener('pointermove', move);
        this.dial.removeEventListener('pointerup', up);
        this.dial.removeEventListener('pointercancel', up);
      };
      this.dial.addEventListener('pointermove', move);
      this.dial.addEventListener('pointerup', up);
      this.dial.addEventListener('pointercancel', up);
    }

    render() {
      const t = this.max > this.min ? (this.value - this.min) / (this.max - this.min) : 0;
      this.arc.setAttribute('d', arcPath(0, Math.max(0.001, Math.min(1, t))));
      this.pointer.setAttribute('transform', 'rotate(' + (-SWEEP / 2 + t * SWEEP) + ' 30 30)');
      this.dial.setAttribute('aria-valuenow', this.value);
      this.dial.setAttribute('aria-valuetext', this.format(this.value));
      if (document.activeElement !== this.input) this.input.value = this.format(this.value);
    }
  }

  function arcPath(t0, t1) {
    const a0 = (-SWEEP / 2 + t0 * SWEEP - 90) * Math.PI / 180;
    const a1 = (-SWEEP / 2 + t1 * SWEEP - 90) * Math.PI / 180;
    const r = 24, cx = 30, cy = 30;
    const large = (t1 - t0) * SWEEP > 180 ? 1 : 0;
    return 'M' + (cx + r * Math.cos(a0)).toFixed(2) + ' ' + (cy + r * Math.sin(a0)).toFixed(2) +
      ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cy + r * Math.sin(a1)).toFixed(2);
  }

  TL.Knob = Knob;
})(window.TL = window.TL || {});
