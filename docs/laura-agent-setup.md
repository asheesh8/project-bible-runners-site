# Laura Agent Setup

Laura is the backend receptionist for VillageServer application form fillouts.
She links each `equipment_applications` row to a durable intake thread, drafts or
sends email, summarizes the queue for Larry every 6 hours, reads Gmail replies
when OAuth is configured, and files deployment records that remain exportable as
CSV.

## What is now in the repo

```
Form submission
  -> equipment_applications
  -> intake_threads
  -> intake_messages draft
  -> admin approval or auto-send setting
  -> Larry digest every 6 hours
  -> Gmail polling every 10 minutes, once OAuth is configured
  -> deployments row for CSV export when filed
```

New serverless endpoints:

- `GET/POST /api/intake-agent` — authenticated admin actions.
- `GET/POST /api/intake-digest` — cron/admin sender for Larry digest.
- `GET/POST /api/intake-gmail-poll` — cron/admin Gmail inbox poller.
- `GET /api/intake-gmail-oauth` — helper to produce a Gmail refresh token.

New admin area:

- `Laura Agent` tab in `landing/admin.html`.
- `Run Laura` button on each application card.

## Required Supabase step

Paste and run the updated `supabase/schema.sql` in the Supabase SQL editor. It is
idempotent and adds:

- `intake_threads`
- `intake_messages`
- `agent_filing_items`
- `agent_digests`
- Laura behavior settings in `site_settings`

## Required Vercel env vars

Add these in Vercel Project Settings -> Environment Variables:

```text
ADMIN_PASSWORD=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...

AGENT_NAME=Laura
AGENT_EMAIL=villageserverassistant@gmail.com
LARRY_EMAIL=larry.villageserver@gmail.com

ANTROPIC_API_KEY=...
INTAKE_AGENT_MODEL=claude-haiku-4-5

RESEND_API_KEY_AGENT=...
CONTACT_FROM_EMAIL=VillageServer Initiative <onboarding@resend.dev>
EMAIL_PROVIDER=resend

CRON_SECRET=make-a-long-random-secret
```

For local testing, use a local `.env`/`.env.local` file only. These files are
ignored by git.

Laura also supports the standard spelling `ANTHROPIC_API_KEY`; `ANTROPIC_API_KEY`
is accepted because that is the key name currently configured in Vercel.

## Resend-first behavior

With `EMAIL_PROVIDER=resend`, Laura sends through Resend and sets:

```text
Reply-To: villageserverassistant@gmail.com
```

That is enough for outbound testing. For the full back-and-forth loop, Gmail
OAuth is still needed so the app can read replies from Laura's inbox.

Laura prefers `RESEND_API_KEY_AGENT` for agent email. If that is not present, she
falls back to the existing site-wide `RESEND_API_KEY`.

## Gmail OAuth setup

Do this after deploying the code and setting `ADMIN_PASSWORD`.

1. In Google Cloud Console, create or open a project for VillageServer.
2. Enable the Gmail API for that project.
3. Configure the OAuth consent screen.
   - App name: `VillageServer Laura`
   - User support email: your admin email
   - Test user while setting up: `villageserverassistant@gmail.com`
4. Create OAuth credentials:
   - Type: `OAuth client ID`
   - Application type: `Web application`
   - Name: `VillageServer Laura Gmail`
5. Add this authorized redirect URI:

   ```text
   https://www.villageservers.com/api/intake-gmail-oauth?action=callback
   ```

6. Add Vercel env vars:

   ```text
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_USER=me
   ```

7. Redeploy Vercel so the OAuth helper can see those env vars.
8. Sign in to the admin panel.
9. Open the `Laura Agent` tab.
10. Click `Get Gmail auth link`.
11. Sign in as `villageserverassistant@gmail.com`.
12. Copy the returned refresh token into Vercel:

   ```text
   GMAIL_REFRESH_TOKEN=...
   ```

13. Redeploy Vercel again.

After that, `/api/intake-gmail-poll` can read unread Gmail replies.

Laura requests these Gmail scopes:

```text
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
```

Google treats Gmail scopes as sensitive/restricted. Since this app is only for
the Laura mailbox, keep the OAuth app limited to the Laura test user while
setting up. If the OAuth consent screen is `External` and left in `Testing`,
Google refresh tokens can expire after 7 days, so move the app out of Testing
when you want the inbox automation to stay connected.

