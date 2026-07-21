-- VillageServer Initiative — complete Supabase schema
-- Safe to paste into Supabase SQL Editor more than once.
-- The website writes through Vercel server functions using the service-role key.

create extension if not exists pgcrypto;

-- ── Editable public content ─────────────────────────────────────────
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  story text,
  goal_amount numeric(12,2) not null default 0 check (goal_amount >= 0),
  raised_amount numeric(12,2) not null default 0 check (raised_amount >= 0),
  bibles_funded integer not null default 0 check (bibles_funded >= 0),
  bibles_needed integer not null default 0 check (bibles_needed >= 0),
  end_date date,
  zeffy_url text,
  image_url text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  author text not null default 'VillageServer Initiative',
  published boolean not null default false,
  published_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  caption text,
  alt text,
  category text not null default 'field',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  website_url text,
  description text,
  logo_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Analytics and public-interest forms ─────────────────────────────
create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  ttclid text,
  user_agent text,
  country text,
  region text,
  city text,
  is_robot boolean not null default false,
  robot_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.link_clicks (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  path text,
  link_url text not null,
  link_text text,
  link_type text not null default 'link',
  user_agent text,
  is_robot boolean not null default false,
  robot_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.donation_interests (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  name text,
  email text,
  country text not null,
  initiative text,
  practical_need text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create table if not exists public.availability_requests (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  country text not null,
  region text,
  name text,
  email text,
  organization text,
  message text,
  requested_items jsonb not null default '[]'::jsonb,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  name text,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- Add newer columns when upgrading an older database.
alter table public.campaigns add column if not exists updated_at timestamptz not null default now();
alter table public.posts add column if not exists updated_at timestamptz not null default now();
alter table public.photos add column if not exists updated_at timestamptz not null default now();
alter table public.affiliates add column if not exists updated_at timestamptz not null default now();
alter table public.page_visits add column if not exists visitor_id text;
alter table public.page_visits add column if not exists site_host text;
alter table public.page_visits add column if not exists user_agent text;
alter table public.page_visits add column if not exists country text;
alter table public.page_visits add column if not exists region text;
alter table public.page_visits add column if not exists city text;
alter table public.page_visits add column if not exists is_robot boolean not null default false;
alter table public.page_visits add column if not exists robot_reason text;
alter table public.link_clicks add column if not exists visitor_id text;
alter table public.link_clicks add column if not exists site_host text;
alter table public.link_clicks add column if not exists path text;
alter table public.link_clicks add column if not exists link_text text;
alter table public.link_clicks add column if not exists link_type text not null default 'link';
alter table public.link_clicks add column if not exists user_agent text;
alter table public.link_clicks add column if not exists is_robot boolean not null default false;
alter table public.link_clicks add column if not exists robot_reason text;
alter table public.donation_interests add column if not exists visitor_id text;
alter table public.donation_interests add column if not exists site_host text;
alter table public.availability_requests add column if not exists visitor_id text;
alter table public.availability_requests add column if not exists site_host text;
alter table public.availability_requests add column if not exists requested_items jsonb not null default '[]'::jsonb;

-- Keep updated_at correct for admin edits.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at before update on public.campaigns
for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists photos_set_updated_at on public.photos;
create trigger photos_set_updated_at before update on public.photos
for each row execute function public.set_updated_at();

drop trigger if exists affiliates_set_updated_at on public.affiliates;
create trigger affiliates_set_updated_at before update on public.affiliates
for each row execute function public.set_updated_at();

-- Useful indexes for the queries used by the site/admin dashboard.
create index if not exists campaigns_active_created_idx on public.campaigns (active, created_at desc);
create index if not exists posts_published_created_idx on public.posts (published, created_at desc);
create index if not exists photos_created_idx on public.photos (created_at desc);
create index if not exists affiliates_active_sort_idx on public.affiliates (active, sort_order, created_at desc);
create index if not exists page_visits_created_idx on public.page_visits (created_at desc);
create index if not exists page_visits_visitor_id_idx on public.page_visits (visitor_id);
create index if not exists page_visits_utm_source_idx on public.page_visits (utm_source);
create index if not exists page_visits_site_host_idx on public.page_visits (site_host);
create index if not exists page_visits_country_idx on public.page_visits (country);
create index if not exists page_visits_region_idx on public.page_visits (region);
create index if not exists page_visits_is_robot_idx on public.page_visits (is_robot, created_at desc);
create index if not exists link_clicks_created_idx on public.link_clicks (created_at desc);
create index if not exists link_clicks_visitor_id_idx on public.link_clicks (visitor_id);
create index if not exists link_clicks_site_host_idx on public.link_clicks (site_host);
create index if not exists link_clicks_link_type_idx on public.link_clicks (link_type);
create index if not exists link_clicks_is_robot_idx on public.link_clicks (is_robot, created_at desc);
create index if not exists donation_interests_created_idx on public.donation_interests (created_at desc);
create index if not exists donation_interests_country_idx on public.donation_interests (country);
create index if not exists donation_interests_visitor_id_idx on public.donation_interests (visitor_id);
create index if not exists availability_requests_created_idx on public.availability_requests (created_at desc);
create index if not exists availability_requests_country_idx on public.availability_requests (country);
create index if not exists availability_requests_visitor_id_idx on public.availability_requests (visitor_id);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_visitor_id_idx on public.contact_messages (visitor_id);

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.campaigns enable row level security;
alter table public.posts enable row level security;
alter table public.photos enable row level security;
alter table public.affiliates enable row level security;
alter table public.page_visits enable row level security;
alter table public.link_clicks enable row level security;
alter table public.donation_interests enable row level security;
alter table public.availability_requests enable row level security;
alter table public.contact_messages enable row level security;

-- Public content may be read with the anon key. Draft posts and hidden
-- affiliates stay private. Admin writes use the server-only service role.
drop policy if exists "Public reads" on public.campaigns;
drop policy if exists "Public reads campaigns" on public.campaigns;
create policy "Public reads campaigns" on public.campaigns for select to anon, authenticated using (true);

drop policy if exists "Public reads published" on public.posts;
drop policy if exists "Public reads published posts" on public.posts;
create policy "Public reads published posts" on public.posts for select to anon, authenticated using (published = true);

drop policy if exists "Public reads photos" on public.photos;
create policy "Public reads photos" on public.photos for select to anon, authenticated using (true);

drop policy if exists "Public reads active affiliates" on public.affiliates;
create policy "Public reads active affiliates" on public.affiliates for select to anon, authenticated using (active = true);

-- No anon policies are created for analytics, donation interests, or kit
-- requests. The public forms call /api/track; the service role bypasses RLS.
drop policy if exists "Public insert visits" on public.page_visits;
drop policy if exists "Public insert clicks" on public.link_clicks;
drop policy if exists "Public insert interests" on public.donation_interests;
drop policy if exists "Public insert availability" on public.availability_requests;

revoke all on public.page_visits from anon, authenticated;
revoke all on public.link_clicks from anon, authenticated;
revoke all on public.donation_interests from anon, authenticated;
revoke all on public.availability_requests from anon, authenticated;
revoke all on public.contact_messages from anon, authenticated;
grant select on public.campaigns, public.posts, public.photos, public.affiliates to anon, authenticated;

-- Initial affiliates. Re-running this does not create duplicates.
insert into public.affiliates (name, description, active, sort_order)
select 'VillageServer Initiative', 'Offline gospel access and field technology initiative.', true, 10
where not exists (select 1 from public.affiliates where name = 'VillageServer Initiative');

insert into public.affiliates (name, description, active, sort_order)
select 'Digital Bible Society', 'Digital Bible resources and library support.', true, 20
where not exists (select 1 from public.affiliates where name = 'Digital Bible Society');

-- ── Equipment & Funding Application + editable site settings ────────
-- Missionaries and field partners apply for equipment/funding here.
-- Submissions arrive through /api/track (service role) and are read in the
-- admin panel. The applications_open flag lets an admin turn the public
-- application section on or off without a code deploy.
create table if not exists public.equipment_applications (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  name text not null,
  email text not null,
  phone_country_code text,
  phone text,
  organization text,
  role text,
  country text not null,
  region text,
  mission_context text,
  equipment_needed jsonb not null default '[]'::jsonb,
  funding_needed text,
  timeframe text,
  message text,
  status text not null default 'new',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Older databases created equipment_applications before some of these
-- columns existed — add them all before any index references them.
alter table public.equipment_applications add column if not exists visitor_id text;
alter table public.equipment_applications add column if not exists site_host text;
alter table public.equipment_applications add column if not exists phone_country_code text;
alter table public.equipment_applications add column if not exists phone text;
alter table public.equipment_applications add column if not exists organization text;
alter table public.equipment_applications add column if not exists role text;
alter table public.equipment_applications add column if not exists region text;
alter table public.equipment_applications add column if not exists mission_context text;
alter table public.equipment_applications add column if not exists equipment_needed jsonb not null default '[]'::jsonb;
alter table public.equipment_applications add column if not exists funding_needed text;
alter table public.equipment_applications add column if not exists timeframe text;
alter table public.equipment_applications add column if not exists message text;
alter table public.equipment_applications add column if not exists status text not null default 'new';
alter table public.equipment_applications add column if not exists utm_source text;
alter table public.equipment_applications add column if not exists utm_medium text;
alter table public.equipment_applications add column if not exists utm_campaign text;

create index if not exists equipment_applications_created_idx on public.equipment_applications (created_at desc);
create index if not exists equipment_applications_status_idx on public.equipment_applications (status);

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at before update on public.site_settings
for each row execute function public.set_updated_at();

alter table public.equipment_applications enable row level security;
alter table public.site_settings enable row level security;

-- Applications are private: writes and admin reads use the service role only.
revoke all on public.equipment_applications from anon, authenticated;

-- The applications_open flag may be read publicly so the application page
-- knows whether to show the form. Writes still require the service role.
drop policy if exists "Public reads settings" on public.site_settings;
create policy "Public reads settings" on public.site_settings for select to anon, authenticated using (true);
grant select on public.site_settings to anon, authenticated;

-- Default: applications stay OFF until the nonprofit setup is complete.
insert into public.site_settings (key, value)
select 'applications_open', 'false'::jsonb
where not exists (select 1 from public.site_settings where key = 'applications_open');

-- ── Intake redesign: structured application fields ──────────────────
-- Single-select kit tier (1 microSD · 2 Wi-Fi hub · 3 Raspberry Pi ·
-- 4 Projector & audio · 5 Satellite), reach/audience signals, mission
-- context, identity & verification, receiving plan, and rule-based
-- triage output. All nullable so legacy rows stay valid.
alter table public.equipment_applications add column if not exists kit_tier smallint check (kit_tier between 1 and 5);
alter table public.equipment_applications add column if not exists reach_justification text;
alter table public.equipment_applications add column if not exists audience_type text check (audience_type in ('individual','small_group','village_congregation','regional_network'));
alter table public.equipment_applications add column if not exists frequency_of_use text check (frequency_of_use in ('one_time','weekly','daily'));
alter table public.equipment_applications add column if not exists has_gathering_infrastructure boolean;
alter table public.equipment_applications add column if not exists gathering_infrastructure_desc text;
alter table public.equipment_applications add column if not exists languages text;
alter table public.equipment_applications add column if not exists literacy_context text;
alter table public.equipment_applications add column if not exists power_internet_access text check (power_internet_access in ('none','limited','reliable'));
alter table public.equipment_applications add column if not exists org_website text;
alter table public.equipment_applications add column if not exists sending_org text;
alter table public.equipment_applications add column if not exists reference_name text;
alter table public.equipment_applications add column if not exists reference_contact text;
alter table public.equipment_applications add column if not exists referral_source text check (referral_source in ('existing_partner','church_network','conference','search','social_media','other'));
alter table public.equipment_applications add column if not exists years_in_field text;
alter table public.equipment_applications add column if not exists current_reach text;
alter table public.equipment_applications add column if not exists supporting_document text;
alter table public.equipment_applications add column if not exists supporting_document_name text;
alter table public.equipment_applications add column if not exists receiving_plan text check (receiving_plan in ('cover_import_costs','transport_partner','approved_retailer','alternative_plan','need_help'));
alter table public.equipment_applications add column if not exists receiving_plan_details text;
alter table public.equipment_applications add column if not exists preferred_contact_method text;
alter table public.equipment_applications add column if not exists contact_timezone text;
-- Verification flags + triage output (computed server-side on submit)
alter table public.equipment_applications add column if not exists email_domain_match boolean;
alter table public.equipment_applications add column if not exists reference_provided boolean;
alter table public.equipment_applications add column if not exists web_presence_found boolean;
alter table public.equipment_applications add column if not exists triage_score smallint;
alter table public.equipment_applications add column if not exists triage_confidence text check (triage_confidence in ('Low','Medium','High'));
alter table public.equipment_applications add column if not exists triage_flags jsonb not null default '[]'::jsonb;
alter table public.equipment_applications add column if not exists triage_note text;
alter table public.equipment_applications add column if not exists fast_track boolean not null default false;
-- Review workflow: submitted / under_review / approved / declined / waitlisted
-- ('new' remains on legacy rows)
alter table public.equipment_applications add column if not exists admin_notes text;
alter table public.equipment_applications add column if not exists status_updated_at timestamptz;

create index if not exists equipment_applications_triage_idx on public.equipment_applications (triage_confidence, fast_track);

-- ── Deployment log — mirrors Eric's Excel sheet column-for-column ───
-- One row per equipped missionary/team. Resource columns are text so the
-- sheet's mixed values ("2", "Yes", model names) survive round-trips to
-- CSV/Excel exactly. in_person_support holds the repeating workshop list
-- as [{"label": "1st Workshop", "date": "2026-06-25"}].
create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  name text not null,                      -- Name / Group / Missionary Team
  date date,
  contact_information text,
  country text,
  region_village text,
  raspberry_pi_5 text,
  power_supply text,                       -- e.g. Solar Suitcase
  satellite_dish text,
  lnb text,
  receiver text,
  satellite_finder text,
  coax_cable text,
  usb_a_to_c text,
  usb_a_to_micro_b text,
  projector text,
  speakers text,
  language_card text,
  usb_adapter text,
  newq_device text,
  charger_100w_20_port text,
  bibles text,
  monetary_support text,
  online_support text,
  in_person_support jsonb not null default '[]'::jsonb,
  power_charger_for_raspberry text,
  highlights text,
  follow_up_needed text,
  additional_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Link deployments to applications. Older production databases use a
-- bigint id on equipment_applications while fresh installs use uuid, so
-- create application_id with whatever type the live table actually has.
do $$
declare
  app_id_type text;
begin
  select data_type into app_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'equipment_applications'
    and column_name = 'id';
  if app_id_type is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'deployments'
      and column_name = 'application_id'
  ) then
    execute format(
      'alter table public.deployments add column application_id %s references public.equipment_applications(id) on delete set null',
      app_id_type
    );
  end if;
end $$;

create index if not exists deployments_date_idx on public.deployments (date desc);
create index if not exists deployments_application_idx on public.deployments (application_id);

drop trigger if exists deployments_set_updated_at on public.deployments;
create trigger deployments_set_updated_at before update on public.deployments
for each row execute function public.set_updated_at();

alter table public.deployments enable row level security;
revoke all on public.deployments from anon, authenticated;

-- Seed: the four deployments from Eric's existing Excel log.
-- Re-running does not duplicate (guarded by name).
insert into public.deployments (name, date, contact_information, country, region_village, raspberry_pi_5, power_supply, lnb, receiver, satellite_finder, usb_a_to_c, usb_a_to_micro_b, projector, language_card, usb_adapter, newq_device, charger_100w_20_port, in_person_support, power_charger_for_raspberry)
select 'Paul Stewart', '2026-08-15', '802-498-3773', 'Kenya', 'Lanette', 'Raspberry Pi 5', 'Solar Suitcase', 'LO 10750', 'GT Media UHD 4K', 'GT Media V8 Finder 2', '2', '4', 'Aurzen Eazze D1', 'English', '2', 'NewQ Filehub', 'Yes', '[{"label":"1st Workshop","date":"2026-06-25"}]'::jsonb, 'Insignia 45 W'
where not exists (select 1 from public.deployments where name = 'Paul Stewart');

insert into public.deployments (name, country, in_person_support)
select 'Doug Stogsdill', 'Peru', '[{"label":"1st Workshop","date":"2026-06-25"}]'::jsonb
where not exists (select 1 from public.deployments where name = 'Doug Stogsdill');

insert into public.deployments (name, country, region_village, power_supply, lnb, satellite_finder, projector, in_person_support)
select 'Uche Okemiri', 'Nigeria', 'Abuja', 'Solar Suitcase', 'LO 10750', 'GT Media V8 Finder 2', 'Aurzen Eazze D1', '[{"label":"2nd Workshop","date":"2026-07-14"}]'::jsonb
where not exists (select 1 from public.deployments where name = 'Uche Okemiri');

insert into public.deployments (name, country, power_supply, lnb, satellite_finder, projector, in_person_support)
select 'Sam Sikapizye', 'Zambia', 'Solar Suitcase', 'LO 10751', 'GT Media V8 Finder 2', 'Aurzen Eazze D1', '[{"label":"2nd Workshop","date":"2026-07-14"}]'::jsonb
where not exists (select 1 from public.deployments where name = 'Sam Sikapizye');

-- ── Site assistant leads ────────────────────────────────────────────
-- The public chat assistant (api/assistant.js) captures interested
-- missionaries/field partners here when they don't complete the full
-- application. Private: service-role writes and admin reads only.
create table if not exists public.assistant_leads (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  site_host text,
  name text,
  email text,
  country text,
  interest text,
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_leads_created_idx on public.assistant_leads (created_at desc);

alter table public.assistant_leads enable row level security;
revoke all on public.assistant_leads from anon, authenticated;

-- Confirm all expected tables exist after running the migration.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'campaigns', 'posts', 'photos', 'affiliates',
    'page_visits', 'link_clicks', 'donation_interests', 'availability_requests',
    'contact_messages', 'equipment_applications', 'site_settings', 'deployments',
    'assistant_leads'
  )
order by table_name;
