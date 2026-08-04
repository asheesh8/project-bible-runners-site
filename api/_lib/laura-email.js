// HTML email templates for Laura.
//
// Two audiences, two jobs:
//   - Applicants get a plain, warm letter. Nothing clever — it has to survive a
//     patchy connection and a cheap phone.
//   - Larry gets a decision card with one-click buttons, so an application can
//     move forward from his inbox without opening the admin panel.
//
// Everything is tables + inline styles because that is what Gmail, Outlook and
// Apple Mail actually render. Every template also returns plain text, which is
// what gets stored and what non-HTML clients fall back to.

const PALETTE = {
  text: '#24292f',
  muted: '#57606a',
  faint: '#8a929b',
  border: '#d0d7de',
  wash: '#f6f8fa',
  go: '#1a7f37',
  neutral: '#0969da',
  stop: '#cf222e',
  warn: '#7d4e00',
  warnBg: '#fff8c5',
  warnBorder: '#d4a72c',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn Laura's plain-text draft into paragraphs, keeping "- " lines as a list.
// A numbered block becomes an <ol> so "1." and "2." survive — stripping the
// prefix into a bulleted list loses the ordering Laura wrote them in.
function textToHtml(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) return '';
    const numbered = lines.every((line) => /^\s*\d+\.\s+/.test(line));
    const isList = numbered || lines.every((line) => /^\s*[-*]\s+/.test(line));
    if (isList) {
      const tag = numbered ? 'ol' : 'ul';
      const items = lines
        .map((line) => `<li style="margin:0 0 6px">${escapeHtml(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`)
        .join('');
      return `<${tag} style="margin:0 0 16px;padding-left:20px;color:${PALETTE.text}">${items}</${tag}>`;
    }
    return `<p style="margin:0 0 16px;line-height:1.55;color:${PALETTE.text}">${lines.map(escapeHtml).join('<br>')}</p>`;
  }).join('');
}

function shell(innerHtml, { preheader = '' } = {}) {
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PALETTE.wash};font-family:${FONT};-webkit-font-smoothing:antialiased">
${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.wash};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
${innerHtml}
</table>
</td></tr></table>
</body></html>`;
}

function card(innerHtml, { padding = '24px' } = {}) {
  return `<tr><td style="background:#ffffff;border:1px solid ${PALETTE.border};border-radius:12px;padding:${padding}">
${innerHtml}
</td></tr>`;
}

function spacer(height = 14) {
  return `<tr><td style="height:${height}px;line-height:${height}px;font-size:0">&nbsp;</td></tr>`;
}

function footer(agentName, extraLine = '') {
  return `<tr><td style="padding:18px 8px 4px;text-align:center;font-size:12px;line-height:1.6;color:${PALETTE.faint}">
${escapeHtml(agentName)} · VillageServer Initiative<br>
${extraLine ? `${escapeHtml(extraLine)}<br>` : ''}
Reply to this email and it reaches the same place.
</td></tr>`;
}

// ── Applicant letter ────────────────────────────────────────────────────

export function renderApplicantEmail({ agentName = 'Laura', text = '', threadToken = '' } = {}) {
  const body = String(text || '');
  // Laura signs off in the plain text already; drop it so it isn't duplicated
  // under the styled signature block.
  const withoutSignature = body
    .replace(new RegExp(`\\n+${agentName}\\s*\\n+VillageServer Initiative\\s*$`, 'i'), '')
    .trim();

  const inner = [
    card(`
${textToHtml(withoutSignature)}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid ${PALETTE.border};width:100%">
  <tr><td style="padding-top:16px;font-size:14px;line-height:1.5;color:${PALETTE.text}">
    <strong style="color:${PALETTE.text}">${escapeHtml(agentName)}</strong><br>
    <span style="color:${PALETTE.muted}">VillageServer Initiative</span>
  </td></tr>
