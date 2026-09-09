-- Proof-of-ministry verification + campaign funnel columns.
-- Safe to run more than once in Supabase SQL Editor.
--
-- Larry's requirement: an application is not reviewable until the ministry
-- behind it has been verified — referrals, a government photo ID, pastoral
-- licensing or authorization, ministry/service photos, and an interview with
-- Laura. Applicants who cannot safely carry or send ministry documents take
-- the exemption path instead: two independent referees and the interview.

-- Which route the applicant took through verification.
--   documents     — sent ID, licensing, and ministry photos
--   safety_exempt — cannot safely share documents; verified by referees + interview
alter table public.equipment_applications
add column if not exists ministry_verification_mode text
check (ministry_verification_mode in ('documents','safety_exempt'));

-- Where the pastoral licensing / ordination / commissioning comes from.
alter table public.equipment_applications add column if not exists ministry_license_body text;
alter table public.equipment_applications add column if not exists ministry_license_ref text;

-- Uploaded evidence. Data URLs, same storage pattern as supporting_document.
-- Images are downscaled in the browser before upload; PDFs are size-capped.
alter table public.equipment_applications add column if not exists id_document text;
alter table public.equipment_applications add column if not exists id_document_name text;
alter table public.equipment_applications add column if not exists license_document text;
alter table public.equipment_applications add column if not exists license_document_name text;
-- Array of { name, data } — ministry/service photos, at most 3.
alter table public.equipment_applications
add column if not exists ministry_photos jsonb not null default '[]'::jsonb;

-- Referrals. The first reference already existed; these give it a stated
-- relationship and add the second referee the exemption path requires.
alter table public.equipment_applications add column if not exists reference_relationship text;
alter table public.equipment_applications add column if not exists reference2_name text;
alter table public.equipment_applications add column if not exists reference2_contact text;
alter table public.equipment_applications add column if not exists reference2_relationship text;

-- The interview with Laura.
alter table public.equipment_applications add column if not exists interview_consent boolean;
alter table public.equipment_applications add column if not exists interview_availability text;
alter table public.equipment_applications add column if not exists interview_status text
check (interview_status in ('not_needed','required','invited','scheduled','completed','declined'));
alter table public.equipment_applications add column if not exists interview_completed_at timestamptz;

-- Why documents cannot be sent, in the applicant's own words.
alter table public.equipment_applications add column if not exists safety_exempt_reason text;

-- Rolled-up verification state, computed on submit and updated by review.
alter table public.equipment_applications add column if not exists verification_status text
check (verification_status in ('unverified','pending_review','interview_required','verified','rejected'));
alter table public.equipment_applications add column if not exists verification_score smallint;
alter table public.equipment_applications add column if not exists verification_note text;

-- Which funnel the application arrived through. 'kenya_schools' is the
-- Facebook campaign funnel; null/'general' is the main site application.
alter table public.equipment_applications add column if not exists funnel text;

create index if not exists equipment_applications_verification_idx
on public.equipment_applications (verification_status, interview_status);

create index if not exists equipment_applications_funnel_idx
on public.equipment_applications (funnel, created_at desc);
