// pamphlets-loader.js — fills in [data-pamphlet] anchor hrefs from the API
// Any <a data-pamphlet="slug"> gets its href updated to the current URL for that pamphlet.
(function(){
  var links = document.querySelectorAll('a[data-pamphlet]');
  if (!links.length) return;

  fetch('/api/pamphlets', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(pamphlets){
      if (!Array.isArray(pamphlets)) return;
      var bySlug = {};
      pamphlets.forEach(function(p){ bySlug[p.slug] = p; });
      links.forEach(function(a){
        var slug = a.getAttribute('data-pamphlet');
        if (bySlug[slug] && bySlug[slug].url) {
          a.href = bySlug[slug].url;
          if (!a.textContent.trim()) a.textContent = bySlug[slug].title;
        }
      });
    })
    .catch(function(){}); // silently fall back to the hardcoded href
})();
