// General-fund donation wiring — shared across every page.
// Reads the admin-editable `general_donate_url` site setting and, when set:
//   • injects a persistent "Donate" button into the page header
//     (board-top on interior pages, hero actions on the homepage), and
//   • activates any [data-donate-link] slots (e.g. the homepage General Fund
//     section), hiding their [data-donate-pending] "coming soon" fallback.
// When no URL is configured yet, no dead button is shown and slots stay in
// their pending state.
(function () {
  'use strict';

  fetch('/api/track?type=setting&key=general_donate_url', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      apply(data && typeof data.value === 'string' ? data.value.trim() : '');
    })
    .catch(function () { apply(''); });

  function apply(url) {
    var valid = /^https?:\/\//i.test(url);

    // Homepage / section donate slots
    document.querySelectorAll('[data-donate-link]').forEach(function (el) {
      if (valid) {
        el.setAttribute('href', url);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
        el.removeAttribute('hidden');
      }
    });
    document.querySelectorAll('[data-donate-pending]').forEach(function (el) {
      if (valid) el.setAttribute('hidden', ''); else el.removeAttribute('hidden');
    });

    if (!valid) return; // no destination → no header button

    injectStyles();

    var btn = document.createElement('a');
    btn.className = 'global-donate-btn';
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.setAttribute('aria-label', 'Donate to the VillageServer general fund');
    btn.innerHTML = '<span aria-hidden="true">♥</span> Donate';

    var boardWrap = document.querySelector('.board-top .wrap');
    var heroActions = document.querySelector('.hero-actions');

    if (boardWrap) {
      var back = boardWrap.querySelector('.board-back');
      if (back) {
        var group = document.createElement('div');
        group.className = 'board-top-actions';
        boardWrap.insertBefore(group, back);
        group.appendChild(back);
        group.appendChild(btn);
      } else {
        boardWrap.appendChild(btn);
      }
    } else if (heroActions) {
      btn.classList.add('in-hero');
      heroActions.appendChild(btn);
    }
  }

  function injectStyles() {
    if (document.getElementById('global-donate-css')) return;
    var s = document.createElement('style');
    s.id = 'global-donate-css';
    s.textContent =
      '.board-top-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.global-donate-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;' +
        'min-height:44px;padding:0 20px;border-radius:999px;background:#1a7f37;color:#fff;' +
        'text-decoration:none;font-weight:900;font-size:.92rem;letter-spacing:.01em;' +
        'transition:background .15s,transform .15s;box-shadow:0 6px 18px rgba(26,127,55,.28)}' +
      '.global-donate-btn:hover,.global-donate-btn:focus-visible{background:#116329;transform:translateY(-1px);outline:0}' +
      '.global-donate-btn>span{font-size:1.05em;line-height:1}' +
      '.global-donate-btn.in-hero{min-height:52px;padding:0 28px;font-size:1.02rem}' +
      '@media(max-width:620px){.global-donate-btn.in-hero{width:100%}}';
    document.head.appendChild(s);
  }
})();
