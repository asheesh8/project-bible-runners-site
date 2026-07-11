(function () {
  'use strict';

  var languages = [
    ['en', 'English'],
    ['es', 'Español / Spanish'],
    ['zh-CN', '中文 / Chinese'],
    ['hi', 'हिन्दी / Hindi'],
    ['ar', 'العربية / Arabic'],
    ['fr', 'Français / French'],
    ['pt', 'Português / Portuguese'],
    ['ru', 'Русский / Russian'],
    ['bn', 'বাংলা / Bengali'],
    ['id', 'Bahasa Indonesia / Indonesian'],
    ['ur', 'اردو / Urdu'],
    ['sw', 'Kiswahili / Swahili'],
    ['vi', 'Tiếng Việt / Vietnamese'],
    ['tl', 'Tagalog / Filipino'],
    ['ne', 'नेपाली / Nepali'],
    ['sd', 'سنڌي / Sindhi']
  ];
  var curatedHomepageLanguages = ['en', 'fr', 'sw', 'es', 'hi', 'ne', 'bn'];
  var supported = languages.map(function (item) { return item[0]; });
  var saved = localStorage.getItem('vsi-language') || 'en';
  if (supported.indexOf(saved) < 0) saved = 'en';

  // documentElement.lang stays "en" until the page actually renders in the
  // chosen language: i18n.js sets it on the curated path, translatePage() sets
  // it once machine translation has been applied.
  document.documentElement.setAttribute('data-language', saved);

  // The curated i18n path only works when the page actually carries data-i18n
  // markup; without it, selecting a curated language must fall through to
  // machine translation or nothing visibly changes.
  function hasCuratedContent() {
    return Boolean(window.VSI18N && document.querySelector('[data-i18n],[data-i18n-html]'));
  }

  function changeLanguage(language) {
    if (supported.indexOf(language) < 0) return;
    if (language === saved) return; // no reload if already selected
    var previous = saved;
    localStorage.setItem('vsi-language', language);
    document.documentElement.setAttribute('data-language', language);
    window.dispatchEvent(new CustomEvent('vsi:languagechange', { detail: { language: language } }));
    if (
      curatedHomepageLanguages.indexOf(language) >= 0 &&
      curatedHomepageLanguages.indexOf(previous) >= 0 &&
      hasCuratedContent()
    ) {
      window.VSI18N.apply(language);
      saved = language;
      return;
    }
    window.location.reload();
  }

  function buildSelect() {
    var existing = document.getElementById('language-select');
    if (existing) {
      existing.classList.add('notranslate');
      existing.setAttribute('translate', 'no');
      existing.value = saved;
      // Guard against double-binding if script runs twice
      var clone = existing.cloneNode(true);
      existing.parentNode.replaceChild(clone, existing);
      clone.value = saved;
      clone.addEventListener('change', function () { changeLanguage(clone.value); });
      return;
    }

    var control = document.createElement('div');
    control.className = 'global-language-switch notranslate';
    control.setAttribute('translate', 'no');
    control.innerHTML = '<span aria-hidden="true">文</span><label for="global-language-select">Language</label><select id="global-language-select" aria-label="Choose language"></select>';
    var select = control.querySelector('select');
    languages.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item[0];
      option.textContent = item[1];
      select.appendChild(option);
    });
    select.value = saved;
    select.addEventListener('change', function () { changeLanguage(select.value); });
    document.body.appendChild(control);
  }

  function protectCuratedHomepageText() {
    if (!document.getElementById('language-select')) return;
    if (curatedHomepageLanguages.indexOf(saved) < 0) return;
    document.querySelectorAll('[data-i18n],[data-i18n-html],.setup-preview,.availability-result').forEach(function (node) {
      node.classList.add('notranslate');
      node.setAttribute('translate', 'no');
    });
  }

  function addStyles() {
    var style = document.createElement('style');
    style.textContent =
      '.global-language-switch{position:fixed;right:18px;bottom:18px;z-index:1200;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #d9ddd4;border-radius:999px;background:rgba(251,250,245,.96);box-shadow:0 10px 35px rgba(20,38,28,.18);font:600 12px "DM Sans",sans-serif;color:#18221d;backdrop-filter:blur(10px)}' +
      '.global-language-switch>span{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#123e31;color:#d9df7b;font-size:11px}.global-language-switch label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
      '.global-language-switch select{border:0;background:transparent;color:#18221d;font:600 12px "DM Sans",sans-serif;min-width:112px;outline:none}' +
      '@media(max-width:520px){.global-language-switch{right:10px;bottom:10px}.global-language-switch select{min-width:94px}.footer{padding-bottom:78px}}' +
      '#vsi-translating-hint{position:fixed;left:18px;bottom:18px;z-index:1200;padding:9px 14px;border:1px solid #d9ddd4;border-radius:999px;background:rgba(251,250,245,.96);box-shadow:0 10px 35px rgba(20,38,28,.18);font:600 12px "DM Sans",sans-serif;color:#18221d;backdrop-filter:blur(10px)}' +
      '@media(max-width:520px){#vsi-translating-hint{left:10px;bottom:10px}}';
    document.head.appendChild(style);
  }

  var hintTimer = null;

  function hideTranslatingHint() {
    var hint = document.getElementById('vsi-translating-hint');
    if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  }

  function showTranslatingHint() {
    if (document.getElementById('vsi-translating-hint')) return;
    var hint = document.createElement('div');
    hint.id = 'vsi-translating-hint';
    hint.className = 'notranslate';
    hint.setAttribute('translate', 'no');
    hint.setAttribute('role', 'status');
    hint.textContent = 'Translating…';
    document.body.appendChild(hint);
    // Failsafe: never leave the hint up if translation stalls
    hintTimer = setTimeout(hideTranslatingHint, 8000);
  }

  // ── Page translator ────────────────────────────────────────────────
  // Google retired the translate-element widget: element.js still loads and
  // renders its dropdown, but it no longer issues any translation requests
  // (verified July 2026 — it marks the page "translated" and does nothing).
  // The public endpoint the widget family uses is still live, so we walk the
  // page's text nodes and translate them against it ourselves, batching
  // requests and caching results in localStorage so navigation across pages
  // reuses shared strings (nav, footer) without refetching.

  var TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=';
  var translatedNodes = typeof WeakSet === 'function' ? new WeakSet() : null;

  function cacheKey(lang) { return 'vsi-tr-' + lang; }

  function readCache(lang) {
    try { return JSON.parse(localStorage.getItem(cacheKey(lang))) || {}; } catch (e) { return {}; }
  }

  function writeCache(lang, map) {
    try {
      var json = JSON.stringify(map);
      if (json.length < 400000) localStorage.setItem(cacheKey(lang), json);
    } catch (e) { /* quota exceeded — translations applied, just not cached */ }
  }

  function collectTextNodes() {
    var nodes = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (translatedNodes && translatedNodes.has(node)) continue;
      // require at least one two-letter word: skips numbers, punctuation,
      // and the countdown digits without needing per-node config
      if (!node.nodeValue || !/[A-Za-z]{2,}/.test(node.nodeValue)) continue;
      var el = node.parentElement;
      if (!el || el.closest('script,style,noscript,textarea,code,pre,.notranslate,[translate="no"]')) continue;
      nodes.push(node);
    }
    return nodes;
  }

  function fetchTranslations(lang, texts) {
    var body = new URLSearchParams();
    texts.forEach(function (t) { body.append('q', t); });
    return fetch(TRANSLATE_ENDPOINT + encodeURIComponent(lang), { method: 'POST', body: body })
      .then(function (res) {
        if (!res.ok) throw new Error('translate http ' + res.status);
        return res.json();
      });
  }

  function translatePage(lang) {
    var nodes = collectTextNodes();
    var cache = readCache(lang);
    var pending = [];
    var seen = {};

    function want(text) {
      var key = text.trim();
      if (key && !(key in cache) && !seen[key]) { seen[key] = true; pending.push(key); }
    }

    nodes.forEach(function (node) { want(node.nodeValue); });
    if (document.title) want(document.title);

    // Batch so each request stays well under body-size limits
    var batches = [];
    var batch = [];
    var size = 0;
    pending.forEach(function (text) {
      if (batch.length >= 100 || size + text.length > 4000) { batches.push(batch); batch = []; size = 0; }
      batch.push(text);
      size += text.length;
    });
    if (batch.length) batches.push(batch);

    var chain = Promise.resolve();
    batches.forEach(function (group) {
      chain = chain.then(function () {
        return fetchTranslations(lang, group).then(function (out) {
          group.forEach(function (text, i) {
            var t = out && out[i];
            if (Array.isArray(t)) t = t[0];
            if (typeof t === 'string' && t) cache[text] = t;
          });
        });
      });
    });

    return chain.then(function () {
      nodes.forEach(function (node) {
        var original = node.nodeValue;
        var key = original.trim();
        var translated = cache[key];
        if (!translated || translated === key) return;
        // replace only the trimmed core so surrounding whitespace survives
        node.nodeValue = original.replace(key, translated);
        if (translatedNodes) translatedNodes.add(node);
      });
      var titleKey = document.title.trim();
      if (cache[titleKey]) document.title = cache[titleKey];
      writeCache(lang, cache);
      document.documentElement.lang = lang;
    });
  }

  function watchDynamicContent() {
    if (typeof MutationObserver !== 'function') return;
    var scheduled = null;
    var observer = new MutationObserver(function (mutations) {
      if (scheduled) return;
      var relevant = mutations.some(function (m) {
        var el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        return el && el.closest && !el.closest('.notranslate,[translate="no"],script,style');
      });
      if (!relevant) return;
      scheduled = setTimeout(function () {
        scheduled = null;
        translatePage(saved).catch(function () {});
      }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function startTranslator() {
    if (saved === 'en') return;
    showTranslatingHint();
    translatePage(saved).then(function () {
      hideTranslatingHint();
      watchDynamicContent();
    }).catch(function () {
      // endpoint unreachable — page stays in English
      hideTranslatingHint();
    });
  }

  function init() {
    addStyles();
    protectCuratedHomepageText();
    buildSelect();
    // English (the default) needs no translation, so default visitors pay zero
    // translation cost. Curated homepage languages are translated locally by
    // i18n.js; everything else is machine-translated by translatePage().
    if (saved === 'en') return;
    if (curatedHomepageLanguages.indexOf(saved) >= 0 && hasCuratedContent()) return;
    startTranslator();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VSILanguage = { change: changeLanguage, current: function () { return saved; } };
}());
