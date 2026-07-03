// Applies admin page-content overrides saved via the Page Editor in admin.
(function(){
  var page = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '') || 'index';
  fetch('/api/page-content?page=' + encodeURIComponent(page), { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(overrides){
      if (!Array.isArray(overrides) || !overrides.length) return;
      overrides.forEach(function(o){
        try {
          if (!o.selector || !('html' in o)) return;
          var el = document.querySelector(o.selector);
          if (el) el.innerHTML = o.html;
        } catch (e) {}
      });
    })
    .catch(function(){});
})();
