import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cleanReplyText, cleanUserText } from '../api/assistant.js';

test('assistant text guardrails remove emoji and cap text cleanly', () => {
  assert.equal(cleanUserText('Hello \u{1F44B}\u{1F3FD} world'), 'Hello world');
  assert.equal(cleanUserText('one\u0000\ntwo'), 'one two');
  assert.equal(cleanUserText('x'.repeat(700)).length, 500);
  const reply = cleanReplyText('A complete useful sentence. '.repeat(60));
  assert.ok(reply.length <= 800);
  assert.match(reply, /[.!?]$/);
  assert.doesNotMatch(reply, /senten\.$/);
  assert.doesNotMatch(cleanReplyText('No emoji \u{1F680}'), /\p{Extended_Pictographic}/u);
});

test('assistant quota limits and atomic database function remain wired in', () => {
  const api = readFileSync(new URL('../api/assistant.js', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../landing/js/assistant-widget.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../landing/admin.html', import.meta.url), 'utf8');
  const transcriptApi = readFileSync(new URL('../api/assistant-transcripts.js', import.meta.url), 'utf8');

  assert.match(api, /PER_VISITOR_LIMIT = 10/);
  assert.match(api, /WINDOW_HOURS = 6/);
  assert.match(api, /MAX_REPLY_CHARS = 800/);
  assert.match(api, /MAX_OUTPUT_TOKENS = 300/);
  assert.match(api, /rpc\/consume_assistant_quota/);
  assert.match(api, /consumeMemoryQuota/);
  assert.match(schema, /pg_advisory_xact_lock/);
  assert.match(schema, /grant execute on function public\.consume_assistant_quota/);
  assert.match(widget, /maxlength="500"/);
  assert.match(widget, /data\.limited/);
  assert.match(widget, /LIMIT_COUNT = 10/);
  assert.match(widget, /LIMIT_WINDOW_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(widget, /CHAT_KEY = 'vsi_assistant_chat_v1'/);
  assert.match(widget, /data-email-form/);
  assert.match(widget, /session_id: sessionId/);
  assert.match(schema, /create table if not exists public\.assistant_transcripts/);
  assert.match(schema, /messages jsonb/);
  assert.match(admin, /data-tab="assistant-chats"/);
  assert.match(admin, /sendAssistantChat/);
  assert.match(transcriptApi, /isAuthorizedAdmin/);
  assert.match(transcriptApi, /action === 'send'/);
  assert.match(transcriptApi, /to: \[row\.email\]/);
});
