import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cleanReplyText, cleanUserText } from '../api/assistant.js';

test('assistant text guardrails remove emoji and cap messages at 500 characters', () => {
  assert.equal(cleanUserText('Hello \u{1F44B}\u{1F3FD} world'), 'Hello world');
  assert.equal(cleanUserText('one\u0000\ntwo'), 'one two');
  assert.equal(cleanUserText('x'.repeat(700)).length, 500);
  assert.equal(cleanReplyText(`Answer \u{1F680} ${'y'.repeat(700)}`).length, 500);
  assert.doesNotMatch(cleanReplyText('No emoji \u{1F680}'), /\p{Extended_Pictographic}/u);
});

test('assistant quota limits and atomic database function remain wired in', () => {
  const api = readFileSync(new URL('../api/assistant.js', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../landing/js/assistant-widget.js', import.meta.url), 'utf8');

  assert.match(api, /PER_VISITOR_LIMIT = 10/);
  assert.match(api, /WINDOW_HOURS = 6/);
  assert.match(api, /MAX_OUTPUT_TOKENS = 200/);
  assert.match(api, /rpc\/consume_assistant_quota/);
  assert.match(schema, /pg_advisory_xact_lock/);
  assert.match(schema, /grant execute on function public\.consume_assistant_quota/);
  assert.match(widget, /maxlength="500"/);
  assert.match(widget, /data\.limited/);
});
