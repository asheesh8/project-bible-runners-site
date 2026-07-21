// Site assistant — a self-contained floating chat helper.
// Talks to /api/assistant. Reuses the site's color tokens; no external SDK.
(function () {
  if (window.__vsiAssistantLoaded) return;
  window.__vsiAssistantLoaded = true;

  var API = '/api/assistant';
  var messages = []; // {role, content} history sent to the API
  var busy = false;

  // ── Styles ─────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '.vsi-asst-launch{position:fixed;right:20px;bottom:20px;z-index:9998;display:inline-flex;align-items:center;gap:9px;padding:13px 18px;border:0;border-radius:999px;background:var(--blue,#1f5795);color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer;box-shadow:0 10px 30px rgba(22,58,107,.28)}',
    '.vsi-asst-launch:hover{filter:brightness(1.06)}',
    '.vsi-asst-launch svg{width:20px;height:20px}',
    '.vsi-asst-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 40px));display:none;flex-direction:column;background:#fff;border:1px solid var(--line,#d7e3f0);border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(22,58,107,.28);font-family:inherit}',
    '.vsi-asst-panel.open{display:flex}',
    '.vsi-asst-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--blue,#1f5795);color:#fff}',
    '.vsi-asst-head strong{font-size:1rem;font-weight:800;flex:1}',
    '.vsi-asst-head button{background:rgba(255,255,255,.16);border:0;color:#fff;width:30px;height:30px;border-radius:8px;font-size:1.1rem;cursor:pointer;line-height:1}',
    '.vsi-asst-body{flex:1;overflow-y:auto;padding:16px;background:var(--paper,#f7fbff);display:flex;flex-direction:column;gap:12px}',
    '.vsi-asst-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:.92rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.vsi-asst-msg.bot{align-self:flex-start;background:#fff;border:1px solid var(--line,#d7e3f0);color:var(--ink,#17283c)}',
    '.vsi-asst-msg.me{align-self:flex-end;background:var(--blue,#1f5795);color:#fff}',
    '.vsi-asst-msg.typing{color:var(--muted,#5d6b7d);font-style:italic}',
    '.vsi-asst-msg p:last-child,.vsi-asst-msg ul:last-child,.vsi-asst-msg ol:last-child{margin-bottom:0}',
    '.vsi-asst-msg li{margin:2px 0}',
    '.vsi-asst-msg code{background:rgba(31,87,149,.09);padding:1px 5px;border-radius:5px;font-size:.86em}',
    '.vsi-asst-msg a{word-break:break-word}',
    '.vsi-asst-foot{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line,#d7e3f0);background:#fff}',
    '.vsi-asst-foot textarea{flex:1;resize:none;border:1.5px solid var(--line,#d7e3f0);border-radius:12px;padding:9px 12px;font:inherit;font-size:.92rem;max-height:96px;color:var(--ink,#17283c)}',
    '.vsi-asst-foot textarea:focus{outline:0;border-color:var(--blue,#1f5795)}',
    '.vsi-asst-foot button{flex:0 0 auto;border:0;border-radius:12px;background:var(--blue,#1f5795);color:#fff;font-weight:800;padding:0 16px;cursor:pointer}',
    '.vsi-asst-foot button:disabled{opacity:.55;cursor:default}',
    '.vsi-asst-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
    '@media (max-width:520px){.vsi-asst-panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px)}}',
  ].join('');
  document.head.appendChild(css);

  // ── Markup ─────────────────────────────────────────────
  var launch = document.createElement('button');
  launch.className = 'vsi-asst-launch';
  launch.type = 'button';
  launch.setAttribute('aria-label', 'Ask the VillageServer assistant');
  launch.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Ask a question';

  var panel = document.createElement('div');
  panel.className = 'vsi-asst-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'VillageServer assistant');
  panel.innerHTML =
    '<div class="vsi-asst-head"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><strong>VillageServer Assistant</strong><button type="button" data-close aria-label="Close">×</button></div>' +
    '<div class="vsi-asst-body" data-body></div>' +
    '<form class="vsi-asst-foot" data-form>' +
    '<div class="vsi-asst-hp"><label>Website<input type="text" tabindex="-1" autocomplete="off" data-hp></label></div>' +
    '<textarea data-input rows="1" placeholder="Ask about kits, sharing, applying…" maxlength="500"></textarea>' +
    '<button type="submit" data-send>Send</button></form>';

  document.body.appendChild(launch);
  document.body.appendChild(panel);

  var body = panel.querySelector('[data-body]');
  var form = panel.querySelector('[data-form]');
  var input = panel.querySelector('[data-input]');
  var sendBtn = panel.querySelector('[data-send]');
  var hp = panel.querySelector('[data-hp]');

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Render a light, safe subset of markdown so replies look clean instead of
  // showing raw #, **, and - symbols. Always escapes HTML first.
  function renderMarkdown(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var html = '';
    var listType = null; // 'ul' | 'ol' | null

    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      // markdown links [text](url)
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>');
      // bare links: full urls, site paths, and *.pdf/*.html paths not already linked
      s = s.replace(/(^|[\s(])((?:https?:\/\/[^\s<]+)|(?:\/[A-Za-z0-9_\-./]+\.(?:html|pdf)))/g,
        function (m, pre, url) { return pre + '<a href="' + url + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">' + url + '</a>'; });
      return s;
    }
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { closeList(); return; }
      // strip stray markdown heading hashes — we don't want big headers in chat
      line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      var ul = line.match(/^\s*[-*•]\s+(.*)$/);
      if (ol) {
        if (listType !== 'ol') { closeList(); html += '<ol style="margin:4px 0;padding-left:20px">'; listType = 'ol'; }
        html += '<li>' + inline(ol[1]) + '</li>';
      } else if (ul) {
        if (listType !== 'ul') { closeList(); html += '<ul style="margin:4px 0;padding-left:20px">'; listType = 'ul'; }
        html += '<li>' + inline(ul[1]) + '</li>';
      } else {
        closeList();
        html += '<p style="margin:0 0 8px">' + inline(line) + '</p>';
      }
    });
    closeList();
    return html || esc(text);
  }

  function addBubble(role, text) {
    var el = document.createElement('div');
    el.className = 'vsi-asst-msg ' + (role === 'user' ? 'me' : 'bot');
    // User text stays plain; the assistant's replies get light markdown rendering.
    el.innerHTML = role === 'user' ? esc(text) : renderMarkdown(text);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  var opened = false;
  function openPanel() {
    panel.classList.add('open');
    launch.style.display = 'none';
    if (!opened) {
      opened = true;
      addBubble('bot', "Hi! I can help with questions about VillageServer kits, how the library is shared, power and satellite options, and how to apply for equipment. What would you like to know?");
    }
    setTimeout(function () { input.focus(); }, 50);
  }
  function closePanel() { panel.classList.remove('open'); launch.style.display = ''; }

  launch.addEventListener('click', openPanel);
  panel.querySelector('[data-close]').addEventListener('click', closePanel);

  input.addEventListener('input', function () {
    input.value = input.value
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '')
      .replace(/[\u200D\uFE0F\u20E3\u0000-\u001F\u007F]/g, ' ');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;

    addBubble('user', text);
    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    busy = true;
    sendBtn.disabled = true;
    var typing = addBubble('bot', 'Typing…');
    typing.classList.add('typing');

    var payload = { messages: messages, website: hp.value, site_host: location.host };
    if (window.VSITracking && window.VSITracking.visitorId) payload.visitor_id = window.VSITracking.visitorId();

    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typing.remove();
        var reply = (data && data.reply) || "Sorry, I couldn't reach the assistant. Please try the contact form.";
        addBubble('bot', reply);
        messages.push({ role: 'assistant', content: reply });
        if (data && data.limited) {
          input.disabled = true;
          sendBtn.disabled = true;
          input.placeholder = 'Chat limit reached';
        }
      })
      .catch(function () {
        typing.remove();
        addBubble('bot', "Sorry, something went wrong. Please try again, or use the contact form and the team will help you.");
      })
      .then(function () {
        busy = false;
        if (!input.disabled) { sendBtn.disabled = false; input.focus(); }
      });
  });
})();
