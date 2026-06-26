/* Interactive setup components: tabs, steppers, phone demo, spread demo, checklist, copy chips. */
(function () {
  'use strict';

  /* Tabs */
  document.querySelectorAll('[data-tabset]').forEach(function (set) {
    var btns = set.querySelectorAll('.tab-btn');
    var panels = set.querySelectorAll('.tab-panel');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = btn.getAttribute('data-tab');
        btns.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        panels.forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-panel') === i); });
      });
    });
  });

  /* Stepper */
  document.querySelectorAll('[data-stepper]').forEach(function (st) {
    var dots = Array.prototype.slice.call(st.querySelectorAll('.step-dot'));
    var panels = Array.prototype.slice.call(st.querySelectorAll('.step-panel'));
    var prev = st.querySelector('[data-prev]');
    var next = st.querySelector('[data-next]');
    var count = st.querySelector('.step-count');
    var n = panels.length, cur = 0;
    function render() {
      dots.forEach(function (d, i) {
        d.classList.toggle('is-active', i === cur);
        d.classList.toggle('is-done', i < cur);
      });
      panels.forEach(function (p, i) { p.classList.toggle('is-active', i === cur); });
      if (count) count.textContent = 'Step ' + (cur + 1) + ' of ' + n;
      if (prev) prev.disabled = cur === 0;
      if (next) next.textContent = cur === n - 1 ? 'Done ✓' : 'Next →';
    }
    dots.forEach(function (d, i) { d.addEventListener('click', function () { cur = i; render(); }); });
    if (prev) prev.addEventListener('click', function () { if (cur > 0) { cur--; render(); } });
    if (next) next.addEventListener('click', function () { if (cur < n - 1) { cur++; render(); } });
    render();
  });

  /* Phone demo (sequence of screens) */
  document.querySelectorAll('[data-phonedemo]').forEach(function (demo) {
    var screens = Array.prototype.slice.call(demo.querySelectorAll('.phone-screen'));
    var nextBtn = demo.querySelector('[data-demo-next]');
    var resetBtn = demo.querySelector('[data-demo-reset]');
    var stateEl = demo.querySelector('.demo-state');
    var cur = 0;
    function render() {
      screens.forEach(function (s, i) { s.classList.toggle('is-active', i === cur); });
      if (stateEl) stateEl.textContent = screens[cur].getAttribute('data-state') || '';
      if (nextBtn) {
        var label = screens[cur].getAttribute('data-next-label');
        if (cur === screens.length - 1) { nextBtn.style.display = 'none'; if (resetBtn) resetBtn.style.display = ''; }
        else { nextBtn.style.display = ''; nextBtn.textContent = label || 'Next →'; if (resetBtn) resetBtn.style.display = 'none'; }
      }
    }
    if (nextBtn) nextBtn.addEventListener('click', function () { if (cur < screens.length - 1) { cur++; render(); } });
    if (resetBtn) resetBtn.addEventListener('click', function () { cur = 0; render(); });
    render();
  });

  /* Spread / multiplication demo */
  document.querySelectorAll('[data-spread]').forEach(function (sp) {
    var btn = sp.querySelector('[data-spread-go]');
    var cols = Array.prototype.slice.call(sp.querySelectorAll('.spread-col'));
    function reset() { sp.querySelectorAll('.spread-dots i').forEach(function (d) { d.classList.remove('on'); }); }
    function run() {
      reset();
      var delay = 0;
      cols.forEach(function (col) {
        var dots = col.querySelectorAll('.spread-dots i');
        dots.forEach(function (d) {
          setTimeout(function () { d.classList.add('on'); }, delay);
          delay += 18;
        });
        delay += 200;
      });
    }
    if (btn) btn.addEventListener('click', run);
  });

  /* Interactive checklist with progress */
  document.querySelectorAll('[data-checklist]').forEach(function (cl) {
    var boxes = Array.prototype.slice.call(cl.querySelectorAll('input[type=checkbox]'));
    var bar = cl.querySelector('.checklist-bar i');
    var pct = cl.querySelector('.pct');
    function update() {
      var done = boxes.filter(function (b) { return b.checked; }).length;
      var p = boxes.length ? Math.round((done / boxes.length) * 100) : 0;
      if (bar) bar.style.width = p + '%';
      if (pct) pct.textContent = done + ' / ' + boxes.length + (p === 100 ? ' ✓ ready' : '');
    }
    boxes.forEach(function (b) { b.addEventListener('change', update); });
    update();
  });

  /* Copy chips */
  document.querySelectorAll('.copy-chip button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var done = function () { btn.classList.add('copied'); var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.classList.remove('copied'); btn.textContent = t; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, done); }
      else { done(); }
    });
  });
})();
