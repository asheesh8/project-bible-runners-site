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

Do this after deploying the code and setting `ADMIN_PASSWORD`,
`GMAIL_CLIENT_ID`, and `GMAIL_CLIENT_SECRET`.

1. Create a Google Cloud OAuth app.
2. Add this redirect URI:

   ```text
   https://YOUR_DOMAIN/api/intake-gmail-oauth?action=callback
   ```

3. Add Vercel env vars:

   ```text
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_USER=me
   ```

4. Sign in to the admin panel.
5. Open the `Laura Agent` tab.
6. Click `Get Gmail auth link`.
7. Sign in as `villageserverassistant@gmail.com`.
8. Copy the returned refresh token into Vercel:

   ```text
   GMAIL_REFRESH_TOKEN=...
   ```

9. Redeploy or restart the Vercel environment.

After that, `/api/intake-gmail-poll` can read unread Gmail replies every 10
minutes.

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
Larry approves sends from the Laura Agent tab.
Turn on auto-send only after drafts look right.
```

## CSV / Excel

Laura files operational deployment data into `deployments`. The existing admin
deployment export remains the Excel handoff, so no Google Sheets or `.xlsx`
automation is needed for v1.
