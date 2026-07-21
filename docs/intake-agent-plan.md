# Intake Receptionist Agent — Plan & Options

What you asked for: an AI "email receptionist" that reads incoming applications,
gathers missing information from the applicant over email in a back-and-forth,
and — once it has enough — proposes a Google Meet, sending the scheduling link to
both Eric and the applicant. **All the data stays in our own Supabase**; the
Anthropic API is only the brain, it stores nothing.

This is a design doc, not built code. It lays out the architecture, the choices
at each moving part with a recommendation, and a phased build order so we ship
something safe first and add autonomy later.

---

## The shape of it

```
Applicant submits form ─► equipment_applications row (exists today)
                                    │
                        ┌───────────┴────────────┐
                        ▼                         ▼
             triage scoring (exists)     NEW: receptionist agent
                                                 │
        ┌────────────────────────────────────────┼───────────────────────────┐
        ▼                    ▼                    ▼                            ▼
  reads the row      Anthropic API          Resend (outbound)        Supabase (state)
  + conversation     (claude-opus-4-8)      sends the email          intake_threads
  so far             decides next step                               intake_messages
                     drafts the reply
                                                 │
                                     when "enough info" →
                                     propose a Google Meet, send link
                                     to applicant + Eric
                        ▲
                        │ applicant replies
             Inbound email webhook ──► append to intake_messages ──► agent runs again
```

Four moving parts to add: **state** (Supabase tables), **a brain** (an Anthropic
call in a Vercel function), **an inbound channel** (so the agent can read replies),
and **scheduling** (the Google Meet hand-off). Outbound email (Resend) already
exists.

---

## Part 1 — State: keep every bit of "juice" in Supabase

Two new tables, so the whole conversation and the agent's decisions are yours and
exportable, exactly like the rest of the system. Nothing about the conversation
lives at Anthropic — each API call is stateless; we send the history from Supabase
and store the reply back.

```sql
-- One conversation per applicant, linked to their application.
create table if not exists public.intake_threads (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.equipment_applications(id) on delete cascade,
  state text not null default 'gathering',   -- gathering | ready_to_schedule | scheduled | handed_off | closed
  missing_fields jsonb not null default '[]'::jsonb,  -- what the agent still wants
  meet_url text,
  meet_time timestamptz,
  last_agent_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every inbound + outbound message, plus the agent's own reasoning notes.
create table if not exists public.intake_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.intake_threads(id) on delete cascade,
  role text not null,                        -- applicant | agent | system | admin
  channel text not null default 'email',     -- email | note
  subject text,
  body text,
  status text not null default 'draft',      -- draft | approved | sent | received
  created_at timestamptz not null default now()
);
```

`application_id` should match the live `equipment_applications.id` type (bigint in
production — see [intake-system.md](intake-system.md)); adjust the FK type the same
way the `deployments` migration does.

---

## Part 2 — The brain: your Anthropic API key + one Vercel function

A new `api/intake-agent.js` that, given a thread, calls Claude once and gets back
a structured decision. This is a single-call/workflow pattern, **not** a long-
running autonomous agent — you stay in control of when it runs and what it's
allowed to do.

- **Model:** default to `claude-opus-4-8` (`$5 / $25` per million tokens in/out) for
  reply quality and judgment on sensitive missionary context. At your volume (16
  applications in ~2 weeks) cost is a rounding error — a full conversation is a few
  cents. If you ever want it cheaper, `claude-haiku-4-5` (`$1 / $5`) handles the
  field-extraction step well; keep Opus for the drafting.
- **Auth:** set `ANTHROPIC_API_KEY` in Vercel env vars. The function calls the
  Messages API directly (`https://api.anthropic.com/v1/messages`) — no data leaves
  your stack except the prompt, and Anthropic doesn't train on API traffic.
- **Structured output:** ask Claude to return a typed decision so the code can act
  on it deterministically:

  ```json
  {
    "next_action": "ask_for_info | ready_to_schedule | escalate_to_human",
    "missing_fields": ["reference_contact", "power_internet_access"],
    "draft_subject": "…",
    "draft_body": "…",
    "reasoning": "one-line why, saved for Eric"
  }
  ```

  Use `output_config.format` with a JSON schema (structured outputs) so the shape
  is guaranteed. The system prompt carries the rules — the tone, what "enough
  info" means, never to promise specific equipment or funding, and when to escalate
  to Eric instead of replying.

The function reads the application row + `intake_messages` history, calls Claude,
writes the draft into `intake_messages`, and updates the thread's `state` and
`missing_fields`.

---

## Part 3 — Inbound email (the one genuinely new piece of plumbing)

For a true back-and-forth the agent has to *read replies*. The applicant's replies
land in the `villageserverinitiative@gmail.com` inbox today; we need them to also
hit a webhook. Options, cheapest/simplest first:

