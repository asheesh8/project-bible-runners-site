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
function textToHtml(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) return '';
    const isList = lines.every((line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line));
    if (isList) {
      const items = lines
        .map((line) => `<li style="margin:0 0 6px">${escapeHtml(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`)
        .join('');
      return `<ul style="margin:0 0 16px;padding-left:20px;color:${PALETTE.text}">${items}</ul>`;
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
  } = item || {};

  return `
<div style="font-size:18px;font-weight:800;color:${PALETTE.text};line-height:1.3">${escapeHtml(applicantName)}</div>
<div style="font-size:13px;color:${PALETTE.muted};margin-top:4px">
  ${escapeHtml(applicantEmail)}${threadToken ? ` &nbsp;·&nbsp; <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">VS-${escapeHtml(threadToken)}</span>` : ''}
</div>
${headline ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${PALETTE.text}">${escapeHtml(headline)}</p>` : ''}
${factTable(facts)}
${flagList(flags)}
${draftPreview(draft)}
${buttonRow(buttons)}
${adminUrl ? `<div style="margin-top:14px;text-align:center">
  <a href="${escapeHtml(adminUrl)}" style="font-size:13px;font-weight:700;color:${PALETTE.muted};text-decoration:underline">Open the full file</a>
</div>` : ''}`;
}

function threadCardText(item) {
  const { applicantName, applicantEmail, threadToken, headline, facts = [], flags = [], buttons = [], adminUrl } = item || {};
  return [
    `${applicantName || 'Applicant'} <${applicantEmail || 'no email'}> — VS-${threadToken || ''}`,
    headline || '',
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
    card(`${intro ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:${PALETTE.muted}">${escapeHtml(intro)}</p>` : ''}${renderThreadCardHtml(item)}`),
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

// ── The page Larry lands on after clicking a button ─────────────────────

export function renderActionPage({ title, message, detail = '', tone = 'go', confirm = null } = {}) {
  const accent = tone === 'stop' ? PALETTE.stop : tone === 'neutral' ? PALETTE.neutral : PALETTE.go;
  const form = confirm ? `
<form method="POST" action="${escapeHtml(confirm.url)}" style="margin-top:26px">
  <button type="submit" style="width:100%;background:${accent};border:1px solid ${accent};color:#fff;border-radius:10px;padding:15px 18px;font-size:16px;font-weight:700;font-family:${FONT};cursor:pointer">${escapeHtml(confirm.label)}</button>
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