</table>`),
    footer(agentName, threadToken ? `Reference VS-${threadToken}` : ''),
  ].join('');

  return {
    html: shell(inner, { preheader: withoutSignature.split('\n').filter(Boolean)[1] || '' }),
    text: body,
  };
}

// ── Larry's decision card ───────────────────────────────────────────────

function buttonRow(buttons) {
  if (!buttons || !buttons.length) return '';
  const color = { go: PALETTE.go, stop: PALETTE.stop, neutral: PALETTE.neutral };
  // Exactly one filled button per card. Two solid greens stacked together read
  // as two defaults, and Larry should never have to work out which is which.
  const primary = buttons.findIndex((button) => button.tone === 'go');
  const cells = buttons.map((button, index) => {
    const solid = index === primary;
    const accent = color[button.tone] || PALETTE.neutral;
    const style = solid
      ? `background:${accent};border:1px solid ${accent};color:#ffffff`
      : `background:#ffffff;border:1px solid ${PALETTE.border};color:${accent}`;
    return `<tr><td style="padding:0 0 8px">
  <a href="${escapeHtml(button.url)}" style="display:block;${style};border-radius:8px;padding:12px 16px;font-size:15px;font-weight:700;text-decoration:none;text-align:center;font-family:${FONT}">${escapeHtml(button.label)}</a>
</td></tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">${cells}</table>`;
}

function factTable(rows) {
  const cells = rows.filter((row) => row && row[1]).map(([label, value]) => `<tr>
  <td style="padding:6px 12px 6px 0;font-size:13px;font-weight:700;color:${PALETTE.muted};white-space:nowrap;vertical-align:top;width:130px">${escapeHtml(label)}</td>
  <td style="padding:6px 0;font-size:13px;color:${PALETTE.text};line-height:1.5">${escapeHtml(value)}</td>
</tr>`).join('');
  if (!cells) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${PALETTE.border};padding-top:6px">${cells}</table>`;
}

