-- Laura Agent migration only.
-- Safe to run more than once in Supabase SQL Editor.

create extension if not exists pgcrypto;

alter table public.equipment_applications
add column if not exists shipping_address text;

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

create index if not exists assistant_leads_created_idx
on public.assistant_leads (created_at desc);

alter table public.assistant_leads enable row level security;
revoke all on public.assistant_leads from anon, authenticated;

create table if not exists public.assistant_usage (
  id uuid primary key default gen_random_uuid(),
  visitor_key text,
  ip_key text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_usage_created_idx
on public.assistant_usage (created_at desc);

create index if not exists assistant_usage_visitor_idx
on public.assistant_usage (visitor_key, created_at desc);

create index if not exists assistant_usage_ip_idx
on public.assistant_usage (ip_key, created_at desc);

alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

create or replace function public.consume_assistant_quota(
  p_visitor_key text,
  p_ip_key text,
  p_window_hours integer default 6,
  p_visitor_limit integer default 10,
  p_ip_limit integer default 30,
  p_global_limit integer default 1000
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_window timestamptz := now() - make_interval(hours => p_window_hours);
  cutoff_day timestamptz := now() - interval '24 hours';
begin
  perform pg_advisory_xact_lock(84657821);

  if (select count(*) from public.assistant_usage where created_at >= cutoff_day) >= p_global_limit
    or (p_visitor_key is not null and
      (select count(*) from public.assistant_usage where visitor_key = p_visitor_key and created_at >= cutoff_window) >= p_visitor_limit)
    or (p_ip_key is not null and
      (select count(*) from public.assistant_usage where ip_key = p_ip_key and created_at >= cutoff_window) >= p_ip_limit)
  then
    return false;
  end if;

  insert into public.assistant_usage (visitor_key, ip_key)
  values (p_visitor_key, p_ip_key);
  return true;
end;
$$;

revoke all on function public.consume_assistant_quota(text, text, integer, integer, integer, integer)
from public, anon, authenticated;

grant execute on function public.consume_assistant_quota(text, text, integer, integer, integer, integer)
to service_role;

create table if not exists public.assistant_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  visitor_id text,
  site_host text,
  email text not null,
  messages jsonb not null default '[]'::jsonb,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_transcripts_updated_idx
on public.assistant_transcripts (updated_at desc);

alter table public.assistant_transcripts enable row level security;
revoke all on public.assistant_transcripts from anon, authenticated;

create table if not exists public.intake_threads (
  id uuid primary key default gen_random_uuid(),
  application_id text not null unique,
  thread_token text unique not null,
  applicant_name text,
  applicant_email text,
  state text not null default 'new',
  owner text not null default 'laura',
  summary text,
  missing_fields jsonb not null default '[]'::jsonb,
  next_follow_up_at timestamptz,
  digest_pending boolean not null default true,
  digest_last_sent_at timestamptz,
  gmail_thread_id text,
  last_agent_run_at timestamptz,
  last_customer_message_at timestamptz,
  last_larry_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.intake_threads(id) on delete cascade,
  role text not null,
  channel text not null default 'email',
  direction text not null default 'internal',
  action_type text,
  subject text,
  body text,
  from_email text,
  to_email jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  provider text,
  provider_message_id text,
  gmail_message_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_filing_items (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.intake_threads(id) on delete cascade,
  application_id text,
  item_type text not null default 'follow_up',
  state text not null default 'pending',
  title text not null,
  detail text,
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_digests (
  id uuid primary key default gen_random_uuid(),
  digest_key text unique not null,
  sent_to text not null,
  thread_ids jsonb not null default '[]'::jsonb,
  subject text,
  body text,
  status text not null default 'draft',
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists intake_threads_created_idx
on public.intake_threads (created_at desc);

create index if not exists intake_threads_state_idx
on public.intake_threads (state, updated_at desc);

create index if not exists intake_threads_digest_idx
on public.intake_threads (digest_pending, updated_at desc);

create index if not exists intake_threads_applicant_email_idx
on public.intake_threads (applicant_email);

create index if not exists intake_messages_thread_idx
on public.intake_messages (thread_id, created_at);

create index if not exists intake_messages_status_idx
on public.intake_messages (status, created_at desc);

create index if not exists intake_messages_gmail_idx
on public.intake_messages (gmail_message_id);

create index if not exists agent_filing_items_state_idx
on public.agent_filing_items (state, due_at nulls last, created_at desc);

create index if not exists agent_filing_items_thread_idx
on public.agent_filing_items (thread_id, created_at desc);

create index if not exists agent_digests_created_idx
on public.agent_digests (created_at desc);

drop trigger if exists intake_threads_set_updated_at on public.intake_threads;
create trigger intake_threads_set_updated_at before update on public.intake_threads
for each row execute function public.set_updated_at();

drop trigger if exists agent_filing_items_set_updated_at on public.agent_filing_items;
create trigger agent_filing_items_set_updated_at before update on public.agent_filing_items
for each row execute function public.set_updated_at();

alter table public.intake_threads enable row level security;
alter table public.intake_messages enable row level security;
alter table public.agent_filing_items enable row level security;
alter table public.agent_digests enable row level security;

revoke all on public.intake_threads from anon, authenticated;
revoke all on public.intake_messages from anon, authenticated;
revoke all on public.agent_filing_items from anon, authenticated;
revoke all on public.agent_digests from anon, authenticated;

insert into public.site_settings (key, value)
select 'laura_agent_enabled', 'true'::jsonb
where not exists (
  select 1 from public.site_settings where key = 'laura_agent_enabled'
);

insert into public.site_settings (key, value)
select 'laura_auto_send_missing_info', 'false'::jsonb
where not exists (
  select 1 from public.site_settings where key = 'laura_auto_send_missing_info'
);

insert into public.site_settings (key, value)
select 'larry_cal_booking_url', '""'::jsonb
where not exists (
  select 1 from public.site_settings where key = 'larry_cal_booking_url'
);

-- How much Laura may send without Larry seeing it first:
-- 'draft_only' | 'staged' | 'full'. See supabase/schema.sql for the full note.
insert into public.site_settings (key, value)
select 'laura_autonomy', '"staged"'::jsonb
where not exists (
  select 1 from public.site_settings where key = 'laura_autonomy'
);

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'assistant_leads',
    'assistant_usage',
    'assistant_transcripts',
    'intake_threads',
    'intake_messages',
    'agent_filing_items',
    'agent_digests'
  )
order by table_name;