## Recurring automation on Vercel Hobby

Vercel Hobby only allows daily native Cron Jobs, so Laura's 10-minute Gmail
poll and 6-hour Larry digest run from GitHub Actions instead.

In GitHub, open this repository's `Settings` -> `Secrets and variables` ->
`Actions` and add:

```text
CRON_SECRET=same-value-as-the-Vercel-CRON_SECRET
```

Optional repository variable:

```text
LAURA_SITE_URL=https://www.villageservers.com
```

The workflow at `.github/workflows/laura-agent.yml` calls:

- `POST /api/intake-gmail-poll` every 10 minutes
- `POST /api/intake-digest` every 6 hours

## Optional Gmail sending

If you want Laura to send directly as the Gmail account, set:

```text
EMAIL_PROVIDER=gmail
```

Leave it as `resend` while testing if you only want Gmail for reading replies.

## Cal.com

Start without a Cal.com API key. Create Larry's public booking link and set:

```text
LARRY_CAL_BOOKING_URL=https://cal.com/...
```

Laura will include the link when a thread is ready to schedule.

## What Laura is allowed to offer

The initiative can only post microSD cards right now, so that is the only thing
Laura ever offers — whatever tier the form asked for.

```text
LAURA_OFFER_MODE=sd_card_only   # default; set to full_kits when larger tiers return
```

### The loop, end to end

Laura runs this herself. Larry is not a step in it.

```
application arrives
  -> Laura asks for what is missing (or clarifies contradictions)
  -> applicant replies
  -> Laura reads their answers back onto the application row   <-- the part that closes the loop
  -> gaps filled? offer the microSD card, ask language + address
  -> they reply with both
  -> Laura confirms to the applicant and stops chasing
  -> Larry gets one email: what to post, where, and a button saying
     "Yes — I have posted it"
  -> he presses it once the card is actually in the post
  -> deployment filed, applicant told it is on its way
```

**Laura never files a deployment for a card nobody has sent.** She takes it as
far as it can go without hands — but somebody still has to physically put the
card in an envelope, and only Larry knows when that happened. So the last step
is his, and the deployment log stays honest about what has actually shipped.

At that stage his buttons change, because "do you approve this applicant?" is a
question that has already been answered:

| Button | What happens |
|---|---|
| Yes — I have posted it | Files the deployment and emails the applicant that the card is on its way |
| File deployment only | Adds it to the log, emails nobody |
| Ask for more info | Laura goes back to the applicant |
| Set up a call first | Sends your booking link (needs `LARRY_CAL_BOOKING_URL`) |
| Hold for now | Pauses it for a week |

**Reading answers back onto the file is what makes autonomy work.** Applicants
reply in prose — "my reference is Pastor Mary, mary@example.org" — and every
later check reads the *application row*, not the email. Without transcription
Laura would re-ask the same question forever, so each run extracts what they
told her and writes it to the row before deciding anything.

Only the columns in `EXTRACTABLE_FIELDS` can be written this way. Identity,
`status`, `triage_*` and admin fields are deliberately excluded — she is
transcribing what an applicant said, not re-deciding who they are or how the
office rated them. Every write is recorded as an `agent_filing_items` note
showing the before and after, so a field never changes invisibly.

Two brakes stop the loop spinning:

```text
LAURA_MAX_ASK_ROUNDS=3   # then hand to Larry rather than keep asking
LAURA_MAX_NUDGES=3       # then hand to Larry rather than keep chasing
```

The first is for someone who replies but never answers; the second is for
someone who goes quiet. Either way the file reaches a human instead of looping.

A card is only confirmed when there is a language *and* a shipping address that
survives the vague-address check — "downtown, can find me" does not close a
file.

### What Laura still will not do

Decline anyone, promise funding, promise a shipping date, or send anything the
model flagged for review. A deterministic override can replace *what* she says,
but never the judgement that a particular message should not go out unread.

While this is `sd_card_only`, the shape of every conversation is:

1. Laura gathers the form details and clears up anything that contradicts
   itself, asking the applicant rather than bothering Larry.
