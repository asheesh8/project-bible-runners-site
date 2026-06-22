(function () {
  'use strict';

  var languages = [
    ['en', 'English'], ['fr', 'Français'], ['sw', 'Kiswahili'],
    ['es', 'Español'], ['hi', 'हिन्दी'], ['ne', 'नेपाली'], ['bn', 'বাংলা']
  ];
  var supported = languages.map(function (item) { return item[0]; });
  var saved = localStorage.getItem('vsi-language') || 'en';
  if (supported.indexOf(saved) < 0) saved = 'en';

  document.documentElement.lang = saved;
  document.documentElement.setAttribute('data-language', saved);

  function translationCookie(language) {
    var expires = language === 'en' ? 'Thu, 01 Jan 1970 00:00:00 GMT' : '';
    var value = language === 'en' ? '' : '/en/' + language;
    document.cookie = 'googtrans=' + value + ';path=/;SameSite=Lax' + (expires ? ';expires=' + expires : '');
  }

  function changeLanguage(language) {
    if (supported.indexOf(language) < 0) return;
    localStorage.setItem('vsi-language', language);
    translationCookie(language);
    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-language', language);
    window.dispatchEvent(new CustomEvent('vsi:languagechange', { detail: { language: language } }));
    // Reload lets the translator cover server-rendered text and every later popup
    // from one consistent source language on every page.
    window.location.reload();
  }

  function buildSelect() {
    var existing = document.getElementById('language-select');
    if (existing) {
      existing.classList.add('notranslate');
      existing.setAttribute('translate', 'no');
      existing.value = saved;
      existing.addEventListener('change', function () { changeLanguage(existing.value); });
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
      '.global-language-switch select{border:0;background:transparent;color:#18221d;font:600 12px "DM Sans",sans-serif;min-width:112px;outline:none}.goog-te-banner-frame,.skiptranslate iframe{display:none!important}body{top:0!important}' +
      '@media(max-width:520px){.global-language-switch{right:10px;bottom:10px}.global-language-switch select{min-width:94px}}';
    document.head.appendChild(style);
  }

  function startTranslator() {
    if (saved === 'en') return;
    translationCookie(saved);
    window.googleTranslateElementInit = function () {
      if (!window.google || !window.google.translate) return;
      new window.google.translate.TranslateElement({
        pageLanguage: 'en',
        includedLanguages: supported.filter(function (code) { return code !== 'en'; }).join(','),
        autoDisplay: false
      }, 'vsi-google-translate');
    };
    var mount = document.createElement('div');
    mount.id = 'vsi-google-translate';
    mount.hidden = true;
    document.body.appendChild(mount);
    var script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    document.head.appendChild(script);
  }

  function init() {
    addStyles();
    protectCuratedHomepageText();
    buildSelect();
    startTranslator();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VSILanguage = { change: changeLanguage, current: function () { return saved; } };
}());
