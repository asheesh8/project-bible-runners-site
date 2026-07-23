import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
  const vercel = read('../vercel.json');
  const docs = read('../docs/laura-agent-setup.md');

  assert.match(schema, /create table if not exists public\.intake_threads/);
  assert.match(schema, /create table if not exists public\.intake_messages/);
  assert.match(schema, /create table if not exists public\.agent_filing_items/);
  assert.match(schema, /create table if not exists public\.agent_digests/);
  assert.match(schema, /laura_auto_send_missing_info/);

  assert.match(core, /runLauraAgent/);
  assert.match(core, /sendLauraDigest/);
  assert.match(core, /pollGmailInbox/);
  assert.match(core, /fileDeploymentForThread/);
  assert.match(core, /ANTROPIC_API_KEY/);
  assert.match(core, /EMAIL_PROVIDER/);
  assert.match(core, /RESEND_API_KEY_AGENT/);
  assert.match(core, /GMAIL_REFRESH_TOKEN/);
  assert.match(core, /LARRY_CAL_BOOKING_URL/);

  assert.match(agentApi, /isAuthorizedAdmin/);
  assert.match(agentApi, /approve-send/);
  assert.match(digestApi, /CRON_SECRET/);
  assert.match(gmailPollApi, /pollGmailInbox/);
  assert.match(oauthApi, /gmail\.modify/);
  assert.match(oauthApi, /refresh_token/);

  assert.match(trackApi, /ensureThreadForApplication/);
  assert.match(trackApi, /runLauraAgent/);
  assert.match(trackApi, /LAURA_DRAFT_ON_SUBMIT/);

  assert.match(admin, /data-tab="laura-agent"/);
  assert.match(admin, /function loadLauraAgent/);
  assert.match(admin, /lauraApproveSend/);
  assert.match(admin, /lauraPollGmail/);
  assert.match(admin, /lauraFileDeployment/);

  assert.match(vercel, /intake-gmail-poll/);
  assert.match(vercel, /intake-digest/);
  assert.match(docs, /AGENT_EMAIL=villageserverassistant@gmail\.com/);
  assert.match(docs, /LARRY_EMAIL=larry\.villageserver@gmail\.com/);
  assert.match(docs, /ANTROPIC_API_KEY/);
  assert.match(docs, /RESEND_API_KEY_AGENT/);
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