function flagList(flags) {
  if (!flags || !flags.length) return '';
  const items = flags.map((flag) => `<li style="margin:0 0 5px;line-height:1.5">${escapeHtml(flag)}</li>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
<tr><td style="background:${PALETTE.warnBg};border:1px solid ${PALETTE.warnBorder};border-radius:8px;padding:12px 14px">
  <div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.warn};margin-bottom:7px">Still open</div>
  <ul style="margin:0;padding-left:18px;font-size:13px;color:${PALETTE.warn}">${items}</ul>
</td></tr></table>`;
}

// The panel Larry actually copies onto an envelope. It gets its own block, at
// the top of the card and bigger than everything else, because when a file is
// ready to post the address *is* the message — everything else on the card is
// context for a decision that has already been made.
//
// Monospace and pre-wrap on purpose: the applicant typed these line breaks, and
// reflowing someone's address into a paragraph is how a parcel goes astray.
function addressBlock(shipTo) {
  if (!shipTo || !shipTo.address) return '';
  const rows = (shipTo.rows || []).filter((row) => row && row[1]).map(([label, value]) => `<tr>
  <td style="padding:3px 10px 3px 0;font-size:12px;font-weight:700;color:${PALETTE.muted};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
  <td style="padding:3px 0;font-size:13px;color:${PALETTE.text};line-height:1.5">${escapeHtml(value)}</td>
</tr>`).join('');

  // A parcel posted to an address that cannot receive it comes back weeks later,
  // so if Laura could not verify it, that says so above the label rather than
  // letting Larry find out from the returned envelope.
  const warning = shipTo.warning ? `<div style="margin-bottom:12px;background:${PALETTE.warnBg};border:1px solid ${PALETTE.warnBorder};border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:${PALETTE.warn}">
    <strong>Check before you post.</strong> ${escapeHtml(shipTo.warning)}
  </div>` : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
<tr><td style="background:#ffffff;border:2px solid ${PALETTE.text};border-radius:10px;padding:16px 18px">
  <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:10px">${escapeHtml(shipTo.label || 'Post to')}</div>
  ${warning}
  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.65;color:${PALETTE.text};white-space:pre-wrap;word-break:break-word">${escapeHtml(shipTo.address)}</div>
  ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid ${PALETTE.border};padding-top:4px">${rows}</table>` : ''}
</td></tr></table>`;
}

function draftPreview(draft) {
  if (!draft || !draft.body) return '';
  const preview = String(draft.body).trim();
  const clipped = preview.length > 700 ? `${preview.slice(0, 700).trimEnd()}…` : preview;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
<tr><td style="background:${PALETTE.wash};border:1px solid ${PALETTE.border};border-radius:8px;padding:14px">
  <div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:8px">Draft waiting to send</div>
  <div style="font-size:13px;font-weight:700;color:${PALETTE.text};margin-bottom:8px">${escapeHtml(draft.subject || '')}</div>
  <div style="font-size:13px;line-height:1.55;color:${PALETTE.text};white-space:pre-wrap">${escapeHtml(clipped)}</div>
</td></tr></table>`;
}

// One applicant, everything Larry needs to decide, and the buttons to do it.
export function renderThreadCardHtml(item) {
  const {
    applicantName = 'Applicant', applicantEmail = '', threadToken = '',
    headline = '', facts = [], flags = [], draft = null, buttons = [], adminUrl = '',
    shipTo = null,
  } = item || {};

  return `
<div style="font-size:18px;font-weight:800;color:${PALETTE.text};line-height:1.3">${escapeHtml(applicantName)}</div>
<div style="font-size:13px;color:${PALETTE.muted};margin-top:4px">
  ${escapeHtml(applicantEmail)}${threadToken ? ` &nbsp;·&nbsp; <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">VS-${escapeHtml(threadToken)}</span>` : ''}
</div>
${headline ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${PALETTE.text}">${escapeHtml(headline)}</p>` : ''}
${addressBlock(shipTo)}
${factTable(facts)}
${flagList(flags)}
${draftPreview(draft)}
${buttonRow(buttons)}
${adminUrl ? `<div style="margin-top:14px;text-align:center">
  <a href="${escapeHtml(adminUrl)}" style="font-size:13px;font-weight:700;color:${PALETTE.muted};text-decoration:underline">Open the full file</a>
</div>` : ''}`;
}

function threadCardText(item) {
  const {
    applicantName, applicantEmail, threadToken, headline,
    facts = [], flags = [], buttons = [], adminUrl, shipTo = null,
  } = item || {};

  // Indented and set apart from the facts, so it stays legible in the clients
  // that show plain text only — the address has to survive there too.
  const address = shipTo && shipTo.address ? [
    `  ${(shipTo.label || 'Post to').toUpperCase()}`,
    ...(shipTo.warning ? [`    ** CHECK BEFORE YOU POST: ${shipTo.warning}`] : []),
    ...String(shipTo.address).split('\n').map((line) => `    ${line}`),
    ...(shipTo.rows || []).filter((row) => row && row[1]).map(([label, value]) => `    ${label}: ${value}`),
  ] : [];

  return [
    `${applicantName || 'Applicant'} <${applicantEmail || 'no email'}> — VS-${threadToken || ''}`,
    headline || '',
    ...address,
    ...facts.filter((row) => row && row[1]).map(([label, value]) => `  ${label}: ${value}`),
    flags.length ? `  Still open: ${flags.join('; ')}` : '',
    '',
    ...buttons.map((button) => `  ${button.label}: ${button.url}`),
    adminUrl ? `  Open the full file: ${adminUrl}` : '',
  ].filter(Boolean).join('\n');
}

// A single application that needs Larry.
export function renderLarryActionEmail({ agentName = 'Laura', intro = '', item = {} } = {}) {
  const inner = [
    `<tr><td style="padding:0 4px 14px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted}">${escapeHtml(agentName)} · needs your call</div>
    </td></tr>`,
    // textToHtml, not a single escaped <p>: Laura's intros carry line breaks and
    // numbered steps, and collapsing them into one paragraph runs an address and
    // an instruction together on the same line.
    card(`${intro ? `<div style="font-size:15px;color:${PALETTE.muted}">${textToHtml(intro)}</div>` : ''}${renderThreadCardHtml(item)}`),
    footer(agentName),
  ].join('');

  return {
    html: shell(inner, { preheader: item.headline || '' }),
    text: [`Larry,`, '', intro || '', '', threadCardText(item), '', agentName].filter(Boolean).join('\n'),
  };
}

// The periodic roll-up: every active file, each with its own buttons.
export function renderDigestEmail({ agentName = 'Laura', stamp = '', items = [], adminUrl = '' } = {}) {
  const count = items.length;
  const heading = `<tr><td style="padding:0 4px 14px">
  <div style="font-size:20px;font-weight:800;color:${PALETTE.text}">${count} ${count === 1 ? 'file needs' : 'files need'} you</div>
  <div style="font-size:13px;color:${PALETTE.muted};margin-top:5px">${escapeHtml(agentName)}'s intake digest${stamp ? ` · ${escapeHtml(stamp)}` : ''}</div>
</td></tr>`;

  const cards = items.map((item) => card(renderThreadCardHtml(item))).join(spacer(14));

  const tail = `<tr><td style="padding:20px 8px 0;text-align:center">
  ${adminUrl ? `<a href="${escapeHtml(adminUrl)}" style="font-size:13px;font-weight:700;color:${PALETTE.neutral};text-decoration:underline">Open the admin panel</a><br><br>` : ''}
  <span style="font-size:12px;color:${PALETTE.faint};line-height:1.6">Buttons act right away. You can also just reply to this email — ${escapeHtml(agentName)} reads it.</span>
</td></tr>`;

  return {
    html: shell([heading, cards, tail, footer(agentName)].join(''), {
      preheader: `${count} intake ${count === 1 ? 'file' : 'files'} waiting`,
    }),
    text: [
      'Larry,',
      '',
      `${agentName} intake digest${stamp ? `: ${stamp}` : ''} — ${count} active ${count === 1 ? 'file' : 'files'}.`,
      'Use the links under each file, or just reply to this email.',
      '',
      ...items.map((item, index) => `${index + 1}. ${threadCardText(item)}\n`),
      agentName,
    ].join('\n'),
  };
}

// ── The queue Laura is still working ────────────────────────────────────
//
// Deliberately not the card treatment. Nothing in this email needs Larry, so it
// is a status report he can skim in ten seconds: who is waiting, what they still
// owe, how long it has been. One link each, in case he wants to lean on somebody
// himself — Laura writes and sends it, he just decides who.
//
// Compact on purpose. At a thousand applicants a stack of decision cards is
// unreadable, and the thing that matters is the shape of the queue.

export function renderWaitingDigestEmail({
  agentName = 'Laura', stamp = '', items = [], adminUrl = '', overflow = 0,
} = {}) {
  const count = items.length;
  const rows = items.map((item) => {
    const wait = item.waited
      ? `<span style="font-size:12px;font-weight:700;color:${item.stale ? PALETTE.warn : PALETTE.faint};white-space:nowrap">${escapeHtml(item.waited)}</span>`
      : '';
    return `<tr><td style="padding:13px 0;border-bottom:1px solid ${PALETTE.border}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:15px;font-weight:700;color:${PALETTE.text};line-height:1.35">${escapeHtml(item.name)}</td>
    <td align="right" style="vertical-align:top">${wait}</td>
  </tr></table>
  <div style="font-size:12px;color:${PALETTE.faint};margin-top:2px">
    ${escapeHtml(item.email || '')}${item.token ? ` &middot; <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">VS-${escapeHtml(item.token)}</span>` : ''}
  </div>
  <div style="font-size:13.5px;color:${PALETTE.text};line-height:1.5;margin-top:7px">
    <span style="color:${PALETTE.muted}">Waiting on:</span> ${escapeHtml(item.waitingFor)}
  </div>
  ${item.nudgeUrl ? `<div style="margin-top:8px">
    <a href="${escapeHtml(item.nudgeUrl)}" style="font-size:13px;font-weight:700;color:${PALETTE.neutral};text-decoration:none;border:1px solid ${PALETTE.border};border-radius:7px;padding:6px 12px;display:inline-block">Ask them for it now</a>
  </div>` : ''}
</td></tr>`;
  }).join('');

  const heading = `<tr><td style="padding:0 4px 14px">
  <div style="font-size:20px;font-weight:800;color:${PALETTE.text}">${count} in the queue</div>
  <div style="font-size:13px;color:${PALETTE.muted};margin-top:5px">Nothing here needs you &mdash; this is what ${escapeHtml(agentName)} is waiting for${stamp ? ` &middot; ${escapeHtml(stamp)}` : ''}</div>
</td></tr>`;

  const tail = `<tr><td style="padding:18px 8px 0;text-align:center">
  ${overflow ? `<div style="font-size:13px;color:${PALETTE.muted};margin-bottom:12px">and ${overflow} more &mdash; the panel has the rest</div>` : ''}
  ${adminUrl ? `<a href="${escapeHtml(adminUrl)}" style="font-size:13px;font-weight:700;color:${PALETTE.neutral};text-decoration:underline">Open the admin panel</a><br><br>` : ''}
  <span style="font-size:12px;color:${PALETTE.faint};line-height:1.6">Every one of these is already being chased on a schedule. The links are only there if you want to push one along early.</span>
</td></tr>`;

  return {
    html: shell([heading, card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`),
      tail, footer(agentName)].join(''), { preheader: `${count} waiting, nothing needs you` }),
    text: [
      'Larry,',
      '',
      `${count} ${count === 1 ? 'file is' : 'files are'} with ${agentName}${stamp ? ` as of ${stamp}` : ''}. Nothing here needs you.`,
      '',
      ...items.map((item) => [
        `${item.name} <${item.email || 'no email'}> — VS-${item.token || ''}${item.waited ? ` — ${item.waited}` : ''}`,
        `  Waiting on: ${item.waitingFor}`,
        item.nudgeUrl ? `  Ask them for it now: ${item.nudgeUrl}` : '',
      ].filter(Boolean).join('\n')),
      overflow ? `\n…and ${overflow} more in the panel.` : '',
      adminUrl ? `\n${adminUrl}` : '',
      '',
      agentName,
    ].filter(Boolean).join('\n'),
  };
}

