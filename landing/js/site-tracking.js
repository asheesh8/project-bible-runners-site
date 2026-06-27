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

  function sendTracking(type, data, preferBeacon) {
    var endpoint = '/api/track?type=' + encodeURIComponent(type);
    var body = JSON.stringify(data);
    if (preferBeacon && navigator.sendBeacon && window.Blob) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      } catch (e) {
        // Fall back to fetch below.
      }
    }

    fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      cache: 'no-store',
      keepalive: true,
      body: body
    }).catch(function () {
      // Analytics must never block the public resource pages.
    });
  }

  function linkType(link, url) {
    if (link.hasAttribute('download') || /\.(pdf|zip|docx?|xlsx?|pptx?|mp[34]|mov)(?:$|[?#])/i.test(url.href)) return 'download';
    if (url.protocol === 'mailto:') return 'email';
    if (url.protocol === 'tel:') return 'phone';
    if (url.hostname && url.hostname !== location.hostname) return 'external';
    if (url.hash && url.pathname === location.pathname) return 'anchor';
    return 'internal';
  }

  function linkLabel(link, rawHref) {
    return (link.getAttribute('aria-label') || link.textContent || link.title || rawHref || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }

  function basePayload() {
    return {
      visitor_id: getVisitorId(),
      site_host: (location.hostname || '').toLowerCase().replace(/^www\./, ''),
      path: location.pathname || '/'
    };
  }

  var params = new URLSearchParams(location.search);
  var base = basePayload();
  var payload = {
    visitor_id: base.visitor_id,
    site_host: base.site_host,
    path: base.path,
    referrer: document.referrer || '',
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    fbclid: params.get('fbclid') || '',
    ttclid: params.get('ttclid') || ''
  };

  sendTracking('visit', payload, false);

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('data-no-track')) return;

    var rawHref = link.getAttribute('href') || '';
    if (!rawHref || /^(javascript|data):/i.test(rawHref)) return;

    var url;
    try {
      url = new URL(rawHref, location.href);
    } catch (e) {
      return;
    }

    var clickBase = basePayload();
    sendTracking('click', {
      visitor_id: clickBase.visitor_id,
      site_host: clickBase.site_host,
      path: clickBase.path,
      link_url: url.href,
      link_text: linkLabel(link, rawHref),
      link_type: linkType(link, url)
    }, true);
  }, true);

  window.VSITracking = {
    visitorId: getVisitorId,
    basePayload: basePayload,
    enrich: function (data) {
      var base = basePayload();
      Object.keys(data || {}).forEach(function (key) { base[key] = data[key]; });
      return base;
    }
  };
}());
