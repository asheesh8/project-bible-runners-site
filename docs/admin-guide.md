# Admin Panel — Feature & Data Reference

Every tab in `landing/admin.html`, what it does, the API it calls, the Supabase
table(s) behind it, and — for tabs that show submissions — the public form that
feeds them. Use this as the map when wiring anything new (like the intake agent
in [intake-agent-plan.md](intake-agent-plan.md)) into the existing data.

## How the pieces connect

```
Public pages (landing/*.html)          Admin panel (landing/admin.html)
        │                                        │
        │ POST /api/track?type=…                 │ Bearer <signed token>
        │ POST /api/content?type=…               │ GET/POST/PATCH/DELETE
        ▼                                        ▼
   Vercel serverless functions (api/*.js)  ──►  Supabase Postgres
        (service-role key; RLS-locked)          (all data lives here)
```

Login: `/api/auth` checks `ADMIN_PASSWORD` and returns a signed 7-day token
(see [intake-system.md](intake-system.md)). Every admin call carries that token
as `Authorization: Bearer …`.

---

## Tabs

### Applications & Campaigns  (`data-tab="applications"`)
The main intake tab. Three things live here.

**Application review queue** — every equipment/funding application.
- API: `GET/PATCH/DELETE /api/track?type=applications`
- Table: **`equipment_applications`**
- Fed by: the public form at **`landing/equipment-application.html`** → `POST /api/track?type=application`
- Fields shown per card: identity (`name`, `organization`, `email`, `phone_*`, `country`, `region`, `role`), kit + reach (`kit_tier`, `audience_type`, `frequency_of_use`, `reach_justification`, `has_gathering_infrastructure`), context (`languages`, `literacy_context`, `power_internet_access`), verification (`org_website`, `sending_org`, `reference_name`, `reference_contact`, `referral_source`, `years_in_field`, `current_reach`, `supporting_document`), logistics (`receiving_plan`, `receiving_plan_details`, `funding_needed`, `timeframe`, `preferred_contact_method`, `contact_timezone`, `message`).
- Triage columns (computed server-side on submit): `email_domain_match`, `reference_provided`, `web_presence_found`, `triage_score`, `triage_confidence`, `triage_flags`, `triage_note`, `fast_track`.
- Workflow columns the admin edits: `status` (submitted / under_review / approved / declined / waitlisted), `admin_notes`, `status_updated_at`.
- Buttons: status dropdown (`PATCH status`), Save Notes (`PATCH admin_notes`), **Approve → Deployment** (sets `status=approved`, opens a prefilled deployment), Build Campaign (prefills the campaign form). Filter chips + CSV export are client-side.

**Application on/off toggle** — controls whether the public form accepts submissions.
- API: `GET /api/track?type=setting&key=applications_open` (public read) / `POST …type=setting` (admin write)
- Table: **`site_settings`**, key `applications_open`

**General Fund donation link** — the site-wide Donate button URL.
- Table: `site_settings`, key `general_donate_url`

**Campaigns** — fundraising campaigns and the live-progress widget.
- API: `GET/POST/PATCH/DELETE /api/content?type=campaigns`
- Table: **`campaigns`** (`name`, `slug`, `description`, `story`, `goal_amount`, `raised_amount`, `bibles_funded`, `bibles_needed`, `end_date`, `zeffy_url`, `image_url`, `active`)

### Deployments  (`data-tab="deployments"`)
The post-approval fulfillment log — mirrors Eric's original Excel sheet.
- API: `GET/POST/PATCH/DELETE /api/track?type=deployments`
- Table: **`deployments`**
- Fed by: **Approve → Deployment** in the Applications tab (prefilled, linked by `application_id`), or the "New deployment" button.
- Fields: `name`, `date`, `contact_information`, `country`, `region_village`, all the resource columns (`raspberry_pi_5`, `power_supply`, `satellite_dish`, `lnb`, `receiver`, `satellite_finder`, `coax_cable`, `usb_a_to_c`, `usb_a_to_micro_b`, `projector`, `speakers`, `language_card`, `usb_adapter`, `newq_device`, `charger_100w_20_port`, `bibles`, `monetary_support`, `online_support`, `power_charger_for_raspberry`), `in_person_support` (jsonb workshop list), `highlights`, `follow_up_needed`, `additional_notes`.
- CSV export writes the columns in the exact spreadsheet order.

### Laura Agent  (`data-tab="laura-agent"`)
Backend receptionist console for application follow-up and Larry handoff.
- API: `GET/POST /api/intake-agent`, plus cron endpoints `intake-gmail-poll` and `intake-digest`
- Tables: **`intake_threads`**, **`intake_messages`**, **`agent_filing_items`**, **`agent_digests`**
- Fed by: new `equipment_applications` rows; recent rows can also be backfilled with **Create missing threads**
- Buttons: Run Laura, approve/send latest draft, poll Gmail, send Larry digest, file deployment
- Setup: see [laura-agent-setup.md](laura-agent-setup.md)

### Blog & Updates  (`data-tab="posts"`)
- API: `GET/POST/PATCH/DELETE /api/content?type=posts`
- Table: **`posts`** (`title`, `body`, `image_url`, `author`, `published`, `published_at`). Public pages only read `published = true`.

### Photos  (`data-tab="photos"`)
- API: `GET/POST/PATCH/DELETE /api/content?type=photos`
- Table: **`photos`** (`url`, `caption`, `alt`, `category`)

### Testimonies  (`data-tab="testimonies"`)
- API: `GET/POST/PATCH/DELETE /api/content?type=testimonies`
- Table: **`testimonies`** — ⚠️ this table exists in the live database but is **not** defined in `supabase/schema.sql`. Add it to the schema file when you next touch it so a fresh database isn't missing it.

### Traffic  (`data-tab="traffic"`)
Analytics dashboard — polls every 4s while open.
- API: `GET /api/track?type=summary`
- Tables (read-only here): **`page_visits`**, **`link_clicks`**, **`donation_interests`**, **`availability_requests`**, **`contact_messages`**. Robot traffic is filtered out.
- Contact messages also come from the public **contact form on `landing/index.html`** → `POST /api/track?type=contact` (which stores a row *and* emails the team via Resend).

### Pamphlets & PDFs  (`data-tab="pamphlets"`)
- API: `GET/POST /api/pamphlets`
- Table: `site_settings`, key `pamphlets_list` (a JSON array). Changes appear instantly on `landing/pamphlets.html`.

### Page Editor  (`data-tab="pageeditor"`)
Per-page text overrides without a code deploy.
- API: `GET/POST /api/page-content`
- Table: **`page_content`** (keyed by `page`).

### Field Guides (Pi)  (`data-tab="internal"`) and Resources  (`data-tab="resources"`)
Static help content baked into `admin.html` (WireGuard setup Q&A, etc.). No database.

---

## Tables not surfaced in the admin UI

- **`donation_interests`**, **`availability_requests`** — schema + API exist, but no current public page posts to them (legacy from an earlier design). Their rows would show in the Traffic tab if any existed.
- **`affiliates`** — ministry partners shown on `landing/affiliates.html`; seeded by `schema.sql`, no admin editor yet.

## The two public forms that create records

| Form | Page | Endpoint | Table | Also emails? |
|---|---|---|---|---|
| Equipment & Funding Application | `equipment-application.html` | `POST /api/track?type=application` | `equipment_applications` | Team + applicant (if `RESEND_API_KEY` set) |
| Contact | `index.html` | `POST /api/track?type=contact` | `contact_messages` | Team (if `RESEND_API_KEY` set) |

Everything else in the panel is admin-authored content or read-only analytics.
