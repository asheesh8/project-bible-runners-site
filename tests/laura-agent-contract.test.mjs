import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { detectApplicantClarificationNeeds } from '../api/_lib/laura-agent.js';

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

  assert.match(admin, /data-tab="laura-agent"/);
  assert.match(admin, /function loadLauraAgent/);
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

test('production secrets are not committed into Laura files', () => {
  const joined = [
    read('../api/_lib/laura-agent.js'),
    read('../api/intake-agent.js'),
    read('../api/intake-digest.js'),
    read('../api/intake-gmail-poll.js'),
    read('../api/intake-gmail-oauth.js'),
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