1. **Cloudflare Email Routing → Email Worker → Vercel webhook** — free, and if the
   domain's DNS is already on Cloudflare it's ~30 minutes. Route a dedicated
   address (e.g. `apply@villageserver.org`) to a Worker that POSTs the parsed email
   to `api/intake-inbound.js`. **Recommended.**
2. **Postmark inbound** (or Mailgun routes) — a dedicated inbound address that
   POSTs parsed JSON to your webhook. Rock-solid, free tier is plenty, ~1 hour.
3. **Gmail API watch + Pub/Sub** — reads the existing Gmail inbox directly, no new
   address. Most "native," but the heaviest setup (Google Cloud project, OAuth,
   Pub/Sub) and the most to maintain. Only worth it if replies *must* come to the
   current Gmail address.

Whichever you pick, `api/intake-inbound.js` verifies the sender, matches the email
to a thread (by the reply address or a token in the subject), appends it to
`intake_messages` as `role: applicant`, and triggers the agent (Part 2).

**Trigger cadence:** simplest is a Vercel Cron (e.g. every 10 min) that runs the
agent on any thread with an unprocessed applicant reply. Event-driven (run
immediately from the inbound webhook) is nicer but cron is fine to start.

---

## Part 4 — The Google Meet hand-off

When the agent decides `ready_to_schedule`, it needs to get a Meet link to both
Eric and the applicant. Two clean ways:

1. **Cal.com or Calendly booking link (recommended).** Eric connects his Google
   Calendar once; the tool auto-creates a Google Meet link per booking and respects
   his real availability. The agent simply emails the applicant Eric's booking
   link ("pick a time that works — Eric will get the invite automatically"). No
   OAuth code on our side, and the applicant chooses a slot that actually fits
   Eric's calendar. This is the lowest-risk, least-code path.
2. **Google Calendar API (fully automated).** The agent creates the calendar event
   itself with `conferenceData` (which mints the Meet link) and invites both
   parties, who get a normal calendar invite. More automated, but needs a Google
   service account with domain-wide delegation or a connected Google account, plus
   OAuth plumbing and its ongoing maintenance.

Start with option 1. It gets you the exact behavior you described — the agent
"delegates off a scheduled Google Meet" — with a link instead of a self-created
event, which is actually better because Eric's availability is honored.

---

## Recommended build order (phased, safe first)

**Phase 1 — Draft-only receptionist (human approves every send).**
Agent reads each new application, drafts a personalized acknowledgment + a request
for whatever's missing, and writes it into the Applications tab (a new "Suggested
reply — approve to send" box next to Admin Notes). Eric clicks Approve → it sends
via Resend. *No inbound parsing yet.* This is ~90% of the value, zero risk of the
AI emailing a missionary something wrong unreviewed, and it's the fastest to ship.

**Phase 2 — Conversational intake (the back-and-forth).**
Add the inbound webhook (Part 3) and the `intake_threads` / `intake_messages`
tables. Now applicant replies flow back in, the agent updates what's still missing,
and drafts the next message. Keep Eric's approval gate on for a week or two, then —
once the drafts are consistently good — let low-risk follow-ups (just asking for a
missing field) auto-send while anything sensitive still routes to Eric.

**Phase 3 — Scheduling hand-off.**
Wire the Cal.com/Calendly link. When the agent reaches `ready_to_schedule`, it
sends the booking link to the applicant and notifies Eric. Meet link + calendar
invite happen automatically through the scheduling tool.

---

## Guardrails (build these in from Phase 1)

- **Human approval before any outbound email, until proven.** The agent drafts;
  Eric sends. Loosen only per-category once you trust it.
- **Never promise equipment or funding.** Bake into the system prompt: the agent
  gathers information and schedules a call; approvals and specifics are Eric's.
  This matters — over-promising to a field missionary is the worst failure mode.
- **Escalate, don't guess.** If an applicant says anything about safety, money
  disputes, or something off-script, the agent returns `escalate_to_human` and
  writes a note instead of replying.
- **Reply-rate limit.** At most one agent email per applicant per ~24h, so a
  misfire can't spam anyone. Log every send to `intake_messages`.
- **Everything auditable in Supabase.** Every inbound, every draft, every send, and
  the agent's one-line reasoning are rows you own and can export — same as the rest
  of the system.

## Why not base44 for this

You already have the admin panel and the data in Supabase. The receptionist is an
Anthropic call + two tables + a webhook living in this repo — no third party in the
data path, no subscription, and the missionary PII never leaves your stack. base44
would add a vendor between you and the data to do work the existing panel already
hosts. (Fuller comparison in the base44 discussion from the build notes.)

## Env vars this adds

- `ANTHROPIC_API_KEY` — the agent's brain.
- `RESEND_API_KEY` — already used; sends the agent's emails.
- Inbound-provider secret (Cloudflare Worker shared secret, or Postmark/Mailgun
  signing key) — verifies the inbound webhook.
- Scheduling: none if using a Cal.com/Calendly link; Google OAuth creds only if you
  choose the Calendar-API path.
