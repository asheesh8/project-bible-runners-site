(function () {
  'use strict';

  if (window.__vsiVisitTracked) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  window.__vsiVisitTracked = true;
  document.documentElement.setAttribute('data-visit-tracked', 'true');

  var params = new URLSearchParams(location.search);
  var payload = {
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
