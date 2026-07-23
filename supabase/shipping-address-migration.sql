-- Equipment application shipping/delivery field.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.equipment_applications
add column if not exists shipping_address text;
