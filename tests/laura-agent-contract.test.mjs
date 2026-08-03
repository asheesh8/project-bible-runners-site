import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  detectApplicantClarificationNeeds, normalizeDecision, sanitizeExtracted, stripQuotedReply,
} from '../api/_lib/laura-agent.js';
import {
  LARRY_ACTIONS, actionButtonsFor, actionMeta, isKnownAction, postedButtonNames,
  signActionToken, verifyActionToken,
} from '../api/_lib/laura-links.js';
import {
  escapeHtml, renderActionPage, renderDigestEmail, renderLarryActionEmail, renderThreadCardHtml,
} from '../api/_lib/laura-email.js';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('Laura receptionist schema, endpoints, and admin console stay wired in', () => {
  const schema = read('../supabase/schema.sql');
  const core = read('../api/_lib/laura-agent.js');
  const agentApi = read('../api/intake-agent.js');
  const digestApi = read('../api/intake-digest.js');
  const gmailPollApi = read('../api/intake-gmail-poll.js');
  const oauthApi = read('../api/intake-gmail-oauth.js');
  const trackApi = read('../api/track.js');
  const admin = read('../landing/admin.html');
  const applicationForm = read('../landing/equipment-application.html');
  const vercel = read('../vercel.json');
  const lauraWorkflow = read('../.github/workflows/laura-agent.yml');
  const docs = read('../docs/laura-agent-setup.md');

  assert.match(schema, /create table if not exists public\.intake_threads/);
  assert.match(schema, /create table if not exists public\.intake_messages/);
  assert.match(schema, /create table if not exists public\.agent_filing_items/);
  assert.match(schema, /create table if not exists public\.agent_digests/);
  assert.match(schema, /laura_auto_send_missing_info/);
  assert.match(schema, /shipping_address text/);
  // Shipping hand-off and the campaigns Laura drafts from a posted file.
  assert.match(schema, /alter table public\.deployments add column if not exists tracking_number text/);
  assert.match(schema, /alter table public\.intake_threads add column if not exists tracking_number text/);
  assert.match(schema, /alter table public\.posts add column if not exists source_application_id text/);
  assert.match(schema, /alter table public\.posts add column if not exists auto_created boolean/);

  assert.match(core, /runLauraAgent/);
  assert.match(core, /sendLauraDigest/);
  assert.match(core, /pollGmailInbox/);
  assert.match(core, /fileDeploymentForThread/);
  assert.match(core, /ANTROPIC_API_KEY/);
  assert.match(core, /EMAIL_PROVIDER/);
  assert.match(core, /RESEND_API_KEY_AGENT/);
  assert.match(core, /GMAIL_REFRESH_TOKEN/);
  assert.match(core, /LARRY_CAL_BOOKING_URL/);
  assert.match(core, /shipping address or delivery destination/);
  assert.match(core, /superseded_at/);
  assert.match(core, /gmail_client_configured/);
  assert.match(core, /applications:/);
  assert.match(core, /monetary_support: trim\(app\.funding_needed/);
  assert.match(core, /function encodeMailHeader/);
  assert.match(core, /Subject: \$\{encodeMailHeader\(subject\)\}/);
  assert.match(core, /detectApplicantClarificationNeeds/);
  assert.match(core, /tier_audience_mismatch/);
  assert.match(core, /Applicant-resolvable intake discrepancies must be clarified with the applicant before asking Larry/);
  assert.match(core, /Tier 4 and Tier 5 requests need a real congregation or regional deployment plan/);

  assert.match(agentApi, /isAuthorizedAdmin/);
  assert.match(agentApi, /approve-send/);
  assert.match(digestApi, /CRON_SECRET/);
  assert.match(gmailPollApi, /pollGmailInbox/);
  assert.match(oauthApi, /gmail\.modify/);
  assert.match(oauthApi, /refresh_token/);
  assert.match(oauthApi, /missing_env/);

  assert.match(trackApi, /ensureThreadForApplication/);
  assert.match(trackApi, /runLauraAgent/);
  assert.match(trackApi, /LAURA_DRAFT_ON_SUBMIT/);
  assert.match(trackApi, /shipping_address: trimText/);
  assert.match(trackApi, /payloadWithoutShipping/);

  assert.match(core, /autoSendGate/);
  assert.match(core, /runDueFollowUps/);
  assert.match(core, /performLarryAction/);
  assert.match(core, /LAURA_SEND_COOLDOWN_HOURS/);
  assert.match(core, /next_follow_up_at/);
  assert.match(schema, /laura_autonomy/);

  assert.match(agentApi, /run-followups/);
  assert.match(agentApi, /run-all/);
  assert.match(core, /runAllWaitingThreads/);

  // A follow-up clock that nothing reads is the same as no clock. Approve and
  // schedule-call arm `ready_to_schedule`, Hold arms whatever state the file was
  // in, and posting a card arms the arrival check — the query has to cover all
  // of them, not just the two intake states.
  assert.match(core, /state=in\.\(new,waiting_on_customer,waiting_on_larry,ready_to_schedule,shipped,follow_up_photos\)/);
  assert.match(core, /hold expired — back in the digest/);
  assert.match(core, /function bookingNudgeDecision/);
  // The deployment record promises rollout photos, so something must ask.
  assert.match(core, /function arrivalCheckDecision/);
  assert.match(core, /LAURA_ARRIVAL_CHECK_DAYS/);
  assert.match(core, /next_follow_up_at: daysFromNow\(config\(\)\.arrivalCheckDays\)/);
  assert.match(core, /closed after arrival checks went unanswered/);
  // Nothing else looks for a file whose first run died before it decided
  // anything, so the sweep is the only thing standing between that and silence.
  assert.match(core, /export async function sweepStalledThreads/);
  assert.match(core, /next_follow_up_at=is\.null/);
  assert.match(agentApi, /action === 'sweep'/);
  assert.match(digestApi, /sweepStalledThreads/);
  assert.match(admin, /function lauraSweep/);
  assert.match(admin, /Find dropped files/);
  // A held draft must not leave the thread claiming it is waiting on someone.
  assert.match(core, /gate\.kind === 'timing'/);
  assert.match(core, /inbound_configured/);
  assert.match(admin, /Laura cannot hear replies yet/);
  // Bulk sending must be able to answer "who would this write to?" first.
  assert.match(core, /dry_run: true, would_contact/);
  assert.match(admin, /function lauraRunAll/);
  assert.match(admin, /dry_run:true/);
  assert.match(admin, /These are real emails/);
  assert.match(agentApi, /larry-action/);
  assert.match(digestApi, /runDueFollowUps/);

  assert.match(admin, /data-tab="laura-agent"/);
  assert.match(admin, /function loadLauraAgent/);
  assert.match(admin, /function lauraLarryAction/);
  assert.match(admin, /function lauraSetAutonomy/);
  assert.match(admin, /function lauraRunFollowUps/);
  assert.match(admin, /Larry&rsquo;s call|Larry’s call/);
  assert.match(admin, /lauraApproveSend/);
  assert.match(admin, /lauraPollGmail/);
  assert.match(admin, /lauraFileDeployment/);
  assert.match(admin, /Shipping address/);
  assert.match(admin, /Client cabinet/);
  assert.match(admin, /Contact file/);
  assert.match(admin, /Mission request/);
  assert.match(admin, /Application notes/);
  assert.match(admin, /Person files/);
  assert.match(admin, /What&#39;s next/);
  assert.match(admin, /Email thread/);
  assert.match(admin, /Current draft waiting for approval/);
  assert.match(admin, /Gmail thread/);

  assert.match(applicationForm, /name="shipping_address"/);

  assert.doesNotMatch(vercel, /"crons"/);
  assert.match(lauraWorkflow, /intake-gmail-poll/);
  assert.match(lauraWorkflow, /intake-digest/);
  // GitHub throttles high-frequency schedules into uselessness, so polling must
  // not depend on one. An external cron owns it.
  assert.doesNotMatch(lauraWorkflow, /cron: "\*\/10/);
  assert.match(lauraWorkflow, /cron: "0 \*\/6 \* \* \*"/);
  assert.match(docs, /cron-job\.org/);
  assert.match(docs, /x-cron-secret: <CRON_SECRET>/);
  assert.match(lauraWorkflow, /secrets\.CRON_SECRET/);
  assert.match(docs, /AGENT_EMAIL=villageserverassistant@gmail\.com/);
  assert.match(docs, /LARRY_EMAIL=larry\.villageserver@gmail\.com/);
  assert.match(docs, /ANTROPIC_API_KEY/);
  assert.match(docs, /RESEND_API_KEY_AGENT/);
  assert.match(docs, /Vercel Hobby/);
  assert.match(docs, /GMAIL_REFRESH_TOKEN/);
  assert.match(docs, /gmail\.modify/);
});

test('action links only ever authorise one thread and one action', () => {
  process.env.LAURA_ACTION_SECRET = 'contract-test-secret';
  const threadId = '11111111-2222-3333-4444-555555555555';

  const token = signActionToken(threadId, 'approve');
  const good = verifyActionToken(token);
  assert.equal(good.ok, true);
  assert.equal(good.thread_id, threadId);
  assert.equal(good.action, 'approve');

  // Editing the action inside the payload must not verify.
  const raw = Buffer.from(token, 'base64url').toString('utf8');
  const swapped = Buffer.from(raw.replace('.approve.', '.decline.'), 'utf8').toString('base64url');
  assert.equal(verifyActionToken(swapped).ok, false);

  assert.equal(verifyActionToken('garbage').ok, false);
  assert.equal(verifyActionToken('').ok, false);
  assert.equal(verifyActionToken(signActionToken(threadId, 'approve', { ttlDays: -1 })).reason, 'expired');

  process.env.LAURA_ACTION_SECRET = 'a-completely-different-secret';
  assert.equal(verifyActionToken(token).reason, 'bad_signature');
  delete process.env.LAURA_ACTION_SECRET;

  assert.equal(isKnownAction('approve'), true);
  assert.equal(isKnownAction('drop-table'), false);
  // Approving, declining and sending a draft must never fire from a bare GET,
  // because mail scanners follow links.
  assert.equal(LARRY_ACTIONS.approve.confirm, true);
  assert.equal(LARRY_ACTIONS.decline.confirm, true);
  assert.equal(LARRY_ACTIONS['send-draft'].confirm, true);
});

test('Larry’s email renders every file with its own buttons and escapes hostile input', () => {
  process.env.LAURA_ACTION_SECRET = 'contract-test-secret';
  const threadId = '11111111-2222-3333-4444-555555555555';
  const item = {
    applicantName: '<script>alert(1)</script>',
    applicantEmail: 'grace@example.org',
    threadToken: 'A1B2C3D4',
    headline: 'Ready for your call.',
    facts: [['Requested', 'Tier 3'], ['Blank', '']],
    flags: ['power and internet access'],
    buttons: actionButtonsFor(threadId, { hasDraft: false }),
    adminUrl: 'https://www.villageservers.com/admin.html',
  };
  const digest = renderDigestEmail({ agentName: 'Laura', items: [item], stamp: 'now' });

  assert.match(digest.html, /laura-action\?token=/);
  assert.doesNotMatch(digest.html, /<script>/);
  assert.match(digest.html, /&lt;script&gt;/);
  assert.doesNotMatch(digest.html, />Blank</); // empty facts are dropped
  assert.equal((digest.html.match(/<table/g) || []).length, (digest.html.match(/<\/table>/g) || []).length);

  // The approve button has to describe what pressing it will actually do, so
  // its wording follows what the initiative can currently send.
  assert.match(digest.text, /Approve — send a card: https/);
  assert.doesNotMatch(digest.text, /booking link/);

  process.env.LAURA_OFFER_MODE = 'full_kits';
  const withKits = renderDigestEmail({
    agentName: 'Laura',
    items: [{ ...item, buttons: actionButtonsFor(threadId, { hasDraft: false }) }],
  });
  assert.match(withKits.text, /Approve & send booking link: https/);
  delete process.env.LAURA_OFFER_MODE;

  const page = renderActionPage({
    title: 'Approve', message: 'Confirm?', tone: 'go',
    confirm: { url: '/api/laura-action?token=x', label: 'Yes' },
  });
  assert.match(page, /method="POST"/);
  assert.match(page, /Nothing has happened yet/);
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  delete process.env.LAURA_ACTION_SECRET;
});

test('only microSD cards are offered while LAURA_OFFER_MODE is sd_card_only', () => {
  const core = read('../api/_lib/laura-agent.js');
  const admin = read('../landing/admin.html');

  // The reality check must live in code, not only in the system prompt, so the
  // model cannot promise a kit or funding that does not exist.
  assert.match(core, /LAURA_OFFER_MODE/);
  assert.match(core, /sd_card_only/);
  assert.match(core, /function sdCardOfferDecision/);
  assert.match(core, /offer_sd_card/);
  assert.match(core, /Overrode \$\{action\} because only microSD cards are going out right now/);
  // ask_larry / send_schedule_link / file_deployment are all pre-empted.
  assert.match(core, /const supersedable = \[/);
  assert.match(core, /'ask_larry', 'send_schedule_link', 'file_deployment', 'ask_customer', 'reply_customer',/);
  // A deterministic override may replace what Laura says, never the judgement
  // that this particular message should not go out unread.
  assert.match(core, /auto_send_ok: forced\.auto_send_ok && d\.auto_send_ok !== false/);
  // The loop has to close: replies write back to the file, and a confirmed
  // card files itself.
  assert.match(core, /function applyExtracted/);
  assert.match(core, /EXTRACTABLE_FIELDS/);
  assert.match(core, /function cardConfirmationDecision/);
  assert.match(core, /confirm_card/);
  assert.match(core, /LAURA_MAX_ASK_ROUNDS/);
  // Answering someone who wrote back is not unprompted contact, so the
  // cooldown must not gate it.
  assert.match(core, /function applicantRepliedSinceLastSend/);
  assert.match(core, /const answering = applicantRepliedSinceLastSend\(messages\)/);
  assert.match(core, /if \(!answering && hours < c\.cooldownHours\)/);
  // Answering an applicant must not require Larry to have spoken first.
  assert.match(core, /action === 'reply_customer' && !hasInboundRole\(messages, 'larry'\) && !answering/);
  // A contradiction stops blocking the offer once the applicant has answered it.
  assert.match(core, /function readyForOffer\(app, messages = \[\]\)/);
  assert.match(core, /!hasInboundRole\(messages, 'applicant'\) && detectApplicantClarificationNeeds/);
  // Laura confirms the card, but Larry posts it — she must not file a
  // deployment for something nobody has actually sent.
  assert.match(core, /function notifyLarryReadyToShip/);
  assert.match(core, /ready_to_ship/);
  assert.match(core, /Nothing is filed yet/);
  assert.match(core, /'mark-shipped'/);
  assert.doesNotMatch(core, /confirm_card'\) \{\s*filed = await fileDeploymentForThread/);
  assert.match(admin, /mark-shipped/);
  assert.match(admin, /Ready to post/);
  // The offer collects exactly what a card needs.
  assert.match(core, /The language or languages your community needs on the card/);
  assert.match(core, /A shipping address, including a recipient name and a phone number/);
  // And it is honest without being a rejection.
  assert.match(core, /this is not a no, it is a not yet for the larger kits/);
  assert.match(core, /Never suggest that a larger kit or funding is coming/);
});

// A file with nothing missing and nothing contradictory: the state in which
// Laura is "comfortable with the person" and the card offer is the next move.
function cleanApplication(extra = {}) {
  return {
    id: 'app-1',
    name: 'Grace Achebe',
    email: 'grace@example.org',
    kit_tier: 1,
    audience_type: 'small_group',
    country: 'Kenya',
    region: 'Kisii',
    reference_name: 'Pastor Mary',
    reference_contact: 'mary@example.org',
    sending_org: 'Kisii Community Church',
    power_internet_access: 'Solar, phone data only',
    preferred_contact_method: 'email',
    receiving_plan: 'cover_import_costs',
    ...extra,
  };
}

const THREAD = { id: 'thread-1', thread_token: 'A1B2C3D4', state: 'waiting_on_customer' };

function sentMessage(actionType, at = '2026-07-01T00:00:00.000Z') {
  return {
    role: 'agent', direction: 'outbound', status: 'sent', action_type: actionType,
    to_email: ['grace@example.org'], created_at: at, sent_at: at,
  };
}

function replyMessage(at = '2026-07-02T00:00:00.000Z') {
  return { role: 'applicant', direction: 'inbound', status: 'received', body: 'Yes please!', created_at: at };
}

test('a clean file is scaled down to the card offer, whatever the model proposed', () => {
  const decision = normalizeDecision(
    { next_action: 'ask_larry', audience: 'larry', auto_send_ok: true },
    cleanApplication(), THREAD, [],
  );
  assert.equal(decision.next_action, 'offer_sd_card');
  assert.equal(decision.audience, 'applicant');
  assert.match(decision.reasoning, /only microSD cards are going out/);

  // The override replaces what she says, never the judgement that a particular
  // message should not go out unread.
  const flagged = normalizeDecision(
    { next_action: 'ask_larry', audience: 'larry', auto_send_ok: false },
    cleanApplication(), THREAD, [],
  );
  assert.equal(flagged.next_action, 'offer_sd_card');
  assert.equal(flagged.auto_send_ok, false);
});

test('a card that is already confirmed or posted is never re-offered or re-confirmed', () => {
  const app = cleanApplication({
    languages: 'Ekegusii, Swahili',
    shipping_address: 'Pastor Mary Ondieki, PO Box 1420, Kisii 40200, Kenya, +254 700 000000',
  });

  // Once they have taken up the offer, a complete file closes itself out.
  const closing = normalizeDecision(
    { next_action: 'reply_customer', audience: 'applicant', auto_send_ok: true },
    app, THREAD, [sentMessage('offer_sd_card'), replyMessage()],
  );
  assert.equal(closing.next_action, 'confirm_card');

  // After it, "thank you, it arrived" must not be answered with the
  // confirmation letter all over again.
  const afterConfirm = normalizeDecision(
    { next_action: 'reply_customer', audience: 'applicant', auto_send_ok: true, draft_body: 'You are very welcome.' },
    app, THREAD, [sentMessage('offer_sd_card'), replyMessage(), sentMessage('confirm_card')],
  );
  assert.equal(afterConfirm.next_action, 'reply_customer');
  assert.equal(afterConfirm.draft_body, 'You are very welcome.');

  // And a posted card is settled by its state alone, whatever the history says.
  const afterShipping = normalizeDecision(
    { next_action: 'reply_customer', audience: 'applicant', auto_send_ok: true, draft_body: 'Glad it reached you.' },
    app, { ...THREAD, state: 'shipped' }, [sentMessage('offer_sd_card'), replyMessage()],
  );
  assert.equal(afterShipping.next_action, 'reply_customer');
});

test('silence is not an acceptance of the card offer', () => {
  // Plenty of applications already carry a language and an address from the
  // original form. Laura must not read her own offer plus the form they filled
  // in weeks ago as an answer — that thanks somebody for details they never
  // sent and books them a card they never asked for.
  const app = cleanApplication({
    languages: 'Lusoga',
    shipping_address: 'Kigambo Samuel, +256706260398, Uganda, Jinja district',
  });

  const noReply = normalizeDecision(
    { next_action: 'ask_customer', audience: 'applicant', auto_send_ok: true, draft_body: 'Just checking in.' },
    app, THREAD, [sentMessage('offer_sd_card')],
  );
  assert.notEqual(noReply.next_action, 'confirm_card');
  assert.equal(noReply.draft_body, 'Just checking in.');

  // A reply that lands *before* the offer is not an answer to it either.
  const staleReply = normalizeDecision(
    { next_action: 'ask_customer', audience: 'applicant', auto_send_ok: true, draft_body: 'Just checking in.' },
    app, THREAD,
    [replyMessage('2026-06-01T00:00:00.000Z'), sentMessage('offer_sd_card', '2026-07-01T00:00:00.000Z')],
  );
  assert.notEqual(staleReply.next_action, 'confirm_card');

  // But a reply after it is.
  const answered = normalizeDecision(
    { next_action: 'ask_customer', audience: 'applicant', auto_send_ok: true },
    app, THREAD, [sentMessage('offer_sd_card'), replyMessage()],
  );
  assert.equal(answered.next_action, 'confirm_card');
});

test('Laura may transcribe what an applicant said, never who they are or how they were rated', () => {
  const clean = sanitizeExtracted({
    languages: 'Bemba, English',
    shipping_address: 'Box 12, Ndola, Zambia',
    kit_tier: 'tier 3',
    // None of these are hers to write.
    status: 'approved',
    email: 'attacker@example.com',
    name: 'Someone Else',
    triage_score: 3,
    id: 'other-application',
    // Nor is a placeholder the model echoed back at her.
    reference_name: 'unknown',
  });

  assert.deepEqual(clean, {
    languages: 'Bemba, English',
    shipping_address: 'Box 12, Ndola, Zambia',
    kit_tier: 3,
  });
  assert.deepEqual(sanitizeExtracted(null), {});
});

test('the tracking page collects exactly the fields the endpoint reads back', () => {
  process.env.LAURA_ACTION_SECRET = 'contract-test-secret';
  const meta = actionMeta('add-tracking');

  // Mail clients strip <form>, so the box has to live on the page the button
  // opens. If that page and the endpoint ever disagree on the field name,
  // Larry's typing is silently dropped and he is still told it worked.
  const page = renderActionPage({
    title: meta.label,
    message: meta.blurb,
    tone: meta.tone,
    confirm: { url: '/api/laura-action?token=abc', label: meta.label, inputs: meta.inputs },
  });
  assert.match(page, /method="POST"/);
  assert.match(page, /name="value"/);
  assert.match(page, /required/);
  assert.match(page, /Tracking or order number/);

  // Every field any action asks for has to be one the endpoint actually reads.
  const endpoint = read('../api/laura-action.js');
  assert.match(endpoint, /value: body\.value/);
  const asked = Object.values(LARRY_ACTIONS)
    .flatMap((entry) => entry.inputs || [])
    .map((field) => field.name);
  assert.deepEqual([...new Set(asked)].sort(), ['value']);

  // A GET must never carry an action that writes, so both stay behind confirm.
  assert.equal(LARRY_ACTIONS['add-tracking'].confirm, true);
  assert.equal(LARRY_ACTIONS['publish-post'].confirm, true);
  delete process.env.LAURA_ACTION_SECRET;
});

test('a posted card asks for the two things only Larry can supply', () => {
  process.env.LAURA_ACTION_SECRET = 'contract-test-secret';
  const core = read('../api/_lib/laura-agent.js');

  assert.deepEqual(postedButtonNames(), ['add-tracking', 'publish-post', 'skip-tracking']);
  const buttons = actionButtonsFor('11111111-2222-3333-4444-555555555555', { actions: postedButtonNames() });
  assert.equal(buttons.length, 3);
  buttons.forEach((button) => assert.match(button.url, /laura-action\?token=/));

  // Posting a card files the write-up and asks for the number.
  assert.match(core, /function notifyLarryPosted/);
  assert.match(core, /export async function ensurePostForThread/);
  // The address block is built for the posting stages only, and the intro no
  // longer repeats it — one place to read it from, no chance of disagreement.
  assert.match(core, /function shipToFor/);
  assert.match(core, /ADDRESSABLE_STAGES/);
  assert.match(core, /shipTo: shipToFor\(app, stage, thread\)/);
  assert.doesNotMatch(core, /`Send to: \$\{trim\(app\.shipping_address/);
  assert.match(core, /action === 'add-tracking'/);
  assert.match(core, /action === 'skip-tracking'/);
  assert.match(core, /action === 'publish-post'/);
  // The number reaches both the export and the applicant.
  assert.match(core, /tracking_number: tracking/);
  assert.match(core, /action_type: 'tracking_number'/);
  // One write-up per applicant, not a fundraiser: no donation link, no goal.
  assert.match(core, /function postDraftFrom/);
  assert.match(core, /auto_created: true/);
  assert.doesNotMatch(core, /zeffy/i);
  assert.doesNotMatch(core, /goal_amount/);
  // It stays unpublished unless the site is explicitly told otherwise, because
  // it names a real person and where they are.
  assert.match(core, /LAURA_AUTO_PUBLISH_POSTS/);
  // Their own reply is folded into that same post, and never auto-published.
  assert.match(core, /function appendReplyToWriteUp/);
  assert.match(core, /published: false/);
  delete process.env.LAURA_ACTION_SECRET;
});

test('the address Larry posts to keeps the line breaks the applicant typed', () => {
  const address = 'Pastor Mary Ondieki\nKisii Community Church\nPO Box 1420\nKisii 40200\nKenya';
  const html = renderThreadCardHtml({
    applicantName: 'Grace Achebe',
    headline: 'Ready for you to post a card.',
    shipTo: { label: 'Post to', address, rows: [['Card language', 'Ekegusii, Swahili']] },
    facts: [['Where', 'Kisii, Kenya']],
    buttons: [],
  });

  // Reflowing someone's address into a paragraph is how a parcel goes astray,
  // so the block must preserve whitespace rather than collapse it.
  assert.match(html, /Post to/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /PO Box 1420\nKisii 40200/);
  assert.match(html, /Card language/);

  // It sits above the facts — when a file is ready to post, the address is the
  // message and everything else is context.
  assert.ok(html.indexOf('Post to') < html.indexOf('Where'));

  // A file with no address renders no empty block.
  assert.doesNotMatch(renderThreadCardHtml({ applicantName: 'Grace', facts: [], buttons: [] }), /Post to/);
});

test('Larry’s intro keeps its line breaks and numbered steps', () => {
  // Escaping the intro into one <p> collapsed every newline, which ran an
  // address and an instruction together on the same line.
  const email = renderLarryActionEmail({
    agentName: 'Laura',
    intro: 'Two things left:\n\n1. The tracking number.\n2. The campaign link.\n\nThat is all.',
    item: { applicantName: 'Grace Achebe', facts: [], buttons: [] },
  });
  assert.match(email.html, /<ol/);
  assert.match(email.html, /<li[^>]*>The tracking number\.<\/li>/);
  assert.match(email.html, /<li[^>]*>The campaign link\.<\/li>/);
  assert.doesNotMatch(email.html, /1\. The tracking number\.\s*2\. The campaign link\./);
});

test('quoted history is trimmed off inbound replies', () => {
  const stripped = stripQuotedReply([
    'Yes, my reference is Pastor Mary.',
    '',
    'On Tue, Jul 28, 2026 at 4:02 PM Laura <laura@example.com> wrote:',
    '> Could you send an independent reference?',
  ].join('\n'));
  assert.equal(stripped, 'Yes, my reference is Pastor Mary.');
  assert.equal(stripQuotedReply('A plain reply.'), 'A plain reply.');
  // If the markers match everything, keep the original rather than store nothing.
  assert.ok(stripQuotedReply('> entirely quoted').length > 0);
});

test('production secrets are not committed into Laura files', () => {
  const joined = [
    read('../api/_lib/laura-agent.js'),
    read('../api/_lib/laura-links.js'),
    read('../api/_lib/laura-email.js'),
    read('../api/intake-agent.js'),
    read('../api/intake-digest.js'),
    read('../api/intake-gmail-poll.js'),
    read('../api/intake-gmail-oauth.js'),
    read('../api/laura-action.js'),
    read('../docs/laura-agent-setup.md'),
  ].join('\n');

  assert.doesNotMatch(joined, /sk-ant-api/i);
  assert.doesNotMatch(joined, /re_[A-Za-z0-9_]{20,}/);
});

test('Laura flags contradictory high-tier applications before Larry review', () => {
  const concerns = detectApplicantClarificationNeeds({
    name: 'Full Name*',
    email: 'the_johnsons@surewest.net',
    country: 'Canada',
    region: 'New York City',
    kit_tier: 5,
    audience_type: 'individual',
    current_reach: '5-6',
    reach_justification: 'daily use',
    shipping_address: 'Down Town City Hall, New York',
    reference_name: 'Jim Crow',
    reference_contact: 'jim@example.com',
  }).map((item) => item.code);

  assert.deepEqual(concerns, [
    'placeholder_name',
    'tier_audience_mismatch',
    'tier_5_low_reach',
    'large_tier_weak_reach_plan',
    'reference_needs_verification',
    'mission_location_mismatch',
    'shipping_country_mismatch',
    'vague_shipping',
  ]);
});
