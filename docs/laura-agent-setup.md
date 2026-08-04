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
  -> Gmail polling every 5-10 minutes from an external cron
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
- `deployments.tracking_number` and `intake_threads.tracking_number`
- `posts.source_application_id` and `posts.auto_created`

**Run it again after pulling the shipping hand-off.** The tracking number and
write-up columns are new; without them Larry's tracking box saves nothing.

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

Vercel Hobby only allows daily native Cron Jobs, so the 6-hour Larry digest
runs from GitHub Actions. Gmail polling runs from an external cron — see below
for why GitHub is the wrong place for it.

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

- `POST /api/intake-digest` every 6 hours

That endpoint is the whole unattended tick, not just a mailout. In order:

1. **Sweep** — picks up files that lost their next step (below).
2. **Follow-ups** — runs every chase that has come due.
3. **Digest** — mails Larry, in two separate emails.

### Two emails, not one

One email carrying every active file is how the handful that needed Larry got
buried in the twenty that did not. The tick sends two, and skips either one when
it would be empty:

| Email | Contains | What it looks like |
|---|---|---|
| **"3 files need you"** | `waiting_on_larry`, `ready_to_ship`, `escalated` | Full decision cards — address block, draft preview, every button |
| **"12 in the queue"** | Everything else still open | A compact list: who, what they still owe, how long it has been |

The queue email needs nothing from him. Each row carries what that applicant is
missing and one **Ask them for it now** link, so he can lean on somebody early
without opening the panel — Laura still writes and sends it, he only picks who.
Rows are ordered longest-ignored first, because this is an email people abandon
halfway, and anyone past `LAURA_FOLLOW_UP_DAYS` is marked. A posted card gets no
link: there is nothing left to ask for, and its chase is the arrival check
already on the clock.

If one of the two fails to send, the other still goes, and only the files that
actually reached an inbox have their pending flag cleared.

The order matters: the digest he reads reflects the mail that just went out,
rather than lagging a full cycle behind it.

### Files that lose their next step

Every open file should either have something scheduled or be sitting with a
human. One with neither has been dropped — the run that created it died before
it decided anything, or a send failed in a way nothing re-armed. Nothing else in
the system looks for these, so the sweep does.

It is deliberately narrow: a healthy file always has a follow-up scheduled, so a
working queue sweeps to nothing. A file is only picked up when it has no next
step, is not parked with Larry, and Laura has not run on it within
`LAURA_FOLLOW_UP_DAYS`.

`Find dropped files` in the `Laura Agent` tab does the same thing by hand, and
shows the list before touching anything.

**Gmail polling is deliberately not on GitHub.** `schedule` is best-effort, and
GitHub drops high-frequency crons hard — a `*/10` was landing every 45 to 160
minutes in practice, which is useless for answering someone's email. Polling
runs from an external cron instead:

