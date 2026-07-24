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

## Conservative automation defaults

By default Laura drafts, but does not freely send.

Server env toggles:

```text
LAURA_DRAFT_ON_SUBMIT=true
LAURA_AUTO_SEND_ON_SUBMIT=false
LAURA_AUTO_SEND_AFTER_LARRY=false
LAURA_AUTO_SEND_SCHEDULING=false
```

Supabase setting:

```text
laura_auto_send_missing_info=false
```

Recommended first live setting:

```text
Draft everything.
Laura asks applicants to clarify contradictions before Larry review.
Larry approves sends from the Laura Agent tab.
Turn on auto-send only after drafts look right.
```

Laura should ask the applicant first when the form has applicant-resolvable
problems: oversized Tier 4/5 requests for an individual or tiny reach,
mismatched mission/shipping locations, self-references, placeholder names, or
vague delivery details.

## CSV / Excel

Laura files operational deployment data into `deployments`. The existing admin
deployment export remains the Excel handoff, so no Google Sheets or `.xlsx`
automation is needed for v1.
