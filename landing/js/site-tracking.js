(function () {
  'use strict';

  if (window.__vsiVisitTracked) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  window.__vsiVisitTracked = true;
  document.documentElement.setAttribute('data-visit-tracked', 'true');

  function getVisitorId() {
    var key = 'vsi-visitor-id';
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'vsi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return 'vsi-session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  }

  var params = new URLSearchParams(location.search);
  var payload = {
    visitor_id: getVisitorId(),
    site_host: (location.hostname || '').toLowerCase().replace(/^www\./, ''),
    path: location.pathname || '/',
    referrer: document.referrer || '',
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    fbclid: params.get('fbclid') || '',
    ttclid: params.get('ttclid') || ''
  };

  fetch('/api/track?type=visit', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    cache: 'no-store',
    keepalive: true,
    body: JSON.stringify(payload)
  }).catch(function () {
    // Analytics must never block the public resource pages.
  });
}());
