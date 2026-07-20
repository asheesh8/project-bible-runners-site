# Intake & Deployment System

How the equipment/funding application pipeline, triage scoring, and the
deployment log work — and what must be configured for them to run.

## Architecture

```
equipment-application.html (5-step form, public — gated by applications_open)
        │  POST /api/track?type=application
        ▼
api/track.js ── honeypot + robot check + rate limit (3/email/hour)
        │       computeTriage() → flags, score, confidence, note
        ├──► Supabase equipment_applications (service role only, RLS locked)
        └──► Resend: notify team + confirmation to applicant
        ▼
admin.html ── review queue (filter chips, triage badges, status workflow)
        │       Approve → Deployment (prefilled record)
        ▼
Supabase deployments — mirrors Eric's Excel log column-for-column
        └──► CSV export in the exact spreadsheet column order
```

Data lives in Supabase Postgres (portable, exportable). No third-party
admin layer — the existing admin panel covers review + deployment
tracking, and any no-code tool can attach to the same Postgres later.

## Required setup (in order)

1. **Apply the schema**: paste `supabase/schema.sql` into the Supabase
   SQL Editor and run it. It is idempotent — safe to run repeatedly. It
   adds the structured intake columns, creates `deployments`, and seeds
   the four historical deployments from Eric's Excel log (Paul Stewart,
   Doug Stogsdill, Uche Okemiri, Sam Sikapizye).
2. **Vercel env vars** (Project → Settings → Environment Variables):
   - `ADMIN_PASSWORD` — **required**. The old hardcoded fallback password
     was removed; if this is not set, admin login is disabled (fails
     closed). Logging in now issues a signed token that expires after
     7 days; the password itself is never used as a bearer credential.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — as before.
   - `RESEND_API_KEY` — enables the two application emails (team
     notification + applicant confirmation). Without it, submissions
     still store; emails are skipped silently.
   - `CONTACT_FROM_EMAIL` — optional; the From address (defaults to
     Resend's onboarding sender until a domain is verified).
   - `NOTIFY_EMAIL` — optional; where team notifications go (defaults
     to villageserverinitiative@gmail.com).
3. **Open applications** from the admin panel (Applications tab →
   toggle). The form stays closed until this flag is on.

The API is deploy-order-safe: if the code deploys before the schema is
applied, submissions fall back to the legacy columns and nothing bounces.

## Triage rules (rule-based, never auto-rejects)

Verification score, 1 point each (0–3):

- **Email domain** — matches the listed website domain, or is a
  non-freemail domain alongside a named organization.
- **Reference** — a reference contact name + email/phone was provided.
- **Web presence** — a website/social link was provided (v1 does not
  crawl; findability stays a 30-second human check).

Confidence: 3 → High, 2 → Medium, 0–1 → Low.

**Mismatch flag** (independent of score): kit tier 4–5 requested for an
`individual` or `small_group` audience → `tier_audience_mismatch`,
always routed to manual review. Tiers 1–3 are never gated.

**Fast-track candidate**: High confidence + tier 1–3 + no flags.

Every application stores a plain-English `triage_note` explaining which
rules fired — shown on the admin card ("Why this tag") and in the team
notification email.

## Review workflow

Statuses: `submitted → under_review → approved / declined / waitlisted`
(legacy rows show as Submitted). Admin notes now live on the application
row (`admin_notes`); the panel falls back to the old settings-blob notes
for pre-migration rows. **Approve → Deployment** sets the status and
opens a prefilled deployment record linked by `application_id`.

## Deployment log

`deployments` mirrors the Excel sheet exactly — same columns, text
values preserved as typed ("2", "Yes", model names). Workshops are
stored as `[{label, date}]` and exported as `1st Workshop (6/25/2026)`.
**Export CSV (Excel format)** downloads the log in the original column
order so Eric can keep working in Excel whenever he wants.

## Spam protection

- Honeypot field (`website`) — bots that fill it get a fake success.
- Known-crawler user-agents are ignored.
- Rate limit: 3 submissions per email address per hour (HTTP 429).
- Supporting documents: optional, image/PDF only, ≤ 2 MB, validated
  server-side, stored as a data URL on the private row (service-role
  access only).