// ── The order Larry prints and sends to Digital Bible Society ───────────
//
// A document, not an email — so it is laid out for A4 and for a browser's
// "save as PDF", with the screen furniture stripped out at print time.
//
// The amount fields are editable in the browser and print whatever Larry typed.
// There is no price list in the system, so a filled-in figure would be a guess;
// a blank line he completes is honest and takes two seconds.

export function renderOrderForm(order = {}) {
  const {
    reference = '', raisedOn = '', supplier = {}, orderedBy = {},
    shipTo = {}, items = [], context = [], adminUrl = '',
  } = order;

  const addressLines = (shipTo.lines || []).map((line) => escapeHtml(line)).join('<br>');
  const rows = items.map((item) => `<tr>
    <td style="padding:12px 10px;border-bottom:1px solid ${PALETTE.border}">
      <strong style="display:block;color:${PALETTE.text}">${escapeHtml(item.description)}</strong>
      <span style="font-size:13px;color:${PALETTE.muted}">Language: ${escapeHtml(item.language)}</span>
    </td>
    <td style="padding:12px 10px;border-bottom:1px solid ${PALETTE.border};text-align:center;font-variant-numeric:tabular-nums">${escapeHtml(item.quantity)}</td>
    <td style="padding:12px 10px;border-bottom:1px solid ${PALETTE.border};text-align:right">
      <span class="fill" contenteditable="true" role="textbox" aria-label="Amount for ${escapeHtml(item.description)}">&nbsp;</span>
    </td>
  </tr>`).join('');

  const contextRows = context.map(([label, value]) => `<tr>
    <td style="padding:5px 14px 5px 0;color:${PALETTE.muted};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:5px 0;color:${PALETTE.text}">${escapeHtml(value)}</td>
  </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Order ${escapeHtml(reference)} — ${escapeHtml(supplier.name || 'Digital Bible Society')}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;background:${PALETTE.wash};font-family:${FONT};color:${PALETTE.text};line-height:1.55}
  .sheet{max-width:760px;margin:0 auto;padding:34px 20px 60px}
  .bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
  .bar button{border:1px solid ${PALETTE.border};background:#fff;color:${PALETTE.text};
    border-radius:9px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
  .bar button.primary{background:${PALETTE.go};border-color:${PALETTE.go};color:#fff}
  .bar a{align-self:center;font-size:13px;font-weight:700;color:${PALETTE.muted}}
  .hint{font-size:13px;color:${PALETTE.faint};margin:0 0 20px}
  .paper{background:#fff;border:1px solid ${PALETTE.border};border-radius:12px;padding:38px 40px}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{font-size:14px;color:${PALETTE.muted};margin:0 0 28px}
  .grid{display:flex;flex-wrap:wrap;gap:28px;margin-bottom:28px}
  .grid > div{flex:1 1 200px;min-width:0}
  .lbl{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;
    color:${PALETTE.muted};margin-bottom:7px}
  .addr{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;line-height:1.6}
  table{width:100%;border-collapse:collapse;font-size:14px}
  thead th{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
    color:${PALETTE.muted};text-align:left;padding:0 10px 8px;border-bottom:2px solid ${PALETTE.text}}
  thead th.num{text-align:center} thead th.amt{text-align:right}
  .fill{display:inline-block;min-width:110px;border-bottom:1px solid ${PALETTE.border};
    padding:2px 4px;text-align:right;font-variant-numeric:tabular-nums;outline:none}
  .fill:focus{border-bottom-color:${PALETTE.go};background:${PALETTE.wash}}
  .total{display:flex;justify-content:flex-end;align-items:baseline;gap:16px;
    margin-top:18px;padding-top:14px;border-top:2px solid ${PALETTE.text};font-weight:800}
  .warn{background:${PALETTE.warnBg};border:1px solid ${PALETTE.warnBorder};color:${PALETTE.warn};
    border-radius:8px;padding:11px 13px;font-size:13px;margin-bottom:20px}
  .ctx{margin-top:30px;padding-top:20px;border-top:1px solid ${PALETTE.border};font-size:13px}
  .ctx table{font-size:13px}
  .sig{margin-top:34px;padding-top:22px;border-top:1px solid ${PALETTE.border};
    display:flex;gap:32px;flex-wrap:wrap;font-size:13px;color:${PALETTE.muted}}
  .sig > div{flex:1 1 200px}
  .sigline{margin-top:26px;border-bottom:1px solid ${PALETTE.text}}
  @media print{
    body{background:#fff}
    .bar,.hint{display:none !important}
    .sheet{max-width:none;padding:0}
    .paper{border:0;border-radius:0;padding:0}
    .fill{border-bottom:1px solid #999}
    @page{margin:16mm}
  }
</style></head>
<body>
<div class="sheet">
  <div class="bar">
    <button type="button" class="primary" onclick="window.print()">Print or save as PDF</button>
    <button type="button" onclick="copyOrder(this)">Copy as text</button>
    ${adminUrl ? `<a href="${escapeHtml(adminUrl)}">Open the full file</a>` : ''}
  </div>
  <p class="hint">Fill in the amounts, then print or save as PDF and send it to ${escapeHtml(supplier.name || 'Digital Bible Society')}. Nothing here changes the file.</p>

  <div class="paper" id="order">
    <h1>Order ${escapeHtml(reference)}</h1>
    <p class="sub">Raised ${escapeHtml(raisedOn)} &middot; VillageServer Initiative</p>

    ${shipTo.warning ? `<div class="warn"><strong>Check this before sending.</strong> ${escapeHtml(shipTo.warning)}</div>` : ''}

    <div class="grid">
      <div>
        <div class="lbl">Supplier</div>
        <div><strong>${escapeHtml(supplier.name || 'Digital Bible Society')}</strong>${supplier.email ? `<br>${escapeHtml(supplier.email)}` : ''}</div>
      </div>
      <div>
        <div class="lbl">Ordered by</div>
        <div><strong>${escapeHtml(orderedBy.name || 'VillageServer Initiative')}</strong>${orderedBy.contact ? `<br>${escapeHtml(orderedBy.contact)}` : ''}</div>
      </div>
      <div>
        <div class="lbl">Deliver to</div>
        <div class="addr"><strong>${escapeHtml(shipTo.name || '')}</strong><br>${addressLines}</div>
        ${shipTo.phone ? `<div style="margin-top:8px;font-size:13px"><strong>Phone</strong> ${escapeHtml(shipTo.phone)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead><tr>
        <th>Item</th><th class="num" style="width:70px">Qty</th><th class="amt" style="width:150px">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total"><span>Total funded by VillageServer Initiative</span>
      <span class="fill" contenteditable="true" role="textbox" aria-label="Order total">&nbsp;</span></div>

    ${contextRows ? `<div class="ctx"><div class="lbl">About this deployment</div><table>${contextRows}</table></div>` : ''}

    <div class="sig">
      <div>Authorised by<div class="sigline"></div></div>
      <div>Date<div class="sigline"></div></div>
    </div>
  </div>
</div>
<script>
function copyOrder(btn){
  var text = document.getElementById('order').innerText.replace(/\\n{3,}/g,'\\n\\n').trim();
  navigator.clipboard.writeText(text).then(function(){
    var old = btn.textContent; btn.textContent = 'Copied';
    setTimeout(function(){ btn.textContent = old; }, 1600);
  });
}
</script>
</body></html>`;
}

// ── The page Larry lands on after clicking a button ─────────────────────

// Larry types here rather than in the email itself — Gmail, Outlook and Apple
// Mail all strip <form> out of a message body, so a box in the email would look
// fine and silently do nothing. The button in the email opens this page instead.
function inputFields(inputs) {
  if (!inputs || !inputs.length) return '';
  return inputs.map((field) => `
<label style="display:block;margin-top:22px;text-align:left">
  <span style="display:block;font-size:14px;font-weight:700;color:${PALETTE.text};margin-bottom:7px">${escapeHtml(field.label)}${field.required ? '' : ' <span style="font-weight:400;color:' + PALETTE.faint + '">(optional)</span>'}</span>
  <input type="${escapeHtml(field.type || 'text')}" name="${escapeHtml(field.name)}"
    ${field.required ? 'required' : ''}
    placeholder="${escapeHtml(field.placeholder || '')}"
    autocomplete="off" autocapitalize="off" spellcheck="false"
    style="width:100%;box-sizing:border-box;padding:13px 14px;font-size:16px;font-family:${FONT};color:${PALETTE.text};background:#fff;border:1px solid ${PALETTE.border};border-radius:10px;outline:none">
  ${field.help ? `<span style="display:block;margin-top:7px;font-size:13px;line-height:1.5;color:${PALETTE.faint}">${escapeHtml(field.help)}</span>` : ''}
</label>`).join('');
}

export function renderActionPage({ title, message, detail = '', tone = 'go', confirm = null } = {}) {
  const accent = tone === 'stop' ? PALETTE.stop : tone === 'neutral' ? PALETTE.neutral : PALETTE.go;
  const fields = confirm ? inputFields(confirm.inputs) : '';
  const form = confirm ? `
<form method="POST" action="${escapeHtml(confirm.url)}" style="margin-top:${fields ? '4px' : '26px'}">
  ${fields}
  <button type="submit" style="width:100%;margin-top:${fields ? '24px' : '0'};background:${accent};border:1px solid ${accent};color:#fff;border-radius:10px;padding:15px 18px;font-size:16px;font-weight:700;font-family:${FONT};cursor:pointer">${escapeHtml(confirm.label)}</button>
</form>
<p style="margin:14px 0 0;font-size:13px;color:${PALETTE.faint};text-align:center">Nothing has happened yet. Close this page to cancel.</p>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — VillageServer</title></head>
<body style="margin:0;background:${PALETTE.wash};font-family:${FONT};color:${PALETTE.text}">
<div style="max-width:520px;margin:0 auto;padding:56px 18px">
  <div style="background:#fff;border:1px solid ${PALETTE.border};border-radius:14px;padding:32px 28px">
    <div style="height:4px;width:44px;background:${accent};border-radius:99px;margin-bottom:20px"></div>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;line-height:1.25">${escapeHtml(title)}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${PALETTE.muted}">${escapeHtml(message)}</p>
    ${detail ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:${PALETTE.muted}">${escapeHtml(detail)}</p>` : ''}
    ${form}
  </div>
  <p style="text-align:center;margin:20px 0 0;font-size:12px;color:${PALETTE.faint}">VillageServer Initiative</p>
</div>
</body></html>`;
}