| | |
|---|---|
| Service | [cron-job.org](https://cron-job.org) (free) |
| URL | `https://www.villageservers.com/api/intake-gmail-poll?limit=3` |
| Method | POST |
| Header | `x-cron-secret: <CRON_SECRET>` |
| Every | 5-10 minutes |

Put the secret in the **header**, never in the query string — query strings end
up in server logs and the cron service's own job history. `limit=3` keeps each
run inside the free tier's 30-second timeout, since every matched reply costs a
model call plus a send.

The poll job stays in the workflow for `workflow_dispatch`, so it can still be
triggered by hand from the Actions tab.

## Optional Gmail sending

If you want Laura to send directly as the Gmail account, set:

```text
EMAIL_PROVIDER=gmail
```

Leave it as `resend` while testing if you only want Gmail for reading replies.

## Cal.com

Not in use yet. Nothing in the card workflow needs it, and no booking button
appears on a file that is ready to post &mdash; by then the conversation is over.
Wire it up when larger tiers return and a call before shipping makes sense again.

Create Larry's public booking link and set:

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
  -> the deployment is written up as a post, ready for him to publish
  -> Larry types the tracking number into one box; Laura passes it on
  -> two weeks later she asks: did it arrive, may we see it, what has it done
  -> their reply is added to that same write-up in their own words
  -> answered, or quietly closed after two tries
```

**Laura never files a deployment for a card nobody has sent.** She takes it as
far as it can go without hands — but somebody still has to physically put the
card in an envelope, and only Larry knows when that happened. So the last step
is his, and the deployment log stays honest about what has actually shipped.

At that stage his buttons change, because "do you approve this applicant?" is a
question that has already been answered:

| Button | What happens |
|---|---|
| Order form for Digital Bible Society | Opens the printable order (below). Changes nothing |
| Yes — I have posted it | Files the deployment, tells the applicant, writes the post, and asks you for the tracking number |
| File deployment only | Adds it to the log, emails nobody |
| Ask for more info | Laura goes back to the applicant |
| Hold for now | Pauses it for a week |

There is no call-booking button at this stage — a file that is ready to post is
past the point of a conversation.

### The order for Digital Bible Society

Nothing physical happens until this leaves Larry's hands, so Laura assembles it
the moment a file is ready rather than making him copy a name, an address and a
language out of three places. The button opens a printable page carrying the
order reference, the supplier, the delivery address as an envelope, the item and
its language, and the deployment context. Print it or save it as a PDF and send
it on; there is also a **Copy as text** button for pasting into an email.

```text
DBS_NAME=Digital Bible Society    # optional, only if the supplier is renamed
DBS_EMAIL=orders@example.org      # optional, printed on the order
```

**The amount is deliberately blank.** The system holds no price list, so a figure
Laura printed would be a guess. The amount and total are editable in the browser
— type them in before printing.

**It is not an invoice.** Digital Bible Society invoices you; this is the order
you place with them. It is also the only action reachable from a bare `GET`,
because opening it changes nothing on the file — which is what makes it safe for
the link scanners that follow everything in an inbox.

Then the loop closes as normal: DBS ships and gives you a tracking number, you
enter it with **Add a tracking number**, and Laura sends it straight on to the
applicant.

Once it is posted, the buttons change again — there is nothing left to approve,
only the two things Laura cannot supply herself:

| Button | What happens |
|---|---|
| Add a tracking number | Opens a page with one box; saves it and emails it to the applicant |
| Publish the write-up | Puts Laura's write-up of this deployment live on the site |
| No tracking for this one | Closes the question, emails nobody |

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

### After the card is posted

Pressing "Yes — I have posted it" does five things, not one:

1. Files the deployment record.
2. Tells the applicant their card is on its way.
3. **Writes the deployment up as a post** from the file (below).
4. **Emails Larry his own card** asking for the tracking number.
5. Schedules the arrival check.

```text
LAURA_ARRIVAL_CHECK_DAYS=14   # post to these places takes weeks, not days
LAURA_MAX_ARRIVAL_CHECKS=2
```

The arrival note asks three things and demands none of them: did it reach you,
may we see a photo, and what have you been able to do with it. It says plainly
that anything they send may be shared, and that "no" is a complete answer. If it
never arrived, Laura offers to send another.

When they write back, their reply is appended to the write-up Laura already
filed for them, under a dated heading and in their own words. That always sets
the post back to **unpublished** for a read, whatever it was before: those are
somebody else's words about their own ministry, sometimes naming a village or a
person, and a human should see them before they go on a public site.

### The tracking number

Larry gets an individual formatted email — the same card as every other file —
with a button that opens a page holding a single text box. He types the number,
and Laura passes it straight to the applicant.

**The box cannot live in the email itself.** Gmail, Outlook and Apple Mail all
strip `<form>` out of a message body, so an input there would look right and
silently do nothing. One tap gets him to a page that works everywhere, and the
number is saved to `deployments.tracking_number` so it stays in the CSV export.

"No tracking for this one" closes the question without emailing anybody — plenty
of post has no number, and the flow must not stall waiting for one that will
never exist.

### One write-up per shipped applicant

Every applicant who is approved and actually gets something sent gets a post,
written from their file when the card goes in the post. All the material is
already there — who they are, where they serve, what language, how many people —
so nothing is retyped.

This is **not a fundraiser**. No donation link, no goal, no money. It is the
account of where a card went and what it is for.

One post per applicant, not one per event: when they write back to the arrival
check, their own words are appended to that same post under a dated heading
rather than becoming a second fragment. `source_application_id` has a unique
index, so a file posted twice finds the write-up that already exists.

**It is filed unpublished by default**, and that is a deliberate default rather
than a limitation. The post names a real person, their church, and the town they
work in. For some fields that is not information to put on a public site without
someone looking at it first. Larry gets a one-tap "Publish the write-up" button
in the same email that asks for the tracking number.

If every applicant you serve is somewhere it is safe to name, make it fully
hands-free:

```text
LAURA_AUTO_PUBLISH_POSTS=true
```

That covers what Laura wrote. It never covers what the applicant wrote — a
reply appended to a post always sets it back to unpublished for a read, because
Laura composing a summary from a form and a missionary describing their own work
are not the same thing.

A card nobody acknowledges is **closed, not escalated**. There is no decision
left for Larry to make about a card that is already in the post, so after two
unanswered checks the file closes itself and the deployment record stands.

Once a card is confirmed or posted, the card rules switch off for that file.
They exist to stop Laura promising equipment that does not exist, and re-running
them on a finished file is how "thank you, it arrived" gets answered with the
confirmation letter for a second time.

### The address has to be one a parcel can reach

A card is only confirmed when there is a language *and* an address that passes a
component check, not a vague-wording check. Rejected outright:

| Rejected | Why |
|---|---|
| PO box, private bag, PMB | No courier hands a parcel to one |
| Airport, freight terminal | Cannot receive a personal parcel |
| Poste restante, general delivery, GPO | A counter, not a destination |
| "downtown", "can find me", "TBD" | A placeholder |

Beyond that it requires a recipient name, a phone number, a country, a locality,
and a physical locator. `Uganda, Jinja district` fails — a country and an
administrative area with no place in them — and used to pass.

**It is deliberately lenient about form.** Plenty of real field addresses have no
street number and never will. `Nawantale village, Kamuli district` is somewhere a
driver can find, and a village or a landmark satisfies the locator exactly as a
street name does. Rejecting those would strand the people this exists for.

When an applicant accepts the offer but sends an address that will not ship,
Laura goes back naming the specific gap and quoting what they sent, rather than
repeating "not specific enough". That is bounded by `LAURA_MAX_ASK_ROUNDS` like
any other question. If Laura still cannot verify it, Larry's card carries a
**Check before you post** warning above the address rather than letting him find
out when the parcel comes back.

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

**A held draft never leaves the file claiming it is waiting on the applicant.**
There are two kinds of hold and they mean opposite things. A *policy* hold —
draft-only mode, an action that always waits, or something Laura flagged for
review — needs a person to release it, so the file goes to Larry. A *timing*
hold, such as the cooldown or a provider outage, just means not yet, so the file
stays where it is and comes back on its own. Getting this wrong is how a file
goes quiet with a letter still sitting in the drawer.

The cooldown governs **unprompted** contact only. Once an applicant has written
back, Laura answers straight away — refusing to reply for a day because she
happened to write that morning is how a receptionist looks broken rather than
careful. A genuine back-and-forth is bounded by `LAURA_MAX_ASK_ROUNDS` instead.
Nudges stay fully cooldown-gated, since a nudge is unprompted by definition.

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
| Approve &mdash; send a card | Marks the application approved and tells the applicant a card in their language is coming |
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