2. Once the file is complete and consistent — "comfortable with the person" —
   she does **not** propose a call, a kit, or a review by Larry. She sends the
   honest scale-down instead: warm about the ministry, plain about the fact that
   only cards are going out, and asking for exactly two things — **the language
   they need** and **a shipping address** with a recipient name and phone.
3. When they reply with those, the file goes to Larry ready to act on.

This is enforced in `normalizeDecision`, not just requested in the prompt: if
the model returns `ask_larry`, `send_schedule_link` or `file_deployment` on a
clean file, it is overridden with the card offer and the reason is recorded on
the thread. The model cannot promise equipment or money that does not exist.

The offer is sent once per thread. Language and shipping are deliberately not
treated as blocking gaps beforehand, because the offer itself is what asks for
them.

## How much Laura sends on her own

One setting controls this, and it is the only thing that decides whether an
email leaves without Larry. Change it from the dropdown at the top of the
`Laura Agent` tab, or directly as the `laura_autonomy` row in `site_settings`.

| Level | Laura sends by herself | Always waits for Larry |
|---|---|---|
| `draft_only` | nothing | everything |
| `staged` *(default)* | acknowledgments, missing-info and clarification requests, follow-up nudges | approve, decline, funding, scheduling |
| `full` | the above, plus the scheduling link once a file is clean | approve, decline, funding |

Approvals and declines are never sent by the model in any mode. They happen
only when Larry presses a button.

`LAURA_AUTONOMY` in the environment overrides the database setting, which is
the fastest way to stop all outbound mail without opening the admin panel:

```text
LAURA_AUTONOMY=draft_only
```

### The rails that make this safe

These apply to applicant mail at every level above `draft_only`:

```text
LAURA_SEND_COOLDOWN_HOURS=24   # at most one email per applicant per window
LAURA_FOLLOW_UP_DAYS=4         # chase after this much silence
LAURA_MAX_NUDGES=3             # then hand the file to Larry instead of nagging
```

Mail to Larry is exempt from the cooldown — it is a notification, not a promise
to an applicant, and holding it back would defeat the point.

**Laura never chases anyone she cannot hear.** Applicant replies only enter the
system through Gmail polling, so until `GMAIL_REFRESH_TOKEN` is set, someone who
answered looks exactly like someone who ignored her. Rather than nag a
missionary for details they already sent, follow-ups hand the file straight to
Larry with a summary saying Gmail is not connected and the mailbox needs
checking by hand. Normal nudging resumes on its own once OAuth is finished — no
setting to remember to flip back.

Laura asks the applicant first when the form has applicant-resolvable problems:
oversized Tier 4/5 requests for an individual or tiny reach, mismatched
mission/shipping locations, self-references, placeholder names, or vague
delivery details. This is enforced in code, not left to the model.

If Anthropic is unreachable while a reply from Larry is waiting, Laura holds the
thread as an internal note rather than guessing at his instruction.

## Larry's one-click buttons

Every file in Larry's email carries signed action buttons, so an application can
move without opening the admin panel:

| Button | What happens |
|---|---|
| Approve & send booking link | Marks the application approved and emails the applicant the scheduling link |
| Send Laura's draft | Sends the drafted reply exactly as written |
| Ask for more info | Laura writes and sends a follow-up for what is still missing |
| Hold for now | Pauses the file and brings it back in a week |
| Decline | Marks it declined and **drafts** a kind note for review — never auto-sent |

Links are HMAC-signed with `LAURA_ACTION_SECRET` (falling back to
`ADMIN_PASSWORD`), name exactly one file and one action, and expire after 14
days. Approve, decline and send-draft show a confirmation page first, because
mail scanners follow links and none of them should be able to approve an
application. Every action is idempotent — a second click reports what already
happened instead of repeating it.

Set the public origin so the buttons point at the right place:

```text
LAURA_SITE_URL=https://www.villageservers.com
LAURA_ACTION_SECRET=another-long-random-secret
```

The same five buttons appear on each file in the `Laura Agent` tab, so the panel
and the inbox never disagree about what is possible.

## CSV / Excel

Laura files operational deployment data into `deployments`. The existing admin
deployment export remains the Excel handoff, so no Google Sheets or `.xlsx`
automation is needed for v1.
