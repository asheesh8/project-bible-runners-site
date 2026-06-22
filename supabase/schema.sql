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
  created_at timestamptz not null default now()
);

create table if not exists public.donation_interests (
  id uuid primary key default gen_random_uuid(),
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

-- Add newer columns when upgrading an older database.
alter table public.campaigns add column if not exists updated_at timestamptz not null default now();
alter table public.posts add column if not exists updated_at timestamptz not null default now();
alter table public.photos add column if not exists updated_at timestamptz not null default now();
alter table public.affiliates add column if not exists updated_at timestamptz not null default now();
alter table public.page_visits add column if not exists site_host text;
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
create index if not exists page_visits_utm_source_idx on public.page_visits (utm_source);
create index if not exists page_visits_site_host_idx on public.page_visits (site_host);
create index if not exists donation_interests_created_idx on public.donation_interests (created_at desc);
create index if not exists donation_interests_country_idx on public.donation_interests (country);
create index if not exists availability_requests_created_idx on public.availability_requests (created_at desc);
create index if not exists availability_requests_country_idx on public.availability_requests (country);

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.campaigns enable row level security;
alter table public.posts enable row level security;
alter table public.photos enable row level security;
alter table public.affiliates enable row level security;
alter table public.page_visits enable row level security;
alter table public.donation_interests enable row level security;
alter table public.availability_requests enable row level security;

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
drop policy if exists "Public insert interests" on public.donation_interests;
drop policy if exists "Public insert availability" on public.availability_requests;

revoke all on public.page_visits from anon, authenticated;
revoke all on public.donation_interests from anon, authenticated;
revoke all on public.availability_requests from anon, authenticated;
grant select on public.campaigns, public.posts, public.photos, public.affiliates to anon, authenticated;

-- Initial affiliates. Re-running this does not create duplicates.
insert into public.affiliates (name, description, active, sort_order)
select 'Project Bible Runners', 'Scripture access and field relationships.', true, 10
where not exists (select 1 from public.affiliates where name = 'Project Bible Runners');

insert into public.affiliates (name, description, active, sort_order)
select 'Digital Bible Society', 'Digital Bible resources and library support.', true, 20
where not exists (select 1 from public.affiliates where name = 'Digital Bible Society');

-- Confirm all expected tables exist after running the migration.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'campaigns', 'posts', 'photos', 'affiliates',
    'page_visits', 'donation_interests', 'availability_requests'
  )
order by table_name;
