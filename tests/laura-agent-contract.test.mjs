import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { detectApplicantClarificationNeeds, stripQuotedReply } from '../api/_lib/laura-agent.js';
import {
  LARRY_ACTIONS, actionButtonsFor, isKnownAction, signActionToken, verifyActionToken,
} from '../api/_lib/laura-links.js';
import { escapeHtml, renderActionPage, renderDigestEmail } from '../api/_lib/laura-email.js';

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
